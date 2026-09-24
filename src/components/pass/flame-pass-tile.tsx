import { useEffect, useId, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Rect, Stop } from 'react-native-svg';

import { ItemArt } from '@/components/economy/item-art';
import { RisingEmbers, ShineSweep, SpinRays, useBreath, usePassMotion } from '@/components/pass/pass-motion';
import { useEmberfallSet } from '@/components/pass/set-showcase';
import { EmberFill } from '@/components/ui/ember-fill';
import { FlameLogo } from '@/components/ui/flame-logo';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { CatalogItem } from '@/lib/economy/catalog';
import {
  PASS_FINE_PRINT,
  SEASON,
  msUntilSeasonBoundary,
  premiumLaneTotals,
  seasonPhase,
} from '@/lib/economy/forge-pass';
import { RARITY_COLOR } from '@/lib/economy/rarity';

// The Flame Pass teaser that lives at the top of the shop (mock 214).
//
// WHAT THIS REPLACES: a flat `#2a1533` purple slab with three lines of type on it and no art at
// all. Two things were wrong with it. The colour was the *old* plum — the one DESIGN_LANGUAGE_EMBER
// §2 abolished — sitting on top of the app's own purple ground, so the season's shopfront was the
// least fiery surface in a shop full of fire. And the season's actual product, sixteen exclusive
// cosmetics, was never once shown: the card sold a real-money purchase with a paragraph.
//
// So the tile is a lit object now — an ember radial ground, a turning ray fan and a breathing aura
// behind the flame, embers rising through it, a shine sweep over it, and a reel that cycles the
// REAL Emberfall art, the same ItemArt the paywall's showcase and the inventory grid draw. No
// placeholder glyphs, and no typed numbers: the counts come from premiumLaneTotals() and the items
// from the catalog, so editing the track re-renders the pitch.
//
// Every animated layer runs through pass-motion, so the whole card parks or unmounts under Reduce
// Motion and while the shop is blurred — the contract the paywall and purchase-success already keep.

/**
 * Height of the card body — FIXED, because the ground, the rays and the aura are all absolutely
 * positioned against it and an auto-height card would leave the gradient short.
 *
 * It is budgeted, not guessed: 28 padding + ~23 chip row + ~93 footer leaves ~276 for the hero,
 * which is what the flame (60) + kicker + 32pt title + a two-line subline + the 68pt reel and its
 * dots come to. The card clips (`overflow: 'hidden'`), so under-budgeting here doesn't reflow
 * anything — it silently cuts the bottom off the reel.
 */
const CARD_H = 420;
const RAY_BOX = 208;
/** Where the flame's light sits, measured from the top of the card — rays and aura centre on it. */
const LIGHT_Y = 82;
const AURA_R = 130;
const CYCLE_MS = 1800;

type FlamePassTileProps = {
  level: number;
  ownsPremium: boolean;
  /** Localized store price, or null while the offering is loading / in a build with no SDK keys. */
  price: string | null;
  /** Whether THIS account may buy right now (inside the window, or a dev). */
  onSale: boolean;
  /** Tap the card body — the track preview. */
  onOpen: () => void;
  /** Tap the CTA — the full paywall. */
  onBuy: () => void;
};

