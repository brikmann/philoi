import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useId, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, G, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

import { CardBackdropArt, cardLookForItem, type CardMotion } from '@/components/economy/card-art';
import { RankBadge } from '@/components/rank-badge';
import { PatronCrest } from '@/components/story-sticker/patron-crest';
import { FLAME_MIRROR_TRANSFORM, FLAME_PATH, FLAME_VIEWBOX } from '@/components/ui/flame-logo';
import { Fonts } from '@/constants/theme';
import type { CatalogItem } from '@/lib/economy/catalog';
import { mix } from '@/lib/economy/colour';
import type { FlameRamp } from '@/lib/economy/flame-ramp';
import { RARITY_COLOR, RARITY_ORDER } from '@/lib/economy/rarity';
import { RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { StickerModel } from '@/lib/story-sticker/data';
import type { StickerBackdrop, StickerPrefs } from '@/lib/story-sticker/prefs';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE STORY SHARE STICKER (mocks 279 + 281, the Strava mechanic).
//
// A single card on an otherwise TRANSPARENT canvas, photographed to PNG and dropped onto the
// person's own photo in Instagram Stories. Every share is an ad carrying the watermark, who shared
// it, and what they did.
//
// THE FORMAT IS THE BRAND, NOT THE SKIN. Whatever the surface — the glass card or a legendary
// cosmetic filling the whole thing — the skeleton never moves: PHILOI watermark top-left, identity,
// the clock + what for, XP + the bar to the next rank, the opt-in stat row. That fixed layout is what
// makes any sticker read as "a Philoi card" at a glance, so a cosmetic may own the entire surface
// (mock 281) as long as it never touches the skeleton. The one guardrail is the scrim: in cosmetic
// mode a bottom-weighted dark gradient always sits between the art and the stats. The cosmetic's
// NAME is never printed — the art speaks for itself.
//
// No backdrop blur: there is nothing behind a transparent canvas to blur at capture time, and
// Instagram composites the PNG later. The glass is the fill alone.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Layout width in points. Exported at 1080px (share.ts), so ~3x — crisp at any pinch. */
export const STICKER_WIDTH = 360;
/** Cosmetic mode leaves the art room to breathe above the stats (mock 281's spacer). */
const COSMETIC_MIN_HEIGHT = 440;

const GOLD = '#FFD166';
const MUTED = '#C9BFE6';
const DIM = '#8A80A8';
const INK = '#F4F0FF';
/** The brand ember ramp — the bar and accents when no flame is equipped. */
const BRAND_BAR: [string, string] = ['#FF7A2F', '#FFB05A'];

/**
 * Which cosmetics get the animated ("live") sticker. Common and uncommon are static only; rare and
 * up animate — the motion is part of what makes the rarer card worth chasing. The in-app preview
 * plays it now; the looping-video export that carries it into Instagram is the fast-follow, and it
 * reads this same rule.
 */
export function stickerAnimates(item: Pick<CatalogItem, 'rarity'> | null | undefined): boolean {
  return !!item && RARITY_ORDER[item.rarity] >= RARITY_ORDER.rare;
}

export type StickerSkin = {
  backdrop: StickerBackdrop;
  /** The equipped card cosmetic — cosmetic mode's whole surface. */
  card: CatalogItem | null;
  /** The live flame colourway. Null = the brand ramp (no flame/flare equipped). */
  flameRamp: FlameRamp | null;
};

type Props = {
  model: StickerModel;
  prefs: Pick<StickerPrefs, 'showRank' | 'showStreak' | 'showCampus'>;
  skin: StickerSkin;
  /** 'full' for the on-screen preview; the captured PNG always renders 'still'. */
  motion: CardMotion;
  onLayout?: (e: LayoutChangeEvent) => void;
};

export const StorySticker = forwardRef<View, Props>(function StorySticker({ model, prefs, skin, motion, onLayout }, ref) {
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 });
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const cosmetic = skin.backdrop === 'cosmetic' && skin.card ? skin.card : null;
  const ramp = skin.flameRamp;

  // Accent: the brand ember unless a flame/flare is worn, then that fire's colours (mock 280 panel 2).
  const bar: [string, string] = ramp ? [ramp.outer, ramp.core] : BRAND_BAR;
  const xpColour = ramp ? mix(ramp.core, '#FFFFFF', 0.25) : GOLD;
  const heroAccent = ramp ? mix(ramp.mid, '#FFFFFF', 0.3) : '#FFB05A';

  let border = 'rgba(255,255,255,0.14)';
  if (cosmetic) border = `${RARITY_COLOR[cosmetic.rarity]}99`;
  else if (ramp) border = `${ramp.mid}88`;

  const statRow = [
    prefs.showStreak && model.streakDays > 0 ? { key: 'streak', value: `🔥 ${model.streakDays}`, label: 'DAY STREAK' } : null,
    prefs.showCampus && model.campus ? { key: 'campus', value: model.campus.value, label: model.campus.label } : null,
  ].filter((s): s is { key: string; value: string; label: string } => s !== null);

  const rank = model.rank;
  const showBadge = prefs.showRank && rank;
  const shadow = cosmetic ? styles.shadow : null;
  const what = [model.goalLabel, model.disciplineLine].filter(Boolean).join(' · ');

  return (
    // The capture root: transparent, no opaque parent, collapsable={false} so Android keeps a real
    // native view to photograph.
    <View ref={ref} collapsable={false} style={styles.root} onLayout={onLayout}>
      <View
        style={[
          styles.card,
          { borderColor: border },
          cosmetic ? { minHeight: COSMETIC_MIN_HEIGHT, backgroundColor: '#0A0704' } : styles.glass,
        ]}
        onLayout={(e) => setCardSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
        {cosmetic && cardSize.height > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <CardBackdropArt
              look={cardLookForItem(cosmetic)}
              from={cosmetic.art.from}
              to={cosmetic.art.to}
              width={cardSize.width}
              height={cardSize.height}
              motion={motion === 'full' && stickerAnimates(cosmetic) ? 'full' : 'still'}
              uid={`sticker${uid}`}
            />
            {/* The legibility scrim — the one rule a cosmetic can't opt out of. */}
            <LinearGradient
              colors={['rgba(10,7,4,0.15)', 'rgba(10,7,4,0)', 'rgba(10,7,4,0.6)', 'rgba(10,7,4,0.92)']}
              locations={[0, 0.3, 0.6, 1]}
              style={StyleSheet.absoluteFill}
            />
          </View>
        ) : null}

        <View style={styles.top}>
          <StickerFlame ramp={ramp} />
          <Text style={[styles.wordmark, shadow]}>PHILOI</Text>
          {showBadge ? (
            <View style={styles.rankTag}>
              <RankBadge tier={rank.tier} division={rank.division} size={22} />
              <Text style={[styles.rankTagText, shadow, { color: RANK_TIER_METAL[rank.tier].text }]}>
                {rank.label.toUpperCase()}
              </Text>
            </View>
          ) : null}
        </View>

        {cosmetic ? <View style={styles.spacer} /> : null}

        {model.handle || model.patron ? (
          <View style={styles.who}>
            {model.handle ? <Text style={[styles.handle, shadow]}>@{model.handle}</Text> : null}
            {model.patron ? (
              <>
                <PatronCrest patronKey={model.patron.key} name={model.patron.name} size={17} />
                <Text style={[styles.heir, shadow, cosmetic ? styles.onArt : null]} numberOfLines={1}>
                  Heir of {model.patron.name}
                </Text>
              </>
            ) : null}
          </View>
        ) : null}

        <View style={styles.hero}>
          <Text style={[styles.clock, shadow]}>{model.clock}</Text>
          <Text style={[styles.lockedIn, shadow, cosmetic ? styles.onArt : null]}>locked in</Text>
        </View>
        <Text style={[styles.what, shadow, { color: cosmetic ? GOLD : heroAccent }]} numberOfLines={1}>
          {what}
        </Text>

        <View style={styles.prog}>
          <View style={styles.progTop}>
            <Text style={[styles.xp, shadow, { color: xpColour }]}>+{model.xpEarned.toLocaleString()} XP</Text>
            {rank ? <Text style={[styles.toNext, shadow, cosmetic ? styles.onArt : null]}>{rank.toNext}</Text> : null}
          </View>
          {rank ? (
            <>
              <View style={[styles.track, cosmetic ? styles.trackOnArt : null]}>
                <LinearGradient
                  colors={bar}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.fill, { width: `${Math.max(4, Math.round(rank.ratio * 100))}%` }]}
                />
              </View>
              <View style={styles.progBottom}>
                <Text style={[styles.rung, cosmetic ? styles.rungOnArt : null]}>{rank.label.toUpperCase()}</Text>
                <Text style={[styles.rung, cosmetic ? styles.rungOnArt : null]}>{(rank.nextLabel ?? 'MAX').toUpperCase()}</Text>
              </View>
            </>
          ) : null}
        </View>

        {statRow.length > 0 ? (
          <View style={styles.stats}>
            {statRow.map((s) => (
              <View key={s.key} style={[styles.stat, cosmetic ? styles.statOnArt : null]}>
                <Text style={[styles.statValue, shadow]}>{s.value}</Text>
                <Text style={[styles.statLabel, cosmetic ? styles.onArt : null]}>{s.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
});

/** The watermark flame — the brand mark, in the worn fire's colours when one is equipped. */
function StickerFlame({ ramp }: { ramp: FlameRamp | null }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const grad = `sf${uid}`;
  const stops = ramp ? [ramp.outer, ramp.mid, ramp.core] : ['#E0612C', '#F2A33C', '#FFD27A'];
  return (
    <Svg width={20} height={22} viewBox={`0 0 ${FLAME_VIEWBOX} ${FLAME_VIEWBOX}`}>
      <Defs>
        <SvgGradient id={grad} x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={stops[0]} />
          <Stop offset="0.55" stopColor={stops[1]} />
          <Stop offset="1" stopColor={stops[2]} />
        </SvgGradient>
      </Defs>
      <G transform={FLAME_MIRROR_TRANSFORM}>
        <Path d={FLAME_PATH} fill={`url(#${grad})`} />
      </G>
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: {
    width: STICKER_WIDTH,
    backgroundColor: 'transparent',
  },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 16,
  },
  glass: {
    backgroundColor: 'rgba(16,11,26,0.62)',
  },
  shadow: {
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  onArt: {
    color: '#EFE4CC',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 13,
  },
  wordmark: {
    fontFamily: Fonts.black,
    fontSize: 13,
    letterSpacing: 2,
    color: INK,
  },
  rankTag: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  rankTagText: {
    fontFamily: Fonts.black,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  spacer: {
    flex: 1,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 12,
  },
  handle: {
    fontFamily: Fonts.black,
    fontSize: 14.5,
    color: INK,
  },
  heir: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: MUTED,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 3,
  },
  clock: {
    fontFamily: Fonts.black,
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: -1,
    color: INK,
    fontVariant: ['tabular-nums'],
  },
  lockedIn: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: MUTED,
  },
  what: {
    fontFamily: Fonts.black,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  prog: {
    marginTop: 14,
  },
  progTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  xp: {
    fontFamily: Fonts.black,
    fontSize: 15.5,
  },
  toNext: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: MUTED,
  },
  track: {
    height: 7,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  trackOnArt: {
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  fill: {
    height: '100%',
    borderRadius: 6,
  },
  progBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  rung: {
    fontFamily: Fonts.black,
    fontSize: 9,
    letterSpacing: 0.6,
    color: DIM,
  },
  rungOnArt: {
    color: '#D9C9A4',
  },
  stats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 13,
  },
  stat: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  statOnArt: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  statValue: {
    fontFamily: Fonts.black,
    fontSize: 15.5,
    color: INK,
  },
  statLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    letterSpacing: 0.3,
    color: MUTED,
    marginTop: 1,
  },
});
