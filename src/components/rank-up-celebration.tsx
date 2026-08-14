import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  interpolateColor,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { HexagonBadge } from '@/components/hexagon-badge';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { divisionUpCopy, RANK_UP_COPY, rankUpCardTag } from '@/lib/rank-up-copy';
import { formatRankTier, RANK_TIER_METAL, TIER_FLASH_KIND } from '@/lib/rank-tiers';
import {
  fireIncinerationBurn,
  fireIncinerationFuse,
  fireRankUp,
  startAscensionAnthem,
  stopRankUpAudio,
} from '@/lib/reward-feedback';
import type { RankTierName } from '@/types/database';

// Warm flash color at the flare beat (design-mocks/85's `.white` / `#FFE9C2`) — a one-off,
// localized highlight distinct from the brand palette in constants/theme.ts.
const FLASH_COLOR = '#FFE9C2';

// ────────────────────────────────── the arc (design-mocks/85) ──────────────────────────────────
//
// The moment is now the mock's tight three-beat arc, NOT the old 5s campfire forge: the badge
// enters with its tier's SIGNATURE move, the tier hit lands on the flare and rings out, and at
// ~2.2s the frame settles into the shareable story card with the hit still ringing under it.
//
// A band crossing puts a cinematic PRE-BEAT in front of all that (the diamond shatter into the
// crimson pillar; the void collapse into the cosmic tear) and only then reaches its crest — so
// every main-phase delay below is measured from `crestAt`, which is 0 for an ordinary crossing.
const ENTRANCE_MS = 1000; // signature move → flare
const BAND_ENTRANCE_MS = 800; // the crest slam is faster and harder than an ordinary entrance
const CARD_AFTER_FLARE_MS = 1200; // flare → the card composes (mock 85: 1000 + 1200 = 2200)
const BAND_CARD_AFTER_CREST_MS = 1500;
const HERO_CREST_MS = 1250; // shatter → whiteout → pillar → crest slam
const PRIMORDIAL_CREST_MS = 1900; // void collapse → tear rips + seals → emblem coalesces
const REDUCED_CARD_MS = 350; // reduce-motion: cross-fade straight to the composed card

// The intra-division bump — "the incineration" (RANKUP_SPEC §9). Its own timeline, since nothing
// about it is a scaled-down crossing: a white ray fuses the badge in, hellfire burns the top
// numeral stroke off, the remaining marks recenter, and the tier's own hit lands as the new
// division locks.
const BUMP_BADGE_MS = 200;
const BUMP_BURN_MS = 900;
const BUMP_COLLAPSE_MS = 1420;
const BUMP_HIT_MS = 1200;
const BUMP_CARD_MS = 1950;

type RankUpCelebrationProps = {
  tier: RankTierName;
  division: number;
  fromTier: RankTierName;
  fromDivision: number;
  streakDays: number;
  /** Shown on the card's `@handle · rank` footer (design-mocks/84). Falls back to the display name
   * upstream; null renders the footer as the rank alone rather than an empty "@". */
  handle?: string | null;
  /** The two ascension moments (RANKUP_SPEC §1): Diamond I → Hero III, and anything → Primordial.
   * Gates the cinematic pre-beat, the full anthem, the hardest wash, and the heavy haptic
   * sequence. Normally derived by the caller from the rank delta (see deriveRankUpLevel), but
   * forced true by the dev-tools ascension buttons so both can be auditioned without climbing. */
  isBandCrossing?: boolean;
  onContinue: () => void;
  onShare: () => void;
  sharing?: boolean;
};

function hashUnit(seed: number): number {
  const x = Math.sin(seed * 9973 + 1) * 43758.5453;
  return x - Math.floor(x);
}

// ─────────────────────────────── per-tier signature (RANKUP_SPEC §9) ───────────────────────────
//
// Each tier gets its OWN move, not a recolored generic burst — the entrance the badge arrives on
// plus the signature that plays around it at the flare. Bronze isn't in mock 85 (you can't cross
// INTO the starting tier) but keeps an entry so a Bronze division bump still has a defined badge
// entrance rather than falling through to undefined.
type EntranceKind = 'forge' | 'drop' | 'slam' | 'bloom' | 'rise' | 'coalesce';
type SignatureKind = 'embers' | 'slash' | 'coins' | 'frost' | 'prism' | 'shock' | 'debris' | 'godray' | 'wisp' | 'fire';

const TIER_SIGNATURE: Record<RankTierName, { entrance: EntranceKind; signature: SignatureKind }> = {
  bronze: { entrance: 'forge', signature: 'embers' },
  silver: { entrance: 'forge', signature: 'slash' }, // blade-slash streak reveal
  gold: { entrance: 'drop', signature: 'coins' }, // crown descent + coin rain
  platinum: { entrance: 'forge', signature: 'frost' }, // crystallize + frost shimmer
  diamond: { entrance: 'forge', signature: 'prism' }, // pressure-forge + prism glints
  hero: { entrance: 'slam', signature: 'shock' }, // crest slam + shockwave (after the pillar)
  titan: { entrance: 'slam', signature: 'debris' }, // colossal slam + screen-shake + debris
  olympian: { entrance: 'bloom', signature: 'godray' }, // slow bloom + god-rays
  immortal: { entrance: 'rise', signature: 'wisp' }, // ethereal rise + ghost-wisps + aura
  primordial: { entrance: 'coalesce', signature: 'fire' }, // emblem coalesces out of the particles
};

// The mock's shared entrance easing — the keyframe stops below are shaped by it exactly as the
// CSS `cubic-bezier(.25,.75,.3,1)` shapes mock 85's `@keyframes`.
const ENTRANCE_EASING = Easing.bezier(0.25, 0.75, 0.3, 1);

/** One badge entrance, expressed as the mock's keyframe stops over a single 0→1 driver. Under
 * reduce-motion every signature collapses to the same plain cross-fade (§7) — no slam, no drop,
 * no overshoot; the badge simply appears. */
