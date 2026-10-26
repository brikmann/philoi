import * as Haptics from 'expo-haptics';
import LottieView, { type AnimationObject } from 'lottie-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { flareDisplayColour } from '@/components/economy/flare-signature';
import { useEquipped } from '@/lib/economy/loadout';
import { getRewardPreferencesSync } from '@/lib/reward-settings';
import { playRewardSound } from '@/lib/sound';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE SPEAR-PLANT (design-mocks/311). A lock-in ends: a hoplite drives the spear into the ground,
// the screen shakes on the strike, embers burst from the base, and the stats slam in above.
//
// TWO LAYERS, never baked together:
//   • the hoplite + impact FX are a Lottie asset (assets/lottie/hoplite-spear-plant.json, built by
//     scripts/gen-hoplite-lottie.js — its header is the asset contract a hand-drawn replacement
//     must keep);
//   • the stats are the done screen's own live views, popped in by <SpearPlantBeat> here. Numbers
//     change every session, so none of them are ever in the asset.
//
// ONE CLOCK. Every beat, the shake and the tap-to-skip read a single shared value counting
// milliseconds since the screen mounted, so nothing can drift from anything else and a skip is one
// assignment: jump the clock to the end and every style lands on its settled frame together.
//
// REDUCE MOTION parks the hoplite on its last frame (spear already planted), drops the shake, and
// fades the stats in together with no slam.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Mock 311's beat sheet, in ms from mount. `stats*` are the three staggered slams. */
export const SPEAR_PLANT_BEATS = {
  drive: 550,
  impact: 820,
  statsHead: 950,
  statsMain: 1050,
  statsRest: 1250,
  cta: 1500,
} as const;
export type SpearPlantBeatName = Exclude<keyof typeof SPEAR_PLANT_BEATS, 'drive' | 'impact'>;

const POP_MS = 500;
const SHAKE_MS = 450;
const STILL_FADE_MS = 300;
// The last beat's pop finishes here; the clock runs to it and the skip catcher unmounts.
const END_MS = SPEAR_PLANT_BEATS.cta + POP_MS;

// Mock 311's `pop` curve — cubic-bezier(.2,1.5,.4,1), the overshoot is the slam.
const popEase = Easing.bezierFn(0.2, 1.5, 0.4, 1);

// The asset by patron. v1 ships one hoplite; the Heracles / Athena silhouettes land here keyed by
// programs.patron_key, and every patron without its own art keeps the generic one.
const HOPLITE_DEFAULT: AnimationObject = require('../../assets/lottie/hoplite-spear-plant.json');
const HOPLITE_BY_PATRON: Partial<Record<string, AnimationObject>> = {};

export type SpearPlant = {
  clock: SharedValue<number>;
  /** Reduce-motion is on: parked hoplite, no shake, plain fades. */
  still: boolean;
  /** The intro is over (ran out or was skipped) — the screen is at rest. */
  settled: boolean;
  /** Settled by a tap rather than by running out. */
  skipped: boolean;
  skip: () => void;
};

/**
 * Drives the reveal. Call once at the top of the done screen and hand the result to the pieces
 * below; `onStatsLand` fires once, when the main stat slams in (or at once on a skip), so the
 * screen can start whatever counts up under it.
 */
export function useSpearPlant(onStatsLand?: () => void): SpearPlant {
  const still = useReducedMotion();
  const clock = useSharedValue(0);
  const [settled, setSettled] = useState(still);
  const [skipped, setSkipped] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const landed = useRef(false);
  const onStatsLandRef = useRef(onStatsLand);
  useEffect(() => {
    onStatsLandRef.current = onStatsLand;
  });

  const land = useCallback(() => {
    if (landed.current) return;
    landed.current = true;
    onStatsLandRef.current?.();
  }, []);

  useEffect(() => {
    const prefs = getRewardPreferencesSync();
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    if (still) {
      // No strike to sync to, so the arrival cue lands with the fade — the same settle + success
      // pair this screen fired on mount before the spear-plant existed.
      clock.set(withTiming(END_MS, { duration: STILL_FADE_MS }));
      if (prefs.reward_sfx_enabled) playRewardSound('settle');
      if (prefs.haptics) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      land();
      return clearTimers;
    }
    clock.set(withTiming(END_MS, { duration: END_MS, easing: Easing.linear }));
    // The whoosh rides the drive and the thud lands on the impact frame. No bespoke clang exists
    // yet, so the thud is the done screen's existing arrival cue — moved from mount to the strike.
    if (prefs.reward_sfx_enabled) at(SPEAR_PLANT_BEATS.drive, () => playRewardSound('whoosh', 0.85));
    at(SPEAR_PLANT_BEATS.impact, () => {
      if (prefs.reward_sfx_enabled) playRewardSound('settle');
      if (prefs.haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    });
    at(SPEAR_PLANT_BEATS.statsMain, land);
    at(END_MS, () => setSettled(true));
    return clearTimers;

    function clearTimers() {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plays once, on mount
  }, []);

  const skip = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    cancelAnimation(clock);
    clock.set(END_MS);
    land();
    setSettled(true);
    setSkipped(true);
  }, [clock, land]);

  return { clock, still, settled, skipped, skip };
}

