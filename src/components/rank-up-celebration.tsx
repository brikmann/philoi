import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { HexagonBadge } from '@/components/hexagon-badge';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { RANK_UP_COPY } from '@/lib/rank-up-copy';
import { formatRankTier, RANK_TIER_METAL, TIER_FLASH_KIND } from '@/lib/rank-tiers';
import { fireRankUp, startRankUpRiser, stopRankUpRiser } from '@/lib/reward-feedback';
import type { RankTierName } from '@/types/database';

// Warm flash color at the forge's flare beat (design-mocks/05: `.flash{background:#FFE9C2}`)
// — a one-off, localized highlight distinct from the brand palette in constants/theme.ts.
const FLASH_COLOR = '#FFE9C2';
// The beat everything converges on — the hex's 3.9s materialize (starting at 500ms) ends here,
// and the flare/tier-flash/sound all fire at this exact moment (design-mocks/05's own timings).
const FLARE_DELAY_MS = 3700;
// How far below its settled spot the hex starts — down in the campfire flames at the bottom of the
// forge stage (design-mocks/05/32's `riseup`: the badge rises up and OUT of the fire). Paired with
// the forge stage layout below so the origin lands over the flames, not in empty space.
const HEX_RISE_DISTANCE = 130;

type RankUpCelebrationProps = {
  tier: RankTierName;
  division: number;
  fromTier: RankTierName;
  fromDivision: number;
  streakDays: number;
  /** The two ascension moments (RANKUP_SPEC §1): Diamond I → Hero III, and anything → Primordial.
   * Gates the framing card, the Victory Anthem, the hardest wash, and the heavy haptic sequence.
   * Normally derived by the caller from the rank delta (see deriveRankUpLevel), but forced true by
   * the dev-tools ascension buttons so both can be auditioned without climbing there. */
  isBandCrossing?: boolean;
  onContinue: () => void;
  onShare: () => void;
  sharing?: boolean;
};

function hashUnit(seed: number): number {
  const x = Math.sin(seed * 9973 + 1) * 43758.5453;
  return x - Math.floor(x);
}

// Smoke gathering above the campfire before the hex rises through it (design-mocks/05's
// `.smoke` — distinct from the embers: bigger, slower, greyer, more transparent).
const SMOKE = [
  { delay: 600, xOffset: -14 },
  { delay: 1200, xOffset: 10 },
  { delay: 1800, xOffset: -4 },
  { delay: 2400, xOffset: 16 },
];

function Smoke({ delay, xOffset }: { delay: number; xOffset: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withRepeat(withTiming(1, { duration: 3000, easing: Easing.out(Easing.quad) }), -1, false));
  }, [delay, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 0.36, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, -150]) },
      { translateX: xOffset },
      { scale: interpolate(progress.value, [0, 1], [0.6, 2.2]) },
    ],
  }));
  return <Animated.View style={[styles.smoke, style]} />;
}

// Staggered rise-and-fade embers drifting off the campfire at the bottom — same pattern as
// lock-in-flame.tsx's Ember, duplicated locally rather than shared since the two components'
// layouts differ enough that a shared abstraction would just be indirection.
const EMBERS = [
  { delay: 0, xOffset: -22 },
  { delay: 500, xOffset: 14 },
  { delay: 950, xOffset: -6 },
  { delay: 1400, xOffset: 26 },
];

function Ember({ delay, xOffset }: { delay: number; xOffset: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 2600, easing: Easing.out(Easing.quad) }), -1, false)
    );
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.15, 0.75, 1], [0, 1, 0.5, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, -90]) },
      { translateX: xOffset },
      { scale: interpolate(progress.value, [0, 1], [0.6, 1]) },
    ],
  }));

  return <Animated.View style={[styles.ember, style]} />;
}

function useRiseStyle(reveal: SharedValue<number>) {
  return useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateY: interpolate(reveal.value, [0, 1], [12, 0]) }],
  }));
}

