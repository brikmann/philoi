import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { Colors } from '@/constants/theme';

export type CampfireFlameState = 'roar' | 'steady' | 'dead';

// Shared read of a campfire's 0-1 heat score (get_my_campfire_heat() in schema.sql) into one
// of the three flame states — used by both the home carousel and the field map so a campfire
// reads the same "temperature" wherever it appears.
export function heatToFlameState(heat: number): CampfireFlameState {
  if (heat <= 0.05) return 'dead';
  if (heat >= 0.6) return 'roar';
  return 'steady';
}

type CampfireFlameStageProps = {
  state: CampfireFlameState;
  size?: number;
};

const SPARKS = [
  { delay: 0, xOffset: -12 },
  { delay: 350, xOffset: 8 },
  { delay: 700, xOffset: -4 },
  { delay: 1050, xOffset: 14 },
];

const SMOKE = [
  { delay: 0, xOffset: -6 },
  { delay: 1300, xOffset: 6 },
];

function Spark({ delay, xOffset }: { delay: number; xOffset: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false));
  }, [delay, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.15, 0.8, 1], [0, 0.9, 0.4, 0]),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [0, -70]) }, { translateX: xOffset }],
  }));
  return <Animated.View style={[styles.spark, style]} />;
}

function Smoke({ delay, xOffset }: { delay: number; xOffset: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withRepeat(withTiming(1, { duration: 3200, easing: Easing.out(Easing.quad) }), -1, false));
  }, [delay, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.15, 1], [0, 0.3, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, -90]) },
      { translateX: xOffset },
      { scale: interpolate(progress.value, [0, 1], [0.7, 1.8]) },
    ],
  }));
  return <Animated.View style={[styles.smoke, style]} />;
}

// The living-flame's three read states across the campfire carousel (design-mocks/02/04/08):
// roar (everyone locked in — fast pulse + sparks), steady (gentle breathe, the default), dead
// (grayscale + dim + slow flick + smoke, "gone cold" — needs relighting).
export function CampfireFlameStage({ state, size = 150 }: CampfireFlameStageProps) {
  const breathe = useSharedValue(1);

  useEffect(() => {
    if (state === 'roar') {
      breathe.value = withRepeat(
        withSequence(withTiming(1.13, { duration: 270 }), withTiming(1.06, { duration: 270 }), withTiming(1, { duration: 360 })),
        -1,
        false
      );
    } else if (state === 'dead') {
      breathe.value = withRepeat(withSequence(withTiming(1.03, { duration: 1500 }), withTiming(1, { duration: 1500 })), -1, true);
    } else {
      breathe.value = withRepeat(withSequence(withTiming(1.05, { duration: 850 }), withTiming(1, { duration: 850 })), -1, true);
    }
  }, [state, breathe]);

  const flameStyle = useAnimatedStyle(() => ({
    opacity: state === 'dead' ? 0.5 : 1,
    transform: [{ scale: breathe.value }],
  }));

  return (
    <View style={[styles.container, { width: size, height: size * FLAME_ASPECT_RATIO_INVERSE }]}>
      {state === 'roar' && SPARKS.map((s) => <Spark key={s.delay} delay={s.delay} xOffset={s.xOffset} />)}
      {state === 'dead' && SMOKE.map((s) => <Smoke key={s.delay} delay={s.delay} xOffset={s.xOffset} />)}
      <Animated.View style={flameStyle}>
        <FlameSvg width={size} height={size * FLAME_ASPECT_RATIO_INVERSE} />
      </Animated.View>
    </View>
  );
}

// FlameSvg's viewBox is narrower than tall (120x150) — FLAME_ASPECT_RATIO is width/height, so
// height = width / FLAME_ASPECT_RATIO.
const FLAME_ASPECT_RATIO_INVERSE = 1 / FLAME_ASPECT_RATIO;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  spark: {
    position: 'absolute',
    bottom: '55%',
    left: '50%',
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.amber,
  },
  smoke: {
    position: 'absolute',
    bottom: '60%',
    left: '50%',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#8a80a0',
  },
});
