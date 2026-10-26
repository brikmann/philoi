import * as Haptics from 'expo-haptics';
import LottieView, { type AnimationObject } from 'lottie-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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
// THE SPEAR-PLANT (design-mocks/311). A lock-in ends: the hoplite stands ALONE on the screen and
// drives the spear into the ground, the screen shakes on the strike, embers burst from the base —
// and then he fades off as the stats come in. He is the intro, not part of the results: once the
// numbers land he is gone, and nothing of him stays on the screen.
//
// TWO LAYERS, never baked together:
//   • the hoplite + impact FX are a Lottie asset (assets/lottie/hoplite-spear-plant.json, built by
//     scripts/gen-hoplite-lottie.js — its header is the asset contract a hand-drawn replacement
//     must keep);
//   • the stats are the done screen's own live views, popped in by <SpearPlantBeat> here. Numbers
//     change every session, so none of them are ever in the asset.
//
// ONE HOPLITE, drawn by <SpearPlantShake> above the content (so nothing else is on screen with
// him) and centred by plain flex layout. 🐛 He used to be positioned from measureInWindow and drawn
// at opacity 0 until that measurement arrived — on Android a bare unstyled View can be flattened out
// of the native tree and never report, so he randomly never appeared. Then he glided into a parked
// copy at the bottom of the done screen, a second hand-off that could blink. Layout can't fail to
// arrive, and with no slot there is no hand-off: he fades from the `move` beat and unmounts at the end.
//
// ONE CLOCK. Every beat, the shake, the glide and the tap-to-skip read a single shared value
// counting milliseconds since the screen mounted, so nothing can drift from anything else and a skip
// is one assignment: jump the clock to the end and everything lands on its settled frame together.
//
// REDUCE MOTION skips the hoplite entirely: no shake, and the stats fade in together with no slam.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The beat sheet, in ms from mount. The spear lands at `impact`; the stats wait for it. */
export const SPEAR_PLANT_BEATS = {
  drive: 550,
  impact: 820,
  move: 1000,
  statsHead: 1100,
  statsMain: 1200,
  statsRest: 1350,
  cta: 1600,
} as const;
export type SpearPlantBeatName = Exclude<keyof typeof SPEAR_PLANT_BEATS, 'drive' | 'impact' | 'move'>;

const POP_MS = 500;
const SHAKE_MS = 450;
const MOVE_MS = 400;
const STILL_FADE_MS = 300;
// The last beat's pop finishes here; the clock runs to it, and the hoplite and the skip catcher
// unmount.
const END_MS = SPEAR_PLANT_BEATS.cta + POP_MS;

/** The hoplite's box. His centre sits a little above the screen's middle (see styles.stageWrap). */
const STAGE_SIZE = 260;

// Mock 311's `pop` curve — cubic-bezier(.2,1.5,.4,1), the overshoot is the slam.
const popEase = Easing.bezierFn(0.2, 1.5, 0.4, 1);
// His exit: quick off the mark, gentle out.
const moveEase = Easing.bezierFn(0.4, 0, 0.2, 1);

// The asset by patron. v1 ships one hoplite; the Heracles / Athena silhouettes land here keyed by
// programs.patron_key, and every patron without its own art keeps the generic one.
const HOPLITE_DEFAULT: AnimationObject = require('../../assets/lottie/hoplite-spear-plant.json');
const HOPLITE_BY_PATRON: Partial<Record<string, AnimationObject>> = {};

export type SpearPlant = {
  clock: SharedValue<number>;
  /** Reduce-motion is on: no hoplite, no shake, plain fades. */
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

/**
 * The whole results container, shaken for 450ms from the impact frame (mock 311's `shake`), with
 * the stage hoplite drawn on top of it for the intro.
 */
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
      {!still && !settled && <StageHoplite reveal={reveal} />}
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

/**
 * The intro's hoplite: full size, centre stage, alone — then, from the `move` beat, fading back and
 * off as the stats slam in. Transforms and opacity only, so the exit runs on the UI thread.
 */
function StageHoplite({ reveal }: { reveal: SpearPlant }) {
  const { clock } = reveal;
  const exit = useAnimatedStyle(() => {
    const p = moveEase(Math.min(Math.max((clock.value - SPEAR_PLANT_BEATS.move) / MOVE_MS, 0), 1));
    return { opacity: 1 - p, transform: [{ scale: 1 - 0.12 * p }] };
  });
  return (
    <View pointerEvents="none" style={styles.stageWrap}>
      <Animated.View style={[styles.stage, exit]}>
        <HopliteLottie parked={false} patronKey={null} style={styles.fill} />
      </Animated.View>
    </View>
  );
}

// Memoised on primitives, with the colour filter memoised too: LottieView is a PureComponent that
// JSON.stringifies an object source on every render it gets, so an unmemoised hoplite re-sent the
// whole asset to native each time the done screen re-rendered (the caption field, the toggles).
// The burst takes the equipped flare's colour; no flare keeps the ember art.
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

const styles = StyleSheet.create({
  // Fills the results container and centres him; the bottom padding lifts his centre to ~44% of
  // the height, where the eye lands, rather than dead centre.
  stageWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: '12%',
  },
  stage: {
    width: STAGE_SIZE,
    height: STAGE_SIZE,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});
