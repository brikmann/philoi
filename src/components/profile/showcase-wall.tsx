import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ItemArt } from '@/components/economy/item-art';
import { seasonLabel } from '@/components/profile/trophy-hall-section';
import { Icon } from '@/components/ui/icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchLongestLockIn, fetchMyShowcasePrs, type ShowcasePr, type ShowcaseSession } from '@/lib/api/showcase';
import { getItem } from '@/lib/economy/catalog';
import { featuredTrophies, formatPlacement } from '@/lib/economy/milestone-badges';
import { RARITY_COLOR, rarityGlow } from '@/lib/economy/rarity';
import { formatSessionDuration } from '@/lib/format';
import { GOAL_TYPE_META, LOCK_IN_CATEGORY_META } from '@/lib/goal-types';
import type { TrophyHall } from '@/types/database';
import type { ProfileIdentity } from '@/types/social';

// Mock 325's SHOWCASE — the serious wall. The hero of the lower profile: someone lands here and
// the first thing under the stats is the heaviest lift, the longest session and the best medal,
// so "this person is serious" reads before anything else does.
//
// AUTO-PICKED, NOT CURATED. Every tile is the top of something the server already ranks (e1RM,
// duration, placement, rarity), so the wall can't be gamed into a brag it didn't earn and nobody
// has to arrange it. Earned things only — no cosmetic reaches this grid.
//
// Order is the read order of the mock: a lift, the longest lock-in, a placement medal, then
// whatever fills out the rows (more lifts, then relics). Six tiles at most, always an even count
// so the 2-up grid never ends on a lone half-width tile.

const MAX_TILES = 6;

type Tile =
  | { key: string; kind: 'pr'; pr: ShowcasePr }
  | { key: string; kind: 'win'; label: string }
  | { key: string; kind: 'session'; session: ShowcaseSession }
  | { key: string; kind: 'medal'; title: string; sub: string }
  | { key: string; kind: 'relic'; itemKey: string };

/** The two reads behind the wall's lifts and session, plus the PR count the stats row shows. */
export function useShowcaseData(userId: string | null | undefined, isOwn: boolean) {
  const [prs, setPrs] = useState<ShowcasePr[]>([]);
  const [prCount, setPrCount] = useState<number | null>(null);
  const [longest, setLongest] = useState<ShowcaseSession | null>(null);

  // On focus: finishing a lock-in or a PR and coming back to the tab should show it.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let live = true;
      // Fail soft, each on its own — a missing tile is fine, a blank wall because one read failed is not.
      if (isOwn) {
        fetchMyShowcasePrs(userId, 3)
          .then((r) => {
            if (!live) return;
            setPrs(r.prs);
            setPrCount(r.count);
          })
          .catch(() => {});
      }
      fetchLongestLockIn(userId, isOwn)
        .then((s) => {
          if (live) setLongest(s);
        })
        .catch(() => {});
      return () => {
        live = false;
      };
    }, [userId, isOwn])
  );

  return { prs, prCount, longest };
}

export function ShowcaseWall({
  userId,
  isOwn,
  hall,
  identity,
  prs,
  longest,
}: {
  userId: string;
  isOwn: boolean;
  hall: TrophyHall | null;
  identity: ProfileIdentity | null;
  prs: ShowcasePr[];
  longest: ShowcaseSession | null;
}) {
  const router = useRouter();
  const openHall = () => router.push({ pathname: '/trophy-hall', params: { userId } });

  const lifts: Tile[] = prs.map((pr) => ({ key: `pr-${pr.id}`, kind: 'pr', pr }));
  // Someone else's PRs are owner-only rows; their latest one still reaches us as their recent win.
  if (!isOwn && identity?.recent_win?.kind === 'pr') {
    lifts.push({ key: 'win-pr', kind: 'win', label: identity.recent_win.label });
  }
  const medals: Tile[] = (hall?.seasons ?? [])
    .filter((s) => !s.hidden)
    .sort((a, b) => a.placement / Math.max(a.board_size, 1) - b.placement / Math.max(b.board_size, 1))
    .slice(0, 1)
    .map((s) => ({
      key: `season-${s.season_id}`,
      kind: 'medal',
      title: (s.medal_key ? getItem(s.medal_key)?.name : null) ?? s.title ?? formatPlacement(s.placement, s.board_size),
      sub: `${seasonLabel(s.season_id)} · ${formatPlacement(s.placement, s.board_size).split(' · ').pop()}`,
    }));
  // A placement medal also rides hall.relics, so the season tile above would otherwise repeat it.
  const medalKeys = new Set((hall?.seasons ?? []).map((s) => s.medal_key));
  const relics: Tile[] = hall
    ? featuredTrophies(hall.relics, MAX_TILES)
        .filter((t) => !medalKeys.has(t.key))
        .map((t) => ({ key: `relic-${t.key}`, kind: 'relic', itemKey: t.key }))
    : [];

  const tiles: Tile[] = [];
  const push = (t: Tile | undefined) => {
    if (t && tiles.length < MAX_TILES) tiles.push(t);
  };
  push(lifts[0]);
  push(longest ? { key: `session-${longest.id}`, kind: 'session', session: longest } : undefined);
  push(medals[0]);
  lifts.slice(1).forEach(push);
  relics.forEach(push);
  if (tiles.length > 1 && tiles.length % 2 === 1) tiles.pop();

  if (tiles.length === 0) {
    if (!isOwn) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.heading}>Showcase</Text>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Your best work lands here — a PR, your longest lock-in, a season medal.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Showcase</Text>
      <View style={styles.grid}>
        {tiles.map((t) => (
          <ShowcaseTile
            key={t.key}
            tile={t}
            onPress={
              t.kind === 'session' && isOwn
                ? () => router.push('/lock-in-history')
                : t.kind === 'pr'
                  ? () => router.push('/fitness')
                  : openHall
            }
          />
        ))}
      </View>
    </View>
  );
}

