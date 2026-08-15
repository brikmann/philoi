import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useEquipped } from '@/lib/economy/loadout';
import type { FlareEffect } from '@/lib/economy/catalog';

// The app-wide perimeter aura (FLARES_SPEC.md, mock 88).
//
// A flare is the ONLY perimeter aura and there is no free one — equipping it paints a faint glow
// around EVERY screen in the app, not just the lock-in screen, which is what makes it the flex the
// premium tiers are selling. The old "God-Mode flare, active only during 90m+ sessions" framing is
// dropped: a cosmetic that appears after an hour and a half is a cosmetic most owners never see.
//
// Three constraints shape every decision below:
//   • FAINT. It sits over live content the user is trying to read. Peak opacity is 0.38 at the
//     screen edge, falling to zero well before the middle.
//   • CHEAP. This is mounted for the entire session on every screen, so it must not cost battery.
//     The base glow is STATIC SVG (no animation at all), and each effect animates at most six plain
//     Views on the UI thread through Reanimated. Nothing re-renders React per frame.
//   • INERT. pointerEvents="none" throughout — the app stays fully usable underneath.

/** How far the glow reaches in from each edge. */
const EDGE = 92;
const PEAK_OPACITY = 0.38;

type Props = { colour: string; effect: FlareEffect };

/**
 * The parameterized overlay. One component, driven entirely by the two fields on the catalog item —
 * adding a flare is a catalog entry, never a new component.
 */
export function FlarePerimeter({ colour, effect }: Props) {
  const { width, height } = useWindowDimensions();

  // A slow breath on the whole overlay. Every flare gets it: a perfectly static edge glow reads as
  // a rendering artefact, and the barely-perceptible movement is what makes it read as alive.
  const breath = useSharedValue(0.82);
  useEffect(() => {
    breath.value = withRepeat(withTiming(1, { duration: 3800, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [breath]);
  const breathStyle = useAnimatedStyle(() => ({ opacity: breath.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.layer, breathStyle]} pointerEvents="none">
      {/* ── the base glow: four gradient bands, static ── */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          {/* Each band fades from full strength AT the edge to nothing inward. x1/y1→x2/y2 point
              inward from their own edge, which is why there are four rather than one reused. */}
          <LinearGradient id="flareTop" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colour} stopOpacity={PEAK_OPACITY} />
            <Stop offset="1" stopColor={colour} stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="flareBottom" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={colour} stopOpacity={PEAK_OPACITY} />
            <Stop offset="1" stopColor={colour} stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="flareLeft" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colour} stopOpacity={PEAK_OPACITY} />
            <Stop offset="1" stopColor={colour} stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="flareRight" x1="1" y1="0" x2="0" y2="0">
            <Stop offset="0" stopColor={colour} stopOpacity={PEAK_OPACITY} />
            <Stop offset="1" stopColor={colour} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={EDGE} fill="url(#flareTop)" />
        <Rect x={0} y={height - EDGE} width={width} height={EDGE} fill="url(#flareBottom)" />
        <Rect x={0} y={0} width={EDGE} height={height} fill="url(#flareLeft)" />
        <Rect x={width - EDGE} y={0} width={EDGE} height={height} fill="url(#flareRight)" />
      </Svg>

      {/* ── the signature effect ── */}
      <EffectLayer effect={effect} colour={colour} width={width} height={height} />
    </Animated.View>
  );
}

function EffectLayer({ effect, colour, width, height }: { effect: FlareEffect; colour: string; width: number; height: number }) {
  switch (effect) {
    case 'smoke':
      return <Smoke colour={colour} width={width} height={height} />;
    case 'zaps':
      return <Zaps colour={colour} width={width} height={height} />;
    case 'falling':
      return <Falling colour={colour} width={width} height={height} />;
    case 'flames':
      return <Flames colour={colour} width={width} height={height} />;
    case 'plasma':
      return <Plasma colour={colour} width={width} height={height} />;
    // The base glow IS the effect for `glow` flares — the breath above carries them.
    case 'glow':
      return null;
  }
}

/**
 * One drifting soft blob. The shared primitive behind smoke and plasma: a big blurred-looking
 * circle (approximated with a heavy borderRadius and low opacity — no blur filter exists in RN
 * without a native dep) that travels a fixed path on a loop.
 */
function Blob({
  colour,
  size,
  left,
  top,
  travel,
  duration,
  delay,
  peak,
}: {
  colour: string;
  size: number;
  left: number;
  top: number;
  travel: number;
  duration: number;
  delay: number;
  peak: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, false));
  }, [t, duration, delay]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: t.value * travel }],
    // Fade in and back out across the travel so a blob never pops out of existence at the end.
    opacity: peak * Math.sin(t.value * Math.PI),
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left, top, width: size, height: size, borderRadius: size / 2, backgroundColor: colour }, style]}
    />
  );
}

