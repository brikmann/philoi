import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { ItemArt } from '@/components/economy/item-art';
import { PushOffBanner } from '@/components/push-off-banner';
import { RankBadge } from '@/components/rank-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { FlameLogo } from '@/components/ui/flame-logo';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useNotifications } from '@/hooks/use-notifications';
import { getItem } from '@/lib/economy/catalog';
import { formatRelativeTime } from '@/lib/format';
import { RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { NotificationEvent, NotificationImageShape, RankTierName } from '@/types/database';

// The bell feed (§F1, mock 106).
//
// Opening it marks everything read — the badge is "there is something you haven't looked at", and
// you are now looking at it. Per-row read state would mean a list of individually-dismissable
// items, which is an inbox; this is an activity log.

export default function NotificationsScreen() {
  const router = useRouter();
  const { items, loading, error, refreshItems, markAllRead } = useNotifications();

  useEffect(() => {
    // Load and clear the badge together. markAllRead refetches, so this is one round trip, not two.
    markAllRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount; markAllRead is stable per user but re-running on every identity change would re-mark on each render
  }, []);

  function open(n: NotificationEvent) {
    if (!n.route) return;
    // The route was stored when the event was written, so this needs no per-type switch and an old
    // row keeps working after a screen is renamed.
    router.push({ pathname: n.route as never, params: n.route_params as never });
  }

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>Activity</Text>
        <Pressable onPress={() => router.push('/settings-notifications')} hitSlop={12} accessibilityLabel="Notification settings">
          <Ionicons name="options-outline" size={20} color={Colors.muted} />
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* The feed fills either way; this is for the half of delivery the feed can't see. */}
      <PushOffBanner />

      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshItems} tintColor={Colors.coral} />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon={<FlameLogo size={64} />}
              title="Nothing yet"
              body="Friend requests, challenges and campfire activity will show up here."
            />
          )
        }
        renderItem={({ item }) => <Row n={item} onPress={() => open(item)} />}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
    </Screen>
  );
}

function Row({ n, onPress }: { n: NotificationEvent; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!n.route}
      style={({ pressed }) => [styles.row, pressed && n.route ? styles.rowPressed : null]}
      accessibilityRole={n.route ? 'button' : undefined}>
      <NotificationLeadingArt n={n} />
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={2}>
          {n.title}
        </Text>
        {n.body ? (
          <Text style={styles.body} numberOfLines={2}>
            {n.body}
          </Text>
        ) : null}
        <Text style={styles.time}>{formatRelativeTime(n.created_at)}</Text>
      </View>
      {/* Unread marker rather than a highlighted row: the whole list is marked read on open, so a
          background wash would flash and vanish. A dot is a quieter way to say "this arrived since
          you last looked" for the split second it is true. */}
      {n.read_at === null ? <View style={styles.unreadDot} /> : null}
    </Pressable>
  );
}

// ── Composed leading art (client-side, from type + payload) ───────────────────────────────────
//
// A rank-up draws its RankBadge, a cosmetic unlock its own ItemArt, a result a glyph — so the row's
// face carries meaning instead of the generic flame. Social events (nudges, fires, requests,
// messages) fall through to the actor avatar the server already resolved into image_url, and an
// unknown or art-less type still shows the flame. Nothing here depends on the server: the face is
// derived from the row's own `type` + `payload`, so it always matches the current cosmetics.

const RANK_NUMERAL_TO_DIVISION: Record<string, number> = { I: 1, II: 2, III: 3 };

/**
 * `payload.rank` is the server's label — `initcap(tier_key) || ' ' || numeral` (migration 0121), so
 * "Gold II" / "Primordial". The first word lowercased IS the tier enum key, and the numeral maps to
 * the STORED division (1→I, 2→II, 3→III, 0121's own direction) — exactly what RankBadge expects. A
 * label we can't resolve returns null and the row falls back to the flame.
 */
function parseRankLabel(label: string | undefined): { tier: RankTierName; division: number | null } | null {
  if (!label) return null;
  const parts = label.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  let division: number | null = null;
  let tierWord = label.trim();
  if (RANK_NUMERAL_TO_DIVISION[last] != null) {
    division = RANK_NUMERAL_TO_DIVISION[last];
    tierWord = parts.slice(0, -1).join(' ');
  }
  const tier = tierWord.toLowerCase() as RankTierName;
  if (!(tier in RANK_TIER_METAL)) return null;
  return { tier, division };
}

