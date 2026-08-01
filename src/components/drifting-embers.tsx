import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';

import { Colors } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

// Ambient embers drifting up the whole lock-in screen (PHILOI_UI_SPEC.md §13, design-mocks/51's
// `.emb`) — screen-level, not attached to the flame, so the immersive background feels alive even
// while the flame itself is holding still between flicks. Positions/delays are the mock's.
const EMBERS: { left: DimensionValue; delay: number }[] = [
  { left: '44%', delay: 0 },
  { left: '54%', delay: 1000 },
  { left: '48%', delay: 2000 },
  { left: '58%', delay: 2700 },
  { left: '40%', delay: 3400 },
];

const RISE_DURATION_MS = 4200;
const RISE_DISTANCE = 180;
const DRIFT_X = 16;

function Ember({ left, delay }: { left: DimensionValue; delay: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(delay, withRepeat(withTiming(1, { duration: RISE_DURATION_MS, easing: Easing.out(Easing.quad) }), -1, false));
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.15, 1], [0, 0.8, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, -RISE_DISTANCE]) },
      { translateX: interpolate(progress.value, [0, 1], [0, DRIFT_X]) },
      { scale: interpolate(progress.value, [0, 1], [1, 0.3]) },
    ],
  }));

  return <Animated.View style={[styles.ember, { left }, style]} />;
}

export function DriftingEmbers() {
  const reduceMotion = useReduceMotion();
  // Static means no embers at all rather than five dots frozen mid-air — a stalled particle
  // reads as a rendering bug, not as a calmer screen.
  if (reduceMotion) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {EMBERS.map((e) => (
        <Ember key={String(e.left) + e.delay} left={e.left} delay={e.delay} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ember: {
    position: 'absolute',
    bottom: '34%',
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.ember,
  },
});
