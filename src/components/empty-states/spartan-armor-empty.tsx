import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Line, Path } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

// The Challenges tab's "no challenges yet" empty state (PHILOI_UI_SPEC.md §16, mock 41) — an
// empty set of Spartan armor (flame-crested helmet, lambda shield, spear) standing by a lit
// campfire. prefers-reduced-motion → the flames hold a fixed mid-flicker frame instead of licking.
export function SpartanArmorEmpty({ size = 160 }: { size?: number }) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const flick1 = useSharedValue(0);
  const flick2 = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    flick1.value = withRepeat(withSequence(withTiming(1, { duration: 800 }), withTiming(0, { duration: 800 })), -1, true);
    flick2.value = withRepeat(withSequence(withTiming(1, { duration: 575 }), withTiming(0, { duration: 575 })), -1, true);
    glow.value = withRepeat(withSequence(withTiming(1, { duration: 1200 }), withTiming(0, { duration: 1200 })), -1, true);
  }, [reduceMotion, flick1, flick2, glow]);

  const flick1Props = useAnimatedProps(() => ({
    transform: [{ scaleY: 1 + flick1.value * 0.08 }, { scaleX: 1 - flick1.value * 0.05 }],
  }));
  const flick2Props = useAnimatedProps(() => ({
    transform: [{ scaleY: 1 + flick2.value * 0.08 }, { scaleX: 1 - flick2.value * 0.05 }],
  }));
  const glowProps = useAnimatedProps(() => ({ opacity: 0.5 + glow.value * 0.35 }));

  return (
    <Svg width={size} height={size * 1.05} viewBox="0 0 200 210">
      <AnimatedEllipse cx={100} cy={120} rx={78} ry={66} fill="#E0612C" opacity={0.16} animatedProps={reduceMotion ? undefined : glowProps} />

      <G transform="translate(100 150)">
        <Path d="M-26 6 h52 a4 4 0 0 1 4 4 v0 a4 4 0 0 1 -4 4 h-52 a4 4 0 0 1 -4 -4 v0 a4 4 0 0 1 4 -4 Z" fill="#5A3A22" transform="rotate(16)" />
        <Path d="M-26 6 h52 a4 4 0 0 1 4 4 v0 a4 4 0 0 1 -4 4 h-52 a4 4 0 0 1 -4 -4 v0 a4 4 0 0 1 4 -4 Z" fill="#4A2F1C" transform="rotate(-16)" />
        <AnimatedPath
          d="M0 -30 C10 -14 16 -8 16 2 a16 16 0 0 1 -32 0 C-16 -10 -8 -12 -6 -18 c1 6 6 8 6 8 C4 -20 -2 -26 0 -30Z"
          fill="#E0612C"
          animatedProps={reduceMotion ? undefined : flick2Props}
        />
        <AnimatedPath
          d="M2 -18 C8 -8 11 -4 11 3 a11 11 0 0 1 -22 0 C-11 -6 -5 -8 -3 -13 c.5 4 3 5 3 5 C3 -12 -1 -15 2 -18Z"
          fill="#F2A33C"
          animatedProps={reduceMotion ? undefined : flick1Props}
        />
        <Path d="M1 -8 C5 -2 6 0 6 4 a6 6 0 0 1 -12 0 C-6 -1 -2 -3 0 -6Z" fill="#FFD27A" />
      </G>

      {/* Spear + shield are background context, deliberately dimmed and pushed behind the
          helmet (opacity, no outline) so the helmet silhouette below reads as the one clear
          focal shape rather than competing with it at equal visual weight. */}
      <G stroke="#9A6A12" strokeWidth={4} strokeLinecap="round" opacity={0.75}>
        <Line x1={150} y1={40} x2={118} y2={150} />
      </G>
      <Path d="M150 40 l-6 12 l10 -3 z" fill="#C89B4A" opacity={0.75} />

      <G transform="translate(58 150)" opacity={0.8}>
        <Circle r={30} fill="#7A5312" />
        <Circle r={30} fill="none" stroke="#C89B4A" strokeWidth={4} />
        <Circle r={21} fill="none" stroke="#B8863B" strokeWidth={2} />
        <Path d="M-10 12 L0 -14 L10 12" fill="none" stroke="#E8C877" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      </G>

      {/* The helmet — scaled up and given a firm dark outline (punchlist 2, §2: "clearer helmet
          silhouette") so its shape reads unmistakably against the similarly warm-toned
          background instead of blending into one bronze blob. */}
      <G transform="translate(100 90) scale(1.18)">
        <AnimatedPath
          d="M0 -46 C-22 -46 -30 -30 -30 -14 C-22 -26 -10 -28 0 -28 C10 -28 22 -26 30 -14 C30 -30 22 -46 0 -46Z"
          fill="#E0612C"
          animatedProps={reduceMotion ? undefined : flick1Props}
        />
        <AnimatedPath
          d="M0 -42 C-15 -42 -21 -30 -21 -18 C-15 -26 -7 -27 0 -27 C7 -27 15 -26 21 -18 C21 -30 15 -42 0 -42Z"
          fill="#F2A33C"
          animatedProps={reduceMotion ? undefined : flick2Props}
        />
        <Path
          d="M0 -30 C-26 -30 -34 -8 -34 14 L-34 40 C-34 48 -29 53 -22 55 L-22 64 L-13 64 L-13 54 C-13 47 -7 43 0 43 C7 43 13 47 13 54 L13 64 L22 64 L22 55 C29 53 34 48 34 40 L34 14 C34 -8 26 -30 0 -30Z"
          fill="#9A6A12"
          stroke="#4A3406"
          strokeWidth={2.5}
        />
        <Path
          d="M0 -30 C-26 -30 -34 -8 -34 14 L-34 40 C-34 48 -29 53 -22 55 L-22 64 L-13 64 L-13 54 C-13 47 -7 43 0 43 C7 43 13 47 13 54 L13 64 L22 64 L22 55 C29 53 34 48 34 40 L34 14 C34 -8 26 -30 0 -30Z"
          fill="none"
          stroke="#E8C877"
          strokeWidth={1.5}
          opacity={0.6}
        />
        {/* A bright rim highlight along the dome's leading edge — extra depth/pop without a
            second competing color. */}
        <Path d="M-18 -27 C-27 -18 -32 -2 -33 14" fill="none" stroke="#E8C877" strokeWidth={2} strokeLinecap="round" opacity={0.5} />
        <Ellipse cx={-16} cy={8} rx={8} ry={12} fill="#17131F" />
        <Ellipse cx={16} cy={8} rx={8} ry={12} fill="#17131F" />
        <Path d="M-5.5 0 h11 a4 4 0 0 1 4 4 v26 a4 4 0 0 1 -4 4 h-11 a4 4 0 0 1 -4 -4 v-26 a4 4 0 0 1 4 -4 Z" fill="#8A6A2E" />
      </G>
    </Svg>
  );
}
