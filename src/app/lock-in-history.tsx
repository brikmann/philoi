import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
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
        style={[styles.row, isSynced && styles.rowSynced]}
        onPress={() =>
          isStrava
            ? router.push({ pathname: '/activity/[checkInId]', params: { checkInId: r.id } })
            : router.push({ pathname: '/lock-in/[checkInId]', params: { checkInId: r.id } })
        }>
        <View style={[styles.rowIcon, isSynced && styles.rowIconSynced]}>
          <DisciplineIcon name={GOAL_TYPE_GLYPH[r.goal_type]} size={16} color={isSynced ? STRAVA_ORANGE : Colors.amber} />
        </View>
        <View style={styles.rowTextCol}>
          <Text style={styles.rowText} numberOfLines={1}>
            {isStrava && r.goal_detail ? r.goal_detail : GOAL_TYPE_META[r.goal_type].label}
            {!isStrava && r.goal_detail ? <Text style={styles.rowDetail}> · {r.goal_detail}</Text> : null}
          </Text>
          <Text style={styles.rowWhen}>{formatWhen(r.created_at)}</Text>
        </View>
        <Text style={styles.rowDur}>{formatSessionDuration(r.duration_seconds ?? 0)}</Text>
        <Ionicons name="chevron-forward" size={13} color={isStrava ? STRAVA_ORANGE : Colors.textTertiary} />
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="chevron-back" size={22} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>Lock-ins</Text>
        {/* Balances the back chevron so the title stays optically centered. */}
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.coral} />
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
              <Ionicons name="flame-outline" size={22} color={Colors.textTertiary} />
              <Text style={styles.emptyText}>No lock-ins yet — your first one will show up here.</Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={Colors.coral} style={styles.footerSpinner} /> : null
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  headerSpacer: {
    width: 22,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.one,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.six,
  },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: Spacing.six,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: Radius.card,
    backgroundColor: Colors.card,
  },
  rowSynced: {
    borderWidth: 1,
    borderColor: 'rgba(252,76,2,0.35)',
    backgroundColor: 'rgba(252,76,2,0.06)',
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: Colors.achieverBg,
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
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
  rowDetail: {
    fontSize: 11,
    color: Colors.muted,
  },
  rowWhen: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  rowDur: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ember,
  },
  footerSpinner: {
    paddingVertical: Spacing.three,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
});