/** A stat group that slams in on its beat (mock 311's `.st` pop): up 14px and from 0.9 scale. */
export function SpearPlantBeat({
  reveal,
  beat,
  style,
  children,
}: {
  reveal: SpearPlant;
  beat: SpearPlantBeatName;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { clock, still } = reveal;
  const delay = SPEAR_PLANT_BEATS[beat];
  const animatedStyle = useAnimatedStyle(() => {
    if (still) return { opacity: Math.min(clock.value / END_MS, 1) };
    const t = Math.min(Math.max((clock.value - delay) / POP_MS, 0), 1);
    const p = popEase(t);
    return {
      opacity: Math.min(t * 2.5, 1),
      transform: [{ translateY: 14 * (1 - p) }, { scale: 0.9 + 0.1 * p }],
    };
  });
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

/** The whole results container, shaken for 450ms from the impact frame (mock 311's `shake`). */
export function SpearPlantShake({
  reveal,
  style,
  children,
}: {
  reveal: SpearPlant;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { clock, still, settled, skip } = reveal;
  const shakeStyle = useAnimatedStyle(() => {
    if (still) return {};
    const t = (clock.value - SPEAR_PLANT_BEATS.impact) / SHAKE_MS;
    const stops = [0, 0.15, 0.3, 0.45, 0.6, 0.8, 1];
    return {
      transform: [
        { translateX: interpolate(t, stops, [0, -4, 4, -3, 3, -1, 0], Extrapolation.CLAMP) },
        { translateY: interpolate(t, stops, [0, 2, -2, 3, -1, 1, 0], Extrapolation.CLAMP) },
      ],
    };
  });
  return (
    <Animated.View style={[style, shakeStyle]}>
      {children}
      {/* Tap anywhere to skip — people see this many times a day. Only mounted while the intro
          runs, so it also keeps a stray tap from landing on the post card before it's visible. */}
      {!settled && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={skip}
          accessibilityRole="button"
          accessibilityLabel="Skip animation"
        />
      )}
    </Animated.View>
  );
}

/** The hoplite himself. The burst takes the equipped flare's colour; no flare keeps the ember art. */
export function SpearPlantHoplite({
  reveal,
  patronKey,
  style,
}: {
  reveal: SpearPlant;
  patronKey?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  return <HopliteLottie parked={reveal.still || reveal.skipped} patronKey={patronKey ?? null} style={style} />;
}

// Memoised on primitives, with the colour filter memoised too: LottieView is a PureComponent that
// JSON.stringifies an object source on every render it gets, so an unmemoised hoplite re-sent the
// whole asset to native each time the done screen re-rendered (the caption field, the toggles).
const HopliteLottie = memo(function HopliteLottie({
  parked,
  patronKey,
  style,
}: {
  parked: boolean;
  patronKey: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const flare = useEquipped('flare')?.flare;
  const source = (patronKey && HOPLITE_BY_PATRON[patronKey]) || HOPLITE_DEFAULT;
  const tint = flare ? flareDisplayColour(flare.effect, flare.colour) : null;
  const colorFilters = useMemo(() => (tint ? [{ keypath: 'Burst', color: tint }] : undefined), [tint]);
  return (
    <LottieView
      // A skip remounts on the last frame rather than seeking a running native animation, which
      // the two platforms resolve differently. An intro that runs out keeps its view: it has
      // already come to rest on that same frame.
      key={parked ? 'parked' : 'playing'}
      source={source}
      autoPlay={!parked}
      progress={parked ? 1 : undefined}
      loop={false}
      resizeMode="contain"
      colorFilters={colorFilters}
      style={style}
    />
  );
});
