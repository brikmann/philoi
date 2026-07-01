import * as Haptics from 'expo-haptics';
import LottieView, { type AnimationObject } from 'lottie-react-native';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { getRewardPreferencesSync } from '@/lib/reward-settings';
import { playRewardSound, type RewardTier } from '@/lib/sound';

const LOTTIE_SOURCES: Record<RewardTier, AnimationObject> = {
  spark: require('../../assets/lottie/spark.json'),
  bloom: require('../../assets/lottie/bloom.json'),
  surge: require('../../assets/lottie/surge.json'),
};

const HAPTIC_BY_TIER: Record<RewardTier, () => void> = {
  spark: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  bloom: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  surge: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
};

export type RewardBurstHandle = { fire: () => void };

// Sound + animation + haptic fired together, peaking on the same frame — none of the three
// wait on each other or on an async preference read (see reward-settings.ts). Mount this
// once per screen and call `ref.fire()` at the moment of success; it doesn't render eagerly.
export const RewardBurst = forwardRef<RewardBurstHandle, { tier: RewardTier }>(function RewardBurst(
  { tier },
  ref
) {
  const lottieRef = useRef<LottieView>(null);
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      reduceMotionRef.current = enabled;
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      reduceMotionRef.current = enabled;
    });
    return () => subscription.remove();
  }, []);

  useImperativeHandle(ref, () => ({
    fire: () => {
      const prefs = getRewardPreferencesSync();
      if (prefs.sound) playRewardSound(tier);
      if (prefs.haptics) HAPTIC_BY_TIER[tier]();
      if (!reduceMotionRef.current) lottieRef.current?.play();
    },
  }));

  return (
    <View style={styles.lottie} pointerEvents="none">
      <LottieView ref={lottieRef} source={LOTTIE_SOURCES[tier]} loop={false} autoPlay={false} style={styles.fill} />
    </View>
  );
});

const styles = StyleSheet.create({
  lottie: {
    position: 'absolute',
    alignSelf: 'center',
    top: '30%',
    width: 220,
    height: 220,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});
