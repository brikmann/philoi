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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

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
//   • SOFT EVERYWHERE. It sits over the live session UI, so it must never compete with the timer —
//     but it IS the screen's centrepiece (an earned or paid Mythic), so it reads clearly. The way
//     to be both is softness, not faintness: NOTHING in this file has a hard edge. No rectangles,
//     no bars, no flat-filled circles — every mark is a radial gradient that fades to nothing at
//     its own boundary, because a hard edge is what makes an overlay read as a BOX rather than as
//     light.
//   • CHEAP. This runs for the whole session, so it must not cost battery. The rim is STATIC SVG
//     (only its opacity breathes), and each effect animates at most six views on the UI thread
//     through Reanimated. Nothing re-renders React per frame.
//   • INERT. pointerEvents="none" throughout — the app stays fully usable underneath.

// ─────────────────────────── the rim ───────────────────────────
//
// Mock 88's in-app aura is `box-shadow: inset 0 0 60px 14px <colour>` — a glow that hugs the very
// edge of the screen and is gone within ~70px. Two earlier builds missed that in opposite ways and
// both produced "the red box" (punchlist 17 P2b, then 20.2):
//
//   1. Four <Rect> edge bands. A linear gradient inside a rectangle has a straight inner boundary,
//      and four of them meet at four visible corners — the literal box.
//   2. One radial at `rx 72% ry 62%`. No edges, but the ramp started 45% of the way out from
//      centre, so the colour washed across a third of the screen and every corner clamped to full
//      opacity. A vignette, not a rim.
//
//   3. One radial at `rx/ry 50%`. Closer, but a PERCENTAGE-radius ellipse cannot give a uniform
//      rim on a non-square screen: rx resolves against width and ry against height, so on a
//      390x844 phone the band came out ~31px at the sides and ~67px top and bottom. That 2.2x
//      asymmetry is precisely the "dark oval vignette" this was reported as (punchlist 21) — it
//      was never a colour problem (every flare in the catalog is bright and saturated), it was
//      the geometry.
//
// So: back to four bands, but composited the way a box-shadow actually is. Each band spans its
// FULL edge — top and bottom run the whole width, left and right the whole height — so they
// OVERLAP in the corners instead of mitring. That is what killed (1): four bands cut to meet at a
// diagonal leave four seams, whereas four overlapping bands leave none, and the corners simply
// receive two contributions and land brightest — which is what an inset shadow does too. The
// thickness is ONE px value, so the rim now reads identically on every edge.
const PEAK_OPACITY = 0.7;

/** Uniform rim thickness — mock 88's 60px blur + 14px spread, scaled off the screen's short edge. */
const RIM_FRACTION_OF_MIN = 0.17;

/** The four edges, as (id suffix, isVertical, runsFromEdge) — one linear ramp each. */
const RIM_EDGES = [
  { dir: 't', vertical: true, fromStart: true },
  { dir: 'b', vertical: true, fromStart: false },
  { dir: 'l', vertical: false, fromStart: true },
  { dir: 'r', vertical: false, fromStart: false },
] as const;

type Props = { colour: string; effect: FlareEffect };

/**
 * The parameterized overlay. One component, driven entirely by the two fields on the catalog item —
 * adding a flare is a catalog entry, never a new component.
 */
