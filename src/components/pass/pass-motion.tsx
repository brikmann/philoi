import { useEffect, useId, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Colors } from '@/constants/theme';
import { useMotionActive } from '@/hooks/use-motion-active';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

// The Flame Pass's shared motion vocabulary — the paywall (mock 200-v2) and the purchase-success
// screen (mock 201-v2) both draw from here so the two halves of the purchase read as one fire.
//
// Every piece obeys the same contract as DriftingEmbers: under Reduce Motion, or while the screen is
// blurred/backgrounded (useMotionActive), a looping layer UNMOUNTS or parks at a static frame rather
// than freezing mid-flight — a particle hung in mid-air reads as a rendering bug.

/** True when looping motion should run. */
export function usePassMotion(): boolean {
  const reduceMotion = useReduceMotion();
  const motionActive = useMotionActive();
  return !reduceMotion && motionActive;
}

// ─────────────────────────── rising flares ───────────────────────────

/**
 * Embers drifting UP the whole screen — the marketing site's `emberfall` canvas, ported: warm dots
 * that rise from below the bottom edge, sway sideways, shrink and fade before they leave the top.
 * Rising, never falling — a falling ember field reads as ash or lava, and the brand is a fire that
 * climbs.
 *
 * Deterministic spread (golden-ratio offsets) rather than Math.random, so a re-render can't
 * reshuffle the field mid-scroll.
 */
export function RisingEmbers({ count = 12, style }: { count?: number; style?: ViewStyle }) {
  const run = usePassMotion();
  const { height } = useWindowDimensions();
  if (!run) return null;
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      {Array.from({ length: count }, (_, i) => {
        const f = (i * 0.618034) % 1;
        const g = (i * 0.414214) % 1;
        return (
          <RisingEmber
            key={i}
            left={`${4 + f * 92}%`}
            drift={(g - 0.5) * 28}
            duration={5400 + g * 2600}
            delay={Math.round(((i * 0.37) % 1) * 5200)}
            rise={height + 40}
            size={3 + (i % 3)}
          />
        );
      })}
    </View>
  );
}

function RisingEmber({
  left,
  drift,
  duration,
  delay,
  rise,
  size,
}: {
  left: string;
  drift: number;
  duration: number;
  delay: number;
  rise: number;
  size: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false));
  }, [delay, duration, t]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.08, 0.72, 1], [0, 0.85, 0.6, 0]),
    transform: [
      { translateY: interpolate(t.value, [0, 1], [0, -rise]) },
      { translateX: interpolate(t.value, [0, 1], [0, drift]) },
      { scale: interpolate(t.value, [0, 1], [1, 0.25]) },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.ember,
        { left: left as `${number}%`, width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    />
  );
}

// ─────────────────────────── shine sweep ───────────────────────────

/**
 * A soft light bar that sweeps across its parent on a loop — the mock's `:after` shine on the crest,
 * the CTA and the reward cards. Fill a parent that clips (`overflow: 'hidden'` + its radius).
 *
 * SVG because there is no gradient background in this app (neither expo-linear-gradient nor
 * masked-view is installed — see PrimaryButton).
 */
export function ShineSweep({
  period = 2600,
  opacity = 0.5,
  delay = 0,
}: {
  period?: number;
  opacity?: number;
  delay?: number;
}) {
  const run = usePassMotion();
  const [w, setW] = useState(0);
  const grad = `shine-${useId()}`;
  const t = useSharedValue(0);

  useEffect(() => {
    if (!run || w === 0) return;
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: period, easing: Easing.linear }), -1, false));
  }, [run, w, period, delay, t]);

  // Crosses in the first 55% of the period and rests off-screen for the rest — a glint, not a
  // strobe (the mock's `sweep` keyframes).
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 0.55, 1], [-w * 0.7, w * 1.3, w * 1.3]) }],
  }));

  if (!run) return null;
  const barW = Math.max(w * 0.48, 24);
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Animated.View style={[styles.sweep, { width: barW }, style]}>
          <Svg width={barW} height="100%">
            <Defs>
              <LinearGradient id={grad} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
                <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={opacity} />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={barW} height="100%" fill={`url(#${grad})`} />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ─────────────────────────── rotating rays ───────────────────────────

/**
 * A slow-turning fan of thin spokes, centred on its own box — the hero flame's `.hrays` and the
 * profile card's `.vrays`. Size the parent; the spokes radiate from its centre. Parks at rest under
 * Reduce Motion (a still fan is a tasteful static frame; an absent one would change the layout).
 */
export function SpinRays({
  size,
  spokes = 6,
  period = 14000,
  color = Colors.ember,
  opacity = 0.5,
  thickness = 2,
}: {
  size: number;
  spokes?: number;
  period?: number;
  color?: string;
  opacity?: number;
  thickness?: number;
}) {
  const run = usePassMotion();
  const grad = `rays-${useId()}`;
  const spin = useSharedValue(0);

  useEffect(() => {
    if (!run) {
      spin.value = 0;
      return;
    }
    spin.value = withRepeat(withTiming(1, { duration: period, easing: Easing.linear }), -1, false);
  }, [run, period, spin]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const r = size / 2;

  return (
    <Animated.View style={[{ width: size, height: size, opacity }, style]} pointerEvents="none">
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="1" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        {Array.from({ length: spokes }, (_, i) => (
          // Each spoke starts at the centre and runs outward; the gradient fades it to nothing at
          // the rim, so the fan has no hard edge to betray its size.
          <Rect
            key={i}
            x={r - thickness / 2}
            y={r}
            width={thickness}
            height={r}
            rx={thickness / 2}
            fill={`url(#${grad})`}
            transform={`rotate(${(360 / spokes) * i} ${r} ${r})`}
          />
        ))}
      </Svg>
    </Animated.View>
  );
}

// ─────────────────────────── breathing glow ───────────────────────────

/** A value that breathes 0→1→0 forever while motion runs, and rests at `rest` otherwise. */
export function useBreath(period: number, rest = 0.5) {
  const run = usePassMotion();
  const t = useSharedValue(rest);
  useEffect(() => {
    if (!run) {
      t.value = rest;
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: period / 2, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [run, period, rest, t]);
  return t;
}

const styles = StyleSheet.create({
  ember: {
    position: 'absolute',
    bottom: -8,
    backgroundColor: '#FFB03C',
    shadowColor: Colors.amber,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  sweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
});
