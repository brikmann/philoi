import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View, type DimensionValue } from 'react-native';
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

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { publishFlameCompletion } from '@/lib/api/daily-fire';
import { useAuth } from '@/lib/auth/auth-context';
import { hasCelebratedFlameMeterToday, markFlameMeterCelebrated } from '@/lib/flame-meter-local';
import { fireFlameMeterComplete } from '@/lib/reward-feedback';
import type { DailyFire } from '@/types/database';

type Tier = 'empty' | 'low' | 'high' | 'full';

function tierFor(pct: number): Tier {
  if (pct <= 0) return 'empty';
  if (pct >= 100) return 'full';
  if (pct >= 66) return 'high';
  return 'low';
}

const NOTE_BY_TIER: Record<Tier, string | null> = {
  empty: "Lock in to start today's fire.",
  low: 'Nice start — keep feeding it.',
  high: "1 more lock-in to complete today's fire.",
  full: null,
};

// Deterministic per-index jitter so embers don't clump but also don't reshuffle every render.
function hashUnit(seed: number): number {
  const x = Math.sin(seed * 9973 + 1) * 43758.5453;
  return x - Math.floor(x);
}

function RisingEmber({ index, count, tier, reduceMotion }: { index: number; count: number; tier: Tier; reduceMotion: boolean }) {
  const progress = useSharedValue(reduceMotion ? 0.4 : 0);
  const baseDuration = tier === 'full' ? 1700 : tier === 'high' ? 1500 : 2100;
  const duration = baseDuration * (0.85 + hashUnit(index) * 0.4);
  const dx = (hashUnit(index + 100) - 0.5) * 14;
  const size = (tier === 'low' ? 3 : 4) + hashUnit(index + 200) * 1.6;
  const left: DimensionValue = `${4 + ((index + 0.35 + hashUnit(index + 300) * 0.3) / count) * 92}%`;

  useEffect(() => {
    if (reduceMotion) return;
    const delay = (index / count) * duration;
    progress.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.out(Easing.quad) }), -1, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot loop setup per mount/tier change
  }, [reduceMotion, tier]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.14, 0.7, 1], [0, 0.95, 0.5, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, -34]) },
      { translateX: dx * progress.value },
      { scale: interpolate(progress.value, [0, 1], [0.55, 0.12]) },
    ],
  }));

  return <Animated.View style={[styles.ember, reduceMotion && styles.emberStatic, style, { left, width: size, height: size }]} />;
}