function useEntranceStyle(kind: EntranceKind, enter: SharedValue<number>, reduceMotion: boolean) {
  return useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: enter.value };
    switch (kind) {
      // Crown descent — drops in from above with a slight rotational settle.
      case 'drop':
        return {
          opacity: interpolate(enter.value, [0, 0.3, 1], [0, 1, 1]),
          transform: [
            { translateY: interpolate(enter.value, [0, 0.7, 1], [-120, 10, 0]) },
            { rotate: `${interpolate(enter.value, [0, 0.7, 1], [-8, 3, 0])}deg` },
          ],
        };
      // Colossal slam — falls from above, oversized, and lands hard.
      case 'slam':
        return {
          opacity: interpolate(enter.value, [0, 0.35, 1], [0, 1, 1]),
          transform: [
            { translateY: interpolate(enter.value, [0, 0.55, 1], [-130, 14, 0]) },
            { scale: interpolate(enter.value, [0, 0.55, 0.75, 1], [1.5, 0.9, 1.05, 1]) },
          ],
        };
      // Slow bloom — no impact at all, it simply grows into being.
      case 'bloom':
        return {
          opacity: enter.value,
          transform: [{ scale: interpolate(enter.value, [0, 1], [0.7, 1]) }],
        };
      // Ethereal rise — drifts UP into place rather than dropping into it.
      case 'rise':
        return {
          opacity: interpolate(enter.value, [0, 0.4, 1], [0, 1, 1]),
          transform: [
            { translateY: interpolate(enter.value, [0, 1], [40, 0]) },
            { scale: interpolate(enter.value, [0, 1], [0.85, 1]) },
          ],
        };
      // The apex COALESCES — forms out of the collapsing particles. Strictly monotonic scale with
      // no overshoot: a bouncy pop here reads as choppy (§9) and undoes the whole void sequence.
      case 'coalesce':
        return {
          opacity: interpolate(enter.value, [0, 0.55, 1], [0, 1, 1]),
          transform: [{ scale: interpolate(enter.value, [0, 1], [0.5, 1]) }],
        };
      // Pressure-forge — slams in oversized, compresses past its size, then settles.
      case 'forge':
      default:
        return {
          opacity: interpolate(enter.value, [0, 0.45, 1], [0, 1, 1]),
          transform: [{ scale: interpolate(enter.value, [0, 0.45, 0.7, 1], [1.6, 0.82, 1.08, 1]) }],
        };
    }
  });
}

// Staggered rise-and-fade embers — the card's ambient drift (design-mocks/84's `.emb`), and
// Bronze's signature. Same pattern as lock-in-flame.tsx's Ember, kept local since the layouts
// differ enough that sharing it would just be indirection.
function Ember({ left, bottom, delay, loop }: { left: number; bottom: number; delay: number; loop: boolean }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    const rise = withTiming(1, { duration: 2600, easing: Easing.out(Easing.quad) });
    progress.value = withDelay(delay, loop ? withRepeat(rise, -1, false) : rise);
  }, [delay, loop, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.15, 0.75, 1], [0, 0.9, 0.5, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, -130]) },
      { scale: interpolate(progress.value, [0, 1], [1, 0.3]) },
    ],
  }));

  return <Animated.View pointerEvents="none" style={[styles.ember, { left: `${left}%`, bottom: `${bottom}%` }, style]} />;
}

function useRiseStyle(reveal: SharedValue<number>) {
  return useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateY: interpolate(reveal.value, [0, 1], [8, 0]) }],
  }));
}

// One falling / twinkling mark — the shared primitive behind Gold's coin rain, Platinum's frost,
// Diamond's and Titan's and Immortal's prism glints, and Hero's rising embers. Only the glyph,
// color and motion differ.
function Glint({
  char = '✦',
  color,
  left,
  startTop,
  fall,
  delay,
  duration,
  spin = true,
}: {
  char?: string;
  color: string;
  left: number;
  startTop: number;
  fall: number;
  delay: number;
  duration: number;
  spin?: boolean;
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
      { rotate: spin ? `${interpolate(progress.value, [0, 1], [0, 170])}deg` : '0deg' },
    ],
  }));
  return (
    <Animated.Text style={[styles.glint, { left: `${left}%`, top: `${startTop}%`, color, textShadowColor: color }, style]}>
      {char}
    </Animated.Text>
  );
}

// Titan's falling debris (§9) — chunks knocked loose by the slam, raining past the badge. Not a
// glint: no glow, no spin-and-sparkle, just dull rubble tumbling down.
function Debris({ left, top, size, delay, duration }: { left: number; top: number; size: number; delay: number; duration: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration, easing: Easing.in(Easing.quad) }));
  }, [delay, duration, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 1, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, 320]) },
      { rotate: `${interpolate(progress.value, [0, 1], [0, 220])}deg` },
    ],
  }));
  return <Animated.View style={[styles.debris, { left: `${left}%`, top: `${top}%`, width: size, height: size }, style]} />;
}

// Silver's blade-slash (§9) — a single white streak that cuts across the badge and reveals it.
function BladeSlash({ color, delay }: { color: string; delay: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
  }, [delay, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.3, 1], [0, 1, 0]),
    transform: [{ rotate: '-22deg' }, { scaleX: interpolate(progress.value, [0, 0.3, 1], [0, 1, 1]) }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.slash, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="bladeSlash" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="0.5" stopColor="#ffffff" stopOpacity={1} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#bladeSlash)" />
      </Svg>
    </Animated.View>
  );
}

// A rising flame blob for Primordial's fire treatment (§2) — one-shot, gone once the moment
// settles (the reconciliation rule: no literal flames left burning at rest).
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

// Immortal's ghost-wisps (§2, design-mocks/80's `.ghost` + `haunt` keyframe) — soft spectral faces
// drifting up through the violet shimmer and fading. The mock reaches for this with
// `filter: blur(1.5px)`; RN has no CSS blur, so the softness comes from the SVG radial gradient
// itself (bright core → violet mid at 68% → transparent edge), which reads the same at this size.
//
// Deliberately restrained: ~0.42 peak opacity, hollow eyes rather than drawn features. Anything
// crisper stops being haunting and starts being cartoonish, which is the note in the spec.
const WISP_WIDTH = 16;
const WISP_HEIGHT = 20;