/** Void Smoke — slow drift up the left and right edges. */
function Smoke({ colour, width, height }: { colour: string; width: number; height: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Blob colour={colour} size={140} left={-50} top={height * 0.62} travel={-height * 0.5} duration={11000} delay={0} peak={0.16} />
      <Blob colour={colour} size={110} left={width - 60} top={height * 0.75} travel={-height * 0.55} duration={13000} delay={2600} peak={0.14} />
      <Blob colour={colour} size={120} left={-40} top={height * 0.9} travel={-height * 0.6} duration={15000} delay={5200} peak={0.12} />
    </View>
  );
}

/** Void Plasma — two overlapping blobs breathing against each other at the corners. */
function Plasma({ colour, width, height }: { colour: string; width: number; height: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Blob colour={colour} size={170} left={-70} top={-50} travel={70} duration={7000} delay={0} peak={0.2} />
      <Blob colour={colour} size={150} left={width - 90} top={height - 140} travel={-70} duration={8200} delay={1400} peak={0.18} />
      <Blob colour={colour} size={120} left={width * 0.5 - 60} top={-70} travel={50} duration={9500} delay={3000} peak={0.12} />
    </View>
  );
}

/**
 * A short bright bar that flashes and dies. Zeus' Wrath and Stormforge are built from four of these
 * on staggered loops — an arc that actually forked would need a path animation, and at this opacity
 * the fork would not be visible anyway. What reads is the SUDDENNESS, which is all this does.
 */
function Zap({ colour, left, top, w, h, delay }: { colour: string; left: number; top: number; w: number; h: number; delay: number }) {
  const flash = useSharedValue(0);
  useEffect(() => {
    flash.value = withDelay(
      delay,
      withRepeat(
        // Snap on, hold barely, fall off, then a long dark gap — the gap is what makes it a strike
        // rather than a blinking light.
        withSequence(
          withTiming(1, { duration: 70 }),
          withTiming(0.25, { duration: 110 }),
          withTiming(0, { duration: 180 }),
          withTiming(0, { duration: 2600 })
        ),
        -1,
        false
      )
    );
  }, [flash, delay]);

  const style = useAnimatedStyle(() => ({ opacity: flash.value * 0.5 }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left, top, width: w, height: h, borderRadius: 2, backgroundColor: colour }, style]}
    />
  );
}

function Zaps({ colour, width, height }: { colour: string; width: number; height: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Zap colour={colour} left={0} top={height * 0.22} w={3} h={70} delay={0} />
      <Zap colour={colour} left={width - 3} top={height * 0.55} w={3} h={90} delay={900} />
      <Zap colour={colour} left={width * 0.3} top={0} w={80} h={3} delay={1800} />
      <Zap colour={colour} left={width * 0.55} top={height - 3} w={64} h={3} delay={2500} />
    </View>
  );
}

/** Toxic — droplets running down both edges. */
function Drop({ colour, left, height, duration, delay }: { colour: string; left: number; height: number; duration: number; delay: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.in(Easing.quad) }), -1, false));
  }, [t, duration, delay]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: t.value * height }],
    opacity: 0.42 * Math.sin(t.value * Math.PI),
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left, top: -12, width: 4, height: 12, borderRadius: 2, backgroundColor: colour }, style]}
    />
  );
}

function Falling({ colour, width, height }: { colour: string; width: number; height: number }) {
  const lanes = [6, 22, width - 12, width - 28, width * 0.5];
  const timings = [
    { duration: 4200, delay: 0 },
    { duration: 5400, delay: 1500 },
    { duration: 4800, delay: 800 },
    { duration: 6000, delay: 2600 },
    { duration: 5200, delay: 3400 },
  ];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {lanes.map((left, i) => (
        <Drop key={i} colour={colour} left={left} height={height + 24} duration={timings[i].duration} delay={timings[i].delay} />
      ))}
    </View>
  );
}

/** Inferno / Emberfall Ascendant — tongues licking up from the bottom edge. */
function Tongue({ colour, left, w, delay }: { colour: string; left: number; w: number; delay: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [t, delay]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: 0.55 + t.value * 0.75 }],
    opacity: 0.16 + t.value * 0.16,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left,
          bottom: 0,
          width: w,
          height: 110,
          // Rounded top only — a licking tongue, not a bar chart.
          borderTopLeftRadius: w / 2,
          borderTopRightRadius: w / 2,
          backgroundColor: colour,
          transformOrigin: 'bottom',
        },
        style,
      ]}
    />
  );
}

function Flames({ colour, width }: { colour: string; width: number; height: number }) {
  const n = 5;
  const w = width / n;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: n }, (_, i) => (
        <Tongue key={i} colour={colour} left={i * w} w={w} delay={i * 420} />
      ))}
    </View>
  );
}

/**
 * The root-mounted instance. Reads the equipped flare and renders nothing at all when the slot is
 * empty — which is the common case, since there is no free flare and most users will never have
 * one equipped. An unequipped user pays one hook read and no views.
 */
export function EquippedFlarePerimeter() {
  const flare = useEquipped('flare');
  if (!flare?.flare) return null;
  return <FlarePerimeter colour={flare.flare.colour} effect={flare.flare.effect} />;
}

const styles = StyleSheet.create({
  layer: {
    // Above the app's content but below nothing else — it must never intercept a touch, which is
    // what pointerEvents="none" on every node in here guarantees.
    zIndex: 900,
  },
});