// One falling/twinkling glint — reused for both Gold's sparkle burst and Diamond's prism
// shower, just with different counts/colors/motion passed in.
function Glint({
  color,
  left,
  startTop,
  fall,
  delay,
  duration,
}: {
  color: string;
  left: number;
  startTop: number;
  fall: number;
  delay: number;
  duration: number;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }));
  }, [delay, duration, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 0.8, 1], [0, 1, 1, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, fall]) },
      { scale: interpolate(progress.value, [0, 0.4, 1], [0.3, 1.1, 0.3]) },
      { rotate: `${interpolate(progress.value, [0, 1], [0, 170])}deg` },
    ],
  }));
  return (
    <Animated.Text style={[styles.glint, { left: `${left}%`, top: `${startTop}%`, color, textShadowColor: color }, style]}>
      ✦
    </Animated.Text>
  );
}

// A rising flame blob for Primordial's "whole screen catches fire" transition (§11) — one-shot,
// removed once the transition settles into the resting molten-aura badge (the reconciliation
// rule: no literal flames left burning at rest).
function FlameBlob({ left, height, delay }: { left: number; height: number; delay: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }));
  }, [delay, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.25, 1], [0, 0.9, 0]),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [20, -(120 + height)]) }, { scaleY: interpolate(progress.value, [0, 1], [0.6, 1.1]) }],
  }));
  return <Animated.View style={[styles.flameBlob, { left: `${left}%`, height, width: 10 + (height % 8) }, style]} />;
}

// The hexagon "burning" during Primordial's transition only (§11's reconciliation: literal flame
// licks are the TRANSITION, never the resting state) — a short ring of small licks around the
// badge that fades out once the settle beat completes.
function HexLick({ rotation, delay }: { rotation: number; delay: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delay,
      withSequence(withTiming(1, { duration: 300 }), withDelay(500, withTiming(0, { duration: 500 })))
    );
  }, [delay, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ rotate: `${rotation}deg` }, { scale: 0.85 + progress.value * 0.3 }],
  }));
  return <Animated.View style={[styles.hexLick, style]} />;
}

