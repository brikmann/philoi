import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LeaderboardPersonRow } from '@/components/leaderboard-person-row';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { fetchWeeklyXpByUser } from '@/lib/api/weekly-xp';

// THE LEADERBOARD, AS A VIEW INSIDE THE CAMPFIRE (mock 101 frame 3).
//
// It used to be one of three tabs — Leaderboard / Feed / Challenges — and the campfire-as-chat
// pass deletes that tab bar entirely: the chat IS the campfire, and everything else is something
// you open ON TOP of it and then dismiss. So this is a sheet over the same screen, not a route.
// The banner keeps burning behind it and the top bar stays visible above it, which is the whole
// reason it reads as "a panel over my campfire" rather than as somewhere you navigated to.
//
// It deliberately does NOT reach the top of the screen: mock 101 pins it below the top bar (its
// `.lbSheet` starts at 118px) so the campfire's own identity is never covered by its own
// leaderboard. `topInset` is that line, passed down from the screen that knows how tall its
// header actually is.

export type LeaderboardPeriod = 'week' | 'all';

type LeaderboardPanelProps = {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  myUserId: string | undefined;
  /** Where the sheet's top edge sits — under the campfire top bar, per mock 101 frame 3. */
  topInset: number;
};

export function LeaderboardPanel({ visible, onClose, groupId, myUserId, topInset }: LeaderboardPanelProps) {
  const insets = useSafeAreaInsets();
  const { rows, loading, refetch } = useLeaderboard(groupId);
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');

  // §5 · THE TOGGLE CHANGES THE METRIC, NOT JUST THE SORT.
  //
  // It used to rank the week by LOCK-IN COUNT and show total XP underneath, because
  // get_group_leaderboard returns one lifetime score and a count of check-ins and nothing else
  // weekly. Both tabs therefore showed the same two numbers in a different order — reported, fairly,
  // as "This week vs All time is meaningless".
  //
  // The weekly figure now comes from fetchWeeklyXpByUser: XP earned from lock-ins since the shared
  // Sunday 00:00 UTC boundary (lib/time/week.ts), which is the same instant every other weekly
  // timer in the app rolls over on. See that function for why it is a second query rather than a
  // column on the RPC, and for what it deliberately excludes.
  const [weeklyXp, setWeeklyXp] = useState<Record<string, number>>({});
  const [weeklyLoading, setWeeklyLoading] = useState(false);

  // Only fetched when the week tab is actually looked at — opening the panel on All time should
  // not cost a second round trip.
  useEffect(() => {
    if (!visible || period !== 'week' || rows.length === 0) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-open, no caching layer to defer to
    setWeeklyLoading(true);
    fetchWeeklyXpByUser(rows.map((r) => r.user_id))
      .then((totals) => {
        if (!cancelled) setWeeklyXp(totals);
      })
      .catch(() => {
        // The board still renders; everyone reads 0 this week rather than the panel breaking.
      })
      .finally(() => {
        if (!cancelled) setWeeklyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, period, rows]);

  const ordered = useMemo(() => {
    const copy = [...rows];
    if (period === 'week') {
      // Ties on 0 (nobody has locked in yet this week) fall back to the all-time order rather
      // than to whatever the planner returned, so the list is stable between renders.
      copy.sort((a, b) => (weeklyXp[b.user_id] ?? 0) - (weeklyXp[a.user_id] ?? 0) || b.score - a.score);
    } else {
      copy.sort((a, b) => b.score - a.score);
    }
    return copy;
  }, [rows, period, weeklyXp]);

  // Swipe down to dismiss, per the mock's caption ("Swipe down returns to chat"). Built once with
  // useMemo and committed from onUpdate rather than onEnd — the same two lessons the campfire's
  // old feed swipe was fixed with: a gesture rebuilt every render loses the touch it was tracking,
  // and a flick that RNGH cancels never delivers onEnd at all.
  const swipeDown = useMemo(() => {
    const fired = { value: false };
    return Gesture.Pan()
      .activeOffsetY([-12, 12])
      .onBegin(() => {
        fired.value = false;
      })
      .onUpdate((e) => {
        if (fired.value) return;
        if (e.translationY > 40) {
          fired.value = true;
          runOnJS(onClose)();
        }
      });
  }, [onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* The area above the sheet stays a tap-to-dismiss target rather than a dimmer: the campfire
          and its banner are still live up there and covering them would defeat the point. */}
      <View style={styles.root}>
        <Pressable style={[styles.above, { height: topInset }]} onPress={onClose} accessibilityLabel="Close the leaderboard" />

        <GestureDetector gesture={swipeDown}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three }]}>
            <View style={styles.grab} />

            <View style={styles.head}>
              <Text style={styles.title}>Leaderboard</Text>
              <View style={styles.seg}>
                <SegButton label="This week" on={period === 'week'} onPress={() => setPeriod('week')} />
                <SegButton label="All time" on={period === 'all'} onPress={() => setPeriod('all')} />
              </View>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="chevron-down" size={20} color={Colors.muted} />
              </Pressable>
            </View>

            {period === 'week' && (
              <Text style={styles.unitNote}>
                {weeklyLoading ? 'Counting this week\u2019s XP\u2026' : 'XP from lock-ins since Sunday.'}
              </Text>
            )}

            <FlatList
              data={ordered}
              keyExtractor={(r) => r.user_id}
              contentContainerStyle={styles.list}
              refreshing={loading}
              onRefresh={refetch}
              renderItem={({ item, index }) => (
                <LeaderboardPersonRow
                  rank={index + 1}
                  displayName={item.display_name}
                  avatarUrl={item.avatar_url}
                  tier={item.tier}
                  division={item.division}
                  value={
                    period === 'all'
                      ? `${Math.round(item.score).toLocaleString()} XP`
                      : `${Math.round(weeklyXp[item.user_id] ?? 0).toLocaleString()} XP`
                  }
                  // The secondary line is the OTHER period's figure, so flipping the toggle swaps
                  // the two numbers rather than changing only one of them — which is what made the
                  // old version read as if nothing had happened.
                  secondaryValue={
                    period === 'all'
                      ? `🔥 ${item.check_ins_this_week}× this week`
                      : `${Math.round(item.score).toLocaleString()} XP all time`
                  }
                  isMe={item.user_id === myUserId}
                />
              )}
              ListEmptyComponent={
                !loading ? <Text style={styles.empty}>Nobody on the board yet. Lock in to get on it.</Text> : null
              }
            />
          </View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

function SegButton({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.segBtn, on && styles.segBtnOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}>
      <Text style={[styles.segLabel, on && styles.segLabelOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  above: {
    width: '100%',
  },
  sheet: {
    flex: 1,
    backgroundColor: 'rgba(16,11,20,0.94)',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderTopColor: Colors.lineStrong,
    paddingTop: 8,
    paddingHorizontal: Spacing.three,
  },
  grab: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.trackAlt,
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: 12,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
  },
  seg: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 4,
    borderRadius: 12,
  },
  segBtn: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 9,
  },
  segBtnOn: {
    backgroundColor: Colors.selectedBg,
  },
  segLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  segLabelOn: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ember,
  },
  list: {
    paddingBottom: Spacing.four,
  },
  unitNote: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginTop: -6,
    marginBottom: 8,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.muted,
    textAlign: 'center',
    paddingTop: Spacing.four,
  },
});
