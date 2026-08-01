import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function Ember({ cx, cy, r, fill, delay, reduceMotion }: { cx: number; cy: number; r: number; fill: string; delay: number; reduceMotion: boolean }) {
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withDelay(delay, withRepeat(withSequence(withTiming(0.85, { duration: 900 }), withTiming(0.25, { duration: 900 })), -1, true));
  }, [reduceMotion, delay, pulse]);

  const animatedProps = useAnimatedProps(() => ({ opacity: reduceMotion ? 0.5 : pulse.value }));
  return <AnimatedCircle cx={cx} cy={cy} r={r} fill={fill} animatedProps={animatedProps} />;
}

// The Leaderboard tab's "no campfires yet" empty state (PHILOI_UI_SPEC.md §15, mock 41) —
// charred crossed logs, ash pile, dying embers still flickering. prefers-reduced-motion → the
// embers hold a fixed mid-glow instead of pulsing.
export function BurntOutCampfire({ size = 160 }: { size?: number }) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  return (
    <Svg width={size} height={size * 1.05} viewBox="0 0 200 210">
      <Ellipse cx={100} cy={168} rx={54} ry={9} fill="#20182F" />
      <G>
        <Path d="M58 146 h84 a7 7 0 0 1 7 7 v0 a7 7 0 0 1 -7 7 h-84 a7 7 0 0 1 -7 -7 v0 a7 7 0 0 1 7 -7 Z" fill="#2A1E18" transform="rotate(20 100 153)" />
        <Path d="M58 146 h84 a7 7 0 0 1 7 7 v0 a7 7 0 0 1 -7 7 h-84 a7 7 0 0 1 -7 -7 v0 a7 7 0 0 1 7 -7 Z" fill="#241A15" transform="rotate(-20 100 153)" />
      </G>
      <Ember cx={92} cy={147} r={4} fill="#E0612C" delay={200} reduceMotion={reduceMotion} />
      <Ember cx={108} cy={150} r={3} fill="#F2A33C" delay={900} reduceMotion={reduceMotion} />
      <Ember cx={100} cy={143} r={2.6} fill="#FFD27A" delay={1500} reduceMotion={reduceMotion} />
    </Svg>
  );
}
