import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Colors } from '@/constants/theme';

type VerticalFillBarProps = {
  /** 0-1. */
  ratio: number;
  width?: number;
  height?: number;
  /** Coral->amber horizontal gradient (the fire side) instead of a flat `color` (the rank side). */
  gradient?: boolean;
  color?: string;
  reduceMotion?: boolean;
};

// The shared vertical progress-bar primitive behind Home's matched fire/rank hero columns
// (design-mocks/30 option B, PHILOI_UI_SPEC.md §5) — fills bottom-up. The gradient (when used)
// is horizontal (left coral -> right amber, same direction as the mock's `.fire-fill` even
// though this bar is vertical), so it's rendered once at the bar's full height and revealed
// through a shrinking overflow-hidden window pinned to the bottom — clipping a
// left-to-right gradient vertically never distorts it, which is what lets the fill height
// animate without the gradient itself needing to resize.
export function VerticalFillBar({ ratio, width = 14, height = 96, gradient, color = Colors.coral, reduceMotion }: VerticalFillBarProps) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const fillHeight = useSharedValue(reduceMotion ? clamped * height : 0);

  useEffect(() => {
    fillHeight.value = reduceMotion
      ? clamped * height
      : withTiming(clamped * height, { duration: 700, easing: Easing.bezier(0.2, 0.7, 0.3, 1) });
  }, [clamped, height, reduceMotion, fillHeight]);

  const clipStyle = useAnimatedStyle(() => ({ height: fillHeight.value }));
  const radius = width / 2;

  return (
    <View style={[styles.track, { width, height, borderRadius: radius }]}>
      <Animated.View style={[styles.clip, { width, borderRadius: radius }, clipStyle]}>
        {gradient ? (
          <Svg width={width} height={height} style={styles.pinned}>
            <Defs>
              <LinearGradient id="vfbFire" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={Colors.coral} />
                <Stop offset="1" stopColor={Colors.amber} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={width} height={height} fill="url(#vfbFire)" />
          </Svg>
        ) : (
          <View style={[styles.pinned, { width, height, backgroundColor: color }]} />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: Colors.disabled,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  clip: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  pinned: {
    position: 'absolute',
    left: 0,
    bottom: 0,
  },
});