export function FlarePerimeter({ colour, effect }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const uid = useId();

  // FULL-BLEED, ESCAPING THE SAFE AREA. <Screen> wraps its children in a SafeAreaView, which insets
  // by PADDING — so StyleSheet.absoluteFill here covered only the inset box, while the Svg inside it
  // was sized to the whole window. Two visible bugs fell out of that one mismatch: the status-bar /
  // notch strip stayed dark (the aura never reached it), and the gradient sat one top-inset lower
  // than the screen's centre, tipping the rim into a lopsided arc. Offsetting by the negative insets
  // puts this layer back on the window box wherever it is mounted. Safe because SafeAreaView insets
  // with padding and RN Views do not clip — nothing above us needs overflow to be visible.
  const frame = {
    position: 'absolute' as const,
    top: -insets.top,
    left: -insets.left,
    width,
    height,
  };

  const rim = Math.round(Math.min(width, height) * RIM_FRACTION_OF_MIN);

  // A slow breath on the whole overlay. Every flare gets it: a perfectly static edge glow reads as
  // a rendering artefact, and the movement is what makes it read as alive. 0.61 -> 1 against the
  // peak reproduces mock 88's `@keyframes breathe{.5 -> .82}` as a ratio, so the rim's strength
  // lives in ONE constant.
  const breath = useSharedValue(0.61);
  useEffect(() => {
    breath.value = withRepeat(withTiming(1, { duration: 3800, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [breath]);
  const breathStyle = useAnimatedStyle(() => ({ opacity: breath.value }));

  return (
    <Animated.View style={[frame, styles.layer, breathStyle]} pointerEvents="none">
      {/* ── the base glow: four soft uniform edge bands, full-bleed behind status bar and nav ── */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          {RIM_EDGES.map(({ dir, vertical, fromStart }) => (
            // Each ramp runs from the screen edge inward to nothing. FOUR stops, not two: a single
            // linear ramp has a perceptible "start" line where it leaves zero, so the bright part
            // is kept hard against the edge and the tail stretched long and thin. That is what
            // makes the light arrive without announcing where it began.
            <LinearGradient
              key={dir}
              id={`flareRim-${dir}-${uid}`}
              x1={vertical ? '0' : fromStart ? '0' : '1'}
              y1={vertical ? (fromStart ? '0' : '1') : '0'}
              x2={vertical ? '0' : fromStart ? '1' : '0'}
              y2={vertical ? (fromStart ? '1' : '0') : '0'}>
              <Stop offset="0" stopColor={colour} stopOpacity={PEAK_OPACITY} />
              <Stop offset="0.32" stopColor={colour} stopOpacity={PEAK_OPACITY * 0.34} />
              <Stop offset="0.62" stopColor={colour} stopOpacity={PEAK_OPACITY * 0.1} />
              <Stop offset="1" stopColor={colour} stopOpacity={0} />
            </LinearGradient>
          ))}
        </Defs>
        {/* Full-length bands, so top/bottom and left/right overlap in the corners rather than
            meeting at a mitre. Dead clear through the middle — the timer never sits in colour. */}
        <Rect x={0} y={0} width={width} height={rim} fill={`url(#flareRim-t-${uid})`} />
        <Rect x={0} y={height - rim} width={width} height={rim} fill={`url(#flareRim-b-${uid})`} />
        <Rect x={0} y={0} width={rim} height={height} fill={`url(#flareRim-l-${uid})`} />
        <Rect x={width - rim} y={0} width={rim} height={height} fill={`url(#flareRim-r-${uid})`} />
      </Svg>

      {/* ── the signature effect ── */}
      <EffectLayer effect={effect} colour={colour} width={width} height={height} />
    </Animated.View>
  );
}

/**
 * The motion layer on its own, sized to whatever box you give it. Exported because the season share
 * card (mock 97) wears the SAME `emberfall` effect as its background — the shared story literally
 * carries the aura the season's capstone flare puts on the lock-in screen. Reused rather than
 * redrawn so the two can never diverge into "similar but not the same" embers.
 */
export function FlareEffectLayer(props: { effect: FlareEffect; colour: string; width: number; height: number }) {
  return <EffectLayer {...props} />;
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
 * THE ONE PRIMITIVE every effect is made of: a soft glowing particle.
 *
 * A radial gradient from `peak` opacity at its centre to fully transparent at its rim, drawn into
 * its own little Svg. This replaces the flat-`backgroundColor` circles and rounded rectangles the
 * effects used to be built from — those have a hard edge by definition, so a "soft drifting blob"
 * rendered as a crisp disc and a "licking tongue" as a lozenge (punchlist 20.2). React Native has
 * no blur filter without a native dependency; a gradient that fades to zero is how you get glow
 * without one, and it costs a single draw call.
 *
 * `stretch` squashes the circle into an ellipse (height = size * stretch) so the same primitive
 * serves round embers and tall flame licks.
 */
function Glow({ size, colour, peak, stretch = 1 }: { size: number; colour: string; peak: number; stretch?: number }) {
  const id = `flareGlow-${useId()}`;
  const h = size * stretch;
  return (
    <Svg width={size} height={h} pointerEvents="none">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={colour} stopOpacity={peak} />
          <Stop offset="0.45" stopColor={colour} stopOpacity={peak * 0.55} />
          <Stop offset="1" stopColor={colour} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {stretch === 1 ? (
        <Circle cx={size / 2} cy={h / 2} r={size / 2} fill={`url(#${id})`} />
      ) : (
        <Ellipse cx={size / 2} cy={h / 2} rx={size / 2} ry={h / 2} fill={`url(#${id})`} />
      )}
    </Svg>
  );
}

/**
 * One drifting soft particle. The shared movement primitive: a Glow that travels a fixed path on a
 * loop, fading in and back out across the trip so it never pops out of existence at either end.
 */
function Drifter({
  colour,
  size,
  left,
  top,
  travelY,
  travelX = 0,
  duration,
  delay,
  peak,
  stretch = 1,
  /** true = ping-pong (breathing in place), false = one-way (falling, rising). */
  reverse = false,
}: {
  colour: string;
  size: number;
  left: number;
  top: number;
  travelY: number;
  travelX?: number;
  duration: number;
  delay: number;
  peak: number;
  stretch?: number;
  reverse?: boolean;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, reverse));
  }, [t, duration, delay, reverse]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: t.value * travelY }, { translateX: t.value * travelX }],
    opacity: Math.sin(t.value * Math.PI),
  }));

  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top }, style]}>
      <Glow size={size} colour={colour} peak={peak} stretch={stretch} />
    </Animated.View>
  );
}

