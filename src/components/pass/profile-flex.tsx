import { useEffect, useId, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { ItemArt } from '@/components/economy/item-art';
import { FlareEffectLayer } from '@/components/economy/flare-perimeter';
import { SpinRays, usePassMotion } from '@/components/pass/pass-motion';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { useMyRanks } from '@/hooks/use-my-ranks';
import { fetchMyStreak } from '@/lib/api/profile';
import { useAuth } from '@/lib/auth/auth-context';
import { DEFAULT_LOADOUT, getItem, type CatalogItem } from '@/lib/economy/catalog';
import { RARITY_COLOR } from '@/lib/economy/rarity';
import { formatRankTier } from '@/lib/rank-tiers';

// "OWN YOUR PROFILE" (mock 200-v2) — the user's OWN profile, side by side, without and with the
// Flame Pass.
//
// 🔴 COSMETIC-ONLY, SHOWN LITERALLY. Rank and streak are read once and rendered identically on both
// cards. The pass changes how a profile LOOKS and never what it has EARNED; putting the same earned
// numbers under both looks is the argument, stated without a sentence.
//
// 🔴 EVERY ITEM ON THE "WITH" CARD IS A PASS ITEM, rendered with its real catalog art: the
// Emberfall Standard banner, the Forge Flame, the Crown Halo, the Emberfall Crown medal beside the
// name, a pass title, and the Ascendant flare's actual `emberfall` effect layer — the same renderer
// the lock-in screen wears. A preview that showed a reward the track can't pay out is a refund
// waiting to happen.

/**
 * The title on the "with" card. Mock 200-v2 (and its brief) show "Locked In", but that's
 * `title-locked-in` — a Common BOX title anyone can pull from a Kindling, not something the pass
 * grants. Every other element of this card is a pass reward, so it's the pass's own L100 capstone
 * title here instead. One-line swap if that call goes the other way.
 */
const FLEX_TITLE_ID = 'title-forged-in-ember';

const WITH = {
  banner: 'banner-emberfall-mythic',
  flame: 'flame-forge',
  halo: 'halo-emberfall-mythic',
  medal: 'medal-emberfall-crown',
  title: FLEX_TITLE_ID,
  flare: 'flare-emberfall-ascendant',
} as const;

function useProfileStats() {
  const { profile } = useAuth();
  const { ranks } = useMyRanks();
  const [streak, setStreak] = useState<number | null>(null);
  const userId = profile?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchMyStreak(userId)
      .then((s) => {
        if (!cancelled) setStreak(s.current_streak);
      })
      // A missing streak just drops that line from both cards — never a reason to break the paywall.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const universal = ranks.find((r) => r.scope === 'universal');
  const name = profile?.display_name?.trim().split(/\s+/)[0] || profile?.handle || 'You';
  return {
    name,
    rank: universal ? formatRankTier(universal.tier, universal.division) : null,
    streak,
  };
}

export function ProfileFlex() {
  const stats = useProfileStats();
  const plainFlame = getItem(DEFAULT_LOADOUT.flame ?? '');

  return (
    <View style={styles.vs}>
      <View style={[styles.card, styles.cardOff]}>
        <View style={[styles.label, styles.labelOff]}>
          <Text style={[styles.labelText, styles.labelTextOff]}>WITHOUT</Text>
        </View>
        <View style={[styles.banner, styles.bannerOff]} />
        <View style={[styles.avatar, styles.avatarOff]}>
          {plainFlame ? (
            <View style={styles.dim}>
              <ItemArt item={plainFlame} size={26} />
            </View>
          ) : null}
        </View>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {stats.name}
          </Text>
        </View>
        <Text style={styles.plain}>plain profile</Text>
        <Stats rank={stats.rank} streak={stats.streak} />
      </View>

      <WithCard stats={stats} />
    </View>
  );
}

function WithCard({ stats }: { stats: ReturnType<typeof useProfileStats> }) {
  const run = usePassMotion();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const banner = getItem(WITH.banner);
  const flame = getItem(WITH.flame);
  const halo = getItem(WITH.halo);
  const medal = getItem(WITH.medal);
  const title = getItem(WITH.title);
  const flare = getItem(WITH.flare);

  return (
    <View
      style={[styles.card, styles.cardOn]}
      onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {/* Slow rays behind the avatar — under everything else so the name stays legible. */}
      <View style={styles.raysAnchor} pointerEvents="none">
        <SpinRays size={150} period={16000} opacity={0.3} />
      </View>

      <View style={[styles.label, styles.labelOn]}>
        <Text style={[styles.labelText, styles.labelTextOn]}>WITH FLAME PASS</Text>
      </View>
      {banner ? <GradientBanner item={banner} /> : <View style={styles.banner} />}

      <View style={[styles.avatar, styles.avatarOn, halo ? { borderColor: halo.art.from } : null]}>
        {halo ? <View style={[styles.haloRing, { borderColor: halo.art.to }]} /> : null}
        {flame ? <ItemArt item={flame} size={28} /> : null}
      </View>

      <View style={styles.nameRow}>
        <Text style={styles.name} numberOfLines={1}>
          {stats.name}
        </Text>
        {medal ? <ItemArt item={medal} size={14} /> : null}
      </View>
      {title ? <TitleChip item={title} /> : null}
      <Stats rank={stats.rank} streak={stats.streak} />

      {/* The Ascendant flare's FULL effect over the card: its own `emberfall` layer (lava pooling
          low, embers climbing the edges) plus the perimeter glow. Under Reduce Motion the moving
          layer is dropped and the lit border + lava wash carry it as a static frame. */}
      {flare?.flare && run && box.w > 0 ? (
        <View style={styles.effect} pointerEvents="none">
          <FlareEffectLayer effect={flare.flare.effect} colour={flare.flare.colour} width={box.w} height={box.h} />
        </View>
      ) : null}
      <LavaWash />
      <View style={styles.aura} pointerEvents="none" />
    </View>
  );
}

function Stats({ rank, streak }: { rank: string | null; streak: number | null }) {
  return (
    <View style={styles.stats}>
      {rank ? (
        <Text style={styles.stat}>
          RANK <Text style={styles.statValue}>{rank}</Text>
        </Text>
      ) : null}
      {streak !== null ? (
        <Text style={styles.stat}>
          STREAK <Text style={styles.statValue}>{streak}d</Text>
        </Text>
      ) : null}
    </View>
  );
}

function TitleChip({ item }: { item: CatalogItem }) {
  const color = RARITY_COLOR[item.rarity];
  return (
    <View style={[styles.titleChip, { borderColor: color }]}>
      <Text style={[styles.titleText, { color }]} numberOfLines={1}>
        “{item.name.replace(/^"|"$/g, '')}”
      </Text>
    </View>
  );
}

/** The banner strip in the banner item's own two colours — the same stops its tile art uses. */
function GradientBanner({ item }: { item: CatalogItem }) {
  const grad = `flexBanner-${useId()}`;
  return (
    <View style={styles.banner}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={grad} x1="0" y1="0" x2="1" y2="0.6">
            <Stop offset="0" stopColor={item.art.from} />
            <Stop offset="1" stopColor={item.art.to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${grad})`} />
      </Svg>
    </View>
  );
}

/** The mock's `.vlava` — hot light pooled along the card's bottom edge. */
function LavaWash() {
  const grad = `flexLava-${useId()}`;
  return (
    <View style={styles.lava} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={grad} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#F5401C" stopOpacity="0.55" />
            <Stop offset="0.4" stopColor={Colors.amber} stopOpacity="0.16" />
            <Stop offset="1" stopColor={Colors.amber} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${grad})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  vs: {
    flexDirection: 'row',
    gap: 10,
  },
  card: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    backgroundColor: '#130E1B',
    paddingBottom: 12,
    alignItems: 'center',
  },
  cardOff: {
    borderColor: Colors.line,
  },
  cardOn: {
    borderColor: 'rgba(245,64,28,0.6)',
    shadowColor: '#F5401C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 14,
    elevation: 10,
  },
  label: {
    alignSelf: 'stretch',
    paddingVertical: 5,
    alignItems: 'center',
    zIndex: 8,
  },
  labelOff: {
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  labelOn: {
    backgroundColor: Colors.coral,
  },
  labelText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 7.5,
    letterSpacing: 0.7,
  },
  labelTextOff: {
    color: '#8a7fa6',
  },
  labelTextOn: {
    color: '#241203',
  },
  banner: {
    alignSelf: 'stretch',
    height: 32,
    zIndex: 2,
  },
  bannerOff: {
    backgroundColor: '#2A2536',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#100B16',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -24,
    borderWidth: 2,
    zIndex: 7,
  },
  avatarOff: {
    borderColor: '#3A3350',
  },
  avatarOn: {
    borderColor: '#B01A0E',
    shadowColor: '#B01A0E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 8,
  },
  haloRing: {
    position: 'absolute',
    top: -7,
    left: -7,
    right: -7,
    bottom: -7,
    borderRadius: 31,
    borderWidth: 2,
    opacity: 0.75,
  },
  dim: {
    opacity: 0.45,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 7,
    zIndex: 7,
    maxWidth: '92%',
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
    textAlign: 'center',
    flexShrink: 1,
  },
  plain: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    color: '#5C5470',
    marginTop: 6,
  },
  titleChip: {
    marginTop: 5,
    maxWidth: '92%',
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: 'rgba(242,163,60,0.14)',
    zIndex: 7,
  },
  titleText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 7.5,
  },
  stats: {
    marginTop: 8,
    alignItems: 'center',
    gap: 2,
    zIndex: 7,
  },
  stat: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    color: '#8a7fa6',
  },
  statValue: {
    color: '#7FE0E8',
  },
  raysAnchor: {
    position: 'absolute',
    top: 56 - 75 + 24,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1,
  },
  effect: {
    ...StyleSheet.absoluteFill,
    zIndex: 6,
  },
  lava: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 54,
    zIndex: 5,
  },
  aura: {
    ...StyleSheet.absoluteFill,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(245,64,28,0.45)',
    zIndex: 9,
  },
});
