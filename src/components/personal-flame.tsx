import { useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { EquippedFlameSvg } from '@/components/flame-icon';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

// YOUR flame (mock 92's `.hero`) — the clean brand silhouette in the ramp you have equipped,
// breathing over a pulsing ember glow. Home's hero and the done screen's both wear this.
//
// This is NOT the HeatFlame gauge, and the split is deliberate (punchlist 20.1). HOME IS YOU:
// a person's own flame is their identity and their cosmetic, so it is always lit, always the
// silhouette they paid for or earned. THE COAL-BED GAUGE IS FOR CAMPFIRES: a group's fire is
// allowed to go cold, because "nobody has shown up" is exactly the thing it exists to say.
// Home used to render the gauge, which meant your own screen greeted you with dead grey coals.

/** Mock 92's `.hglow` — 210px behind a 132px flame, 170 behind 118. One ratio covers both. */
const GLOW_RATIO = 1.6;

type Props = {
  size?: number;
  /** Overrides the glow box; defaults to `size * GLOW_RATIO`. */
  glowSize?: number;
};

export function PersonalFlame({ size = 132, glowSize }: Props) {
  const reduceMotion = useReduceMotion();
  const uid = useId();
  const glowId = `personalFlameGlow-${uid}`;
  const glow = glowSize ?? size * GLOW_RATIO;

  // Two loops, deliberately out of step with each other: the glow breathes slowly (2.8s) while
  // the flame flicks fast (1.1s). In sync they read as one object scaling; out of sync they read
  // as a flame sitting in its own light.
  const pulse = useSharedValue(0);
  const flick = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
    flick.value = withRepeat(withTiming(1, { duration: 550, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse, flick, reduceMotion]);

  // `.hglow`: opacity .5 -> .92, scale 1 -> 1.05.
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + pulse.value * 0.42,
    transform: [{ scale: 1 + pulse.value * 0.05 }],
  }));
  // `.flame` @keyframes flick: scaleY 1 -> 1.06, scaleX 1 -> .96. Anchored at the base so the
  // flame stretches upward out of a fixed footprint rather than growing in both directions.
  const flameStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: 1 + flick.value * 0.06 }, { scaleX: 1 - flick.value * 0.04 }],
  }));

  return (
    <View style={[styles.wrap, { width: glow, height: glow }]} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, glowStyle]} pointerEvents="none">
        <Svg width={glow} height={glow}>
          <Defs>
            {/* `radial-gradient(circle, rgba(224,97,44,.42), transparent 62%)`. RN has no blur
                filter, so the falloff does that job: the stop at 62% with a soft midpoint is what
                keeps this a glow rather than a visible disc. */}
            <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#E0612C" stopOpacity={0.42} />
              <Stop offset="0.38" stopColor="#E0612C" stopOpacity={0.24} />
              <Stop offset="0.62" stopColor="#E0612C" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={glow / 2} cy={glow / 2} r={glow / 2} fill={`url(#${glowId})`} />
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.flame, flameStyle]} pointerEvents="none">
        {/* Orientation is not this component's business any more: the one flip lives in
            flame-logo, so there is nothing to opt into here (CINDY_SPEC rendering rule 1). */}
        <EquippedFlameSvg width={size} height={size} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  flame: {
    transformOrigin: '50% 100%',
  },
});