function GhostWisp({ left, top, drift, delay, duration }: { left: number; top: number; drift: number; delay: number; duration: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.quad) }));
  }, [delay, duration, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.25, 1], [0, 0.42, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [24, -48]) },
      { translateX: interpolate(progress.value, [0, 1], [0, drift]) },
      { scale: interpolate(progress.value, [0, 1], [0.8, 1.15]) },
    ],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.wisp, { left: `${left}%`, top: `${top}%` }, style]}>
      <Svg width={WISP_WIDTH} height={WISP_HEIGHT}>
        <Defs>
          <RadialGradient id="wispBody" cx="50%" cy="38%" rx="60%" ry="60%">
            <Stop offset="0" stopColor="#EAE2FA" stopOpacity={0.55} />
            <Stop offset="0.68" stopColor="#8E6BC8" stopOpacity={0.18} />
            <Stop offset="1" stopColor="#8E6BC8" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {/* Rounded at the crown, tapering below — the mock's 50%/50%/42%/42% silhouette. */}
        <Ellipse cx={WISP_WIDTH / 2} cy={WISP_HEIGHT / 2} rx={WISP_WIDTH / 2} ry={WISP_HEIGHT / 2} fill="url(#wispBody)" />
        <Ellipse cx={WISP_WIDTH / 2 - 3.5} cy={8.5} rx={1.25} ry={1.5} fill="rgba(58,43,92,0.75)" />
        <Ellipse cx={WISP_WIDTH / 2 + 3.5} cy={8.5} rx={1.25} ry={1.5} fill="rgba(58,43,92,0.75)" />
      </Svg>
    </Animated.View>
  );
}

// The hexagon "burning" during Primordial's arrival only (§11's reconciliation: literal flame
// licks are the TRANSITION, never the resting state) — a short ring of small licks around the
// badge that fades out once the moment settles.
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

// ───────────────────────────── the band-crossing pre-beats (§9) ────────────────────────────────
//
// The two rarest moments in the app get a cinematic beat BEFORE the badge they're announcing even
// exists. Hero: the Diamond badge shatters, the screen whites out, and a crimson pillar breaks
// through. Primordial: dark matter converges into a void collapse, then a cosmic tear rips the
// frame open — and SEALS shut again, which is the point (§9: never leaves a persistent beam on
// screen or on the card).
function HeroPreBeat() {
  const white = useSharedValue(0);
  const pillar = useSharedValue(0);

  useEffect(() => {
    // 400ms in — after the shatter has read — the frame blows out and the pillar drives through.
    white.value = withDelay(400, withTiming(1, { duration: 1000, easing: Easing.out(Easing.quad) }));
    pillar.value = withDelay(400, withTiming(1, { duration: 1000, easing: Easing.out(Easing.cubic) }));
  }, [white, pillar]);

  const whiteStyle = useAnimatedStyle(() => ({ opacity: interpolate(white.value, [0, 0.12, 1], [0, 1, 0]) }));
  const pillarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pillar.value, [0, 0.3, 1], [0, 0.9, 0]),
    transform: [{ scaleY: interpolate(pillar.value, [0, 1], [0.15, 1]) }],
  }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.pillar, pillarStyle]}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="heroPillar" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={FLASH_COLOR} />
              <Stop offset="1" stopColor={RANK_TIER_METAL.hero.inner} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height="100%" fill="url(#heroPillar)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.whiteout, whiteStyle]} />
    </View>
  );
}

// One converging dark-matter mote — starts out at a radius around the badge and falls INTO it.
function VoidMote({ angle, radius, delay, duration }: { angle: number; radius: number; delay: number; duration: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration, easing: Easing.in(Easing.quad) }));
  }, [delay, duration, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.3, 1], [0, 0.9, 0]),
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [Math.cos(angle) * radius, 0]) },
      { translateY: interpolate(progress.value, [0, 1], [Math.sin(angle) * radius, 0]) },
      { scale: interpolate(progress.value, [0, 1], [1.5, 0.15]) },
    ],
  }));
  return <Animated.View pointerEvents="none" style={[styles.voidMote, style]} />;
}

function PrimordialPreBeat({ badgeTop }: { badgeTop: number }) {
  const dark = useSharedValue(0);
  const tear = useSharedValue(0);
  const { width } = useWindowDimensions();

  useEffect(() => {
    dark.value = withDelay(400, withTiming(1, { duration: 1100, easing: Easing.in(Easing.quad) }));
    // The tear rips open and then seals shut inside its own 1s — width goes 0 → wide → a sliver →
    // 0, so there is nothing left of it by the time the emblem coalesces.
    tear.value = withDelay(1100, withTiming(1, { duration: 1000, easing: Easing.out(Easing.cubic) }));
  }, [dark, tear]);

  const darkStyle = useAnimatedStyle(() => ({ opacity: interpolate(dark.value, [0, 0.45, 1], [0, 1, 1]) }));
  const tearStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tear.value, [0, 0.22, 0.74, 1], [0, 1, 1, 0]),
    width: interpolate(tear.value, [0, 0.48, 0.74, 1], [0, width * 0.72, 22, 0]),
  }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, darkStyle]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="voidCollapse" cx="50%" cy="38%" r="72%">
              <Stop offset="0" stopColor="#0a0710" />
              <Stop offset="1" stopColor="#000000" />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height="100%" fill="url(#voidCollapse)" />
        </Svg>
      </Animated.View>

      <View style={[styles.voidField, { top: badgeTop }]} pointerEvents="none">
        {Array.from({ length: 11 }, (_, i) => (
          <VoidMote
            key={i}
            angle={hashUnit(i + 200) * Math.PI * 2}
            radius={55 + hashUnit(i + 210) * 45}
            delay={400 + hashUnit(i + 220) * 500}
            duration={1000 + hashUnit(i + 230) * 600}
          />
        ))}
      </View>

      <Animated.View style={[styles.tear, tearStyle]}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="cosmicTear" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#C77BFF" stopOpacity={0} />
              <Stop offset="0.3" stopColor="#C77BFF" stopOpacity={1} />
              <Stop offset="0.5" stopColor="#6BE6FF" stopOpacity={1} />
              <Stop offset="0.7" stopColor="#C77BFF" stopOpacity={1} />
              <Stop offset="1" stopColor="#C77BFF" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height="100%" fill="url(#cosmicTear)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

