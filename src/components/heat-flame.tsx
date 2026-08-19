import { useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Ellipse, LinearGradient, Stop } from 'react-native-svg';

import { useReduceMotion } from '@/hooks/use-reduce-motion';

// The ACTIVITY GAUGE (mock 93). One `heat` in [0,1] drives three states, and the same mapping
// serves the personal flame and a campfire's.
//
// This is deliberately NOT FlameLogo. The brand mark is one clean silhouette; a gauge has to read
// as a different *thing* at each state, not the same glyph at three opacities — so every state here
// is its own composition over a PERSISTENT COAL BED. The bed is what makes it a fire rather than an
// icon: it stays put while what burns on top changes.
//
//   >= 0.6  roaring    — a staggered cluster of tongues off a bright bed, plus rising sparks
//   0.15-0.6 simmering — a few low, slow licks off a glowing ember bed
//   < 0.15  cold       — dead grey coals, no glow, drifting smoke puffs (the "relight" nudge)

export type HeatState = 'roaring' | 'simmering' | 'cold';

export function heatToState(heat: number): HeatState {
  if (heat >= 0.6) return 'roaring';
  if (heat >= 0.15) return 'simmering';
  return 'cold';
}

/** Mock 93's stops. Bed and tongues are keyed off the same state so they can never disagree. */
const PALETTE = {
  roaring: { bedTop: '#E0612C', bedBot: '#3a1c10', tip: '#FFD27A', mid: '#F2A33C', base: '#E0612C', glow: 0.5 },
  simmering: { bedTop: '#B33A15', bedBot: '#3a1c10', tip: '#F2A33C', mid: '#B33A15', base: '#6e2610', glow: 0.22 },
  cold: { bedTop: '#453f55', bedBot: '#211d2b', tip: '#3a3450', mid: '#3a3450', base: '#3a3450', glow: 0 },
} as const;

/** One licking tongue. Its own timing per index — a real fire never flickers in unison. */
function Tongue({
  colour, left, w, h, delay, duration, reduceMotion,
}: { colour: string; left: number; w: number; h: number; delay: number; duration: number; reduceMotion: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [t, delay, duration, reduceMotion]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: 0.62 + t.value * 0.55 }],
    opacity: 0.72 + t.value * 0.28,
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute', bottom: h * 0.16, left, width: w, height: h,
          backgroundColor: colour,
          // Rounded top, tapered base — a tongue, not a bar.
          borderTopLeftRadius: w, borderTopRightRadius: w,
          borderBottomLeftRadius: w * 0.35, borderBottomRightRadius: w * 0.35,
          transformOrigin: 'bottom',
        },
        style,
      ]}
    />
  );
}

/** A rising spark (roaring) or smoke puff (cold) — same motion, opposite meaning. */
function Rising({
  colour, left, size, delay, duration, travel, reduceMotion,
}: { colour: string; left: number; size: number; delay: number; duration: number; travel: number; reduceMotion: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.out(Easing.quad) }), -1, false));
  }, [t, delay, duration, reduceMotion]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -t.value * travel }, { scale: 1 - t.value * 0.55 }],
    opacity: Math.sin(t.value * Math.PI) * 0.9,
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', bottom: 0, left, width: size, height: size, borderRadius: size, backgroundColor: colour }, style]}
    />
  );
}

export function HeatFlame({ heat, size = 132 }: { heat: number; size?: number }) {
  const state = heatToState(heat);
  const p = PALETTE[state];
  const reduceMotion = useReduceMotion();
  const uid = useId();
  const bedId = `heatBed-${uid}`;

  const bedH = size * 0.16;
  const bedW = size * 0.72;

  // Each state is a different COMPOSITION, not a faded copy: how many tongues, how tall, how fast.
  const tongues =
    state === 'cold'
      ? []
      : state === 'roaring'
        ? [
            { w: size * 0.15, h: size * 0.52, x: 0.30, d: 0, ms: 620 },
            { w: size * 0.19, h: size * 0.70, x: 0.42, d: 180, ms: 520 },
            { w: size * 0.14, h: size * 0.46, x: 0.57, d: 340, ms: 700 },
            { w: size * 0.10, h: size * 0.33, x: 0.24, d: 90, ms: 780 },
          ]
        : [
            { w: size * 0.13, h: size * 0.26, x: 0.36, d: 0, ms: 1500 },
            { w: size * 0.10, h: size * 0.20, x: 0.52, d: 600, ms: 1800 },
          ];

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      {/* Glow behind everything. Cold has none at all — that absence IS the signal. */}
      {p.glow > 0 ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: p.base, opacity: p.glow * 0.25, borderRadius: size, transform: [{ scaleY: 0.7 }] },
          ]}
        />
      ) : null}

      {tongues.map((t, i) => (
        <Tongue
          key={i}
          colour={i % 2 === 0 ? p.mid : p.tip}
          left={size * t.x}
          w={t.w}
          h={t.h}
          delay={t.d}
          duration={t.ms}
          reduceMotion={reduceMotion}
        />
      ))}

      {/* Roaring throws sparks; cold pushes smoke. Simmering does neither — it just glows. */}
      {state === 'roaring'
        ? [0, 1, 2].map((i) => (
            <Rising key={i} colour="#FFE6B0" left={size * (0.34 + i * 0.13)} size={size * 0.028}
              delay={i * 520} duration={1500} travel={size * 0.62} reduceMotion={reduceMotion} />
          ))
        : null}
      {state === 'cold'
        ? [0, 1, 2].map((i) => (
            <Rising key={i} colour="#5a5470" left={size * (0.36 + i * 0.11)} size={size * 0.09}
              delay={i * 900} duration={3200} travel={size * 0.5} reduceMotion={reduceMotion} />
          ))
        : null}

      {/* The coal bed — the one element every state shares. */}
      <Svg width={size} height={bedH * 2} style={{ position: 'absolute', bottom: 0 }}>
        <Defs>
          <LinearGradient id={bedId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.bedTop} />
            <Stop offset="1" stopColor={p.bedBot} />
          </LinearGradient>
        </Defs>
        <Ellipse cx={size / 2} cy={bedH} rx={bedW / 2} ry={bedH * 0.7} fill={`url(#${bedId})`} />
      </Svg>
    </View>
  );
}
