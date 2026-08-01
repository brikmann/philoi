import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Colors } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

// The running session's flame (PHILOI_UI_SPEC.md §13 redesign, design-mocks/51 + 52) — a pure
// three-layer flame, NOT the campfire brand mark in flame-icon.tsx (that one has the crossed logs
// and belongs to Philoi's identity). Deliberately carries no goal-tool symbol: the redesign note
// removed the flaming dumbbell/pen ("looked cheap"), so the flame is just fire now.
//
// Paths lifted verbatim from mock 51's SVG so the silhouette matches the design exactly.
const VIEWBOX_WIDTH = 100;
const VIEWBOX_HEIGHT = 120;
const FLAME_ASPECT = VIEWBOX_WIDTH / VIEWBOX_HEIGHT;

const OUTER_PATH = 'M50 4 C59 30 84 40 84 74 a34 34 0 0 1 -68 0 C16 52 29 46 33 35 c3 13 11 15 11 15 C44 31 46 17 50 4Z';
const MID_PATH = 'M52 32 C59 50 76 57 76 78 a26 26 0 0 1 -52 0 c0 -14 9 -19 13 -28 c1.5 9 6 11 6 11 C48 60 50 44 52 32Z';
const CORE_PATH = 'M51 60 C56 70 65 74 65 86 a15 15 0 0 1 -30 0 c0 -8 5 -11 8 -16 c.8 5 3 6 3 6 C46 76 48 68 51 60Z';

// Glow is a 200x200 circle sitting 24px off the bottom of a 240-tall flame in mock 51 — kept as
// ratios so the whole assembly scales off one `height` prop.
const GLOW_RATIO = 200 / 240;
const GLOW_BOTTOM_RATIO = 24 / 240;

type SessionFlameProps = {
  /** Flame height in px; the wrapper and glow scale off this. */
  height?: number;
  /** Gym (mock 52): the flame drops to a dimmed background layer behind the workout log — lower
   * opacity, softer glow, and the bright core is dropped (mock 52 draws only outer + mid). */
  dimmed?: boolean;
};

export function SessionFlame({ height = 240, dimmed = false }: SessionFlameProps) {
  const reduceMotion = useReduceMotion();
  const flick = useSharedValue(0);
  const glowPulse = useSharedValue(0);

  const width = height * FLAME_ASPECT;
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
            <RadialGradient id="flameGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={Colors.coral} stopOpacity={dimmed ? 0.4 : 0.5} />
              <Stop offset="62%" stopColor={Colors.coral} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={glowSize} height={glowSize} fill="url(#flameGlow)" />
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.flame, { opacity: dimmed ? 0.5 : 1 }, flameStyle]}>
        <Svg width={width} height={height} viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}>
          <Path d={OUTER_PATH} fill={Colors.coral} />
          <Path d={MID_PATH} fill={Colors.amber} />
          {!dimmed && <Path d={CORE_PATH} fill={Colors.ember} />}
        </Svg>
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
