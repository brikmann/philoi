import { forwardRef, useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import { EquippedFlameSvg } from '@/components/flame-icon';
import { FlareEffectLayer } from '@/components/economy/flare-perimeter';
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, ShareCardFrame } from '@/components/share-card-frame';
import { Colors, Fonts } from '@/constants/theme';
import { RARITY_COLOR, RARITY_LABEL, type Rarity } from '@/lib/economy/rarity';
import type { RankTierName, SeasonCard, SeasonReward } from '@/types/database';

// B5 — the season card, built as THE SPLIT (design-mocks/97, the approved direction over mock 96's
// single card): screen 1 is the placement flex, screen 2 is the reward haul. Two separately
// shareable stories, and a swipeable pair in-app.
//
// Everything on both screens is REAL and comes from get_my_season_card():
//   · the band headline, the absolute rank, and the size of the pool it was out of
//   · the title actually granted, with its actual rarity (global cuts read one notch hotter)
//   · the actual granted reward bundle, from the grant ledger — not re-derived from the band
// Nothing here is hardcoded, which is the one rule the handoff repeats twice.
//
// Both screens wear the EMBERFALL AURA: the same `emberfall` FlareEffect the season's capstone
// flare puts on the lock-in screen — lava pooling at the bottom, embers raining from the top —
// reused as the card's animated background so the shared story carries the season's signature.

/** Season 1's aura colour (catalog: Emberfall Ascendant). */
const EMBERFALL = '#FF5A2E';

/** Band -> the words on the placement screen. The band itself is decided server-side. */
const BAND_HEADLINE: Record<string, string> = {
  rank_1: '#1',
  rank_2: '#2',
  rank_3: '#3',
  p1: 'TOP 1%',
  p10: 'TOP 10%',
  p25: 'TOP 25%',
  p50: 'TOP 50%',
};

/** Reward-kind glyphs, matching mock 97's tiles. */
const REWARD_ICON: Record<SeasonReward['kind'], string> = {
  title: '🏅',
  banner: '🎴',
  card: '🎴',
  particle: '✨',
  medal: '🎖',
  box: '🎁',
  embers: '🔥',
};

function EmberfallAura() {
  const uid = useId();
  const pool = `lavaPool-${uid}`;
  const core = `lavaCore-${uid}`;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* The lava pool at the bottom edge. Two radials rather than a blur — RN has no blur filter
          without a native dep, and a radial that fades to transparent is the same soft pool. */}
      <Svg width={SHARE_CARD_WIDTH} height={SHARE_CARD_HEIGHT} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={pool} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={EMBERFALL} stopOpacity={0.55} />
            <Stop offset="0.6" stopColor={EMBERFALL} stopOpacity={0.12} />
            <Stop offset="1" stopColor={EMBERFALL} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={core} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFC14D" stopOpacity={0.85} />
            <Stop offset="0.6" stopColor={EMBERFALL} stopOpacity={0.5} />
            <Stop offset="1" stopColor={EMBERFALL} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={SHARE_CARD_WIDTH / 2} cy={SHARE_CARD_HEIGHT} rx={200} ry={90} fill={`url(#${pool})`} />
        <Ellipse cx={SHARE_CARD_WIDTH / 2} cy={SHARE_CARD_HEIGHT - 6} rx={112} ry={22} fill={`url(#${core})`} />
      </Svg>
      {/* The falling embers + licking flames — the real `emberfall` effect, bounded to the card. */}
      <FlareEffectLayer effect="emberfall" colour={EMBERFALL} width={SHARE_CARD_WIDTH} height={SHARE_CARD_HEIGHT} />
    </View>
  );
}

function seasonKick(card: SeasonCard): string {
  return `SEASON ${card.season_id.replace(/^S/, '')} · ${(card.season_name ?? '').toUpperCase()}`;
}

type ScreenProps = {
  card: SeasonCard;
  handle: string | null;
  tier?: RankTierName;
  division?: number;
};

/**
 * SCREEN 1 — the placement. The band burns INSIDE the person's equipped flame (the logo silhouette
 * recoloured by their own flame ramp, per mock 97's note), so the flex wears their cosmetic. Under
 * it: university, absolute rank, and the real size of the pool — "#300 of 30,000" is the concrete
 * version of a percentage, and the percentage alone is what makes a flex feel invented.
 */
