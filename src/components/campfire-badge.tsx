import { useEffect, useId } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useReduceMotion } from '@/hooks/use-reduce-motion';

// THE CAMPFIRE BADGE (mock 168) — one component for every place a campfire is drawn.
//
// What it reconciles. A campfire had two halves of an identity and no surface carried both. The
// creator's EMOJI is the identity — it is what the owner picked and what members recognise in a
// list — and the HEAT is the activity. Discover rows, the invite sheet and search drew the emoji
// as a loose 24px glyph on a card with nothing around it; the valley nodes drew a bare <HeatFlame>
// with no emoji at all, so your own campfires were indistinguishable from each other except by the
// label underneath. Same object, two incompatible renders.
//
// This is both, in one warm frame: emoji centred, heat carried by a PULSING AURA behind it. Mock
// 168's first draft put the coal bed under the emoji and its own build note retires that — at
// badge size the bed and the emoji fight for the same 78px and the result reads as a flame with
// something stuck on it. The aura says the same thing (roaring = big and bright, steady = small
// and slow, cold = nothing) without competing for the centre.
//
// This is NOT a replacement for <HeatFlame>. The gauge still owns the surfaces that are ABOUT the
// fire — the campfire header's hero, mock 93's heat states. The badge owns the surfaces that are
// about WHICH campfire.

export type CampfireBadgeState = 'roar' | 'steady' | 'cold';

/** Same thresholds as heatToState()/heatToFlameState(), in this component's own vocabulary. */
export function heatToBadgeState(heat: number): CampfireBadgeState {
  if (heat >= 0.6) return 'roar';
  if (heat >= 0.15) return 'steady';
  return 'cold';
}

// Mock 168's three frames, verbatim: a radial from a lit centre to a dark rim, plus a rim stroke.
const FRAME: Record<CampfireBadgeState, { inner: string; outer: string; border: string }> = {
  roar: { inner: '#F2A33C', outer: '#5A2C12', border: '#7A4A24' },
  steady: { inner: '#7A3F18', outer: '#2A160C', border: '#5A3418' },
  cold: { inner: '#2A2438', outer: '#151220', border: '#2A2340' },
};

// `.aura`'s two live states. `spread` is the mock's negative inset as a fraction of the badge, so
// a roaring aura reaches nearly half a badge past the frame and a steady one barely clears it.
const AURA: Record<CampfireBadgeState, { spread: number; core: string; coreOpacity: number; mid: string; midOpacity: number; midStop: number; ms: number } | null> = {
  roar: { spread: 0.48, core: '#FFB258', coreOpacity: 0.72, mid: '#F2A33C', midOpacity: 0.24, midStop: 0.46, ms: 1500 },
  steady: { spread: 0.22, core: '#F2A33C', coreOpacity: 0.5, mid: '#F2A33C', midOpacity: 0, midStop: 0.62, ms: 2700 },
  cold: null,
};

/**
 * The honest stand-in for heat on a campfire you have not joined. lock_in_sessions' RLS scopes
 * activity to circle-mates, so discover / invite / search rows have no real temperature to show —
 * member count is the only signal available, bucketed to the same three states the valley uses so
 * a fire does not change size the moment you join it.
 */
export function heatFromMemberCount(count: number): number {
  if (count >= 15) return 1;
  if (count >= 4) return 0.35;
  return 0;
}

type CampfireBadgeProps = {
  /** The creator's emoji — the identity half. */
  emoji: string;
  /** 0-1, from get_my_campfire_heat() or a member-count proxy for fires you haven't joined. */
  heat: number;
  /** Frame edge length. The emoji, corner radius and aura all scale off this. */
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function CampfireBadge({ emoji, heat, size = 44, style }: CampfireBadgeProps) {
  const state = heatToBadgeState(heat);
  const frame = FRAME[state];
  const aura = AURA[state];
  const radius = size * 0.23; // 18 / 78, mock 168's badge
  // react-native-svg resolves gradient ids in ONE global registry, so two badges in a list would
  // otherwise both answer to `#frame` and every row after the first would wear the first row's
  // heat. Same guard campfire-banner-art.tsx uses.
  const gradId = `campfireFrame-${useId()}`;

  return (
    // overflow visible on purpose — a roaring aura is meant to spill past the frame, and clipping
    // it to the badge is what would turn a glow into a lit square.
    <View style={[{ width: size, height: size }, styles.badge, style]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={gradId} cx="50%" cy="40%" rx="65%" ry="50%">
            <Stop offset="0" stopColor={frame.inner} />
            <Stop offset="0.72" stopColor={frame.outer} />
          </RadialGradient>
        </Defs>
        <Rect
          x={0.5}
          y={0.5}
          width={size - 1}
          height={size - 1}
          rx={radius}
          fill={`url(#${gradId})`}
          stroke={frame.border}
          strokeWidth={1}
        />
      </Svg>

      {aura && <Aura size={size} spec={aura} />}

      {/* A cold fire keeps its identity but loses its light — the badge still says WHICH campfire
          while reading unmistakably as unlit. RN has no grayscale filter, so opacity carries it. */}
      <Text style={[styles.emoji, { fontSize: size * 0.42 }, state === 'cold' && styles.emojiCold]}>{emoji}</Text>
    </View>
  );
}

function Aura({ size, spec }: { size: number; spec: NonNullable<(typeof AURA)['roar']> }) {
  const reduceMotion = useReduceMotion();
  const gradId = `campfireAura-${useId()}`;
  const t = useSharedValue(0);
  const box = size * (1 + spec.spread * 2);

  useEffect(() => {
    if (reduceMotion) {
      // Still lit, just not breathing — the state has to stay legible without animation.
      t.value = 0.5;
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: spec.ms / 2, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [reduceMotion, spec.ms, t]);

  // `aurapulse`: opacity .4 -> .92, scale .9 -> 1.1.
  const animated = useAnimatedStyle(() => ({
    opacity: 0.4 + t.value * 0.52,
    transform: [{ scale: 0.9 + t.value * 0.2 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.aura, { width: box, height: box, marginLeft: -box / 2, marginTop: -box / 2 }, animated]}>
      {/* A soft radial rather than a blurred disc: RN has no blur primitive, and the mock's
          `filter: blur(2px)` was only ever there to soften a hard-edged CSS gradient. */}
      <Svg width={box} height={box}>
        <Defs>
          <RadialGradient id={gradId} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={spec.core} stopOpacity={spec.coreOpacity} />
            <Stop offset={String(spec.midStop)} stopColor={spec.mid} stopOpacity={spec.midOpacity} />
            <Stop offset="0.72" stopColor={spec.mid} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={box} height={box} fill={`url(#${gradId})`} />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  aura: {
    position: 'absolute',
    left: '50%',
    top: '50%',
  },
  emoji: {
    // No lineHeight multiplier: an emoji in a fixed-height box gets clipped on Android when the
    // font's own ascent exceeds the line box, which is why the loose 24px renders sat high.
    textAlign: 'center',
  },
  emojiCold: {
    opacity: 0.45,
  },
});
