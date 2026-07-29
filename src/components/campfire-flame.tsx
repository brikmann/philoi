import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Colors } from '@/constants/theme';

type CampfireFlameProps = {
  /** 0 (dormant, nearly out) to 1 (roaring — everyone locked in today) — see get_my_campfire_heat() in schema.sql. */
  heat: number;
  size?: number;
};

// The living-flame signature mechanic (UI_REDESIGN_SPEC.md) — a Campfire's flame is a live
// gauge of the GROUP's activity, distinct from LockInFlame (an individual session's timer-
// driven flame). Same breathing/glow visual language, smaller scale, driven by a 0-1 heat
// score instead of elapsed seconds.
export function CampfireFlame({ heat, size = 32 }: CampfireFlameProps) {
  const clampedHeat = Math.min(Math.max(heat, 0), 1);
  const breathe = useSharedValue(1);

  useEffect(() => {
    breathe.value = withRepeat(withSequence(withTiming(1.08, { duration: 900 }), withTiming(1, { duration: 900 })), -1, true);
  }, [breathe]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: breathe.value * (0.6 + clampedHeat * 0.4) }],
  }));

  const glowOpacity = 0.15 + clampedHeat * 0.55;
  const fireOpacity = 0.35 + clampedHeat * 0.65;

  return (
    <View style={[styles.container, { width: size * 1.8, height: size * 1.8 }]}>
      <View
        style={[
          styles.glow,
          {
            width: size * 1.8,
            height: size * 1.8,
            borderRadius: size,
            opacity: glowOpacity,
          },
        ]}
      />
      <Animated.View style={style}>
        <Text style={[styles.fire, { fontSize: size, opacity: fireOpacity }]}>🔥</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    backgroundColor: Colors.amber,
  },
  fire: {
    textAlign: 'center',
  },
});
