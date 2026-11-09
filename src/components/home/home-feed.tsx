import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { agoraPhotoUrl, fetchAgoraFeed } from '@/lib/api/agora';
import { fetchPeopleWeek, formatPeopleHours, type PeopleWeek } from '@/lib/api/home';
import { getErrorMessage } from '@/lib/errors';
import type { AgoraItem, AgoraScope } from '@/types/database';

// HOME = THE FEED (ShareSpot mock 344). Pinterest-style two-column masonry over the existing Agora
// backend (get_agora_feed). Comment-only, no likes: a card shows 💬 and nothing else countable.
//
//   Home    → scope 'all'     — your friends' posts + everything made for a room you're in.
//   Friends → scope 'friends' — your friends' posts only.
// An empty 'all' (a brand-new account) falls back to 'everyone' so the app never opens on a void.
//
// Lock-in shows up AS a feed card ("your people are on a roll"), not a separate screen — that's the
// collective from get_people_week_hours (0288), slotted in as the second card.

type MediaFilter = 'all' | 'photos' | 'text';
const FILTERS: { key: MediaFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'photos', label: 'Photos' },
  { key: 'text', label: 'Text' },
];

/** The image a card leads with: a photo, else real art (ss3's resolver, 0298), else a session photo. */
export function feedCardImage(item: AgoraItem): string | null {
  const photo = agoraPhotoUrl(item.photo_path);
  if (photo) return photo;
  for (const a of item.attachments ?? []) {
    if (a.snapshot?.art_url) return a.snapshot.art_url;
    const p = a.snapshot?.photos?.[0];
    if (p) return agoraPhotoUrl(p);
  }
  return null;
}

/** One-line tag for an attachment-led card ("🏋 PR · first 10k", "🎉 Win"). */
function feedCardTag(item: AgoraItem): string | null {
  const a = item.attachments?.[0];
  if (!a) return null;
  const s = a.snapshot ?? {};
  switch (a.kind) {
    case 'pr':
      return `🏋 PR${s.headline ? ` · ${s.headline}` : ''}`;
    case 'milestone':
      return `🎉 ${s.headline ?? 'Win'}`;
    case 'lockin':
      return `🔥 ${s.goal_label ?? 'Locked in'}`;
    case 'art':
      return s.title ? `${s.title}${s.subtitle ? ` · ${s.subtitle}` : ''}` : null;
    case 'rank':
    case 'streak':
      return '🎉 Win';
    case 'link':
      return s.provider ? `↗ ${s.provider}` : '↗ Link';
    default:
      return null;
  }
}

export function HomeFeed({ scope }: { scope: Extract<AgoraScope, 'all' | 'friends'> }) {
  const router = useRouter();
  const [items, setItems] = useState<AgoraItem[] | null>(null);
  const [week, setWeek] = useState<PeopleWeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MediaFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [usedScope, setUsedScope] = useState<AgoraScope>(scope);
  const done = useRef(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      done.current = false;
      let next = await fetchAgoraFeed(scope, null, 30);
      let s: AgoraScope = scope;
      if (next.length === 0 && scope === 'all') {
        next = await fetchAgoraFeed('everyone', null, 30);
        s = 'everyone';
      }
      setUsedScope(s);
      setItems(next);
      if (next.length < 30) done.current = true;
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load the feed.'));
      setItems((prev) => prev ?? []);
    }
    fetchPeopleWeek()
      .then(setWeek)
      .catch(() => setWeek(null));
  }, [scope]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const loadMore = useCallback(async () => {
    if (!items?.length || done.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const last = items[items.length - 1];
      const more = await fetchAgoraFeed(usedScope, { created_at: last.created_at, id: last.id }, 30);
      if (more.length < 30) done.current = true;
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((p) => `${p.item_type}:${p.id}`));
        return [...(prev ?? []), ...more.filter((m) => !seen.has(`${m.item_type}:${m.id}`))];
      });
    } catch {
      // A failed page is retried by the next scroll-to-bottom.
    } finally {
      setLoadingMore(false);
    }
  }, [items, usedScope, loadingMore]);

  const shown = useMemo(() => {
    const list = items ?? [];
    if (filter === 'photos') return list.filter((i) => feedCardImage(i));
    if (filter === 'text') return list.filter((i) => !feedCardImage(i) && i.body?.trim());
    return list;
  }, [items, filter]);

  // Masonry by estimated height, not by alternation — a tall photo shouldn't leave one column short.
  const columns = useMemo(() => {
    const cols: { key: string; node: 'week' | AgoraItem }[][] = [[], []];
    const h = [0, 0];
    const push = (key: string, node: 'week' | AgoraItem, est: number) => {
      const c = h[0] <= h[1] ? 0 : 1;
      cols[c].push({ key, node });
      h[c] += est;
    };
    shown.forEach((item, i) => {
      if (i === 1 && week && week.thisWeekSeconds > 0 && scope === 'all') push('week', 'week', 150);
      const img = feedCardImage(item);
      push(`${item.item_type}:${item.id}`, item, (img ? 190 : 40) + Math.min(120, (item.body?.length ?? 0) * 0.6) + 50);
    });
    return cols;
  }, [shown, week, scope]);

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          tintColor={Colors.navEmber}
        />
      }
      onScroll={({ nativeEvent: n }) => {
        if (n.layoutMeasurement.height + n.contentOffset.y > n.contentSize.height - 600) void loadMore();
      }}
      scrollEventThrottle={250}>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[styles.filter, filter === f.key && styles.filterOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f.key }}>
            <Text style={[styles.filterText, filter === f.key && styles.filterTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {items === null ? (
        <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
      ) : shown.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{error ?? (scope === 'friends' ? 'No posts from friends yet' : 'Nothing here yet')}</Text>
          <Text style={styles.emptyBody}>Post something, or find your people in Search.</Text>
          <Pressable style={styles.emptyBtn} onPress={() => router.push('/agora/compose')} accessibilityRole="button">
            <Text style={styles.emptyBtnText}>Post</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.grid}>
          {columns.map((col, ci) => (
            <View key={ci} style={styles.col}>
              {col.map(({ key, node }) =>
                node === 'week' ? (
                  <WeekCard key={key} week={week!} onPress={() => router.navigate('/lockin')} />
                ) : (
                  <FeedCard key={key} item={node} />
                )
              )}
            </View>
          ))}
        </View>
      )}
      {loadingMore ? <ActivityIndicator color={Colors.navEmber} style={styles.more} /> : null}
    </ScrollView>
  );
}

