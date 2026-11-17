import { Redirect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GYM_BOARD_ROW_HEIGHT, GymBoardRowView } from '@/components/gym-spark/board/gym-board-row';
import { useGymBoard } from '@/components/gym-spark/board/use-gym-board';
import { EmberCta } from '@/components/lockin-hub/ember-cta';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { BoardStoryButton } from '@/components/gym-spark/share/board-story-button';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { GYM_SPARK } from '@/constants/feature-flags';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useActiveSession } from '@/lib/active-session-context';
import type { GymBoardRow, GymBoardWindow } from '@/lib/api/gym-spark';
import { formatWeekCountdown } from '@/lib/time/week';

// THE BOARD (GYM_SPARK, mock 402, CODE_PROMPT_gym_spark.md §3). One leaderboard, everyone on it,
// ranked by sessions — This week (Sunday 00:00 UTC reset, lib/time/week.ts ↔ SQL week_start()) or
// All-time. Reads get_gym_board through lib/api/gym-spark.ts; the ranking metric is the server's to
// swap, this screen just draws `sessions`.
//
// YOUR ROW, ALWAYS: the server always returns the caller's row. It is highlighted in place, and when
// it is not on screen a copy is pinned over the bottom of the list. "On screen" is FlatList's own
// viewability tracking (≥60% of the row showing), so it holds however long the board gets and
// wherever you scroll — no guessing at "the first N rows". The pinned copy floats over the list
// (the list pads its end by one row), so showing or hiding it never resizes the list under it.
//
// Off the flag this route is unreachable from the bar (href:null in the tabs layout) and redirects
// home if deep-linked, so the classic app is unchanged.

const TABS: { key: GymBoardWindow; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'all', label: 'All-time' },
];

/** FlatList refuses a viewabilityConfig that changes identity, so it lives out here. */
const VIEWABILITY = { itemVisiblePercentThreshold: 60 };

export default function BoardScreen() {
  if (!GYM_SPARK) return <Redirect href="/" />;
  return <SparkBoard />;
}

function SparkBoard() {
  const router = useRouter();
  const [range, setRange] = useState<GymBoardWindow>('week');
  const { rows, failed, refreshing, refresh, resetInMs } = useGymBoard(range);
  const { session: activeSession } = useActiveSession();
  // Starts true so a caller on the podium never sees the pin flash before the first viewability pass.
  const [meVisible, setMeVisible] = useState(true);

  // Stable identity on purpose: FlatList throws if onViewableItemsChanged changes between renders.
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    setMeVisible(viewableItems.some((v) => (v.item as GymBoardRow | undefined)?.is_me === true));
  }, []);

  const openRow = useCallback(
    (row: GymBoardRow) => {
      if (row.is_me) router.navigate('/profile');
      else router.push({ pathname: '/friend-profile', params: { userId: row.user_id } });
    },
    [router]
  );

  const me = rows?.find((r) => r.is_me) ?? null;
  // The caller's own 0-session row is always returned; a board where nobody has a session is empty.
  const hasActivity = Boolean(rows?.some((r) => r.sessions > 0));
  const listRows = rows && hasActivity ? rows : [];
  const showPinned = Boolean(me) && hasActivity && !meVisible;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {/* `right` is the slot for the Board's story-sticker share (built separately): it renders
          beside the ✉ / 🔔 / ☰ globals. `me` is the caller's GymBoardRow (null until loaded) and
          `range` is the GymBoardWindow on screen. */}
      <AppTopBar title="The Board" right={<BoardStoryButton row={me} window={range} />} />

      {/* Spec §5: Lock In left the bar, so starting one is an action here (and on the Feed). With a
          session already running it goes back to it instead — the bar's live dot went with the slot. */}
      <EmberCta
        label={activeSession ? 'Return to your session' : 'Start session'}
        leading={<NavGlyph name="flame" size={18} color="#2A0F05" />}
        onPress={() => (activeSession ? router.push('/lock-in') : router.navigate('/lockin'))}
        style={styles.startCta}
      />

      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = t.key === range;
          return (
            <Pressable
              key={t.key}
              onPress={() => setRange(t.key)}
              style={[styles.tab, on && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}>
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.captionRow}>
        <Text style={styles.caption}>{range === 'week' ? 'RANKED BY SESSIONS · RESETS SUNDAY' : 'ALL-TIME SESSIONS'}</Text>
        {range === 'week' ? <Text style={styles.countdown}>{formatWeekCountdown(resetInMs)} left</Text> : null}
      </View>

      <View style={styles.listWrap}>
        <FlatList
          // Remount per tab: each list starts at the top and re-runs its own viewability pass.
          key={range}
          data={listRows}
          keyExtractor={(r) => r.user_id}
          renderItem={({ item }) => <GymBoardRowView row={item} onPress={openRow} />}
          getItemLayout={(_, index) => ({ length: GYM_BOARD_ROW_HEIGHT, offset: GYM_BOARD_ROW_HEIGHT * index, index })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY}
          contentContainerStyle={[styles.listContent, me && hasActivity ? styles.listContentPinned : null]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={Colors.navEmber} />
          }
          ListEmptyComponent={
            rows === null ? (
              failed ? (
                <View style={styles.state}>
                  <Text style={styles.stateBody}>Couldn&apos;t load the board.</Text>
                  <Pressable onPress={() => void refresh()} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.retry}>Try again</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.state}>
                  <ActivityIndicator color={Colors.navEmber} />
                </View>
              )
            ) : (
              <View style={styles.state}>
                <Text style={styles.stateTitle}>{range === 'week' ? 'No sessions yet this week' : 'No sessions yet'}</Text>
                <Text style={styles.stateBody}>Lock in to get on the board.</Text>
                <EmberCta label="Start a session" onPress={() => router.navigate('/lockin')} style={styles.stateCta} />
              </View>
            )
          }
        />

        {showPinned && me ? (
          <View style={styles.pinned} pointerEvents="box-none">
            <GymBoardRowView row={me} onPress={openRow} pinned />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  startCta: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.twelve,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
  },
  tab: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  tabOn: {
    backgroundColor: Colors.navEmber2,
    borderColor: Colors.navEmber2,
  },
  tabText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  tabTextOn: {
    color: Colors.onEmber,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: Spacing.three,
    paddingTop: 14,
    paddingBottom: 6,
  },
  caption: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.8,
    color: Colors.spaceDim,
  },
  countdown: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.spaceFaint,
  },
  listWrap: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    flexGrow: 1,
  },
  // Room for the pinned row, so the last real rows can scroll clear of it.
  listContentPinned: {
    paddingBottom: GYM_BOARD_ROW_HEIGHT + Spacing.four,
  },
  pinned: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.two,
    backgroundColor: Colors.spaceBg,
    borderRadius: 14,
  },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    gap: Spacing.two,
  },
  stateTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
    textAlign: 'center',
  },
  stateBody: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.spaceDim,
    textAlign: 'center',
  },
  stateCta: {
    marginTop: Spacing.three,
    alignSelf: 'stretch',
  },
  retry: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.navEmber2,
  },
});
