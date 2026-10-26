import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { SpaceEmpty, SpaceHeader, SPACE_GUTTER } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchMyLockInsPage, type MyRecentLockIn } from '@/lib/api/check-ins';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { formatSessionDuration } from '@/lib/format';
import { GOAL_TYPE_GLYPH, GOAL_TYPE_META } from '@/lib/goal-types';

const PAGE_SIZE = 30;
const STRAVA_ORANGE = '#FC4C02';

// Every lock-in you've ever logged (punchlist 4C) — reached from Profile's "Lock-ins · See all".
// Profile became the single home for lock-in data once Home's recent-lock-ins journal was removed
// (4B), so this is where the full record lives. Same compact row as Profile's own list, paginated
// because this list is unbounded where that one is capped at six.
function formatWhen(iso: string | undefined): string {
  if (!iso) return '';
  const then = new Date(iso);
  const today = new Date();
  const sameYear = then.getFullYear() === today.getFullYear();
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export default function LockInHistoryScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [items, setItems] = useState<MyRecentLockIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Null once a short page comes back — that's the signal there's nothing left, so onEndReached
  // stops firing requests forever on a list the user keeps flicking at.
  const [exhausted, setExhausted] = useState(false);
  // Guards against FlatList firing onEndReached repeatedly before the in-flight page resolves,
  // which would otherwise fetch the same offset several times and append duplicates.
  const loadingRef = useRef(false);

  // First page: resolved in a promise callback rather than an awaited call in the effect body,
  // so state only ever updates once the fetch settles (matches how every other screen here loads).
  useEffect(() => {
    if (!userId) return;
    fetchMyLockInsPage(userId, { limit: PAGE_SIZE, offset: 0 })
      .then((page) => {
        setItems(page);
        if (page.length < PAGE_SIZE) setExhausted(true);
      })
      .catch((e) => setError(getErrorMessage(e, 'Could not load your lock-ins.')))
      .finally(() => setLoading(false));
  }, [userId]);

  // Subsequent pages, driven by onEndReached. Offset is the current item count, so a page that
  // arrives while the user keeps scrolling still appends in order.
  const loadMore = useCallback(async (offset: number) => {
    if (!userId || loadingRef.current || exhausted) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchMyLockInsPage(userId, { limit: PAGE_SIZE, offset });
      setItems((prev) => [...prev, ...page]);
      if (page.length < PAGE_SIZE) setExhausted(true);
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load more lock-ins.'));
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [userId, exhausted]);

  function renderRow(r: MyRecentLockIn) {
    const isSynced = Boolean(r.source && r.source !== 'manual');
    const isStrava = r.source === 'strava';
    return (
      <Pressable
        style={({ pressed }) => [styles.row, isSynced && styles.rowSynced, pressed && styles.rowPressed]}
        accessibilityRole="button"
        onPress={() =>
          isStrava
            ? router.push({ pathname: '/activity/[checkInId]', params: { checkInId: r.id } })
            : router.push({ pathname: '/lock-in/[checkInId]', params: { checkInId: r.id } })
        }>
        <View style={[styles.rowIcon, isSynced && styles.rowIconSynced]}>
          <DisciplineIcon name={GOAL_TYPE_GLYPH[r.goal_type]} size={16} color={isSynced ? STRAVA_ORANGE : Colors.navEmber2} />
        </View>
        <View style={styles.rowTextCol}>
          <Text style={styles.rowText} numberOfLines={1}>
            {isStrava && r.goal_detail ? r.goal_detail : GOAL_TYPE_META[r.goal_type].label}
            {!isStrava && r.goal_detail ? <Text style={styles.rowDetail}> · {r.goal_detail}</Text> : null}
          </Text>
          <Text style={styles.rowWhen}>{formatWhen(r.created_at)}</Text>
        </View>
        <Text style={styles.rowDur}>{formatSessionDuration(r.duration_seconds ?? 0)}</Text>
        <UiGlyph name="forward" size={13} color={isStrava ? STRAVA_ORANGE : Colors.spaceFaint} />
      </Pressable>
    );
  }

  return (
    // Top edge only: the global footer sits under every screen and owns the bottom inset.
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <SpaceHeader title="Lock-ins" />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.navEmber} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => renderRow(item)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.4}
          onEndReached={() => loadMore(items.length)}
          ListEmptyComponent={
            <View style={styles.centered}>
              <NavGlyph name="flame" size={24} color={Colors.spaceFaint} />
              <SpaceEmpty title="No lock-ins yet" body="Your first one will show up here." />
            </View>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={Colors.navEmber} style={styles.footerSpinner} /> : null
          }
        />
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    // Was Colors.cream, an opaque flat fill that painted over the deep-purple radial. These
    // screens don't route through <Screen>, so the radial reaches them from the navigator's
    // scene background — an opaque colour here blocks it (Ember reskin sweep).
    backgroundColor: 'transparent',
  },
  listContent: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.five,
    gap: 6,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.six,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 10,
    paddingHorizontal: Spacing.twelve,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  rowPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  // Strava's own orange marks a synced row — brand colour, so it stays off the space palette.
  rowSynced: {
    borderColor: 'rgba(252,76,2,0.35)',
    backgroundColor: 'rgba(252,76,2,0.06)',
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,122,47,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconSynced: {
    backgroundColor: 'rgba(252,76,2,0.14)',
  },
  rowTextCol: {
    flex: 1,
    minWidth: 0,
  },
  rowText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  rowDetail: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
  },
  rowWhen: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
    marginTop: 2,
  },
  rowDur: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.navEmber2,
  },
  footerSpinner: {
    paddingVertical: Spacing.three,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.danger,
    textAlign: 'center',
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.two,
  },
});
