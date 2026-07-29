import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { VerticalFillBar } from '@/components/vertical-fill-bar';
import { Colors } from '@/constants/theme';

type FireVerticalBarProps = {
  /** 0-100+; values >=100 are visually capped — VerticalFillBar clamps its own ratio, so this
   * never renders past a full track regardless of how far progress_xp overshot goal_xp. */
  pct: number;
  width?: number;
  height?: number;
};

// The fire-side vertical bar (design-mocks/30 option B) — deliberately as plain as the rank
// column's hex-over-bar (Dispatch review: the earlier ember-particle + perimeter-flame
// decoration read as a "matchstick," with small amber cap-flames rendering as brown prong nubs
// right under the badge whenever the tier hit 'full' — removed entirely). The only thing that
// still distinguishes this from the rank bar is the coral->amber gradient fill and a soft
// steady glow once it's genuinely full ("ignited") — same track height/width/radius as the rank
// bar, no particles, no rings. Completion itself is handled by the done-screen celebration
// (lock-in/index.tsx's FlameMeterComplete), never an inline takeover here.
export function FireVerticalBar({ pct, width = 14, height = 92 }: FireVerticalBarProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const glow = useSharedValue(0);
  const isFull = pct >= 100;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    glow.value = reduceMotion ? (isFull ? 1 : 0) : withTiming(isFull ? 1 : 0, { duration: 300 });
  }, [isFull, reduceMotion, glow]);

  const glowStyle = useAnimatedStyle(() => ({ shadowOpacity: interpolate(glow.value, [0, 1], [0, 0.55]) }));

  return (
    <Animated.View style={[styles.wrap, glowStyle]}>
      <VerticalFillBar ratio={pct / 100} width={width} height={height} gradient reduceMotion={reduceMotion} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    shadowColor: Colors.amber,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
    elevation: 3,
  },
});