function ShowcaseTile({ tile, onPress }: { tile: Tile; onPress: () => void }) {
  if (tile.kind === 'pr' || tile.kind === 'win') {
    const title = tile.kind === 'pr' ? (tile.pr.weight > 0 ? `${formatLb(tile.pr.weight)} lb ${tile.pr.exercise}` : tile.pr.exercise) : tile.label;
    const sub =
      tile.kind === 'pr'
        ? `${tile.pr.reps} rep${tile.pr.reps === 1 ? '' : 's'} · ${tile.pr.verified ? 'verified clip' : 'PR'}`
        : 'Latest PR';
    const verified = tile.kind === 'pr' && tile.pr.verified;
    return (
      <Pressable style={[styles.tile, styles.prTile]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}, ${sub}`}>
        <View style={[StyleSheet.absoluteFill, styles.prAura]} />
        {verified ? <Ionicons name="play" size={12} color="#CDBFF0" style={styles.play} /> : null}
        <View style={[styles.badge, !verified && styles.badgePr]}>
          <Text style={[styles.badgeText, !verified && styles.badgePrText]}>{verified ? '✓ CLIP' : 'PR'}</Text>
        </View>
        <Text style={styles.t} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.s} numberOfLines={1}>
          {sub}
        </Text>
      </Pressable>
    );
  }

  if (tile.kind === 'session') {
    const s = tile.session;
    const discipline = s.category ? LOCK_IN_CATEGORY_META[s.category]?.label : GOAL_TYPE_META[s.goal_type]?.label;
    return (
      <Pressable style={[styles.tile, styles.sessionTile]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Longest lock-in, ${formatSessionDuration(s.duration_seconds)}`}>
        <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit>
          {formatSessionDuration(s.duration_seconds)}
        </Text>
        <Text style={styles.t}>Longest lock-in</Text>
        <Text style={styles.s} numberOfLines={1}>
          {[discipline, s.goal_detail].filter(Boolean).join(' · ')}
        </Text>
      </Pressable>
    );
  }

  if (tile.kind === 'medal') {
    return (
      <Pressable style={[styles.tile, styles.medalTile]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${tile.title}, ${tile.sub}`}>
        <Icon name="medal" size={30} color={Colors.gold} />
        <Text style={[styles.t, styles.center]} numberOfLines={2}>
          {tile.title}
        </Text>
        <Text style={[styles.s, styles.center, { color: Colors.gold }]} numberOfLines={1}>
          {tile.sub}
        </Text>
      </Pressable>
    );
  }

  const item = getItem(tile.itemKey);
  if (!item) return <View style={styles.tile} />;
  return (
    <Pressable
      style={[styles.tile, styles.medalTile, { borderColor: RARITY_COLOR[item.rarity] + '70' }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.name}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: rarityGlow(item.rarity, 0.14) }]} />
      <ItemArt item={item} size={52} />
      <Text style={[styles.t, styles.center]} numberOfLines={1}>
        {item.name}
      </Text>
      <Text style={[styles.s, styles.center, { color: RARITY_COLOR[item.rarity] }]} numberOfLines={1}>
        {item.type === 'MEDAL' ? 'Medal' : 'Relic'}
      </Text>
    </Pressable>
  );
}

/** 405 → "405", 102.5 → "102.5". The PR is the number the lifter typed, not a rounded one. */
function formatLb(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(1);
}

const styles = StyleSheet.create({
  section: {
    marginTop: Spacing.four,
  },
  heading: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.ink,
    marginBottom: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  tile: {
    // Two up: half the row less half the gap.
    width: '48.5%',
    aspectRatio: 1,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: 10,
  },
  prTile: {
    backgroundColor: '#1B1430',
  },
  // Mock 325's inset legend glow — the PR tile reads as the one that matters most.
  prAura: {
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: 'rgba(185,139,255,0.45)',
    backgroundColor: 'rgba(185,139,255,0.06)',
  },
  play: {
    position: 'absolute',
    top: 9,
    left: 10,
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 9,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: Colors.green,
    backgroundColor: 'rgba(10,7,22,0.7)',
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: Fonts.black,
    fontSize: 8,
    color: Colors.green,
  },
  badgePr: {
    borderColor: Colors.navEmber2,
  },
  badgePrText: {
    color: Colors.navEmber2,
  },
  sessionTile: {
    backgroundColor: '#1F1538',
  },
  medalTile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#22190E',
  },
  big: {
    fontFamily: Fonts.black,
    fontSize: 24,
    color: Colors.navEmber2,
    marginBottom: 2,
  },
  t: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  s: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.muted,
    marginTop: 1,
  },
  center: {
    textAlign: 'center',
  },
  empty: {
    borderRadius: 13,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.spaceLine,
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
    textAlign: 'center',
  },
});