// The tier flash + the tier's SIGNATURE particles, all keyed to the flare beat. EVERY rank-up gets
// the same full-screen tier-colored wash — one solid-color absoluteFill overlay (not an edge
// vignette), so it covers the whole screen reliably on the first play for every tier with no
// dependence on late-measured dimensions. On top of that shared wash:
//   • Tier crossing → the moving metallic sweep + the tier's own signature (§9's table).
//   • Division bump → the wash alone; the incineration IS its motif.
function TierFlashOverlay({
  tier,
  isDivisionBump,
  isBandCrossing,
  reduceMotion,
  flareAt,
  badgeTop,
}: {
  tier: RankTierName;
  isDivisionBump: boolean;
  isBandCrossing: boolean;
  reduceMotion: boolean;
  flareAt: number;
  badgeTop: number;
}) {
  const { width, height } = useWindowDimensions();
  const kind = TIER_FLASH_KIND[tier];
  const metal = RANK_TIER_METAL[tier];
  const signature = TIER_SIGNATURE[tier].signature;
  const isFlame = signature === 'fire';
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
    // Engulf → brief hold → recede, long enough to read as a real screen flush rather than a blip.
    wash.value = withDelay(
      flareAt,
      withSequence(withTiming(washPeak, { duration: 450 }), withDelay(350, withTiming(0, { duration: 950 })))
    );
    if (!isDivisionBump && (signature === 'godray' || signature === 'wisp')) {
      halo.value = withDelay(flareAt, withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) }));
    }
    // Crossings layer the moving metallic sweep on top; a division bump is the wash alone.
    if (!isDivisionBump && kind) {
      sweep.value = withDelay(flareAt, withTiming(1, { duration: 820, easing: Easing.inOut(Easing.ease) }));
    }
  }, [reduceMotion, isDivisionBump, kind, signature, flareAt, washPeak, wash, sweep, halo]);

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
          late-measured dimensions. Sits behind the card chrome, so text stays legible on it. */}
      <Animated.View style={[StyleSheet.absoluteFill, washStyle]} />

      {/* A division bump is the wash alone. Crossings add the sweep + the tier's signature. */}
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

          {/* Silver — the blade-slash streak that reveals the badge. */}
          {signature === 'slash' && <BladeSlash color={metal.inner} delay={flareAt - 120} />}

          {/* Gold — coin rain under the crown descent. */}
          {signature === 'coins' &&
            Array.from({ length: 14 }, (_, i) => (
              <Glint
                key={`coin-${i}`}
                char="●"
                color={metal.inner}
                left={4 + hashUnit(i) * 92}
                startTop={-6}
                fall={height + 60}
                delay={flareAt + i * 55}
                duration={900 + hashUnit(i + 40) * 500}
                spin={false}
              />
            ))}

          {/* Platinum — frost crystallizing in place: twinkles, no fall. */}
          {signature === 'frost' &&
            Array.from({ length: 14 }, (_, i) => (
              <Glint
                key={`frost-${i}`}
                color={i % 3 === 0 ? '#ffffff' : metal.inner}
                left={5 + hashUnit(i + 5) * 90}
                startTop={14 + hashUnit(i + 55) * 56}
                fall={0}
                delay={flareAt + i * 50}
                duration={900 + hashUnit(i + 65) * 600}
                spin={false}
              />
            ))}

          {/* Diamond / Titan / Immortal share the prism primitive, tinted from their own metal —
              'prism' used to belong to Diamond alone, so this was a fixed cyan set; spraying
              Diamond's cyan on the other two made the crossing read as the wrong tier. White stays
              as the refraction highlight, the rest come from the tier itself. */}
          {(signature === 'prism' || signature === 'wisp') &&
            Array.from({ length: 10 }, (_, i) => {
              const cols = [metal.text, metal.inner, '#ffffff', metal.inner, metal.text];
              return (
                <Glint
                  key={`prism-${i}`}
                  char="◈"
                  color={cols[i % cols.length]}
                  left={4 + hashUnit(i + 5) * 92}
                  startTop={6 + hashUnit(i + 60) * 78}
                  fall={30 - hashUnit(i + 80) * 60}
                  delay={flareAt + i * 40}
                  duration={650 + hashUnit(i + 90) * 450}
                />
              );
            })}

          {/* Titan — rubble knocked loose by the slam (the screen-shake lives on the container). */}
          {signature === 'debris' &&
            Array.from({ length: 14 }, (_, i) => (
              <Debris
                key={`debris-${i}`}
                left={38 + hashUnit(i + 300) * 24}
                top={(badgeTop / height) * 100}
                size={3 + hashUnit(i + 310) * 4}
                delay={flareAt + hashUnit(i + 320) * 400}
                duration={600 + hashUnit(i + 330) * 600}
              />
            ))}

          {/* Primordial — the apex catches fire. */}
          {isFlame &&
            Array.from({ length: 14 }, (_, i) => (
              <FlameBlob key={`flame-${i}`} left={hashUnit(i + 10) * 96} height={40 + hashUnit(i + 20) * 60} delay={flareAt + i * 45} />
            ))}

          {/* Hero — "the threshold ignites" (§2). Embers thrown up across the whole screen as the
              crest lands, on top of the shockwave the container fires. */}
          {signature === 'shock' &&
            Array.from({ length: 12 }, (_, i) => (
              <Glint
                key={`hero-${i}`}
                color={i % 3 === 0 ? metal.text : metal.inner}
                left={4 + hashUnit(i + 15) * 92}
                startTop={70 + hashUnit(i + 25) * 26}
                fall={-(120 + hashUnit(i + 35) * 160)}
                delay={flareAt + i * 50}
                duration={900 + hashUnit(i + 45) * 500}
              />
            ))}

          {/* Olympian — 3 soft radial beams from the top, fading down (§2). */}
          {signature === 'godray' && (
            <>
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, haloStyle]}>
                <Svg width="100%" height="100%">
                  <Defs>
                    <LinearGradient id="godRay" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor={metal.inner} stopOpacity={0.85} />
                      <Stop offset="1" stopColor={metal.inner} stopOpacity={0} />
                    </LinearGradient>
                  </Defs>
                  {[0.22, 0.5, 0.78].map((cx, i) => (
                    <Rect key={cx} x={width * cx - (26 + i * 6) / 2} y={0} width={26 + i * 6} height={height * 0.72} fill="url(#godRay)" />
                  ))}
                </Svg>
              </Animated.View>
              {Array.from({ length: 10 }, (_, i) => (
                <Glint
                  key={`sparkle-${i}`}
                  color={metal.inner}
                  left={6 + hashUnit(i) * 88}
                  startTop={-8}
                  fall={height + 80}
                  delay={flareAt + i * 55}
                  duration={900 + hashUnit(i + 40) * 400}
                />
              ))}
            </>
          )}

          {/* Immortal — a gentle violet glow ascending behind the badge, plus the souls in the
              shimmer (§2, mock 80). Ethereal, NOT fiery: it rises and dissolves rather than
              licking upward like Primordial's flames. */}
          {signature === 'wisp' && (
            <>
              <Animated.View pointerEvents="none" style={[styles.ascendGlow, { backgroundColor: metal.inner }, ascendStyle]} />
              {Array.from({ length: 5 }, (_, i) => (
                <GhostWisp
                  key={`wisp-${i}`}
                  left={14 + hashUnit(i + 100) * 70}
                  top={44 + hashUnit(i + 110) * 30}
                  drift={hashUnit(i + 120) * 24 - 12}
                  delay={flareAt + hashUnit(i + 130) * 1000}
                  duration={2600 + hashUnit(i + 140) * 1000}
                />
              ))}
            </>
          )}

          {/* Bronze has no crossing of its own, but its `embers` signature is what a future entry
              tier would use — and it keeps the switch total rather than silently blank. */}
          {signature === 'embers' &&
            Array.from({ length: 10 }, (_, i) => (
              <Ember key={`bronze-${i}`} left={20 + hashUnit(i + 400) * 60} bottom={20 + hashUnit(i + 410) * 20} delay={flareAt + i * 90} loop={false} />
            ))}
        </>
      )}
    </View>
  );
}

