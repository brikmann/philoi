import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { Easing, useSharedValue, useAnimatedStyle, withTiming, ZoomIn, ZoomOut } from 'react-native-reanimated';

import { Colors, Radius } from '@/constants/theme';

const THUMB_SIZE = 56;

type BouncingPhotoProps = {
  uri: string;
  onRemove: () => void;
  bounds: { width: number; height: number };
};

// Purely local/visual — these positions never leave the device, let alone sync to other
// users mid-session. Periodic re-targeting (not a physics engine — none exists in this repo)
// gives a lazy "drifting" feel without the complexity of real collision/velocity simulation.
export function BouncingPhoto({ uri, onRemove, bounds }: BouncingPhotoProps) {
  const maxX = Math.max(bounds.width - THUMB_SIZE, 0);
  const maxY = Math.max(bounds.height - THUMB_SIZE, 0);

  // Math.random() is impure, so the seed is drawn once via a lazy useState initializer
  // (React's documented escape hatch for one-time impure setup) rather than called directly
  // in the render body.
  const [seed] = useState(() => ({ x: Math.random(), y: Math.random() }));
  const translateX = useSharedValue(seed.x * maxX);
  const translateY = useSharedValue(seed.y * maxY);
  const boundsRef = useRef({ maxX, maxY });
  useEffect(() => {
    boundsRef.current = { maxX, maxY };
  }, [maxX, maxY]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    function retarget() {
      if (cancelled) return;
      const { maxX: mx, maxY: my } = boundsRef.current;
      const duration = 2200 + Math.random() * 1600;
      translateX.value = withTiming(Math.random() * mx, { duration, easing: Easing.inOut(Easing.quad) });
      translateY.value = withTiming(Math.random() * my, { duration, easing: Easing.inOut(Easing.quad) });
      timeoutId = setTimeout(retarget, 2500 + Math.random() * 1500);
    }

    retarget();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [translateX, translateY]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  return (
    <Animated.View entering={ZoomIn.springify()} exiting={ZoomOut.duration(200)} style={[styles.wrap, style]}>
      <Pressable onPress={onRemove} accessibilityLabel="Remove photo" accessibilityRole="button">
        <Image source={{ uri }} style={styles.thumb} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: Radius.input,
    borderWidth: 2,
    borderColor: Colors.cream,
  },
});