function FeedCard({ item }: { item: AgoraItem }) {
  const router = useRouter();
  const img = feedCardImage(item);
  const tag = feedCardTag(item);
  const sub = [item.audience_name ? `${item.audience_emoji ?? ''} ${item.audience_name}`.trim() : null, item.university]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push({ pathname: '/agora/[id]', params: { id: item.id, type: item.item_type } })}
      accessibilityRole="button"
      accessibilityLabel={`Post by ${item.display_name}${item.body ? `: ${item.body}` : ''}`}>
      {img ? <Image source={{ uri: img }} style={styles.cardImg} contentFit="cover" transition={150} /> : null}
      <View style={styles.cardBody}>
        {tag ? (
          <Text style={styles.tag} numberOfLines={1}>
            {tag}
          </Text>
        ) : null}
        {item.body ? (
          <Text style={[styles.caption, !img && styles.captionBig]} numberOfLines={img ? 3 : 7}>
            {item.body}
          </Text>
        ) : null}
        <Pressable
          style={styles.author}
          onPress={() => router.push({ pathname: '/friend-profile', params: { userId: item.user_id } })}
          hitSlop={4}
          accessibilityRole="link"
          accessibilityLabel={`${item.display_name}'s Campfire`}>
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={styles.avatar} contentFit="cover" />
          ) : (
            <Avatar label={(item.display_name || '?').slice(0, 2).toUpperCase()} size={22} />
          )}
          <View style={styles.authorText}>
            <Text style={styles.name} numberOfLines={1}>
              {item.display_name}
            </Text>
            {sub ? (
              <Text style={styles.sub} numberOfLines={1}>
                {sub}
              </Text>
            ) : null}
          </View>
          <Text style={styles.comments}>💬 {item.comments}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function WeekCard({ week, onPress }: { week: PeopleWeek; onPress: () => void }) {
  return (
    <Pressable style={[styles.card, styles.weekCard]} onPress={onPress} accessibilityRole="button">
      <Text style={styles.weekKicker}>🔥 Your people are on a roll</Text>
      <Text style={styles.weekBig}>{formatPeopleHours(week.thisWeekSeconds)}</Text>
      <Text style={styles.weekSub}>locked in together this week</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 10, paddingBottom: 120 },
  filters: { flexDirection: 'row', gap: 6, paddingHorizontal: 4, paddingBottom: 10 },
  filter: {
    paddingVertical: 6,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  filterOn: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  filterText: { fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.muted },
  filterTextOn: { color: Colors.cream },
  loader: { marginTop: Spacing.five },
  more: { marginVertical: Spacing.three },
  grid: { flexDirection: 'row', gap: 8 },
  col: { flex: 1, gap: 8 },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  cardImg: { width: '100%', aspectRatio: 0.82, backgroundColor: Colors.spacePanel2 },
  cardBody: { padding: 10, gap: 6 },
  tag: { fontFamily: Fonts.bodyBold, fontSize: 11.5, color: Colors.navEmber2 },
  caption: { fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 17, color: Colors.ink },
  captionBig: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.bodySemiBold },
  author: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  avatar: { width: 22, height: 22, borderRadius: 11 },
  authorText: { flex: 1 },
  name: { fontFamily: Fonts.bodyBold, fontSize: 11.5, color: Colors.ink },
  sub: { fontFamily: Fonts.body, fontSize: 10, color: Colors.spaceDim },
  comments: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.spaceDim },
  weekCard: { padding: 14, gap: 4, backgroundColor: '#2A1530', borderColor: '#5A2A2A' },
  weekKicker: { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.navEmber2 },
  weekBig: { fontFamily: Fonts.black, fontSize: 26, color: Colors.gold },
  weekSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted },
  empty: { marginTop: Spacing.five, alignItems: 'center', gap: 6, paddingHorizontal: Spacing.four },
  emptyTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink, textAlign: 'center' },
  emptyBody: { fontFamily: Fonts.body, fontSize: 13, color: Colors.spaceDim, textAlign: 'center' },
  emptyBtn: { marginTop: Spacing.two, paddingVertical: 9, paddingHorizontal: 20, borderRadius: 999, backgroundColor: Colors.navEmber },
  emptyBtnText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.onEmber },
});