/** Void Smoke — slow drift up the left and right edges. */
function Smoke({ colour, width, height }: { colour: string; width: number; height: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Drifter colour={colour} size={190} left={-105} top={height * 0.58} travelY={-height * 0.26} duration={11000} delay={0} peak={0.5} />
      <Drifter colour={colour} size={160} left={width - 70} top={height * 0.72} travelY={-height * 0.28} duration={13000} delay={2600} peak={0.44} />
      <Drifter colour={colour} size={170} left={-95} top={height * 0.88} travelY={-height * 0.3} duration={15000} delay={5200} peak={0.38} />
    </View>
  );
}

/** Void Plasma — overlapping glows breathing against each other at the corners. */
function Plasma({ colour, width, height }: { colour: string; width: number; height: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Drifter colour={colour} size={230} left={-120} top={-120} travelY={34} duration={7000} delay={0} peak={0.6} reverse />
      <Drifter colour={colour} size={210} left={width - 95} top={height - 110} travelY={-34} duration={8200} delay={1400} peak={0.5} reverse />
      <Drifter colour={colour} size={175} left={width * 0.5 - 88} top={-110} travelY={24} duration={9500} delay={3000} peak={0.4} reverse />
    </View>
  );
}

/**
 * A soft flash that swells and dies. Zeus' Wrath and Stormforge are built from four of these on
 * staggered loops — an arc that actually forked would need a path animation, and at this size the
 * fork would not be visible anyway. What reads is the SUDDENNESS, which is all this does.
 *
 * Previously a 2px hard-edged bar, which is exactly the "hard rect" this file no longer contains:
 * a lightning strike lights the air around it, so what belongs on the edge is a burst of light.
 */
function Zap({ colour, left, top, size, delay }: { colour: string; left: number; top: number; size: number; delay: number }) {
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

  const style = useAnimatedStyle(() => ({ opacity: flash.value, transform: [{ scale: 0.85 + flash.value * 0.3 }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top }, style]}>
      <Glow size={size} colour={colour} peak={0.95} />
    </Animated.View>
  );
}

function Zaps({ colour, width, height }: { colour: string; width: number; height: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Zap colour={colour} left={-60} top={height * 0.22} size={120} delay={0} />
      <Zap colour={colour} left={width - 60} top={height * 0.55} size={130} delay={900} />
      <Zap colour={colour} left={width * 0.3} top={-58} size={116} delay={1800} />
      <Zap colour={colour} left={width * 0.55} top={height - 58} size={110} delay={2500} />
    </View>
  );
}

/** Toxic / Emberfall — glowing droplets running down the edges. */
function Drop({ colour, left, height, duration, delay }: { colour: string; left: number; height: number; duration: number; delay: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.in(Easing.quad) }), -1, false));
  }, [t, duration, delay]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: t.value * height }],
    opacity: 0.9 * Math.sin(t.value * Math.PI),
  }));

  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top: -34 }, style]}>
      {/* Taller than wide — a falling ember stretches along its own path. */}
      <Glow size={22} colour={colour} peak={0.85} stretch={2.2} />
    </Animated.View>
  );
}

function Falling({ colour, width, height }: { colour: string; width: number; height: number }) {
  // Edge lanes only. The old centre lane ran drops down the middle of the screen, which is exactly
  // the full-screen reading the rim is meant to replace (punchlist 15.2).
  const lanes = [-4, 10, 24, width - 26, width - 40];
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
        <Drop key={i} colour={colour} left={left} height={height + 60} duration={timings[i].duration} delay={timings[i].delay} />
      ))}
    </View>
  );
}

/**
 * Inferno / Emberfall Ascendant — light welling up off the bottom edge.
 *
 * This was five rounded rectangles 112px tall, which is the single hardest-edged thing the aura
 * ever drew: a row of flat bars pumping up the screen (punchlist 20.2). A tall soft ellipse
 * anchored below the edge gives the same "fire along the bottom" read with no shape to see —
 * only its top half is on screen, so what's visible is a glow that swells and sinks.
 */
function Lick({ colour, left, w, height, delay }: { colour: string; left: number; w: number; height: number; delay: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [t, delay]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: 0.72 + t.value * 0.42 }],
    opacity: 0.55 + t.value * 0.3,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      // Bottom-anchored and pushed half off-screen: the ellipse's own fade does the shaping, so
      // there is no boundary at the screen edge either.
      style={[{ position: 'absolute', left, bottom: -height * 0.42, transformOrigin: '50% 100%' }, style]}>
      <Glow size={w} colour={colour} peak={0.7} stretch={height / w} />
    </Animated.View>
  );
}

function Flames({ colour, width }: { colour: string; width: number; height: number }) {
  const n = 5;
  const w = width / n;
  // Overlapping by half a lane each side, so the five never read as five separate things.
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: n }, (_, i) => (
        <Lick key={i} colour={colour} left={i * w - w * 0.5} w={w * 2} height={230} delay={i * 420} />
      ))}
    </View>
  );
}

/**
 * The lock-in-screen instance (mounted in src/app/lock-in/index.tsx, in the gym branch and the
 * base branch — they are mutually exclusive returns, so exactly one is ever mounted and it is up
 * for exactly as long as a session runs). Reads the equipped flare and renders nothing at all when
 * the slot is empty — which is the common case, since there is no free flare and most users will
 * never have one equipped. An unequipped user pays one hook read and no views.
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