export function FlamePassTile({ level, ownsPremium, price, onSale, onOpen, onBuy }: FlamePassTileProps) {
  const items = useEmberfallSet();
  const phase = seasonPhase();
  const totals = premiumLaneTotals();

  return (
    <Pressable
      style={styles.card}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Flame Pass, season ${SEASON.id.replace('S', '')} ${SEASON.name}. Preview the track.`}>
      <CardGround />
      <View style={styles.raysWrap} pointerEvents="none">
        <SpinRays size={RAY_BOX} period={30000} spokes={10} opacity={0.4} thickness={1.6} />
      </View>
      <Aura />
      {/* Scoped to the card's own height, so an ember fades out near the top of the TILE instead of
          being clipped at 85% opacity — the giveaway that a field was sized for a screen and then
          cropped into a card. */}
      <RisingEmbers count={14} rise={CARD_H + 24} />
      <ShineSweep period={4600} opacity={0.18} />

      <View style={styles.content}>
        <View style={styles.chipRow}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>◆ SEASON {SEASON.id.replace('S', '')}</Text>
          </View>
          <View style={styles.ends}>
            <Text style={styles.endsText}>{seasonChip(phase)}</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <HeroFlame />
          <Text style={styles.kicker}>The Season Pass</Text>
          <Text style={styles.title}>{SEASON.name}</Text>
          <Text style={styles.subline}>
            {ownsPremium ? (
              <>
                <Text style={styles.sublineStrong}>Level {level}</Text> of {SEASON.totalLevels} · every premium reward
                you have climbed to is waiting
              </>
            ) : (
              <>
                {/* The unlock count is the SET's length, not premiumLaneTotals().items — the reel
                    below draws one dot per set member, and a headline that disagrees with a row of
                    dots the user can count is worse than no headline. Same number the paywall's
                    "N items to be unlocked" prints. Embers and boxes are grant totals, which is
                    what those two genuinely are. */}
                <Text style={styles.sublineStrong}>{items.length} exclusive unlocks</Text> ·{' '}
                {totals.embers.toLocaleString('en-US')} embers · {totals.boxes} loot boxes
              </>
            )}
          </Text>
          <Reel items={items} />
        </View>

        <View style={styles.foot}>
          <PassCta ownsPremium={ownsPremium} onSale={onSale} phase={phase} price={price} onBuy={onBuy} />
          {/* The disclosure stays attached to the buy CTA — it moved here with the card, it did not
              get dropped for the art. The mock's marketing line loses to it. */}
          <Text style={styles.fine}>{PASS_FINE_PRINT}</Text>
          <Text style={styles.hint}>Tap the card to preview all {SEASON.totalLevels} levels →</Text>
        </View>
      </View>
    </Pressable>
  );
}

/** "ENDS IN 74D" — the same boundary every other Pass countdown reads, in the chip's voice. */
function seasonChip(phase: ReturnType<typeof seasonPhase>): string {
  if (phase === 'closed') return 'SEASON CLOSED';
  const days = Math.ceil(msUntilSeasonBoundary() / 86_400_000);
  if (phase === 'upcoming') return `OPENS IN ${days}D`;
  if (phase === 'claim-window') return `CLAIM · ${days}D LEFT`;
  return `ENDS IN ${days}D`;
}

// ─────────────────────────── the ground ───────────────────────────

/**
 * The mock's `radial-gradient(120% 90% at 50% 8%, #3a1c0c, #1a0f08 46%, #0d0906)` — firelight from
 * just above the flame, falling to near-black in the corners.
 *
 * SVG sized off onLayout, for the same reason ScreenBackground is one: React Native has no gradient
 * backgrounds, and this card is the one surface in the shop that must not read as purple.
 */
function CardGround() {
  const grad = `passTile-${useId()}`;
  const [w, setW] = useState(0);

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.groundBase]}
      pointerEvents="none"
      onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Svg width={w} height={CARD_H}>
          <Defs>
            {/* Gradient ids are GLOBAL in react-native-svg — a hardcoded one blanks every instance
                after the first on Android, which is why every gradient in this app carries useId. */}
            <RadialGradient id={grad} cx="50%" cy="8%" rx="120%" ry="90%">
              <Stop offset="0" stopColor="#3A1C0C" />
              <Stop offset="0.46" stopColor="#1A0F08" />
              <Stop offset="1" stopColor="#0D0906" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={w} height={CARD_H} fill={`url(#${grad})`} />
        </Svg>
      ) : null}
    </View>
  );
}

/** The amber bloom behind the flame, breathing (the mock's `.aura`). */
function Aura() {
  const grad = `passAura-${useId()}`;
  const breath = useBreath(3600, 0.5);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(breath.value, [0, 1], [0.5, 0.85]),
    transform: [{ scale: interpolate(breath.value, [0, 1], [1, 1.08]) }],
  }));

  return (
    <Animated.View style={[styles.auraWrap, style]} pointerEvents="none">
      <Svg width={AURA_R * 2} height={AURA_R * 2}>
        <Defs>
          <RadialGradient id={grad} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={Colors.amber} stopOpacity="0.5" />
            <Stop offset="0.34" stopColor={Colors.coral} stopOpacity="0.22" />
            <Stop offset="0.66" stopColor={Colors.coral} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={AURA_R} cy={AURA_R} rx={AURA_R} ry={AURA_R} fill={`url(#${grad})`} />
      </Svg>
    </Animated.View>
  );
}

/** The mock's `floaty` — the brand mark riding up and down on a long loop. */
function HeroFlame() {
  const run = usePassMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!run) {
      t.value = 0;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [run, t]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(t.value, [0, 1], [0, -6]) }] }));

  return (
    <Animated.View style={style}>
      <FlameLogo size={60} />
    </Animated.View>
  );
}

// ─────────────────────────── the reel ───────────────────────────

/**
 * One exclusive at a time, named, with a dot per item — the mock's auto-cycling slot.
 *
 * The tile's whole job is to prove the season has *things* in it, and sixteen 20pt thumbnails at
 * this size prove nothing; one at 44pt, changing, does. Same source as the paywall's showcase, so
 * the two never disagree about what is in the set.
 */
