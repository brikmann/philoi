import { useEffect, useId } from 'react';
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
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useEquipped } from '@/lib/economy/loadout';
import type { FlareEffect } from '@/lib/economy/catalog';

// The lock-in perimeter aura (FLARES_SPEC.md, mock 88).
//
// A flare is the ONLY perimeter aura and there is no free one. SCOPE (punchlist 15.2, reversing
// #86's "app-wide flex"): it is mounted by the LOCK-IN SCREEN and lives only as long as the
// session does. App-wide was tried and was wrong in practice — an aura on every screen forever
// stops reading as a cosmetic and becomes a tint over the whole product. The flex still travels,
// because the session's out-of-app surfaces carry the flare colour too: the iOS Live Activity /
// Dynamic Island frame and the Android notification accent (see lib/live-activity.ts).
//
// Three constraints shape every decision below:
//   • SOFT, NOT FAINT. It sits over the live session UI, so it must never compete with the timer —
//     but it IS the screen's centrepiece (an earned or paid Mythic), so it reads clearly. Peak
//     opacity is PEAK_OPACITY at the very rim, falling to
//     zero within a 40px band — a coloured RIM, not a wash. Every effect is tuned to hug that rim
//     at roughly half its old strength; if you can describe what it is doing without looking for
//     it, it is too strong.
//   • CHEAP. This runs for the whole session, so it must not cost battery. The base glow is STATIC
//     SVG (no animation at all), and each effect animates at most six plain Views on the UI thread
//     through Reanimated. Nothing re-renders React per frame.
//   • INERT. pointerEvents="none" throughout — the app stays fully usable underneath.

// Built to mock 88 + PUNCHLIST_15 §2, which supersede the earlier "faint / thin border" reading.
// The ~0.14 numbers were tuned for the RETIRED app-wide-over-content scope; at lock-in scope this
// is the screen's centrepiece — an earned or paid Mythic, on a sparse screen where the flame
// deliberately dims to ~50% to make room — so it has to read clearly. The spec's words: err bright.
//
// Mock 88's rim is `box-shadow: inset 0 0 42px 8px <colour>` breathing between .5 and .82 opacity
// across a full-screen `inset: 0` layer — a soft inset glow with no edge. There is no EDGE constant
// any more: a band width only means something for rectangles, and the rim is one radial gradient.
const PEAK_OPACITY = 0.82;

type Props = { colour: string; effect: FlareEffect };

/**
 * The parameterized overlay. One component, driven entirely by the two fields on the catalog item —
 * adding a flare is a catalog entry, never a new component.
 */