function PerimeterFlame({
  left,
  top,
  rotation,
  delay,
  reduceMotion,
}: {
  left: DimensionValue;
  top?: number;
  rotation: number;
  delay: number;
  reduceMotion: boolean;
}) {
  const scale = useSharedValue(reduceMotion ? 1 : 0.9);

  useEffect(() => {
    if (reduceMotion) return;
    scale.value = withDelay(delay, withRepeat(withSequence(withTiming(1.15, { duration: 400 }), withTiming(0.9, { duration: 400 })), -1, true));
  }, [reduceMotion, delay, scale]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation}deg` }, { scale: scale.value }],
  }));

  return <Animated.View style={[styles.lick, style, { left, top }]} />;
}

// The "full" tier's perimeter ring (§5: "small, faint flames ring the whole perimeter,
// pointing outward") — approximated as a fixed layout rather than measuring the bar's exact
// pixel width and computing true rounded-rect perimeter trigonometry; visually equivalent for
// a meter this small, and avoids an onLayout round-trip before anything can render.
function PerimeterRing({ reduceMotion }: { reduceMotion: boolean }) {
  const topPositions = [12, 28, 50, 72, 88];
  const capRotations = [-45, 0, 45];
  return (
    <>
      {topPositions.map((left, i) => (
        <PerimeterFlame key={`t${i}`} left={`${left}%` as DimensionValue} top={-2} rotation={0} delay={i * 90} reduceMotion={reduceMotion} />
      ))}
      {topPositions.map((left, i) => (
        <PerimeterFlame key={`b${i}`} left={`${left}%` as DimensionValue} top={16} rotation={180} delay={i * 90 + 40} reduceMotion={reduceMotion} />
      ))}
      {capRotations.map((rot, i) => (
        <PerimeterFlame key={`r${i}`} left="96%" top={2 + i * 6} rotation={rot} delay={i * 70} reduceMotion={reduceMotion} />
      ))}
      {capRotations.map((rot, i) => (
        <PerimeterFlame key={`l${i}`} left="0%" top={2 + i * 6} rotation={rot + 180} delay={i * 70 + 30} reduceMotion={reduceMotion} />
      ))}
    </>
  );
}

type FlameMeterProps = {
  dailyFire: DailyFire | null;
  /** True when the day's most recent fetch threw (see useDailyFire) — lets this render a
   * distinct, subtle notice instead of silently looking identical to "no data loaded yet." */
  error?: boolean;
};

// The daily flame meter (design-mocks/26, PHILOI_UI_SPEC.md §5) — sits below the "Lock in"
// hero, above the rank hex. Two tracks: this bar is TODAY; the rank hex below is forever.
export function FlameMeter({ dailyFire, error }: FlameMeterProps) {
  const { profile } = useAuth();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const fillWidth = useSharedValue(0);
  const glowPulse = useSharedValue(0);
  const rewardFiredForDay = useRef<string | null>(null);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  const pct = dailyFire && dailyFire.goal_xp > 0 ? Math.min(100, (dailyFire.progress_xp / dailyFire.goal_xp) * 100) : 0;
  const tier = tierFor(pct);

  useEffect(() => {
    fillWidth.value = reduceMotion ? pct : withTiming(pct, { duration: 700, easing: Easing.bezier(0.2, 0.7, 0.3, 1) });
  }, [pct, reduceMotion, fillWidth]);

  // Sub-100% glow pulses gently; full tier holds a steady glow instead (§5: "a steady soft
  // glow, no pulsing") — driven by the same shared value so only one useAnimatedStyle is needed.
  useEffect(() => {
    if (reduceMotion || tier === 'empty') {
      glowPulse.value = tier === 'full' ? 1 : 0;
      return;
    }
    if (tier === 'full') {
      glowPulse.value = withTiming(1, { duration: 300 });
    } else {
      glowPulse.value = withRepeat(withSequence(withTiming(1, { duration: 1300 }), withTiming(0.5, { duration: 1300 })), -1, true);
    }
  }, [tier, reduceMotion, glowPulse]);

  // Fallback firing path only — the common case is the fire-complete celebration screen
  // (lock-in/index.tsx -> FlameMeterCompleteScreen) already fired this cue right as the meter
  // crossed, and marked hasCelebratedFlameMeterToday so this effect is a no-op when Home is
  // reached afterward. This still covers the rare case where the meter completes without going
  // through that screen at all.
  useEffect(() => {
    if (!dailyFire?.just_completed || rewardFiredForDay.current === dailyFire.day) return;
    rewardFiredForDay.current = dailyFire.day;
    const day = dailyFire.day;
    (async () => {
      if (await hasCelebratedFlameMeterToday(day)) return;
      await markFlameMeterCelebrated(day);
      fireFlameMeterComplete();
    })();
  }, [dailyFire?.just_completed, dailyFire?.day]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${fillWidth.value}%` }));
  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(glowPulse.value, [0, 1], [0.28, 0.5]),
  }));

  if (!dailyFire) {
    // Distinguishable from "still loading" (which renders nothing here too, briefly) — a
    // failed fetch stays visible on-screen instead of the meter just never appearing, which is
    // exactly what made the get_or_create_daily_fire bug (migration 0028) invisible for so long.
    if (error) {
      return (
        <View style={styles.fm}>
          <View style={styles.lblRow}>
            <Ionicons name="flame-outline" size={13} color={Colors.textTertiary} />
            <Text style={styles.errorNote}>Couldn&apos;t load today&apos;s fire — pull to refresh.</Text>
          </View>
        </View>
      );
    }
    return null;
  }

  const emberCount = tier === 'full' ? 8 : tier === 'high' ? 10 : 6;
  const showCompletionCard = dailyFire.completed;
  const canShare = Boolean(profile?.publish_flame_completion);

  async function handleShare() {
    setSharing(true);
    try {
      await publishFlameCompletion();
      setShared(true);
    } catch {
      // A failed share just leaves the button tappable to retry.
    } finally {
      setSharing(false);
    }
  }

  return (
    <View style={styles.fm}>
      <View style={styles.fmhead}>
        <View style={styles.lblRow}>
          <Ionicons name="flame" size={13} color={Colors.amber} />
          <Text style={styles.lbl}>Today&apos;s fire</Text>
        </View>
        <Text style={styles.fmval}>
          {Math.round(dailyFire.progress_xp)} / {Math.round(dailyFire.goal_xp)} XP
        </Text>
      </View>

      <View style={styles.fmbar}>
        <Animated.View style={[styles.fmfill, tier === 'full' && styles.fmfillFull, fillStyle, glowStyle]}>
          {tier !== 'empty' &&
            Array.from({ length: emberCount }, (_, i) => (
              <RisingEmber key={i} index={i} count={emberCount} tier={tier} reduceMotion={reduceMotion} />
            ))}
        </Animated.View>
        {tier === 'full' && <PerimeterRing reduceMotion={reduceMotion} />}
      </View>

      {!showCompletionCard && NOTE_BY_TIER[tier] && <Text style={styles.fmnote}>{NOTE_BY_TIER[tier]}</Text>}

      {showCompletionCard && (
        <View style={styles.done}>
          <Ionicons name="flame" size={20} color={Colors.amber} />
          <View style={styles.doneText}>
            <Text style={styles.doneA}>Today&apos;s fire is complete!</Text>
            <Text style={styles.doneB}>
              +{dailyFire.bonus_xp || 50} XP · +{dailyFire.bonus_embers || 5} embers
            </Text>
          </View>
          {canShare && (
            <Pressable style={styles.share} onPress={handleShare} disabled={sharing || shared}>
              <Ionicons name="send" size={11} color={Colors.achieverText} />
              <Text style={styles.shareText}>{shared ? 'Shared' : sharing ? 'Sharing…' : 'Share'}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fm: {
    marginTop: Spacing.three,
    width: '100%',
  },
  errorNote: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
  },
  fmhead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  lblRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lbl: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  fmval: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ember,
  },
  fmbar: {
    height: 20,
    borderRadius: Radius.pill,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    overflow: 'visible',
  },
  fmfill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: Radius.pill,
    backgroundColor: Colors.coral,
    overflow: 'visible',
    shadowColor: Colors.amber,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
    elevation: 3,
  },
  fmfillFull: {
    backgroundColor: Colors.amber,
  },
  ember: {
    position: 'absolute',
    bottom: 4,
    borderRadius: 999,
    backgroundColor: Colors.ember,
  },
  emberStatic: {
    opacity: 0.6,
  },
  lick: {
    position: 'absolute',
    width: 5,
    height: 6,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    borderBottomLeftRadius: 1.5,
    borderBottomRightRadius: 1.5,
    backgroundColor: Colors.amber,
    opacity: 0.45,
  },
  fmnote: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 8,
  },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 10,
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.coral,
    borderRadius: Radius.card,
    padding: 11,
  },
  doneText: {
    flex: 1,
  },
  doneA: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ember,
  },
  doneB: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
    marginTop: 1,
  },
  share: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  shareText: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.achieverText,
  },
});