// ─────────────────────────── the incineration's numeral (§9's bump) ────────────────────────────
//
// Rendered INSIDE the hexagon in place of its roman numeral: one stroke per division mark, so the
// top one can burn away on its own and the survivors can recenter. A single Text can't do either —
// "III" burning to "II" has to be three independent glyphs, and the collapse has to remove the
// burned stroke's WIDTH (not just hide it) for the row to recenter around what's left.
function BurningDivisionMark({
  strokes,
  color,
  fontSize,
  burnAt,
  collapseAt,
  reduceMotion,
}: {
  strokes: number;
  color: string;
  fontSize: number;
  burnAt: number;
  collapseAt: number;
  reduceMotion: boolean;
}) {
  const burn = useSharedValue(0);
  const collapse = useSharedValue(1);
  const strokeWidth = fontSize * 0.52;

  useEffect(() => {
    if (reduceMotion) {
      // Straight to the settled state — the burned stroke is simply not there.
      burn.value = 1;
      collapse.value = 0;
      return;
    }
    burn.value = withDelay(burnAt, withTiming(1, { duration: 800, easing: Easing.in(Easing.quad) }));
    collapse.value = withDelay(collapseAt, withTiming(0, { duration: 450, easing: Easing.out(Easing.cubic) }));
  }, [burnAt, collapseAt, reduceMotion, burn, collapse]);

  // Hellfire eats the stroke: white → ember gold → coral as it lifts off and shrinks away.
  const burnStyle = useAnimatedStyle(() => ({
    opacity: interpolate(burn.value, [0, 0.45, 1], [1, 1, 0]),
    color: interpolateColor(burn.value, [0, 0.2, 0.45], ['#ffffff', '#FFD27A', Colors.coral]),
    transform: [
      { translateY: interpolate(burn.value, [0, 0.45, 1], [0, -3, -20]) },
      { scale: interpolate(burn.value, [0, 0.45, 1], [1, 1.15, 0.3]) },
    ],
  }));
  const collapseStyle = useAnimatedStyle(() => ({ width: strokeWidth * collapse.value }));

  return (
    <View style={styles.divisionMark}>
      {Array.from({ length: strokes }, (_, i) =>
        i === strokes - 1 ? (
          // The top stroke — the one hellfire takes. Its wrapper's width collapsing is what makes
          // the remaining marks recenter, since the row is center-aligned.
          <Animated.View key={i} style={[styles.strokeSlot, collapseStyle]}>
            <Animated.Text style={[styles.stroke, { fontSize, width: strokeWidth }, burnStyle]}>I</Animated.Text>
          </Animated.View>
        ) : (
          <Text key={i} style={[styles.stroke, { fontSize, width: strokeWidth, color }]}>
            I
          </Text>
        )
      )}
    </View>
  );
}

// The stage the moment lives in, and the story card's own background once it settles
// (design-mocks/85's `.stage`: radial-gradient(130% 58% at 50% 30%, #2a1f3a, #1a1326 60%, #120d1a)).
function StageBackdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="stageBg" cx="50%" cy="30%" rx="130%" ry="58%">
            <Stop offset="0" stopColor="#2a1f3a" />
            <Stop offset="0.6" stopColor="#1a1326" />
            <Stop offset="1" stopColor="#120d1a" />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#stageBg)" />
      </Svg>
    </View>
  );
}

