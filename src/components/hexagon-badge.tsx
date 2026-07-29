import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, Polygon, RadialGradient, Stop } from 'react-native-svg';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { DIVISION_NUMERAL, RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);

// Pointy-top hexagon, 6 vertices around a (50,50) center at radius 46, viewBox 0 0 100 100 —
// same "fixed viewBox, scaled via width/height props" pattern as flame-icon.tsx.
const HEXAGON_POINTS = '50,4 89.8,27 89.8,73 50,96 10.2,73 10.2,27';
// Same hexagon shape uniformly scaled to ~88% and centered — matches design-mocks/05's
// outer/inner ratio (120x130 outer, 106x115 inner = 0.883) for the two-tone metal split
// (PHILOI_UI_SPEC.md §11) — a thin metal border ring, not a thick inset.
const INNER_HEXAGON_POINTS = '50,9.4 85.15,29.69 85.15,70.31 50,90.6 14.85,70.31 14.85,29.69';

// The Infernal emblem — the brand flame vector, molten (design-mocks/05's `.crest` SVG, same
// path data), NOT a numeral, NOT a crown. Simplified two-tone (outer/mid only, no innermost
// ember path) since at badge scale the third tone reads as noise.
const FLAME_CREST_OUTER = 'M60 20 C74 46 90 62 85 92 C82 108 72 116 60 116 C48 116 37 107 37 92 C37 82 42 76 47 72 C44 84 51 92 59 92 C68 92 72 82 67 72 C60 58 52 44 60 20 Z';
const FLAME_CREST_INNER = 'M60 44 C70 62 78 74 74 92 C72 104 67 110 60 110 C52 110 47 103 47 93 C47 86 50 82 54 80 C52 88 56 94 61 94 C67 94 70 87 67 80 C62 70 56 58 60 44 Z';

type HexagonBadgeProps = {
  tier: RankTierName;
  division: number;
  size?: number;
  /** 0-1; when provided, renders an XP bar underneath toward the next division (see xpProgressRatio). */
  progress?: number;
};

// Ranks — two-tone metal hexagon (outer + inner) + a tier crest, per PHILOI_UI_SPEC.md §11.
// Infernal (renamed from "Legend" — migration 0030) is molten (not metal) — a flame vector
// emblem instead of a numeral, a slow shimmer on its inner fill, and a faint pulsing firelight
// aura. Never relies on color alone: the roman numeral (or flame) inside is what actually
// carries the tier/division, same as the hexagon shape carries "this is a rank."
export function HexagonBadge({ tier, division, size = 40, progress }: HexagonBadgeProps) {
  const metal = RANK_TIER_METAL[tier];
  const isInfernal = tier === 'infernal';

  // Shimmer (Infernal only) — slow color drift on the inner fill toward the shimmer target.
  const shimmer = useSharedValue(0);
  // Two-layer aura pulse (Infernal only, design-mocks/05's a1/a2) — a tight bright layer
  // (0.09->0.20) plus a larger, dimmer outer layer (0.03->0.09) slightly phase-offset, so the
  // glow reads with real depth instead of one flat ring.
  const aura1 = useSharedValue(0);
  const aura2 = useSharedValue(0);

  useEffect(() => {
    if (!isInfernal) return;
    shimmer.value = withRepeat(withSequence(withTiming(1, { duration: 1100 }), withTiming(0, { duration: 1100 })), -1, true);
    aura1.value = withRepeat(withSequence(withTiming(1, { duration: 1400 }), withTiming(0, { duration: 1400 })), -1, true);
    aura2.value = withDelay(
      75,
      withRepeat(withSequence(withTiming(1, { duration: 1400 }), withTiming(0, { duration: 1400 })), -1, true)
    );
  }, [isInfernal, shimmer, aura1, aura2]);

  const innerAnimatedProps = useAnimatedProps(() => ({
    fill: isInfernal ? interpolateColor(shimmer.value, [0, 1], [metal.inner, metal.shimmer ?? metal.inner]) : metal.inner,
  }));

  const aura1Style = useAnimatedStyle(() => ({
    opacity: 0.09 + aura1.value * 0.11,
    transform: [{ scale: 1 + aura1.value * 0.05 }],
  }));

  const aura2Style = useAnimatedStyle(() => ({
    opacity: 0.03 + aura2.value * 0.06,
    transform: [{ scale: 1.04 + aura2.value * 0.1 }],
  }));

  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height: size }}>
        {isInfernal && (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.aura,
                { width: size * 2.1, height: size * 2.1, left: -size * 0.55, top: -size * 0.55 },
                aura2Style,
              ]}>
              <Svg width="100%" height="100%" viewBox="0 0 100 100">
                <Defs>
                  <RadialGradient id="infernalAura2" cx="50%" cy="50%" r="50%">
                    <Stop offset="0%" stopColor={metal.shimmer ?? metal.inner} stopOpacity={1} />
                    <Stop offset="100%" stopColor={metal.shimmer ?? metal.inner} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx="50" cy="50" r="50" fill="url(#infernalAura2)" />
              </Svg>
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.aura,
                { width: size * 1.8, height: size * 1.8, left: -size * 0.4, top: -size * 0.4 },
                aura1Style,
              ]}>
              <Svg width="100%" height="100%" viewBox="0 0 100 100">
                <Defs>
                  <RadialGradient id="infernalAura1" cx="50%" cy="50%" r="50%">
                    <Stop offset="0%" stopColor={metal.shimmer ?? metal.inner} stopOpacity={1} />
                    <Stop offset="100%" stopColor={metal.shimmer ?? metal.inner} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx="50" cy="50" r="50" fill="url(#infernalAura1)" />
              </Svg>
            </Animated.View>
          </>
        )}
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Polygon points={HEXAGON_POINTS} fill={metal.outer} stroke={Colors.line} strokeWidth={3} />
          <AnimatedPolygon points={INNER_HEXAGON_POINTS} animatedProps={innerAnimatedProps} />
          {!isInfernal && <Circle cx="50" cy="85" r="4" fill={metal.inner} />}
        </Svg>
        <View style={styles.numeralOverlay}>
          {isInfernal ? (
            <Svg width={size * 0.28} height={size * 0.28 * 1.25} viewBox="0 0 120 150">
              <Path d={FLAME_CREST_OUTER} fill={metal.outer} />
              <Path d={FLAME_CREST_INNER} fill={Colors.coral} />
            </Svg>
          ) : (
            <Text style={[styles.numeral, { fontSize: size * 0.32, color: metal.numeral }]}>
              {DIVISION_NUMERAL[division] ?? division}
            </Text>
          )}
        </View>
      </View>
      {progress != null && (
        <View style={[styles.progressTrack, { width: size }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: metal.outer }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 4,
  },
  aura: {
    position: 'absolute',
  },
  numeralOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numeral: {
    fontFamily: Fonts.displayHeavy,
  },
  progressTrack: {
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.line,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
});