// The tier flash at the forge's flare beat (PHILOI_UI_SPEC.md §11, design-mocks/31), keyed to the
// NEW tier. EVERY rank-up (§21/§22) gets the SAME full-screen tier-colored wash — one solid-color
// absoluteFill overlay (not an edge vignette), so it covers the whole screen reliably on the first
// play for every tier with no dependence on late-measured dimensions. On top of that shared wash:
//   • Tier crossing → the moving metallic sweep + the tier's TIER_FLASH_KIND particles (Primordial
//     also gets rising flames, and the hardest wash — the apex).
//   • Division bump → the wash alone (also covers bronze, which has no crossing `kind`).
function TierFlashOverlay({
  tier,
  isDivisionBump,
  isBandCrossing,
  reduceMotion,
}: {
  tier: RankTierName;
  isDivisionBump: boolean;
  isBandCrossing: boolean;
  reduceMotion: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const kind = TIER_FLASH_KIND[tier];
  const metal = RANK_TIER_METAL[tier];
  const isFlame = kind === 'flame';
  // Coral for Primordial's fire; the tier's own metal.inner for every other tier.
  const washColor = isFlame ? Colors.coral : metal.inner;
  const wash = useSharedValue(0);
  const sweep = useSharedValue(0);
  // Olympian's god-rays and Immortal's ascending glow both ride this one 0→1 driver.
  const halo = useSharedValue(0);

  // The three intensities (§1) read as one dial: how hard the screen floods. 0.5 bump / 0.7
  // crossing / 0.9 band crossing — Primordial stays at the apex value on any crossing since its
  // arrival IS a band crossing.
  const washPeak = isDivisionBump ? 0.5 : isBandCrossing || isFlame ? 0.9 : 0.7;

  useEffect(() => {
    if (reduceMotion) return;
    // Full-screen tier-colored wash on EVERY rank-up (bump OR crossing, every tier) — engulf →
    // brief hold → recede, long enough to read as a real screen flush rather than a blip.
    wash.value = withDelay(
      FLARE_DELAY_MS,
      withSequence(withTiming(washPeak, { duration: 450 }), withDelay(350, withTiming(0, { duration: 950 })))
    );
    if (!isDivisionBump && (kind === 'sparkle' || tier === 'immortal')) {
      halo.value = withDelay(FLARE_DELAY_MS, withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) }));
    }
    // Crossings layer the moving metallic sweep on top; a division bump is the wash alone.
    if (!isDivisionBump && kind) {
      sweep.value = withDelay(FLARE_DELAY_MS, withTiming(1, { duration: 820, easing: Easing.inOut(Easing.ease) }));
    }
  }, [reduceMotion, isDivisionBump, kind, tier, washPeak, wash, sweep, halo]);

  const washStyle = useAnimatedStyle(() => ({ opacity: wash.value, backgroundColor: washColor }));
  // God-rays (Olympian) fade in then hold faint; the ascending glow (Immortal) also drifts upward.
  const haloStyle = useAnimatedStyle(() => ({ opacity: interpolate(halo.value, [0, 0.35, 1], [0, 0.5, 0.12]) }));
  const ascendStyle = useAnimatedStyle(() => ({
    opacity: interpolate(halo.value, [0, 0.3, 1], [0, 0.45, 0]),
    transform: [{ translateY: interpolate(halo.value, [0, 1], [80, -120]) }],
  }));
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(sweep.value, [0, 1], [-width * 1.6, width * 1.6]) }, { rotate: '-14deg' }],
  }));

  if (reduceMotion) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Full-fill tier wash — a solid color over absoluteFill (NOT an edge vignette), so it covers
          the whole screen reliably on the first play for EVERY tier, with zero dependence on
          late-measured dimensions. Sits behind the hero, so the badge/text stay legible on it. */}
      <Animated.View style={[StyleSheet.absoluteFill, washStyle]} />

      {/* A division bump is the wash alone. Crossings add the sweep + the tier's particles (and
          Primordial its rising flames) on top of the same wash. */}
      {!isDivisionBump && kind && (
        <>
          <Animated.View style={[styles.sweep, { width: width * 0.7, height: height * 1.4 }, sweepStyle]}>
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="tierSweep" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={metal.inner} stopOpacity={0} />
                  <Stop offset="0.5" stopColor={metal.inner} stopOpacity={0.8} />
                  <Stop offset="1" stopColor={metal.inner} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect x={0} y={0} width="100%" height="100%" fill="url(#tierSweep)" />
            </Svg>
          </Animated.View>

          {kind === 'sparkle' &&
            Array.from({ length: 10 }, (_, i) => (
              <Glint
                key={i}
                color={metal.inner}
                left={6 + hashUnit(i) * 88}
                startTop={-8}
                fall={height + 80}
                delay={FLARE_DELAY_MS + i * 55}
                duration={900 + hashUnit(i + 40) * 400}
              />
            ))}

          {kind === 'prism' &&
            Array.from({ length: 10 }, (_, i) => {
              // Derived from the tier, not hardcoded. 'prism' used to belong to Diamond alone, so
              // this was a fixed cyan/white/violet set — but the 0063 rework gave it to Titan
              // (green) and Immortal (lilac) too, and spraying Diamond's cyan on either made the
              // crossing read as the wrong tier entirely. White stays as the refraction highlight;
              // the rest come from the tier's own metal so each prism keeps its identity.
              const cols = [metal.text, metal.inner, '#ffffff', metal.inner, metal.text];
              return (
                <Glint
                  key={i}
                  color={cols[i % cols.length]}
                  left={4 + hashUnit(i + 5) * 92}
                  startTop={6 + hashUnit(i + 60) * 78}
                  fall={30 - hashUnit(i + 80) * 60}
                  delay={FLARE_DELAY_MS + i * 40}
                  duration={650 + hashUnit(i + 90) * 450}
                />
              );
            })}

          {isFlame &&
            Array.from({ length: 14 }, (_, i) => (
              <FlameBlob key={i} left={hashUnit(i + 10) * 96} height={40 + hashUnit(i + 20) * 60} delay={FLARE_DELAY_MS + i * 45} />
            ))}

          {/* Hero — "the threshold ignites" (§2). Embers reused from the campfire, tinted crimson
              and thrown across the whole screen rather than rising from the fire's base. */}
          {tier === 'hero' &&
            Array.from({ length: 12 }, (_, i) => (
              <Glint
                key={`hero-${i}`}
                color={i % 3 === 0 ? metal.text : metal.inner}
                left={4 + hashUnit(i + 15) * 92}
                startTop={70 + hashUnit(i + 25) * 26}
                fall={-(120 + hashUnit(i + 35) * 160)}
                delay={FLARE_DELAY_MS + i * 50}
                duration={900 + hashUnit(i + 45) * 500}
              />
            ))}

          {/* Olympian — 3 soft radial beams from the top, fading down (§2). */}
          {tier === 'olympian' && (
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, haloStyle]}>
              <Svg width="100%" height="100%">
                <Defs>
                  <LinearGradient id="godRay" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={metal.inner} stopOpacity={0.85} />
                    <Stop offset="1" stopColor={metal.inner} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                {[0.22, 0.5, 0.78].map((cx, i) => (
                  <Rect
                    key={cx}
                    x={width * cx - (26 + i * 6) / 2}
                    y={0}
                    width={26 + i * 6}
                    height={height * 0.72}
                    fill="url(#godRay)"
                  />
                ))}
              </Svg>
            </Animated.View>
          )}

          {/* Immortal — a gentle violet glow ascending behind the badge. Ethereal, NOT fiery: it
              rises and dissolves rather than licking upward like Primordial's flames (§2). */}
          {tier === 'immortal' && (
            <Animated.View pointerEvents="none" style={[styles.ascendGlow, { backgroundColor: metal.inner }, ascendStyle]} />
          )}
        </>
      )}
    </View>
  );
}

