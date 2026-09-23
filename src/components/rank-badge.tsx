import { useEffect, useId, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Colors, Radius } from '@/constants/theme';
import { useMotionActive } from '@/hooks/use-motion-active';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { divisionMarks, RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

const AnimatedStop = Animated.createAnimatedComponent(Stop);
const AnimatedPath = Animated.createAnimatedComponent(Path);

// ─────────────────────────────── the frame (design-mocks/213) ───────────────────────────────
//
// The flat hexagon + roman numeral is gone. This is mock 213's faceted-polygon badge: one cohesive
// frame per tier struck in that tier's metal, the tier's own emblem imprinted in the middle, and
// the DIVISION carried by how much frame there is — bare · studded · winged + crown-spike — with a
// chevron count that matches the numeral. Colour still never carries meaning on its own: the
// emblem says which tier, the chevrons say which division, and both survive a greyscale screenshot.
//
// `OUT` is the medallion, `INN` the engraved inner line. Both are mock 213's exact path data.
const OUT = 'M50 6 L58 14 L74 18 L84 42 L81 66 L50 112 L19 66 L16 42 L26 18 L42 14 Z';
const INN = 'M50 15 L57 22 L70 26 L78 44 L75 62 L50 100 L25 62 L22 44 L30 26 L43 22 Z';
// The highlight the mock lays across the badge's shoulders — the one bit of "this is polished
// metal" that survives without a filter (see the note on the sheen gradient below).
const GLOSS = 'M31 24 Q50 16 69 24';

// The mock draws in a `0 0 100 120` box and leans on `overflow: visible` for exactly one detail —
// division III's crown spike, which rises to y = -1. react-native-svg CLIPS to the viewBox on
// Android, so the box is opened upward by 2 units rather than the spike being clipped off the one
// badge that is supposed to be the flashiest in its tier.
const VIEW_BOX = '0 -2 100 122';
/** height ÷ width for the box above — every call site sizes by WIDTH and gets this much height. */
export const RANK_BADGE_ASPECT = 122 / 100;

// ─────────────────────────────── the tier emblems ───────────────────────────────
//
// One per tier, all drawn around the same (50, 49) centre so the imprint sits in the same place in
// every frame. Ported one-for-one from mock 213's `symbol()`; the helpers below exist because
// three of them are generated shapes in the mock rather than literal path data.

/** The Philoi ember mark — an inverted teardrop, round on top and pointed at the bottom. */
function emberMark(x: number, y: number, s: number) {
  return {
    cy: y - s * 0.15,
    r: s * 0.6,
    tail: `M ${x - s * 0.42} ${y + s * 0.05} L ${x} ${y + s * 0.9} L ${x + s * 0.42} ${y + s * 0.05} Z`,
  };
}

/** A four-point star with concave waists — Platinum's imprint. */
function star4Path(x: number, y: number, r: number): string {
  const q = r * 0.28;
  return (
    `M ${x} ${y - r} C ${x} ${y - q} ${x + q} ${y} ${x + r} ${y}` +
    ` C ${x + q} ${y} ${x} ${y + q} ${x} ${y + r}` +
    ` C ${x} ${y + q} ${x - q} ${y} ${x - r} ${y}` +
    ` C ${x - q} ${y} ${x} ${y - q} ${x} ${y - r} Z`
  );
}

/** One wing of the Divine imprint. `d` is -1 for the left wing, 1 for the right. */
function wingPath(d: number): string {
  return `M50 51 q ${d * 12} -13 ${d * 25} -11 q ${d * -7} 6 ${d * -12} 11 q ${d * 9} -4 ${d * 15} 1 q ${d * -11} 7 ${d * -21} 6 z`;
}

function Emblem({ tier, fill }: { tier: RankTierName; fill: string }) {
  switch (tier) {
    // Bronze carries the brand mark itself — the ember. Mock 213's note: the entry tier had the
    // weakest symbol of the set, and the one symbol this app can never get wrong is its own.
    case 'bronze': {
      const e = emberMark(50, 48, 14);
      return (
        <>
          <Circle cx={50} cy={e.cy} r={e.r} fill={fill} />
          <Path d={e.tail} fill={fill} />
        </>
      );
    }
    // The forge hammer — the tool the whole product's language is built on.
    case 'silver':
      return (
        <>
          <Rect x={48} y={42} width={4} height={31} rx={2} fill={fill} />
          <Path d="M37 35 L63 35 L61 44 L39 44 Z" fill={fill} />
          <Rect x={60} y={36} width={4.5} height={8} rx={1.5} fill={fill} />
          <Rect x={35.5} y={36} width={4.5} height={8} rx={1.5} fill={fill} />
          <Circle cx={50} cy={73} r={2.2} fill={fill} />
        </>
      );
    case 'gold':
      return (
        <>
          <Path d="M35 61 L39 41 L45 53 L50 33 L55 53 L61 41 L65 61 Z" fill={fill} strokeLinejoin="round" />
          <Rect x={35} y={59} width={30} height={7} rx={2} fill={fill} />
          <Circle cx={50} cy={33} r={2.6} fill={fill} />
          <Circle cx={39} cy={41} r={2.2} fill={fill} />
          <Circle cx={61} cy={41} r={2.2} fill={fill} />
        </>
      );
    case 'platinum':
      return <Path d={star4Path(50, 49, 16)} fill={fill} />;
    case 'diamond':
      return <Path d="M50 33 L67 49 L50 69 L33 49 Z" fill={fill} />;
    // Crossed swords over a shield.
    case 'hero':
      return (
        <>
          <Path
            d="M50 35 C43 35 40 43 40 51 C40 60 45 66 50 68 C55 66 60 60 60 51 C60 43 57 35 50 35 Z"
            fill={fill}
            opacity={0.4}
          />
          <Path d="M36 67 L64 38 M64 67 L36 38" stroke={fill} strokeWidth={3.4} strokeLinecap="round" />
          <Path d="M33 64 L40 70 M67 64 L60 70" stroke={fill} strokeWidth={2.6} strokeLinecap="round" />
        </>
      );
    // Atlas under the world.
    case 'titan':
      return (
        <>
          <Circle cx={50} cy={43} r={12} fill={fill} />
          <Path d="M45 54 L41 70 L47 70 L50 57 Z" fill={fill} />
          <Path d="M55 54 L59 70 L53 70 L50 57 Z" fill={fill} />
          <Rect x={40} y={68} width={20} height={4} rx={1.5} fill={fill} />
        </>
      );
    // 'olympian' is the ENUM KEY only — the tier is called Divine everywhere a human reads it
    // (see RANK_TIER_LABEL). Wings under a halo, per mock 213.
    case 'olympian':
      return (
        <>
          <Path d={wingPath(-1)} fill={fill} />
          <Path d={wingPath(1)} fill={fill} />
          <Path d="M40 36 A11 5 0 0 1 60 36" fill="none" stroke={fill} strokeWidth={2.4} />
        </>
      );
    case 'immortal':
      return (
        <Path
          d="M50 34 C40 34 35 42 35 51 C35 57 38 61 42 63 L42 69 L46 69 L46 64 L54 64 L54 69 L58 69 L58 63 C62 61 65 57 65 51 C65 42 60 34 50 34 Z"
          fill={fill}
        />
      );
    // The apex: an ember sun, rays out.
    case 'primordial':
      return (
        <>
          {Array.from({ length: 12 }, (_, k) => {
            const a = (k * 30 * Math.PI) / 180;
            return (
              <Path
                key={k}
                d={`M ${(50 + 13 * Math.cos(a)).toFixed(1)} ${(49 + 13 * Math.sin(a)).toFixed(1)} L ${(50 + 19.5 * Math.cos(a)).toFixed(1)} ${(49 + 19.5 * Math.sin(a)).toFixed(1)}`}
                stroke={fill}
                strokeWidth={2.4}
                strokeLinecap="round"
              />
            );
          })}
          <Circle cx={50} cy={49} r={11} fill="none" stroke={fill} strokeWidth={3} />
          <Circle cx={50} cy={49} r={4} fill={fill} />
        </>
      );
  }
}

// ─────────────────────────────── the division escalation ───────────────────────────────
//
// `marks` is the ROMAN NUMERAL'S VALUE, not the stored division — the two run opposite ways since
// the flip, and `divisionMarks()` is the single place that conversion lives. So III, the top of its
// tier, is also the most ornate badge in it: 3 chevrons, wing-ticks and a crown spike. 0 marks
// covers Primordial, which has no divisions at all, and an unknown division, which must not
// invent one.

function Accents({ marks, metal }: { marks: number; metal: { inner: string; numeral: string } }) {
  if (marks < 2) return null;
  return (
    <>
      {/* II — shoulder studs. */}
      <Circle cx={27} cy={19} r={2.6} fill={metal.inner} stroke={metal.numeral} strokeWidth={0.6} />
      <Circle cx={73} cy={19} r={2.6} fill={metal.inner} stroke={metal.numeral} strokeWidth={0.6} />
      {/* III — outswept wing-ticks and the crown spike. */}
      {marks >= 3 && (
        <>
          <Path d="M84 48 L96 44 L92 54 L84 58 Z" fill={metal.inner} stroke={metal.numeral} strokeWidth={0.6} />
          <Path d="M16 48 L4 44 L8 54 L16 58 Z" fill={metal.inner} stroke={metal.numeral} strokeWidth={0.6} />
          <Path d="M50 8 L54 -1 L50 1 L46 -1 Z" fill={metal.inner} stroke={metal.numeral} strokeWidth={0.6} />
        </>
      )}
    </>
  );
}

/** Chevron `k` (0-based, counting up from the bottom of the stack) in the mock's geometry. */
function chevronPath(k: number): string {
  const y = 101 - k * 6;
  return `M43 ${y} L50 ${y - 5} L57 ${y}`;
}

/**
 * The chevron a division bump just earned, arriving lit.
 *
 * This replaces the incineration the old badge used. That animation burned the TOP stroke off a
 * roman numeral, which was right while climbing counted III → II → I: you were losing a mark. Since
 * the flip you climb I → II → III and the mark is GAINED, so the same move would now play the
 * promotion backwards. The chevron strikes in instead — white-hot, settling to the tier's metal.
 */
function IgnitingChevron({
  index,
  color,
  delay,
  reduceMotion,
}: {
  index: number;
  color: string;
  delay: number;
  reduceMotion: boolean;
}) {
  const strike = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      strike.value = 1;
      return;
    }
    strike.value = withDelay(delay, withTiming(1, { duration: 620 }));
    return () => cancelAnimation(strike);
  }, [delay, reduceMotion, strike]);

  const animatedProps = useAnimatedProps(() => ({
    opacity: strike.value,
    stroke: interpolateColor(strike.value, [0, 0.35, 1], ['#ffffff', '#FFD27A', color]),
    strokeWidth: 2.2 + (1 - strike.value) * 2.6,
  }));

  return (
    <AnimatedPath
      d={chevronPath(index)}
      fill="none"
      animatedProps={animatedProps}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

type RankBadgeProps = {
  tier: RankTierName;
  /**
   * The STORED division (3 = bottom of the tier, 1 = top), exactly as the server sends it — the
   * badge converts to the displayed numeral itself, so no call site has to know the direction.
   * Null/undefined means "unknown", which draws the bare frame and no chevrons rather than
   * fabricating a division (the trap ShareCardFooter documents).
   */
  division?: number | null;
  /** Width in points. Height is this × RANK_BADGE_ASPECT. */
  size?: number;
  /** 0-1; when provided, renders an XP bar underneath toward the next division (xpProgressRatio). */
  progress?: number;
  /**
   * Plays the top chevron in as a strike, this many ms after mount, rather than drawing it
   * settled — the division bump's moment. One caller: the rank-up celebration.
   */
  igniteTopChevronAt?: number | null;
  /** Rendered over the badge, centred. */
  children?: ReactNode;
};

/**
 * A rank, as mock 213 draws it.
 *
 * Primordial keeps the treatment it has always had, now on top of the new frame: a slow shimmer
 * through the molten palette and a two-layer firelight aura, both gated on reduce-motion and on
 * the app's own motion budget.
 */
export function RankBadge({ tier, division, size = 40, progress, igniteTopChevronAt, children }: RankBadgeProps) {
  const metal = RANK_TIER_METAL[tier];
  const isPrimordial = tier === 'primordial';
  const marks = isPrimordial || division == null ? 0 : divisionMarks(division);
  const height = size * RANK_BADGE_ASPECT;

  // Per-instance gradient ids. The old badge hardcoded "primordialAura1", which collides the
  // moment two Primordials are on screen together — and a leaderboard is exactly that.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const metalId = `rbM${uid}`;
  const sheenId = `rbS${uid}`;
  const auraId = `rbA${uid}`;

  const shimmer = useSharedValue(0);
  const aura1 = useSharedValue(0);
  const aura2 = useSharedValue(0);

  const reduceMotion = useReduceMotion();
  const motionActive = useMotionActive();
  useEffect(() => {
    if (!isPrimordial || reduceMotion || !motionActive) return;
    shimmer.value = withRepeat(withSequence(withTiming(1, { duration: 1100 }), withTiming(0, { duration: 1100 })), -1, true);
    aura1.value = withRepeat(withSequence(withTiming(1, { duration: 1400 }), withTiming(0, { duration: 1400 })), -1, true);
    aura2.value = withDelay(
      75,
      withRepeat(withSequence(withTiming(1, { duration: 1400 }), withTiming(0, { duration: 1400 })), -1, true)
    );
    return () => {
      cancelAnimation(shimmer);
      cancelAnimation(aura1);
      cancelAnimation(aura2);
    };
  }, [isPrimordial, reduceMotion, motionActive, shimmer, aura1, aura2]);

  // The shimmer rides the medallion gradient's bright stop rather than a flat fill, because the
  // medallion IS a gradient now — same drift, applied where the light actually is.
  const shimmerStopProps = useAnimatedProps(() => ({
    stopColor: isPrimordial
      ? interpolateColor(shimmer.value, [0, 1], [metal.inner, metal.shimmer ?? metal.inner])
      : metal.inner,
  }));

  const aura1Style = useAnimatedStyle(() => ({
    opacity: 0.09 + aura1.value * 0.11,
    transform: [{ scale: 1 + aura1.value * 0.05 }],
  }));

  const aura2Style = useAnimatedStyle(() => ({
    opacity: 0.03 + aura2.value * 0.06,
    transform: [{ scale: 1.04 + aura2.value * 0.1 }],
  }));

  const igniting = igniteTopChevronAt != null && marks > 0;

  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height }}>
        {isPrimordial && (
          <>
            <Animated.View
              pointerEvents="none"
              style={[styles.aura, { width: size * 2.1, height: size * 2.1, left: -size * 0.55, top: -size * 0.45 }, aura2Style]}>
              <Svg width="100%" height="100%" viewBox="0 0 100 100">
                <Defs>
                  <RadialGradient id={`${auraId}b`} cx="50%" cy="50%" r="50%">
                    <Stop offset="0%" stopColor={metal.shimmer ?? metal.inner} stopOpacity={1} />
                    <Stop offset="100%" stopColor={metal.shimmer ?? metal.inner} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx="50" cy="50" r="50" fill={`url(#${auraId}b)`} />
              </Svg>
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={[styles.aura, { width: size * 1.8, height: size * 1.8, left: -size * 0.4, top: -size * 0.3 }, aura1Style]}>
              <Svg width="100%" height="100%" viewBox="0 0 100 100">
                <Defs>
                  <RadialGradient id={`${auraId}a`} cx="50%" cy="50%" r="50%">
                    <Stop offset="0%" stopColor={metal.shimmer ?? metal.inner} stopOpacity={1} />
                    <Stop offset="100%" stopColor={metal.shimmer ?? metal.inner} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx="50" cy="50" r="50" fill={`url(#${auraId}a)`} />
              </Svg>
            </Animated.View>
          </>
        )}
        <Svg width={size} height={height} viewBox={VIEW_BOX}>
          <Defs>
            <LinearGradient id={metalId} x1="0" y1="0" x2="0.18" y2="1">
              {/* `stopColor` is set STATICALLY as well as through animatedProps, and it is not
                  redundant. Only Primordial's stop ever moves; for the other nine tiers the driver
                  is parked at 0 and the animated value is just `metal.inner` forever. If a future
                  react-native-svg stops honouring animated props on a <Stop> — a virtual node, and
                  the least-exercised animation target in this app — the static prop means every
                  badge still renders in its own metal and only the apex's shimmer goes quiet.
                  Without it the same change would leave a gradient stop with no colour at all. */}
              <AnimatedStop offset="0" stopColor={metal.inner} animatedProps={shimmerStopProps} />
              <Stop offset="1" stopColor={metal.outer} />
            </LinearGradient>
            {/* MOCK 213 LIT ITS METAL WITH feSpecularLighting. react-native-svg has no specular
                lighting primitive, and filters on Android rasterise the whole node — which is not
                something a leaderboard full of these can afford. A single diagonal light-to-dark
                wash over the medallion buys the same "struck metal, lit from the top-left" read
                for one extra path and no filter. */}
            <LinearGradient id={sheenId} x1="0" y1="0" x2="0.62" y2="1">
              <Stop offset="0" stopColor="#ffffff" stopOpacity={0.24} />
              <Stop offset="0.42" stopColor="#ffffff" stopOpacity={0.05} />
              <Stop offset="1" stopColor="#000000" stopOpacity={0.24} />
            </LinearGradient>
          </Defs>

          <Accents marks={marks} metal={metal} />

          <Path d={OUT} fill={`url(#${metalId})`} stroke={metal.numeral} strokeWidth={2.5} strokeLinejoin="round" />
          <Path d={OUT} fill={`url(#${sheenId})`} />
          <Path d={INN} fill="none" stroke={metal.numeral} strokeWidth={1.2} opacity={0.4} strokeLinejoin="round" />

          {/* The imprint: a rim-lit copy lifted a hair, with the dark stamp struck on top. Two
              passes is what makes it read as pressed INTO the metal rather than painted onto it. */}
          <G transform="translate(0,-1.1)" opacity={0.45}>
            <Emblem tier={tier} fill={metal.inner} />
          </G>
          <Emblem tier={tier} fill={metal.numeral} />
          {/* Immortal's sockets are punched clean through to the medallion underneath. */}
          {tier === 'immortal' && (
            <>
              <Circle cx={44} cy={50} r={3.6} fill={`url(#${metalId})`} />
              <Circle cx={56} cy={50} r={3.6} fill={`url(#${metalId})`} />
              <Path d="M50 55 L47.5 60 L52.5 60 Z" fill={`url(#${metalId})`} />
            </>
          )}

          <Path d={GLOSS} fill="none" stroke="#ffffff" strokeWidth={1.6} opacity={0.28} strokeLinecap="round" />

          {Array.from({ length: marks }, (_, k) =>
            igniting && k === marks - 1 ? (
              <IgnitingChevron
                key={k}
                index={k}
                color={metal.text}
                delay={igniteTopChevronAt ?? 0}
                reduceMotion={reduceMotion}
              />
            ) : (
              <Path
                key={k}
                d={chevronPath(k)}
                fill="none"
                stroke={metal.text}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )
          )}
        </Svg>
        {children != null && <View style={styles.overlay}>{children}</View>}
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
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
