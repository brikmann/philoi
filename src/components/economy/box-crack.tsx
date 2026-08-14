import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { BoxArt } from '@/components/economy/box-art';
import type { BoxKey, CrackStyle } from '@/lib/economy/boxes';
import { BOXES } from '@/lib/economy/boxes';
import { Colors } from '@/constants/theme';
import { fireBoxOpen } from '@/lib/reward-feedback';

// §8.5's two stages, in one component.
//
// Stage 1 — CRACK (~0.6–0.9s), DIFFERENT per box: a vault spins, a crate's fuse burns, logs get
// chopped. The box is a distinct physical object per tier and the crack has to read that way.
// Stage 2 — PULSE (~0.7s), IDENTICAL for all six: whiten, shrink slightly, and let light rays
// break free of the centre in a fixed ember gold.
//
// The result is already decided when this mounts, and this component is deliberately not told what
// it is (PUNCHLIST_14 §1). It used to take a `rarity` prop and flash the tier colour through the
// rays, which spoiled the pull before the item was ever shown.

const CRACK_MS: Record<CrackStyle, number> = {
  chop: 600,
  fuse: 900,
  grate: 700,
  oil: 800,
  unlock: 750,
  spin: 1800, // ~3600° over ~1.5-2s — the Mythic vault gets the longest wind-up on purpose.
};

const PULSE_MS = 700;

/**
 * The crack's ray colour, identical for every box and every pull (PUNCHLIST_14 §1).
 *
 * This used to be `RARITY_COLOR[rarity]`, which meant the rays flashed the tier BEFORE the item
 * was shown — the box told you it was a Mythic and the reveal had nothing left to say. Opening is
 * now just a box opening; rarity is the results grid's news to break.
 */
const CRACK_LIGHT = Colors.ember;

type Props = {
  boxKey: BoxKey;
  reduceMotion: boolean;
  onDone: () => void;
  size?: number;
};

export function BoxCrack({ boxKey, reduceMotion, onDone, size = 160 }: Props) {
  const crack = BOXES[boxKey].crack;
  const crackMs = CRACK_MS[crack];

  // One driver per visual property rather than one timeline, so each crack style can use only the
  // channels it needs (spin uses rotate, chop uses splitX, fuse uses shudder).
  const rotate = useSharedValue(0);
  const splitX = useSharedValue(0);
  const shudder = useSharedValue(0);
  const scale = useSharedValue(1);
  const whiten = useSharedValue(0);
  const rays = useSharedValue(0);

  useEffect(() => {
    // The crack cue fires as the box gives, including under reduced motion — that setting is about
    // vestibular safety, not silence, and the cross-fade below is still the box opening. The
    // cascade's stagger comes free: each cell mounts its own BoxCrack on its own delay, so ten
    // boxes produce ten cracks in the order they were dealt without any scheduling here.
    fireBoxOpen();

    if (reduceMotion) {
      // Reduced motion: no spin, no shudder, no rays — a plain cross-fade to the reveal, which is
      // exactly what §8.5's closing note asks for.
      whiten.value = withTiming(1, { duration: 220 }, (finished) => {
        if (finished) runOnJS(onDone)();
      });
      return;
    }

    // ── Stage 1: the per-box crack ──
    if (crack === 'spin') {
      rotate.value = withTiming(3600, { duration: crackMs, easing: Easing.in(Easing.cubic) });
    } else if (crack === 'chop') {
      splitX.value = withDelay(crackMs - 250, withTiming(1, { duration: 250, easing: Easing.out(Easing.quad) }));
    } else if (crack === 'fuse') {
      // The fuse burns, then the crate blows — a rising shudder into the pulse.
      shudder.value = withSequence(
        withTiming(1, { duration: crackMs - 150, easing: Easing.in(Easing.quad) }),
        withTiming(0, { duration: 150 })
      );
    } else if (crack === 'grate' || crack === 'oil') {
      // Molten light / unholy oil: the box swells as it fills before it gives.
      scale.value = withTiming(1.12, { duration: crackMs, easing: Easing.inOut(Easing.quad) });
    } else {
      // unlock — the lock turns, a small settle before the lid goes.
      rotate.value = withSequence(
        withTiming(-8, { duration: crackMs * 0.4 }),
        withTiming(6, { duration: crackMs * 0.4 }),
        withTiming(0, { duration: crackMs * 0.2 })
      );
    }

    // ── Stage 2: the universal pulse ──
    whiten.value = withDelay(crackMs, withTiming(1, { duration: PULSE_MS * 0.4 }));
    scale.value = withDelay(crackMs, withTiming(0.82, { duration: PULSE_MS * 0.5, easing: Easing.out(Easing.quad) }));
    rays.value = withDelay(
      crackMs + PULSE_MS * 0.2,
      withTiming(1, { duration: PULSE_MS * 0.8, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onDone)();
      })
    );
  }, [crack, crackMs, reduceMotion, onDone, rotate, splitX, shudder, scale, whiten, rays]);

  const boxStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${rotate.value}deg` },
      { scale: scale.value },
      { translateX: shudder.value * (Math.random() > 0.5 ? 2 : -2) },
    ],
    opacity: 1 - whiten.value * 0.85,
  }));

  // The chop splits the silhouette into two halves that part down the middle.
  const leftHalf = useAnimatedStyle(() => ({ transform: [{ translateX: -splitX.value * 26 }] }));
  const rightHalf = useAnimatedStyle(() => ({ transform: [{ translateX: splitX.value * 26 }] }));

  const rayStyle = useAnimatedStyle(() => ({
    opacity: rays.value * (1 - rays.value * 0.4),
    transform: [{ scale: 0.3 + rays.value * 2.4 }],
  }));

  const flashStyle = useAnimatedStyle(() => ({ opacity: whiten.value * 0.9 }));

  return (
    <View style={[styles.stage, { width: size, height: size }]}>
      {/* Rays break free of the centre in the same ember gold every time — see CRACK_LIGHT. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.rays,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: CRACK_LIGHT },
          rayStyle,
        ]}
      />
      <Animated.View style={boxStyle}>
        {crack === 'chop' ? (
          <View style={{ width: size * 0.8, height: size * 0.8 }}>
            <Animated.View style={[styles.half, styles.halfLeft, leftHalf]}>
              <BoxArt boxKey={boxKey} size={size * 0.8} />
            </Animated.View>
            <Animated.View style={[styles.half, styles.halfRight, rightHalf]}>
              <BoxArt boxKey={boxKey} size={size * 0.8} />
            </Animated.View>
          </View>
        ) : (
          <BoxArt boxKey={boxKey} size={size * 0.8} />
        )}
      </Animated.View>
      {/* The whiten pass — the box turns whiter as it shrinks, reading as breaking open. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.flash, { width: size * 0.5, height: size * 0.5, borderRadius: size * 0.25 }, flashStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rays: {
    position: 'absolute',
    opacity: 0,
  },
  flash: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
  },
  // Each half renders the full vector and clips to its side, so the split needs no second asset.
  half: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '50%',
    overflow: 'hidden',
  },
  halfLeft: {
    left: 0,
  },
  halfRight: {
    right: 0,
    alignItems: 'flex-end',
  },
});
