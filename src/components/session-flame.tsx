import { useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useFlameRamp } from '@/lib/economy/flame-ramp';

// The running session's flame — the SAME brand silhouette home wears, recoloured by the equipped
// ramp. What stays here is only the session behaviour: the glow, the flick, and `dimmed`.
//
// This used to draw its own three-layer flame (mock 51's OUTER/MID/CORE paths) and so rendered a
// rounder, visibly different shape than home's — two marks for one app. Punchlist 17 P0 already
// fixed exactly this bug for the heroes by collapsing the stacked layers into one FLAME_PATH
// silhouette with the ramp feeding the gradient stops (see flame-icon.tsx); SessionFlame was the
// one surface never migrated. It now delegates to <FlameSvg> rather than re-deriving geometry, so
// the mark cannot drift again — there is no bespoke flame left in this file.
//
// Cosmetics still only recolour (PHILOI_UI_SPEC §4): `dimmed`, the flick, and the glow opacity are
// all driven by whether the session is running, never by what is equipped.

// Glow is a 200x200 circle sitting 24px off the bottom of a 240-tall flame in mock 51 — kept as
// ratios so the whole assembly scales off one `height` prop.
const GLOW_RATIO = 200 / 240;
const GLOW_BOTTOM_RATIO = 24 / 240;

type SessionFlameProps = {
  /** Flame height in px; the wrapper and glow scale off this. */
  height?: number;
  /** Gym (mock 52): the flame drops to a dimmed background layer behind the workout log — lower
   * opacity and a softer glow. */
  dimmed?: boolean;
};

export function SessionFlame({ height = 240, dimmed = false }: SessionFlameProps) {
  const reduceMotion = useReduceMotion();
  // Colour ONLY. `dimmed`, the flick animation, and the glow opacity below are all untouched by
  // whatever is equipped — they're the activity signal, and a cosmetic must never move them.
  // Flare-aware — see useFlameRamp. A screen does not decide what colour your flame is.
  const ramp = useFlameRamp();
  // Gradient ids are GLOBAL in react-native-svg: a hardcoded id makes every instance after the
  // first render blank on Android, and this component mounts twice on the lock-in screen. Same
  // bug FlameLogo and EmberIcon already carry a useId for.
  const uid = useId();
  const glowId = `sessionFlameGlow-${uid}`;
  const flick = useSharedValue(0);
  const glowPulse = useSharedValue(0);

  const width = height * FLAME_ASPECT_RATIO;
  const glowSize = height * GLOW_RATIO;

  useEffect(() => {
    if (reduceMotion) {
      // Park both drivers at their resting value rather than leaving a half-finished repeat
      // running — this also covers the user flipping the setting on mid-session.
      flick.value = 0;
      glowPulse.value = 0;
      return;
    }
    // Mock: `flick` 1.5s ease-in-out infinite alternate, `pulse` 2.2s (2.4s dimmed).
    flick.value = withRepeat(withTiming(1, { duration: 750, easing: Easing.inOut(Easing.quad) }), -1, true);
    glowPulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: dimmed ? 1200 : 1100, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: dimmed ? 1200 : 1100, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, [reduceMotion, dimmed, flick, glowPulse]);

  // scaleY 1 -> 1.05 / scaleX 1 -> 0.97, anchored at the base (transformOrigin below) so the
  // flame licks upward instead of growing symmetrically out of its middle.
  const flameStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: 1 + flick.value * 0.05 }, { scaleX: 1 - flick.value * 0.03 }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: dimmed ? 0.55 + glowPulse.value * 0.25 : 0.7 + glowPulse.value * 0.3,
  }));

  return (
    <View style={[styles.wrap, { width, height: height + glowSize * GLOW_BOTTOM_RATIO }]} pointerEvents="none">
      <Animated.View
        style={[
          styles.glow,
          { width: glowSize, height: glowSize, bottom: height * GLOW_BOTTOM_RATIO, left: (width - glowSize) / 2 },
          glowStyle,
        ]}>
        <Svg width={glowSize} height={glowSize}>
          <Defs>
            {/* The equipped colourway tints the glow too, but its OPACITY still comes from
                `dimmed` — i.e. from whether the session is actually running. A skin may never
                change how lit this reads (PHILOI_UI_SPEC §4). */}
            <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={ramp.outer} stopOpacity={dimmed ? 0.4 : 0.5} />
              <Stop offset="62%" stopColor={ramp.outer} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={glowSize} height={glowSize} fill={`url(#${glowId})`} />
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.flame, { opacity: dimmed ? 0.5 : 1 }, flameStyle]}>
        {/* Orientation is not this component's business any more: the one flip lives in
            flame-logo, so there is nothing to opt into here (CINDY_SPEC rendering rule 1). */}
        <FlameSvg width={width} height={height} ramp={ramp} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  glow: {
    position: 'absolute',
  },
  flame: {
    // Mock's `transform-origin:50% 100%` — without this the flick reads as a pulse rather than
    // a flame licking up off its base.
    transformOrigin: '50% 100%',
  },
});