export const SeasonPlacementShareCard = forwardRef<View, ScreenProps>(function SeasonPlacementShareCard(
  { card, handle, tier, division },
  ref
) {
  const headline = card.band ? BAND_HEADLINE[card.band] : `#${card.rank}`;

  return (
    <ShareCardFrame
      ref={ref}
      kick={seasonKick(card)}
      ground="season"
      aura={<EmberfallAura />}
      handle={handle}
      tier={tier}
      division={division}>
      <View style={styles.flameWrap}>
        <EquippedFlameSvg width={210} height={210} />
        <Text style={styles.inFlame}>{headline}</Text>
      </View>

      <Text style={styles.place}>
        🎓 {card.university} · #{card.rank.toLocaleString('en-US')} of {card.board_size.toLocaleString('en-US')}
      </Text>
      <Text style={styles.effort}>
        {card.hours_locked_in}h locked in · {card.pass_xp.toLocaleString('en-US')} XP this season
      </Text>
      <Text style={styles.swipe}>your rewards →</Text>
    </ShareCardFrame>
  );
});

/**
 * SCREEN 2 — what the season actually paid. Permanent items first (the title and the banner you
 * keep forever, in purple), then the loot that gets consumed. That ordering is the point of the
 * split: a loot box at the top of the list would bury the honour underneath it.
 */
export const SeasonRewardsShareCard = forwardRef<View, ScreenProps>(function SeasonRewardsShareCard(
  { card, handle, tier, division },
  ref
) {
  // Already ordered permanent-first by the RPC; sorted again here so a card rendered from any other
  // source of the same shape can't come out in the wrong order.
  const rewards = [...card.rewards].sort((a, b) => Number(b.permanent) - Number(a.permanent));

  return (
    <ShareCardFrame
      ref={ref}
      kick={seasonKick(card)}
      ground="season"
      aura={<EmberfallAura />}
      handle={handle}
      tier={tier}
      division={division}>
      <Text style={styles.forged}>FORGED THIS SEASON</Text>

      <View style={styles.rewardList}>
        {rewards.slice(0, 5).map((r) => (
          <RewardRow key={`${r.kind}-${r.key}`} reward={r} />
        ))}
      </View>

      {/* The god's own significance line, under the haul — the lore is the reason the title reads
          as an honour rather than a word. */}
      {card.title?.description ? <Text style={styles.lore}>{card.title.description}</Text> : null}
    </ShareCardFrame>
  );
});

function RewardRow({ reward }: { reward: SeasonReward }) {
  const rarity = (reward.rarity ?? null) as Rarity | null;
  const tint = reward.permanent ? '#C79BEC' : Colors.amber;
  const sub = [
    rarity ? RARITY_LABEL[rarity].toUpperCase() : null,
    reward.kind === 'title' ? 'TITLE' : reward.kind === 'box' ? 'BOX' : reward.kind === 'embers' ? 'CURRENCY' : null,
    reward.permanent ? 'PERMANENT' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.rewardRow, { borderColor: reward.permanent ? 'rgba(199,155,236,0.5)' : 'rgba(242,163,60,0.28)' }]}>
      <View style={[styles.rewardIcon, { backgroundColor: reward.permanent ? 'rgba(199,155,236,0.16)' : 'rgba(255,150,60,0.14)' }]}>
        <Text style={styles.rewardGlyph}>{REWARD_ICON[reward.kind]}</Text>
      </View>
      <View style={styles.rewardText}>
        <Text style={styles.rewardName} numberOfLines={1}>
          {reward.amount && reward.kind === 'embers' ? `${reward.amount.toLocaleString('en-US')} ` : ''}
          {reward.name}
        </Text>
        <Text style={[styles.rewardSub, { color: tint }]}>{sub}</Text>
      </View>
      {rarity ? <View style={[styles.rarityDot, { backgroundColor: RARITY_COLOR[rarity] }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flameWrap: {
    width: 210,
    height: 210,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inFlame: {
    position: 'absolute',
    top: 118,
    fontFamily: Fonts.bodyBold,
    fontSize: 34,
    letterSpacing: -1,
    color: Colors.ink,
    textShadowColor: 'rgba(80,25,0,0.95)',
    textShadowRadius: 10,
  },
  place: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    letterSpacing: 0.4,
    color: '#FFD9A0',
    marginTop: 12,
    textAlign: 'center',
  },
  effort: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: '#C8BCDD',
    marginTop: 8,
    textAlign: 'center',
  },
  swipe: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: Colors.textTertiary,
    marginTop: 16,
  },
  forged: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    letterSpacing: 2.5,
    color: '#FFB84D',
    textAlign: 'center',
  },
  rewardList: {
    width: '100%',
    gap: 9,
    marginTop: 18,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(36,26,46,0.72)',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  rewardIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardGlyph: {
    fontSize: 15,
  },
  rewardText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rewardName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  rewardSub: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 0.6,
  },
  rarityDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  lore: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 16,
  },
});
