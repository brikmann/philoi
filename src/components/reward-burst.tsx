import * as Haptics from 'expo-haptics';
import LottieView, { type AnimationObject } from 'lottie-react-native';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { getRewardPreferencesSync } from '@/lib/reward-settings';
import { playRewardSound, type RewardCue } from '@/lib/sound';

// Exhaustive over RewardCue for type-safety/future-proofing, but in practice every current
// call site only ever passes 'settle' (challenges.tsx, lock-in/index.tsx's plain done-screen
// branch, the retired goal check-in screen) — ignite/whoosh/rankup*/spark fire directly via
// reward-feedback.ts, bypassing this component's Lottie+ref mechanism entirely. No new Lottie
// assets were made for the new cue names, so these reuse the existing three sensibly: ignite
// and spark borrow the small/quick spark burst, rankup* all borrow the biggest (surge), whoosh
// only needs an entry to satisfy the Record type.
const LOTTIE_SOURCES: Record<RewardCue, AnimationObject> = {
  ignite: require('../../assets/lottie/spark.json'),
  whoosh: require('../../assets/lottie/spark.json'),
  settle: require('../../assets/lottie/bloom.json'),
  rankup: require('../../assets/lottie/surge.json'),
  spark: require('../../assets/lottie/spark.json'),
  'rankup-bronze': require('../../assets/lottie/surge.json'),
  'rankup-silver': require('../../assets/lottie/surge.json'),
  'rankup-gold': require('../../assets/lottie/surge.json'),
  'rankup-diamond': require('../../assets/lottie/surge.json'),
  'rankup-olympian': require('../../assets/lottie/surge.json'),
  'rankup-primordial': require('../../assets/lottie/surge.json'),
  // Never routed through RewardBurst (the rank-up riser is start/stopped directly via
  // reward-feedback.ts) — entry exists only to satisfy the exhaustive Record type.
  'rankup-riser': require('../../assets/lottie/surge.json'),
};

// expo-haptics degrades gracefully on its own when its native module is missing (throws a
// plain UnavailabilityError only when called, never at import) — the .catch() here just
// prevents that rejection from surfacing as an unhandled-rejection warning on an unawaited call.
const HAPTIC_BY_CUE: Record<RewardCue, () => void> = {
  ignite: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  whoosh: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  settle: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  rankup: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}),
  spark: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  'rankup-bronze': () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}),
  'rankup-silver': () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}),
  'rankup-gold': () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}),
  'rankup-diamond': () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}),
  'rankup-olympian': () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}),
  'rankup-primordial': () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}),
  // Placeholder (see LOTTIE_SOURCES) — the riser carries no RewardBurst haptic of its own.
  'rankup-riser': () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
};

export type RewardBurstHandle = { fire: () => void };

// Sound + animation + haptic fired together, peaking on the same frame — none of the three
// wait on each other or on an async preference read (see reward-settings.ts). Mount this
// once per screen and call `ref.fire()` at the moment of success; it doesn't render eagerly.
export const RewardBurst = forwardRef<RewardBurstHandle, { cue: RewardCue }>(function RewardBurst(
  { cue },
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
      if (prefs.sound) playRewardSound(cue);
      if (prefs.haptics) HAPTIC_BY_CUE[cue]();
      if (!reduceMotionRef.current) lottieRef.current?.play();
    },
  }));

  return (
    <View style={styles.lottie} pointerEvents="none">
      <LottieView ref={lottieRef} source={LOTTIE_SOURCES[cue]} loop={false} autoPlay={false} style={styles.fill} />
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