// The immersive backdrop the forge lives in (design-mocks/32's `.stage` radial-gradient:
// `radial-gradient(120% 80% at 50% 46%, #241528 0%, #17131f 62%)`) — a dark twilight glow, NOT
// the flat plum a plain `<Screen dark>` would show behind it. The center lift (#241528) sits just
// under the rising hex; everything past 62% settles to Colors.forgeBg (#17131f).
function ForgeBackdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="forgeBg" cx="50%" cy="46%" rx="120%" ry="80%">
            <Stop offset="0" stopColor="#241528" />
            <Stop offset="0.62" stopColor={Colors.forgeBg} />
            <Stop offset="1" stopColor={Colors.forgeBg} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#forgeBg)" />
      </Svg>
    </View>
  );
}

// Rank-up moment — the full ~5s campfire forge (PHILOI_UI_SPEC.md §11, design-mocks/05's exact
// timings + 31/32's tier flash and composed headline). Runs on EVERY rank-up now (§21/§22), not
// just tier crossings: a same-tier division bump plays the identical forge, differing only at the
// flare payoff (lighter tier-tinted flash + a softer per-tier cue — driven by isDivisionBump).
// Sound + haptic fire here directly, timed to the solidify flare, not at mount — the riser builds
// the whole way in and is cut exactly at that beat so it resolves into the tier hit; Primordial gets
// an extra follow-up thump on top of the normal heavy impact.
export function RankUpCelebration({
  tier,
  division,
  fromTier,
  fromDivision,
  streakDays,
  isBandCrossing = false,
  onContinue,
  onShare,
  sharing,
}: RankUpCelebrationProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  // Fixed per tier now (§5) — no pool, no picker, no interpolation, so nothing to memoize.
  const copy = RANK_UP_COPY[tier];

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  const isPrimordial = tier === 'primordial';
  // Titan is "colossal" (§2) — a short ±3px jolt at the flare. Reduce-motion skips it entirely.
  const shake = useSharedValue(0);
  // The framing card owns the first 1.2s of a band crossing, then hands off to the forge.
  const [showFraming, setShowFraming] = useState(isBandCrossing);

  useEffect(() => {
    if (!isBandCrossing) return;
    const timer = setTimeout(() => setShowFraming(false), 1200);
    return () => clearTimeout(timer);
  }, [isBandCrossing]);
  // Same tier in and out (e.g. Bronze III -> II) = a within-tier bump: same forge, lighter flare
  // payoff + softer cue. Anything else is a true tier crossing. (The dev-preview's Bronze III
  // "from = itself" also reads as a bump, which is right — there's no lower rank to cross from.)
  const isDivisionBump = fromTier === tier;

  // Materialize: tiny + near-transparent -> full scale/opacity with one slow 360° rotateY, while
  // rising up out of the campfire (hexRise: 1 = down in the flames, 0 = settled).
  const hexScale = useSharedValue(reduceMotion ? 1 : 0.1);
  const hexOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const hexRotateY = useSharedValue(0);
  const hexRise = useSharedValue(reduceMotion ? 0 : 1);
  // Flare at the materialize's tail — warm flash + expanding ring(s), Primordial gets a second ring.
  const flash = useSharedValue(0);
  const ring1 = useSharedValue(0);
  const ring2 = useSharedValue(0);
  // Persistent settle once materialized — gentle float + breathe, never stops.
  const hover = useSharedValue(0);
  // Staggered text/CTA reveal.
  const headlineReveal = useSharedValue(reduceMotion ? 1 : 0);
  const tierReveal = useSharedValue(reduceMotion ? 1 : 0);
  const metaReveal = useSharedValue(reduceMotion ? 1 : 0);
  const ctasReveal = useSharedValue(reduceMotion ? 1 : 0);

  // Fires the tier cue exactly once per mount, guarding against effect re-runs (the reduceMotion
  // state resolving, dev-tool re-render, StrictMode's double-invoke) replaying the sound.
  const hasFiredCueRef = useRef(false);
  function fireTierCueOnce() {
    if (hasFiredCueRef.current) return;
    hasFiredCueRef.current = true;
    fireRankUp(tier, isDivisionBump, isBandCrossing);
  }

  useEffect(() => {
    if (reduceMotion) {
      // Skip straight to the settled state + full text — no materialize, no flare beat, and no
      // riser (a 3.7s build with no forge behind it is worse than silence). The moment still gets
      // its cue, immediately instead of at 3.7s, scaled to bump vs. crossing.
      fireTierCueOnce();
      return;
    }
    // Riser swells from the forge's first frame and is cut at the flare (below), resolving into
    // the per-tier hit instead of overlapping it. startRankUpRiser is idempotent (stops any
    // existing riser first) so StrictMode's mount→cleanup→mount can't leave two overlapping.
    startRankUpRiser();
    const bezier = Easing.bezier(0.25, 0.55, 0.25, 1);
    hexOpacity.value = withDelay(500, withTiming(1, { duration: 3900, easing: bezier }));
    hexScale.value = withDelay(500, withTiming(1, { duration: 3900, easing: bezier }));
    hexRotateY.value = withDelay(500, withTiming(1080, { duration: 3900, easing: Easing.out(Easing.cubic) }));
    // Rise up out of the campfire over the same materialize window (design-mocks/05's `riseup`).
    hexRise.value = withDelay(500, withTiming(0, { duration: 3900, easing: bezier }));

    // Titan's earthquake — six quick alternating offsets over ~400ms, only on its crossing.
    if (tier === 'titan' && !isDivisionBump) {
      shake.value = withDelay(
        FLARE_DELAY_MS,
        withSequence(
          withTiming(1, { duration: 60 }),
          withTiming(-1, { duration: 60 }),
          withTiming(1, { duration: 60 }),
          withTiming(-1, { duration: 60 }),
          withTiming(0.5, { duration: 60 }),
          withTiming(0, { duration: 100 })
        )
      );
    }

    flash.value = withDelay(FLARE_DELAY_MS, withTiming(1, { duration: 800, easing: Easing.linear }));
    ring1.value = withDelay(3850, withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) }));
    if (isPrimordial) {
      // "A double shockwave (two rings), denser sparks" — the loudest forge in the app.
      ring2.value = withDelay(4150, withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) }));
    }

    hover.value = withDelay(
      4600,
      withRepeat(withSequence(withTiming(1, { duration: 1700 }), withTiming(0, { duration: 1700 })), -1, true)
    );

    headlineReveal.value = withDelay(4600, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
    tierReveal.value = withDelay(4850, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
    metaReveal.value = withDelay(5100, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
    ctasReveal.value = withDelay(5350, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));

    // At the flare (§22): cut the riser so it resolves into the tier hit, then fire the per-tier
    // cue + haptic once — scaled down for a division bump, full for a crossing.
    const flareTimer = setTimeout(() => {
      stopRankUpRiser();
      fireTierCueOnce();
    }, FLARE_DELAY_MS);
    // Cut the riser on early unmount too (navigating away / dev-tool re-roll mid-forge) so it
    // never plays on past the screen it belongs to.
    return () => {
      clearTimeout(flareTimer);
      stopRankUpRiser();
    };
    // fireTierCueOnce is idempotent by ref (hasFiredCueRef) and reads only props already listed
    // below; including it would rebuild this whole timeline on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reduceMotion,
    tier,
    isDivisionBump,
    isPrimordial,
    hexOpacity,
    hexScale,
    hexRotateY,
    hexRise,
    flash,
    ring1,
    ring2,
    hover,
    headlineReveal,
    tierReveal,
    metaReveal,
    ctasReveal,
    shake,
  ]);

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value * 3 }] }));

  const hexStyle = useAnimatedStyle(() => ({
    opacity: hexOpacity.value,
    transform: [
      { perspective: 800 },
      // Rise up out of the campfire, then the gentle resting hover once settled.
      { translateY: interpolate(hexRise.value, [0, 1], [0, HEX_RISE_DISTANCE]) + interpolate(hover.value, [0, 1], [0, -8]) },
      { rotateY: `${hexRotateY.value}deg` },
      { scale: hexScale.value + hover.value * 0.05 },
    ],
  }));

  const flashStyle = useAnimatedStyle(() => ({
    opacity: interpolate(flash.value, [0, 0.25, 1], [0, 0.95, 0]),
  }));

  // Invisible at rest — the ring sits at value 0 for the whole 3.85s rise, so a [0,1]->[0.7,0]
  // map would leave a static 0.7-opacity coral ring hanging at the hex origin the entire time
  // (the "orange circle" bug). The near-zero keyframe keeps it at 0 until the expand actually
  // begins, then it pops to 0.7 and fades as it grows.
  const ring1Style = useAnimatedStyle(() => ({
    opacity: interpolate(ring1.value, [0, 0.001, 1], [0, 0.7, 0]),
    transform: [{ scale: interpolate(ring1.value, [0, 1], [1, 5]) }],
  }));

  const ring2Style = useAnimatedStyle(() => ({
    opacity: interpolate(ring2.value, [0, 0.001, 1], [0, 0.7, 0]),
    transform: [{ scale: interpolate(ring2.value, [0, 1], [1, 5]) }],
  }));

  const headlineStyle = useRiseStyle(headlineReveal);
  const tierStyle = useRiseStyle(tierReveal);
  const metaStyle = useRiseStyle(metaReveal);
  const ctasStyle = useRiseStyle(ctasReveal);

  return (
    <Animated.View entering={FadeIn.duration(300)} style={[styles.container, shakeStyle]}>
      <ForgeBackdrop />

      {/* Band-crossing framing card (§1) — a 1.2s pre-beat that owns the screen before the forge
          resolves, so entering the Realm of Legend / becoming Primordial doesn't just look like a
          louder tier crossing. Static under reduce-motion, but it still shows (§7). */}
      {isBandCrossing && showFraming && (
        <Animated.View
          entering={FadeIn.duration(reduceMotion ? 0 : 350)}
          exiting={FadeOut.duration(reduceMotion ? 0 : 400)}
          style={styles.framingCard}
          pointerEvents="none">
          <Text style={styles.framingHead}>{copy.head}</Text>
          <Text style={styles.framingSub}>{copy.sub}</Text>
        </Animated.View>
      )}
      <TierFlashOverlay
        tier={tier}
        isDivisionBump={isDivisionBump}
        isBandCrossing={isBandCrossing}
        reduceMotion={reduceMotion}
      />

      {/* Clustered in the vertical center (design-mocks/05 + 32): the forge stage — campfire at the
          bottom with the hex rising up OUT of it — then the "Reached X" / streak text right under.
          The CTAs pin to the bottom below this cluster. */}
      <View style={styles.hero}>
        <View style={styles.forge}>
          {/* Campfire pinned to the bottom of the stage — the hex's rise origin sits in these
              flames, so the badge visibly emerges from the fire (rendered first = behind the hex). */}
          <View style={styles.campfire} pointerEvents="none">
            {SMOKE.map((s) => (
              <Smoke key={s.delay} delay={s.delay} xOffset={s.xOffset} />
            ))}
            {EMBERS.map((e) => (
              <Ember key={e.delay} delay={e.delay} xOffset={e.xOffset} />
            ))}
            <CampfireFlame />
          </View>

          {/* The flare (flash + rings) stays anchored at the hex's SETTLED spot near the top of the
              stage; only the hex itself rises into it. Both align at the flare beat. */}
          <View style={styles.hexZone} pointerEvents="none">
            <Animated.View pointerEvents="none" style={[styles.flash, flashStyle]} />
            <Animated.View pointerEvents="none" style={[styles.ring, ring1Style]} />
            {isPrimordial && <Animated.View pointerEvents="none" style={[styles.ring, ring2Style]} />}
            <Animated.View style={hexStyle}>
              <HexagonBadge tier={tier} division={division} size={96} />
              {/* "The hexagon burns" — transition only (§11's reconciliation); fades out on its
                  own and never re-fires, leaving just the badge's normal resting aura. */}
              {isPrimordial && !reduceMotion && (
                <View style={styles.hexLickRing} pointerEvents="none">
                  {[-60, -20, 20, 60, 140, 200].map((rotation, i) => (
                    <HexLick key={rotation} rotation={rotation} delay={FLARE_DELAY_MS + i * 30} />
                  ))}
                </View>
              )}
            </Animated.View>
          </View>
        </View>

        {/* Copy is a TIER-CROSSING payoff only (§5). A division bump gets the lighter wash and the
            haptic and nothing else — showing "IGNITION." again on Bronze III→II would spend the
            line twice and flatten the crossing it belongs to. */}
        {!isDivisionBump && (
          <Animated.View style={headlineStyle}>
            <Text style={styles.headline}>{copy.head}</Text>
            <Text style={styles.headlineSub}>{copy.sub}</Text>
          </Animated.View>
        )}
        <Animated.Text style={[styles.tierText, tierStyle]}>Reached {formatRankTier(tier, division)}</Animated.Text>
        <Animated.Text style={[styles.metaText, metaStyle]}>forged from a {streakDays}-day streak</Animated.Text>
      </View>

      <Animated.View style={[styles.ctas, ctasStyle]}>
        <Pressable style={styles.shareBtn} onPress={onShare} disabled={sharing}>
          {sharing ? (
            <ActivityIndicator color={Colors.ink} />
          ) : (
            <>
              <Ionicons name="share-social" size={16} color={Colors.ink} />
              <Text style={styles.shareLabel}>Share to your story</Text>
            </>
          )}
        </Pressable>
        <Pressable onPress={onContinue} disabled={sharing}>
          <Text style={styles.continueLabel}>Continue</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

// The campfire the rank was forged from — a real FlameSvg (matching the rest of the app's art,
// not a bare emoji) with a continuous "roar" pulse (design-mocks/05's `.fire .fl` keyframe).
function CampfireFlame() {
  const roar = useSharedValue(0);
  useEffect(() => {
    roar.value = withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0, { duration: 500 })), -1, true);
  }, [roar]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: 1 + roar.value * 0.13 }, { scaleX: 1 - roar.value * 0.06 }],
  }));
  return (
    <Animated.View style={style}>
      <FlameSvg width={72 * FLAME_ASPECT_RATIO} height={72} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.forgeBg,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
  },
  // Holds the hex + text + campfire as one centered cluster (the three "zones"), taking all the
  // space above the pinned CTAs — so the moment reads tight and composed, not stretched.
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The forge stage: campfire pinned to the bottom, hex settled near the top, so the hex's rise
  // (HEX_RISE_DISTANCE) starts down in the flames and ends at the top. Tall enough to hold both.
  forge: {
    width: 200,
    height: 240,
    alignItems: 'center',
  },
  hexZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    height: 160,
  },
  flash: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: FLASH_COLOR,
  },
  ring: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 3,
    borderColor: Colors.coral,
  },
  hexLickRing: {
    position: 'absolute',
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
  },
  hexLick: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 7,
    height: 16,
    marginLeft: -3.5,
    marginTop: -60,
    borderRadius: 4,
    backgroundColor: Colors.amber,
  },
  // Band-crossing framing card — a full-bleed takeover over the forge for its first beat.
  framingCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,7,16,0.92)',
    paddingHorizontal: Spacing.five,
  },
  framingHead: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: 0.5,
    color: Colors.ink,
    textAlign: 'center',
  },
  framingSub: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    letterSpacing: 1.4,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  // Immortal's ascending glow — a soft wide blob that drifts up behind the badge and dissolves.
  ascendGlow: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: '18%',
    width: 260,
    height: 260,
    borderRadius: 130,
  },
  // Big + bold head, smaller/lighter sub beneath (§5) — the same treatment the band-crossing
  // framing card uses, so the takeover and the badge screen read as one voice.
  headline: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: 0.5,
    color: Colors.ink,
    textAlign: 'center',
    paddingHorizontal: Spacing.two,
  },
  headlineSub: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1.2,
    color: Colors.muted,
    textAlign: 'center',
    paddingHorizontal: Spacing.two,
    marginTop: Spacing.one,
  },
  tierText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ember,
    marginTop: Spacing.two,
  },
  metaText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    marginTop: 4,
  },
  campfire: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    height: 90,
  },
  smoke: {
    position: 'absolute',
    bottom: 60,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#9a90ad',
  },
  ember: {
    position: 'absolute',
    bottom: 20,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.ember,
  },
  sweep: {
    position: 'absolute',
    top: '-20%',
  },
  glint: {
    position: 'absolute',
    fontSize: 13,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  flameBlob: {
    position: 'absolute',
    bottom: -14,
    borderRadius: 999,
    backgroundColor: Colors.amber,
  },
  ctas: {
    width: '100%',
    gap: Spacing.two,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    backgroundColor: Colors.coral,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
  },
  shareLabel: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.ink,
    fontSize: 15,
  },
  continueLabel: {
    fontFamily: Fonts.body,
    color: Colors.textTertiary,
    fontSize: 13.5,
    textAlign: 'center',
  },
});