function Reel({ items }: { items: CatalogItem[] }) {
  const run = usePassMotion();
  const [index, setIndex] = useState(0);
  const pop = useSharedValue(1);

  useEffect(() => {
    if (!run || items.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % items.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [run, items.length]);

  // The mock's `pop` — each new pick scales in from 62% with a little overshoot.
  useEffect(() => {
    if (!run) {
      pop.value = 1;
      return;
    }
    pop.value = 0.62;
    pop.value = withSpring(1, { damping: 10, stiffness: 190 });
  }, [index, run, pop]);

  const artStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const current = items[index];
  if (!current) return null;

  return (
    <View style={styles.reel}>
      <View style={styles.slot}>
        <Animated.View style={artStyle}>
          <ItemArt item={current} size={42} />
        </Animated.View>
      </View>
      <Text style={[styles.itemName, { color: RARITY_COLOR[current.rarity] }]} numberOfLines={1}>
        {current.name}
      </Text>
      <View style={styles.dots}>
        {items.map((item, i) => (
          <View key={item.id} style={[styles.dot, i === index && styles.dotOn]} />
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────── the CTA ───────────────────────────

function PassCta({
  ownsPremium,
  onSale,
  phase,
  price,
  onBuy,
}: {
  ownsPremium: boolean;
  onSale: boolean;
  phase: ReturnType<typeof seasonPhase>;
  price: string | null;
  onBuy: () => void;
}) {
  // Already paid. Selling it again is the fastest way to make someone think the first purchase
  // failed, so the strip becomes a receipt and the card body is the way into what they bought.
  if (ownsPremium) {
    return (
      <View style={styles.ctaOwned}>
        <Text style={styles.ctaOwnedText}>Your Flame Pass is live</Text>
      </View>
    );
  }

  // Outside the window the Pass is not for sale at any price (§3) — a strip that states WHY beats a
  // live button that fails on tap.
  if (!onSale) {
    return (
      <View style={styles.ctaOff}>
        <Text style={styles.ctaOffText}>{phase === 'upcoming' ? 'Opens October 1' : 'Season closed'}</Text>
      </View>
    );
  }

  return (
    <Pressable onPress={onBuy} accessibilityRole="button" accessibilityLabel="Unlock the Flame Pass">
      <EmberFill radius={14} direction="diagonal" style={styles.cta}>
        {/* The store's own localized price, or nothing at all — never a literal, which could
            disagree with what the card is actually charged. */}
        <Text style={styles.ctaText}>Unlock Flame Pass{price ? ` · ${price}` : ''}</Text>
        <View style={styles.ctaShine} pointerEvents="none">
          <ShineSweep period={2400} opacity={0.5} />
        </View>
      </EmberFill>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    height: CARD_H,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#3A2A18',
  },
  // Painted under the SVG so the card is never transparent in the frames before onLayout lands —
  // the same first-frame guard ScreenBackground uses.
  groundBase: {
    backgroundColor: '#0D0906',
  },
  raysWrap: {
    position: 'absolute',
    top: LIGHT_Y - RAY_BOX / 2,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  auraWrap: {
    position: 'absolute',
    top: LIGHT_Y - AURA_R,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  content: {
    flex: 1,
    padding: 14,
  },
  chipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  chip: {
    backgroundColor: 'rgba(20,12,6,0.7)',
    borderWidth: 1,
    borderColor: '#53381F',
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: Radius.pill,
  },
  chipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 1,
    color: Colors.ember,
  },
  ends: {
    backgroundColor: 'rgba(20,12,6,0.6)',
    borderWidth: 1,
    borderColor: '#3A2A18',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
  },
  endsText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 0.6,
    color: '#D9B98A',
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 2.6,
    textTransform: 'uppercase',
    color: '#D9B98A',
    marginTop: 2,
  },
  // No gradient-filled text without a mask (same call the pass header's wordmark makes) — the
  // ember stop carries the identity at this size.
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 32,
    letterSpacing: 0.5,
    color: Colors.ember,
    marginTop: 1,
  },
  subline: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: '#E8D8C4',
    marginTop: 6,
    textAlign: 'center',
  },
  sublineStrong: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  reel: {
    alignItems: 'center',
    marginTop: 10,
  },
  slot: {
    width: 68,
    height: 68,
    borderRadius: 16,
    backgroundColor: '#1A120B',
    borderWidth: 1,
    borderColor: '#3A2A18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    marginTop: 8,
    // Holds the line's height while a longer name swaps in for a shorter one, so the dot row below
    // doesn't hop on every cycle.
    minHeight: 16,
  },
  dots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
    maxWidth: 200,
    marginTop: 7,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#3A2A18',
  },
  dotOn: {
    backgroundColor: Colors.amber,
  },
  foot: {
    marginTop: Spacing.twelve,
  },
  cta: {
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ctaText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14.5,
    color: Colors.onEmber,
  },
  ctaShine: {
    ...StyleSheet.absoluteFill,
  },
  ctaOwned: {
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,210,122,0.14)',
    borderWidth: 1,
    borderColor: '#6B4A1E',
  },
  ctaOwnedText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ember,
  },
  ctaOff: {
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(20,12,6,0.7)',
    borderWidth: 1,
    borderColor: '#3A2A18',
  },
  ctaOffText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: '#D9B98A',
  },
  fine: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: '#B09A83',
    textAlign: 'center',
    marginTop: 7,
  },
  hint: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    color: '#8A7461',
    textAlign: 'center',
    marginTop: 3,
  },
});