// The soft tier-colored aura the badge sits in once the card composes (mock 84's `.aura`).
function BadgeAura({ color, reveal }: { color: string; reveal: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: reveal.value * 0.5 }));
  return (
    <Animated.View pointerEvents="none" style={[styles.aura, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id="badgeAura" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={0.9} />
            <Stop offset="0.55" stopColor={color} stopOpacity={0.35} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="50" cy="50" r="50" fill="url(#badgeAura)" />
      </Svg>
    </Animated.View>
  );
}

const BADGE_SIZE = 112;
// Where the badge settles, as a share of the screen — mock 85 puts it at 38% of the stage, with
// the card chrome composed around it.
const BADGE_TOP_RATIO = 0.34;

// Rank-up moment — the full arc from design-mocks/85: the tier's signature move → the hit landing
// on the flare and ringing out → the frame settling into the 9:16 story card. Sound + haptic fire
// here, timed to the flare (or, for a band crossing, started back in the pre-beat so the anthem
// builds across the whole sequence), never at mount.
export function RankUpCelebration({
  tier,
  division,
  fromTier,
  fromDivision,
  streakDays,
  handle,
  isBandCrossing = false,
  onContinue,
  onShare,
  sharing,
}: RankUpCelebrationProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const { height } = useWindowDimensions();

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // Same tier in and out (e.g. Gold II→I) = a within-tier bump: the incineration, not a crossing.
  // (The dev-preview's Bronze "from = itself" also reads as a bump, which is right — there's no
  // lower rank to cross from.)
  const isDivisionBump = fromTier === tier;
  const isPrimordial = tier === 'primordial';
  const metal = RANK_TIER_METAL[tier];
  const { entrance, signature } = TIER_SIGNATURE[tier];
  const copy = isDivisionBump ? divisionUpCopy(tier) : RANK_UP_COPY[tier];
  // Where the badge actually sits on screen, for the effects that have to be centered ON it (the
  // void collapse, Titan's debris). Seeded from the mock's 34% so the pre-beat has a usable value
  // on the very first frame, then corrected by the badge zone's own layout.
  const [badgeTop, setBadgeTop] = useState(height * BADGE_TOP_RATIO);

  // ── the timeline ──
  // A band crossing's pre-beat owns the frame first; every main-phase beat hangs off its crest.
  // A division bump runs its own (shorter, quieter) incineration timeline instead.
  const crestAt = isBandCrossing ? (isPrimordial ? PRIMORDIAL_CREST_MS : HERO_CREST_MS) : 0;
  const entranceMs = isBandCrossing ? BAND_ENTRANCE_MS : ENTRANCE_MS;
  const flareAt = reduceMotion
    ? 0
    : isDivisionBump
      ? BUMP_HIT_MS
      : isBandCrossing
        ? crestAt // the crest slam IS the flare — the anthem has been building into it
        : ENTRANCE_MS;
  const cardAt = reduceMotion
    ? REDUCED_CARD_MS
    : isDivisionBump
      ? BUMP_CARD_MS
      : crestAt + (isBandCrossing ? BAND_CARD_AFTER_CREST_MS : ENTRANCE_MS + CARD_AFTER_FLARE_MS);

  // During a band crossing's pre-beat the badge still shows the tier you're LEAVING — the Diamond
  // that shatters, the Immortal that the void takes — and only becomes the new one at the crest.
  const [crested, setCrested] = useState(!isBandCrossing);
  const [composed, setComposed] = useState(false);
  // Reduce-motion has no pre-beat to hand off from (§7), so the badge is the new tier from frame
  // one rather than waiting on a crest that never arrives.
  const showsNewTier = crested || reduceMotion;
  const badgeTier = showsNewTier ? tier : fromTier;
  const badgeDivision = showsNewTier ? division : fromDivision;

  // Titan is "colossal" (§2/§9) — a short ±3px jolt at the slam. Reduce-motion skips it entirely.
  const shake = useSharedValue(0);
  const enter = useSharedValue(0);
  const flash = useSharedValue(0);
  const shock = useSharedValue(0);
  // Primordial's coalesce reads as "forming out of the particles" via a soft halo that shrinks and
  // resolves into the emblem — RN has no blur filter, so this stands in for the mock's blur(9px).
  const coalesce = useSharedValue(0);
  // The white ray that fuses the badge in on a division bump (§9's loot-box-style fuse-in).
  const fuse = useSharedValue(0);
  // Card chrome, staggered exactly like mock 85's composeCard().
  const brandReveal = useSharedValue(0);
  const tagReveal = useSharedValue(0);
  const tierReveal = useSharedValue(0);
  const copyReveal = useSharedValue(0);
  const footReveal = useSharedValue(0);
  const ctasReveal = useSharedValue(0);
  const auraReveal = useSharedValue(0);

  // Fires the tier cue exactly once per mount, guarding against effect re-runs (the reduceMotion
  // state resolving, a dev-tool re-render, StrictMode's double-invoke) replaying the sound.
  const hasFiredCueRef = useRef(false);
  function fireTierCueOnce() {
    if (hasFiredCueRef.current) return;
    hasFiredCueRef.current = true;
    fireRankUp(tier, isDivisionBump, isBandCrossing);
  }

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => {
      if (ms <= 0) fn();
      else timers.push(setTimeout(fn, ms));
    };

    // The anthem is the build (§9) — it starts at the very top of the pre-beat and climaxes on the
    // crest, which is why nothing in this moment has a riser under it any more. Started here
    // rather than at the flare precisely because it has to have been running for over a second by
    // the time the crest lands. Offsets from mock 85, so each track's own opening transient (the
    // diamond shatter; the void) lands on the visual it belongs to. If the mix is ever missing,
    // fireRankUp notices and lets the tier's own hit carry the crest instead.
    //
    // Started under reduce-motion too, just without the offset: §7 cuts MOTION, not the moment —
    // and since fireRankUp deliberately holds its tier hit back when an anthem is carrying the
    // crest, skipping it here would leave the rarest event in the app completely silent.
    if (isBandCrossing) {
      at(reduceMotion ? 0 : isPrimordial ? 250 : 650, () => startAscensionAnthem(tier));
    }

    if (reduceMotion) {
      // Cross-fade straight to the settled card — no signature move, no flare beat, no shake (§7).
      // The moment still gets its cue, immediately instead of on the flare.
      enter.value = withTiming(1, { duration: 300 });
      fireTierCueOnce();
      at(REDUCED_CARD_MS, () => setComposed(true));
      composeCardChrome();
      return cleanup;
    }

    if (isDivisionBump) {
      runIncineration();
    } else {
      runCrossing();
    }

    return cleanup;

    function cleanup() {
      timers.forEach(clearTimeout);
      // Everything this moment started — the hit still ringing out, the souls, the anthem — dies
      // with the screen. Without this the Champions Anthem follows you back to the home tab.
      stopRankUpAudio();
    }

    // ── the two timelines ──

    function runCrossing() {
      // The badge's signature entrance, at the crest for a band crossing and at t=0 otherwise.
      // Only a band crossing has an old tier to swap away from — everything else starts crested.
      if (isBandCrossing) timers.push(setTimeout(() => setCrested(true), crestAt));
      enter.value = withDelay(crestAt, withTiming(1, { duration: entranceMs, easing: ENTRANCE_EASING }));
      if (entrance === 'coalesce') {
        coalesce.value = withDelay(crestAt, withTiming(1, { duration: entranceMs, easing: Easing.out(Easing.cubic) }));
      }

      // The flare: the warm flash, the shockwave, and the tier HIT — which then rings out under
      // everything that follows (§9). Deliberately NOT stopped when the card composes.
      flash.value = withDelay(flareAt, withTiming(1, { duration: 800, easing: Easing.linear }));
      // The shockwave belongs to Hero's crest slam alone (§9) — the apex's payoff is the aura and
      // the fire, not another ring.
      if (signature === 'shock') {
        shock.value = withDelay(flareAt, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
      }
      if (signature === 'debris') {
        // Titan's earthquake — six quick alternating offsets over ~400ms.
        shake.value = withDelay(
          flareAt,
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
      // Hero's shatter is a jolt of its own, before its badge even exists.
      if (isBandCrossing && !isPrimordial) {
        shake.value = withSequence(
          withTiming(1, { duration: 55 }),
          withTiming(-1, { duration: 55 }),
          withTiming(0.6, { duration: 55 }),
          withTiming(0, { duration: 90 })
        );
      }

      at(flareAt, fireTierCueOnce);
      at(cardAt, () => setComposed(true));
      composeCardChrome();
    }

    // The incineration (§9): fuse-in → forge → hellfire takes the top stroke → the marks recenter
    // → the tier's own hit lands as the new division locks → a lighter DIVISION UP card.
    function runIncineration() {
      fuse.value = withTiming(1, { duration: 1000, easing: Easing.out(Easing.cubic) });
      fireIncinerationFuse();
      enter.value = withDelay(BUMP_BADGE_MS, withTiming(1, { duration: 900, easing: ENTRANCE_EASING }));
      at(BUMP_BURN_MS, fireIncinerationBurn);
      at(BUMP_HIT_MS, fireTierCueOnce);
      at(BUMP_CARD_MS, () => setComposed(true));
      composeCardChrome();
    }

    function composeCardChrome() {
      const reveal = (value: SharedValue<number>, offset: number) => {
        value.value = withDelay(cardAt + offset, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
      };
      auraReveal.value = withDelay(cardAt, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
      reveal(brandReveal, 0);
      reveal(tagReveal, 50);
      reveal(tierReveal, 100);
      reveal(copyReveal, 150);
      reveal(footReveal, 200);
      reveal(ctasReveal, 350);
    }
    // fireTierCueOnce and the two timeline closures are deliberately omitted: they're redefined
    // every render, so listing them would tear the whole timeline down and rebuild it on each one.
    // Safe ONLY because every prop they read — tier, isDivisionBump, isBandCrossing — is listed
    // below, so the closures the timers capture can never be stale. isBandCrossing in particular:
    // without it, showing Hero as an ordinary crossing and then as an ascension (same tier, same
    // bump flag) would leave the timers holding the first render's value and skip the anthem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reduceMotion,
    tier,
    isDivisionBump,
    isBandCrossing,
    isPrimordial,
    entrance,
    signature,
    crestAt,
    entranceMs,
    flareAt,
    cardAt,
    enter,
    coalesce,
    flash,
    shock,
    shake,
    fuse,
    brandReveal,
    tagReveal,
    tierReveal,
    copyReveal,
    footReveal,
    ctasReveal,
    auraReveal,
  ]);

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value * 3 }] }));
  const entranceStyle = useEntranceStyle(entrance, enter, reduceMotion);
  const flashStyle = useAnimatedStyle(() => ({ opacity: interpolate(flash.value, [0, 0.25, 1], [0, 0.95, 0]) }));
  // Invisible at rest — the ring sits at 0 for the whole entrance, so a [0,1]→[0.7,0] map would
  // leave a static ring hanging at the badge the entire time (the old "orange circle" bug). The
  // near-zero keyframe keeps it at 0 until the expand actually begins.
  const shockStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shock.value, [0, 0.001, 1], [0, 0.7, 0]),
    transform: [{ scale: interpolate(shock.value, [0, 1], [1, 9]) }],
    borderColor: metal.inner,
  }));
  const coalesceStyle = useAnimatedStyle(() => ({
    opacity: interpolate(coalesce.value, [0, 0.15, 0.6, 1], [0, 0.85, 0.4, 0]),
    transform: [{ scale: interpolate(coalesce.value, [0, 1], [2.2, 1]) }],
  }));
  const fuseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(fuse.value, [0, 0.35, 0.9, 1], [0, 1, 0.4, 0]),
    transform: [{ scaleY: interpolate(fuse.value, [0, 0.35, 1], [0, 1, 0.86]) }, { scaleX: interpolate(fuse.value, [0, 0.35, 0.7], [1, 1, 0.25]) }],
  }));

  const brandStyle = useRiseStyle(brandReveal);
  const tagStyle = useRiseStyle(tagReveal);
  const tierStyle = useRiseStyle(tierReveal);
  const copyStyle = useRiseStyle(copyReveal);
  const footStyle = useRiseStyle(footReveal);
  const ctasStyle = useRiseStyle(ctasReveal);

  function handleContinue() {
    stopRankUpAudio();
    onContinue();
  }

  return (
    <Animated.View entering={FadeIn.duration(300)} style={[styles.container, shakeStyle]}>
      <StageBackdrop />

      {/* The two cinematic pre-beats — only ever mounted for the two band crossings, and only when
          motion is allowed (§7: reduce-motion cross-fades straight to the composed card). */}
      {isBandCrossing && !reduceMotion && !isPrimordial && <HeroPreBeat />}
      {isBandCrossing && !reduceMotion && isPrimordial && <PrimordialPreBeat badgeTop={badgeTop} />}

      <TierFlashOverlay
        tier={tier}
        isDivisionBump={isDivisionBump}
        isBandCrossing={isBandCrossing}
        reduceMotion={reduceMotion}
        flareAt={flareAt}
        badgeTop={badgeTop}
      />

      {/* Card chrome — in the layout from the first frame at opacity 0, so composing the card fades
          it in WITHOUT shifting the badge that the signature move just landed. */}
      <Animated.View style={[styles.brand, brandStyle]}>
        <FlameSvg width={16 * FLAME_ASPECT_RATIO} height={16} />
        <Text style={styles.brandLabel}>Philoi</Text>
      </Animated.View>
      <Animated.Text style={[styles.tag, { color: metal.inner }, tagStyle]}>
        {rankUpCardTag(tier, isDivisionBump)}
      </Animated.Text>

      <View
        style={styles.badgeZone}
        pointerEvents="none"
        onLayout={(e) => {
          // Correct the seeded estimate with where the badge actually landed, so the void collapse
          // converges on the emblem and Titan's debris falls from the badge rather than from a
          // guessed offset.
          const { y, height: zoneHeight } = e.nativeEvent.layout;
          setBadgeTop(y + zoneHeight / 2);
        }}>
        <BadgeAura color={metal.inner} reveal={auraReveal} />
        {isDivisionBump && !reduceMotion && <Animated.View style={[styles.fuseRay, fuseStyle]} />}
        <Animated.View pointerEvents="none" style={[styles.flash, flashStyle]} />
        <Animated.View pointerEvents="none" style={[styles.shockRing, shockStyle]} />
        {entrance === 'coalesce' && <Animated.View pointerEvents="none" style={[styles.coalesceHalo, { backgroundColor: metal.inner }, coalesceStyle]} />}
        <Animated.View style={entranceStyle}>
          <HexagonBadge
            tier={badgeTier}
            division={badgeDivision}
            size={BADGE_SIZE}
            // The incineration replaces the numeral with independently-animatable strokes so the
            // top one can burn off and the rest recenter (§9).
            numeralOverride={
              isDivisionBump ? (
                <BurningDivisionMark
                  // Derived from the division REACHED, not from fromDivision: the mark that burns
                  // is always the one the new division doesn't have, so a multi-step jump (III→I,
                  // possible on a big XP drop-in) still lands on the correct final numeral.
                  strokes={Math.min(3, division + 1)}
                  color={metal.numeral}
                  fontSize={BADGE_SIZE * 0.32}
                  burnAt={BUMP_BURN_MS}
                  collapseAt={BUMP_COLLAPSE_MS}
                  reduceMotion={reduceMotion}
                />
              ) : undefined
            }
          />
          {/* "The hexagon burns" — Primordial's arrival only (§11's reconciliation); fades out on
              its own and never re-fires, leaving just the badge's normal resting aura. */}
          {isPrimordial && !reduceMotion && (
            <View style={styles.hexLickRing} pointerEvents="none">
              {[-60, -20, 20, 60, 140, 200].map((rotation, i) => (
                <HexLick key={rotation} rotation={rotation} delay={flareAt + i * 30} />
              ))}
            </View>
          )}
        </Animated.View>
      </View>

      <Animated.Text style={[styles.tierName, { color: metal.inner }, tierStyle]}>
        {formatRankTier(tier, division)}
      </Animated.Text>

      {/* The all-caps two-liner is the TIER-CROSSING payoff (§5). A bump gets the light
          division-up line instead — spending "THE CROWN IS YOURS." on Gold III→II would flatten
          the crossing it belongs to. */}
      <Animated.View style={[styles.copyBlock, copyStyle]}>
        <Text style={[styles.copyHead, { color: metal.inner }, isDivisionBump && styles.copyHeadBump]}>{copy.head}</Text>
        <Text style={styles.copySub}>{copy.sub}</Text>
      </Animated.View>

      <View style={styles.spacer} />

      {/* Ambient embers, only once the card has composed (mock 84's drifting `.emb`). */}
      {composed &&
        !reduceMotion &&
        Array.from({ length: 5 }, (_, i) => (
          <Ember key={`card-ember-${i}`} left={18 + hashUnit(i + 500) * 64} bottom={12 + hashUnit(i + 510) * 20} delay={i * 620} loop />
        ))}

      <Animated.View style={[styles.foot, footStyle]}>
        <View style={styles.who}>
          <Text style={styles.whoHandle}>{handle ? `@${handle}` : 'You'}</Text>
          <Text style={styles.whoDot}>·</Text>
          <View style={[styles.whoHex, { backgroundColor: metal.inner }]} />
          <Text style={[styles.whoRank, { color: metal.inner }]}>{formatRankTier(tier, division)}</Text>
        </View>
        <Text style={styles.streakLine}>forged from a {streakDays}-day streak</Text>
      </Animated.View>

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
        <Pressable onPress={handleContinue} disabled={sharing}>
          <Text style={styles.continueLabel}>Continue</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.five,
    backgroundColor: Colors.forgeBg,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandLabel: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 15,
    color: Colors.ink,
  },
  tag: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 4,
    marginTop: Spacing.two,
  },
  badgeZone: {
    height: BADGE_SIZE * 1.5,
    marginTop: Spacing.six,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aura: {
    position: 'absolute',
    width: 240,
    height: 240,
  },
  flash: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: FLASH_COLOR,
  },
  shockRing: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
  },
  // Stands in for the mock's `filter: blur(9px)` on the apex's coalesce — a soft over-scaled halo
  // that contracts into the emblem, since RN has no CSS blur.
  coalesceHalo: {
    position: 'absolute',
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
  },
  // The division bump's white fuse-in ray (§9) — a vertical beam the badge forges out of.
  fuseRay: {
    position: 'absolute',
    width: 14,
    height: 190,
    backgroundColor: '#ffffff',
    borderRadius: 7,
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
  divisionMark: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  strokeSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stroke: {
    fontFamily: Fonts.displayHeavy,
    textAlign: 'center',
  },
  tierName: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 26,
    marginTop: Spacing.three,
  },
  copyBlock: {
    alignItems: 'center',
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  copyHead: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  // A bump's line is deliberately smaller — it is not one of the ten earned tier lines.
  copyHeadBump: {
    fontSize: 16,
    lineHeight: 20,
  },
  copySub: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    lineHeight: 16,
    letterSpacing: 0.6,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.one,
  },
  spacer: {
    flex: 1,
  },
  wisp: {
    position: 'absolute',
    width: WISP_WIDTH,
    height: WISP_HEIGHT,
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
  whiteout: {
    backgroundColor: FLASH_COLOR,
  },
  pillar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignSelf: 'center',
    width: 30,
  },
  voidField: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voidMote: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C79BEC',
  },
  tear: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignSelf: 'center',
  },
  foot: {
    alignItems: 'center',
    gap: 6,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingVertical: 6,
    paddingHorizontal: 13,
    borderRadius: Radius.pill,
  },
  whoHandle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  whoDot: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  whoHex: {
    width: 11,
    height: 12,
    borderRadius: 2,
  },
  whoRank: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
  },
  streakLine: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
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
  debris: {
    position: 'absolute',
    backgroundColor: '#6b5a3f',
    borderRadius: 1,
  },
  slash: {
    position: 'absolute',
    top: '34%',
    left: '-25%',
    width: '150%',
    height: 5,
  },
  flameBlob: {
    position: 'absolute',
    bottom: -14,
    borderRadius: 999,
    backgroundColor: Colors.amber,
  },
  ember: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.ember,
  },
  ctas: {
    width: '100%',
    gap: Spacing.two,
    marginTop: Spacing.three,
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