/** A small trophy — gold for a win, muted outline for a loss. */
function ResultGlyph({ won = false }: { won?: boolean }) {
  const c = won ? '#F5C542' : Colors.muted;
  return (
    <Svg width={24} height={24} viewBox="0 0 40 40">
      <Path d="M13 8 h14 v6 a7 7 0 0 1 -14 0 Z" fill={won ? c : 'none'} stroke={c} strokeWidth={won ? 0 : 2} />
      <Path d="M27 9.5 h3.5 a3.5 3.5 0 0 1 -3.5 4.5 M13 9.5 h-3.5 a3.5 3.5 0 0 0 3.5 4.5" fill="none" stroke={c} strokeWidth={2} />
      <Path d="M18.2 20 h3.6 v5.4 h-3.6 Z" fill={c} />
      <Path d="M14 25.6 h12 v2.6 a1.6 1.6 0 0 1 -1.6 1.6 h-8.8 a1.6 1.6 0 0 1 -1.6 -1.6 Z" fill={c} />
    </Svg>
  );
}

/** The 44px masked slot, shared with the avatar/flame path, backing composed art on a dark disc. */
function ArtSlot({ shape, children }: { shape: NotificationImageShape; children: ReactNode }) {
  return <View style={[styles.art, styles.artCompose, SHAPE_STYLE[shape]]}>{children}</View>;
}

function NotificationLeadingArt({ n }: { n: NotificationEvent }) {
  switch (n.type) {
    case 'ranked_up': {
      const parsed = parseRankLabel(typeof n.payload?.rank === 'string' ? n.payload.rank : undefined);
      if (parsed) {
        return (
          <ArtSlot shape="hexagon">
            <RankBadge tier={parsed.tier} division={parsed.division ?? undefined} size={32} />
          </ArtSlot>
        );
      }
      break; // no usable label → flame fallback
    }
    case 'reward_ready': {
      const key = typeof n.payload?.relic === 'string' ? n.payload.relic : null;
      const item = key ? getItem(key) : undefined;
      if (item) {
        return (
          <ArtSlot shape="rounded">
            <ItemArt item={item} size={30} motion="off" />
          </ArtSlot>
        );
      }
      break; // unknown key → flame fallback
    }
    case 'challenge_won':
    case 'campfire_settled':
      return (
        <ArtSlot shape="rounded">
          <ResultGlyph won />
        </ArtSlot>
      );
    case 'challenge_lost':
    case 'challenge_forfeited':
      return (
        <ArtSlot shape="rounded">
          <ResultGlyph />
        </ArtSlot>
      );
  }
  // social + everything else: the actor avatar / flame the server resolved.
  return <LeadingArt url={n.image_url} shape={n.image_shape} />;
}

/**
 * The spec's leading art, masked per subject: circle for avatars, hexagon for ranks, rounded
 * square for campfires and boxes, flame when there is no subject image.
 *
 * Hexagon is approximated with a heavy border radius rather than an SVG clip — react-native-svg
 * cannot mask an <Image> without a mask element, and at 44px the difference between a hexagon and
 * a squircle is not visible. Worth revisiting if the art ever gets bigger.
 */
function LeadingArt({ url, shape }: { url: string | null; shape: NotificationImageShape }) {
  if (!url) {
    return (
      <View style={[styles.art, styles.artFallback]}>
        <FlameLogo size={22} />
      </View>
    );
  }
  return <Image source={{ uri: url }} style={[styles.art, SHAPE_STYLE[shape]]} contentFit="cover" />;
}

const SHAPE_STYLE: Record<NotificationImageShape, { borderRadius: number }> = {
  circle: { borderRadius: 999 },
  hexagon: { borderRadius: 14 },
  rounded: { borderRadius: 12 },
  square: { borderRadius: 4 },
  flame: { borderRadius: 999 },
};

const ART = 44;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.twelve,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  headerTitle: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.coral,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  list: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  emptyWrap: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: Spacing.twelve,
  },
  rowPressed: {
    opacity: 0.6,
  },
  art: {
    width: ART,
    height: ART,
    backgroundColor: Colors.disabled,
  },
  artFallback: {
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Composed art (rank badge / item art / result glyph) on a dark disc, centred and clipped to the
  // per-type shape so it reads like the avatars beside it.
  artCompose: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: Colors.cardDark,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.coral,
  },
  sep: {
    height: 1,
    backgroundColor: Colors.line,
  },
});