export function FlarePerimeter({ colour, effect }: Props) {
  const { width, height } = useWindowDimensions();
  const rimId = `flareRim-${useId()}`;

  // A slow breath on the whole overlay. Every flare gets it: a perfectly static edge glow reads as
  // a rendering artefact, and the movement is what makes it read as alive.
  //
  // 0.61→1 against a 0.82 peak reproduces mock 88's `@keyframes breathe{.5 → .82}` exactly
  // (0.61 x 0.82 = 0.5). Expressed as a multiplier rather than absolute stops so the rim's peak
  // lives in ONE constant.
  const breath = useSharedValue(0.61);
  useEffect(() => {
    breath.value = withRepeat(withTiming(1, { duration: 3800, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [breath]);
  const breathStyle = useAnimatedStyle(() => ({ opacity: breath.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.layer, breathStyle]} pointerEvents="none">
      {/* ── the base glow: ONE soft radial rim, static ── */}
      {/* Four hard-edged <Rect> bands at 0.82 was the red-box vignette (punchlist 17 P2b): a linear
          gradient inside a rectangle has a visible straight inner boundary, and four of them meet at
          visible corners. Mock 88's rim is `box-shadow: inset 0 0 42px 8px` — a SOFT inset glow with
          no edge anywhere — so this is one radial gradient over the whole screen instead: fully
          transparent through the middle, easing to the flare colour only as it reaches the rim.
          Full-bleed, behind header and nav, and there is no rectangle to see. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id={rimId} cx="50%" cy="50%" rx="72%" ry="62%">
            <Stop offset="0" stopColor={colour} stopOpacity={0} />
            {/* Nothing at all until well past centre — the content area stays clean. */}
            <Stop offset="0.55" stopColor={colour} stopOpacity={0} />
            <Stop offset="0.82" stopColor={colour} stopOpacity={PEAK_OPACITY * 0.45} />
            <Stop offset="1" stopColor={colour} stopOpacity={PEAK_OPACITY} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${rimId})`} />
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
    // Emberfall Ascendant's bespoke layer (punchlist 15.3) — lava pooling along the bottom edge
    // plus embers raining from the top. Deliberately a composition of the two existing layers
    // rather than a third primitive: the combination is the signature, and one more animated
    // primitive would cost battery for a difference nobody can see at these opacities.
    case 'emberfall':
      return (
        <>
          <Flames colour={colour} width={width} height={height} />
          <Falling colour={colour} width={width} height={height} />
        </>
      );
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
      <Blob colour={colour} size={90} left={-55} top={height * 0.62} travel={-height * 0.26} duration={11000} delay={0} peak={0.5} />
      <Blob colour={colour} size={74} left={width - 32} top={height * 0.75} travel={-height * 0.28} duration={13000} delay={2600} peak={0.44} />
      <Blob colour={colour} size={80} left={-48} top={height * 0.9} travel={-height * 0.3} duration={15000} delay={5200} peak={0.38} />
    </View>
  );
}

/** Void Plasma — two overlapping blobs breathing against each other at the corners. */
function Plasma({ colour, width, height }: { colour: string; width: number; height: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Blob colour={colour} size={110} left={-56} top={-56} travel={34} duration={7000} delay={0} peak={0.62} />
      <Blob colour={colour} size={98} left={width - 42} top={height - 60} travel={-34} duration={8200} delay={1400} peak={0.5} />
      <Blob colour={colour} size={80} left={width * 0.5 - 40} top={-52} travel={24} duration={9500} delay={3000} peak={0.4} />
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

  const style = useAnimatedStyle(() => ({ opacity: flash.value * 0.95 }));
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
      <Zap colour={colour} left={0} top={height * 0.22} w={2} h={44} delay={0} />
      <Zap colour={colour} left={width - 2} top={height * 0.55} w={2} h={56} delay={900} />
      <Zap colour={colour} left={width * 0.3} top={0} w={52} h={2} delay={1800} />
      <Zap colour={colour} left={width * 0.55} top={height - 2} w={42} h={2} delay={2500} />
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
    opacity: 0.85 * Math.sin(t.value * Math.PI),
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left, top: -12, width: 4, height: 12, borderRadius: 2, backgroundColor: colour }, style]}
    />
  );
}

function Falling({ colour, width, height }: { colour: string; width: number; height: number }) {
  // Edge lanes only. The old centre lane ran drops down the middle of the screen, which is exactly
  // the full-screen reading the rim is meant to replace (punchlist 15.2).
  const lanes = [4, 16, 28, width - 8, width - 20];
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
    transform: [{ scaleY: 0.6 + t.value * 0.45 }],
    opacity: 0.4 + t.value * 0.3,
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
          // Mock 88's `.tongue` height. The dimming pass cut this to 44, which is part of the same
          // retired app-wide tuning as the ~0.14 opacities — at lock-in scope the tongues are meant
          // to read (see PUNCHLIST_15 §2). Original note, kept for context: tongues that licked
          // screen were the single biggest reason the flare read as full-screen.
          height: 112,
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
 * The lock-in-screen instance (mounted in src/app/lock-in/index.tsx, in both the base and the gym
 * branch, so it is up for exactly as long as a session runs). Reads the equipped flare and renders
 * nothing at all when the slot is empty — which is the common case, since there is no free flare
 * and most users will never have one equipped. An unequipped user pays one hook read and no views.
 */
/**
 * Whether a flare is equipped — the lock-in screen dims its flame ~50% when one is (punchlist 17
 * P2c). The flare is the centrepiece; a full-strength coloured flame fights it for the same eye.
 */
export function useFlareEquipped(): boolean {
  return Boolean(useEquipped('flare'));
}

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
