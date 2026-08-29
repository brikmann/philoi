import React, { useEffect, useId, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type EasingFunction,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

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

/** Mock 167's `.vig` alpha runs .24-.32 flat across the whole screen. Held at the bottom of that
 *  range because, unlike the mock's static tiles, this sits under a live timer for a full hour. */
const TINT_ALPHA = 0.24;

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
        {/* ── THE FULL-SCREEN WASH (mock 167 `.vig`) ──
            🔴 This deliberately softens the "dead clear through the middle" rule the bands below
            were built on. Every tile in mock 167 paints a flat `position:absolute; inset:0` colour
            across the WHOLE screen — `rgba(255,214,74,.3)` for Zeus, `rgba(40,92,214,.32)` for
            Asgard — and the note above the grid calls the flare the screen's signature, not its
            border. The rim survives underneath it because the mock's marquee still reads
            edge-heavy; what changes is that the middle is no longer empty.

            Kept LOW (see TINT_ALPHA) for the reason the three rejected attempts in the header
            failed: a heavy centre wash is how this became "the red box" in punchlist 17/20.2/21.
            The difference now is that it is a flat, even, low-alpha tint rather than a gradient
            whose ramp clamped to full opacity across a third of the screen. If this reads as a box
            again, TINT_ALPHA is the one number to turn down. */}
        <Rect x={0} y={0} width={width} height={height} fill={colour} opacity={TINT_ALPHA} />
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
    // Zeus and Asgard are deliberately NOT the same renderer — see the note on FlareEffect in
    // catalog.ts. Neither takes `colour`: mock 167 fixes their palettes (gold-on-white,
    // ice-on-white) as part of the identity, and tinting a lightning bolt to the catalog swatch
    // is what made them interchangeable in the first place.
    case 'zaps':
      return <Zeus width={width} height={height} />;
    case 'hammer':
      return <Hammer width={width} height={height} />;
    // Acid Rain is weather, not embers: it falls out of the same storm bank Zeus strikes from,
    // across the whole width. `Falling` stays as the Ascendant's ember rain and nothing else.
    case 'falling':
      return <ToxicRain colour={colour} width={width} height={height} />;
    // All four edges — mock 167's inferno is a full engulf, not a floor fire.
    case 'flames':
      return <Flames colour={colour} width={width} height={height} edges={INFERNO_EDGES} />;
    case 'plasma':
      return <Plasma colour={colour} width={width} height={height} />;
    // Emberfall Ascendant's bespoke layer (punchlist 15.3) — lava pooling along the bottom edge,
    // embers raining into it, motes climbing back out. See Ascendant: it was a plain stack of the
    // two stock layers, which is not what a capstone is.
    case 'emberfall':
      return <Ascendant colour={colour} width={width} height={height} />;
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

// ───────────────────────── never a static first frame ─────────────────────────
//
// THE BLOB BUG (COSMETIC_UI_FIXES §4). Every driver in this file used to be `useSharedValue(0)`
// followed by `withDelay(delay, withRepeat(...))` inside an effect. Two failures came out of that
// one shape, and together they are the whole "flares load as blobs" report:
//
//   • The value SITS at its initial until the delay elapses. A Lick's resting opacity at t=0 is
//     0.55, so the last of the five flame licks was painted as a stationary soft blob for 1.7s
//     before it ever moved. A shape that does not move does not read as fire; it reads as a smudge
//     someone left on the screen.
//   • Every particle starts its loop at exactly the same point in the cycle, so the layer arrives
//     as a set of things in lockstep rather than as weather.
//
// SEEDING the phase rather than delaying the start fixes both: the first painted frame is already
// mid-cycle, and the particles are spread across the loop from the moment they mount. The static
// `opacity: 0` every caller puts UNDER its animated style is the second half of the guarantee —
// if a frame is ever painted before Reanimated has applied anything, it paints nothing at all
// rather than a full-strength glow sitting still.

/** Hoisted so the effects below have stable deps — `Easing.inOut(Easing.sin)` allocates a new
 *  function on every call, which would re-run the loop on every render. */
const EASE_SINE = Easing.inOut(Easing.sin);
const EASE_QUAD = Easing.inOut(Easing.quad);
/** Embers fall at roughly terminal velocity — they do not accelerate the way a water drop does,
 *  which is why the rain used to read as droplets rather than as fire. */
const EASE_LINEAR = Easing.linear;

/**
 * A 0 -> 1 driver that is already `phase` of the way through its cycle on the first frame.
 *
 * `pingPong` alternates 0 -> 1 -> 0 forever; otherwise it runs one-way and snaps back, which is
 * only ever invisible because every one-way consumer's opacity is zero at both ends of the trip.
 *
 * Note the shape: a lead-in withTiming for the remainder of the seeded cycle, THEN the repeat.
 * `withRepeat(..., true)` on its own would ping-pong between the seeded phase and 1 forever
 * instead of between 0 and 1, quietly halving the travel of every particle it touched.
 */
function usePhasedLoop(phase: number, duration: number, easing: EasingFunction, pingPong: boolean) {
  const t = useSharedValue(phase);

  useEffect(() => {
    const leadIn = Math.max(1, duration * (1 - phase));
    t.value = phase;
    t.value = pingPong
      ? withSequence(
          withTiming(1, { duration: leadIn, easing }),
          withRepeat(withSequence(withTiming(0, { duration, easing }), withTiming(1, { duration, easing })), -1, false)
        )
      : withSequence(
          withTiming(1, { duration: leadIn, easing }),
          withTiming(0, { duration: 0 }),
          withRepeat(withTiming(1, { duration, easing }), -1, false)
        );
  }, [t, phase, duration, easing, pingPong]);

  return t;
}

/** Deterministic 0..1 spread for particle `i` — phases, sizes and lane offsets all pull from this
 *  rather than from Math.random(), so a re-render can never reshuffle the weather mid-session. The
 *  golden ratio is what keeps successive values far apart instead of clustering. */
function spread(i: number, offset = 0): number {
  return ((i + 1) * 0.6180339887 + offset) % 1;
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
  phase,
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
  /** 0..1 — how far through its loop this particle already is on the very first frame. */
  phase: number;
  peak: number;
  stretch?: number;
  reverse?: boolean;
}) {
  const t = usePhasedLoop(phase, duration, EASE_SINE, reverse);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: t.value * travelY }, { translateX: t.value * travelX }],
    opacity: Math.sin(t.value * Math.PI),
  }));

  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top, opacity: 0 }, style]}>
      <Glow size={size} colour={colour} peak={peak} stretch={stretch} />
    </Animated.View>
  );
}

/** Void Smoke — slow drift up the left and right edges. */
function Smoke({ colour, width, height }: { colour: string; width: number; height: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Drifter colour={colour} size={190} left={-105} top={height * 0.58} travelY={-height * 0.26} duration={11000} phase={0.28} peak={0.5} />
      <Drifter colour={colour} size={160} left={width - 70} top={height * 0.72} travelY={-height * 0.28} duration={13000} phase={0.62} peak={0.44} />
      <Drifter colour={colour} size={170} left={-95} top={height * 0.88} travelY={-height * 0.3} duration={15000} phase={0.08} peak={0.38} />
    </View>
  );
}

/**
 * VOID PLASMA — mock 167's eight blurred masses drifting and morphing in place.
 *
 * Three corner blobs is what this was, and the mock is emphatic that the motion is a slow PULSE
 * rather than a pop: `@keyframes plasma` scales .9 -> 1.4 -> .9 while opacity breathes .2 -> .85
 * -> .2, over 4.5-7.5s. So each mass ping-pongs (reverse) rather than travelling one way, and the
 * eight fixed spots are lifted straight from the mock's `spots` array so the field covers the whole
 * screen — corners, edge midpoints and two in the middle — instead of clustering at three corners.
 */
function Plasma({ colour, width, height }: { colour: string; width: number; height: number }) {
  // Mock 167: spots = [[6,16],[92,26],[9,72],[88,80],[48,4],[50,94],[28,48],[72,44]] as % of the box.
  const SPOTS = [
    [6, 16], [92, 26], [9, 72], [88, 80],
    [48, 4], [50, 94], [28, 48], [72, 44],
  ] as const;
  const base = Math.min(width, height);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {SPOTS.map(([px, py], i) => {
        // Mock sizes are 42-78px against a 188px-wide tile; scaled to the real screen's short edge
        // so the masses stay the same fraction of the view rather than shrinking to dots.
        const size = (base / MOCK_W) * (42 + spread(i, 0.23) * 36) * 0.62;
        return (
          <Drifter
            key={i}
            colour={colour}
            size={size}
            left={(px / 100) * width - size / 2}
            top={(py / 100) * height - size / 2}
            travelY={(spread(i, 0.51) * 26 - 13) * (base / MOCK_W) * 0.4}
            travelX={(spread(i, 0.77) * 26 - 13) * (base / MOCK_W) * 0.4}
            duration={4500 + spread(i, 0.4) * 3000}
            phase={spread(i, 0.13)}
            peak={0.5}
            reverse
          />
        );
      })}
    </View>
  );
}

/** Mock 167's tile is 188x308. Every size below is expressed as its fraction of that width, so the
 *  bolts scale to a real phone instead of rendering as hairlines. */
const MOCK_W = 188;

/**
 * One jagged polyline. Ported from the mock's `jagged()` — same segment count, same lateral jitter
 * as a fraction of width, same clamp away from the edges.
 */
function jaggedPath(
  w: number,
  h: number,
  startY: number,
  startX: number,
  segs: number,
  jitterFraction: number
): { d: string; endX: number } {
  let x = startX;
  let d = `M ${x.toFixed(1)} ${startY.toFixed(1)}`;
  const span = h - startY;
  for (let i = 1; i <= segs; i++) {
    const y = startY + (span * i) / segs;
    x = Math.max(6, Math.min(w - 6, x + (Math.random() * 2 - 1) * w * jitterFraction));
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return { d, endX: x };
}

/**
 * The mock's `zap` keyframes, exactly: 0% dark, 5% full, 11% almost out, 18% full again, 30% dark,
 * then a long tail of nothing. The double-strike is what makes it read as lightning rather than as
 * a pulse, and the long dark tail is what stops it reading as a strobe.
 */
function useFlash(period: number, phaseMs: number) {
  const flash = useSharedValue(0);
  useEffect(() => {
    flash.value = withDelay(
      phaseMs,
      withRepeat(
        withSequence(
          withTiming(1, { duration: period * 0.05 }),
          withTiming(0.1, { duration: period * 0.06 }),
          withTiming(0.95, { duration: period * 0.07 }),
          withTiming(0, { duration: period * 0.12 }),
          withTiming(0, { duration: period * 0.7 })
        ),
        -1,
        false
      )
    );
  }, [flash, period, phaseMs]);
  return flash;
}

type BoltGeo = { d: string; sparks: string | null; endX: number };

/**
 * Roll one bolt's geometry.
 *
 * A plain module function called ONLY from an effect, never during render. React Compiler is on for
 * this project and its purity rule is right to reject `Math.random()` inside a `useMemo`: a memo may
 * be re-evaluated whenever React likes, so a bolt shaped during render would silently re-roll on
 * unrelated re-renders. Generating in the effect makes the randomness an explicit event — one roll
 * per flash — which is also exactly what the mock's `animationiteration` listener does.
 */
function rollBolt(width: number, height: number, topDown: boolean, impact: boolean): BoltGeo {
  const startY = topDown ? 0 : height * 0.09;
  const startX = topDown ? width * (0.28 + Math.random() * 0.44) : 8 + Math.random() * (width - 16);
  const segs = (topDown ? 6 : 5) + Math.floor(Math.random() * 4);
  const bolt = jaggedPath(width, height, startY, startX, segs, topDown ? 0.32 : 0.3);
  return { d: bolt.d, sparks: impact ? sparkBurst(bolt.endX, height) : null, endX: bolt.endX };
}

function Bolt({
  width,
  height,
  glowColour,
  coreColour,
  glowWidth,
  coreWidth,
  period,
  phaseMs,
  topDown,
  impact = false,
}: {
  width: number;
  height: number;
  glowColour: string;
  coreColour: string;
  glowWidth: number;
  coreWidth: number;
  period: number;
  phaseMs: number;
  /** Asgard: full height, top to bottom. Zeus: starts just under the cloud bank. */
  topDown: boolean;
  /** Asgard only — the ragged shrapnel burst where the hammer lands. */
  impact?: boolean;
}) {
  const flash = useFlash(period, phaseMs);
  const [geo, setGeo] = useState<BoltGeo | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const roll = () => setGeo(rollBolt(width, height, topDown, impact));
    roll();
    // Re-roll 45% into each cycle. The mock's zap keyframe is already dark by 30%, so the new shape
    // is always swapped in behind a black frame and never changes mid-strike.
    const kickoff = setTimeout(
      () => {
        roll();
        interval = setInterval(roll, period);
      },
      phaseMs + period * 0.45
    );
    return () => {
      clearTimeout(kickoff);
      if (interval) clearInterval(interval);
    };
  }, [width, height, topDown, impact, period, phaseMs]);

  const style = useAnimatedStyle(() => ({ opacity: flash.value }));

  if (!geo) return null;

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: 0 }, style]}>
      <Svg width={width} height={height} pointerEvents="none">
        {/* The impact burst sits UNDER the bolt so the core reads as landing on top of it. */}
        {geo.sparks && (
          <>
            <Circle cx={geo.endX} cy={height} r={glowWidth * 1.1} fill={glowColour} opacity={0.42} />
            <Path d={geo.sparks} stroke={glowColour} strokeWidth={glowWidth * 0.42} fill="none" strokeLinecap="round" opacity={0.5} />
          </>
        )}
        <Path d={geo.d} stroke={glowColour} strokeWidth={glowWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.5} />
        <Path d={geo.d} stroke={coreColour} strokeWidth={coreWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {geo.sparks && (
          <Path d={geo.sparks} stroke={coreColour} strokeWidth={coreWidth * 0.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </Svg>
    </Animated.View>
  );
}

/**
 * Asgard's impact shrapnel — seven three-point splinters thrown up in a fan from the strike point.
 * Ported from the mock's `sparks()`: same fan across 0.1pi..0.9pi, same per-splinter angle jitter,
 * same mid-point kink that makes each one ragged rather than a clean ray.
 */
function sparkBurst(cx: number, cy: number): string {
  const n = 7;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.1 + (i / (n - 1)) * 0.8) + (Math.random() * 0.22 - 0.11);
    const len = 14 + Math.random() * 22;
    const mr = len * (0.42 + Math.random() * 0.22);
    const j = Math.random() * 0.6 - 0.3;
    const mx = cx + Math.cos(a + j) * mr;
    const my = cy - Math.sin(a + j) * mr;
    const ex = cx + Math.cos(a) * len;
    const ey = cy - Math.sin(a) * len;
    out.push(`M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${mx.toFixed(1)} ${my.toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)}`);
  }
  return out.join(' ');
}

/**
 * The storm-cloud bank across the very top — Zeus and Toxic Rain both strike out of it.
 *
 * Ten overlapping puffs plus a gradient band behind them, which is the mock's `.cloudbank` +
 * `.cloud` pair. The bolts start BELOW it (at 9% of the height) so they read as coming out of the
 * cloud rather than out of the top of the screen.
 */
function CloudBank({ width, height }: { width: number; height: number }) {
  const id = `cloudband-${useId()}`;
  const r = (width / MOCK_W) * 13;
  const bandH = Math.max(30, height * 0.05);
  const N = 10;
  return (
    <Svg width={width} height={bandH + r * 2} style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2b2836" stopOpacity={1} />
          <Stop offset="1" stopColor="#2b2836" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={bandH} fill={`url(#${id})`} />
      {Array.from({ length: N }, (_, i) => {
        const cx = (i / (N - 1)) * width;
        const scale = 0.9 + spread(i, 0.31) * 0.5;
        const cy = bandH * 0.55;
        return (
          <React.Fragment key={i}>
            <Circle cx={cx} cy={cy} r={r * scale} fill="#34313f" />
            <Circle cx={cx + r * 1.3} cy={cy + r * 0.45} r={r * scale * 0.85} fill="#34313f" />
            <Circle cx={cx - r * 1.3} cy={cy + r * 0.45} r={r * scale * 0.8} fill="#2e2b39" />
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

/**
 * ZEUS' WRATH — gold lightning striking at random points across the whole screen, out of a storm
 * bank at the top. Three bolts, each on its own period, each re-rolled every flash.
 */
function Zeus({ width, height }: { width: number; height: number }) {
  const scale = width / MOCK_W;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <CloudBank width={width} height={height} />
      {[0, 1, 2].map((i) => (
        <Bolt
          key={i}
          width={width}
          height={height}
          glowColour="#FFE87A"
          coreColour="#FFF7D6"
          glowWidth={11 * scale}
          coreWidth={3.2 * scale}
          period={1100 + spread(i, 0.4) * 1300}
          phaseMs={spread(i, 0.17) * 2200}
          topDown={false}
        />
      ))}
    </View>
  );
}

/**
 * ASGARDIAN VALOR — heavier and fewer than Zeus: bolts that fall the FULL height of the screen and
 * land with a ragged shrapnel burst. Thicker strokes, slower periods, no cloud bank (the hammer
 * comes from above the frame, not out of weather).
 */
function Hammer({ width, height }: { width: number; height: number }) {
  const scale = width / MOCK_W;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {[0, 1, 2].map((i) => (
        <Bolt
          key={i}
          width={width}
          height={height}
          glowColour="#8FD4FF"
          coreColour="#EAF7FF"
          glowWidth={12 * scale}
          coreWidth={3.6 * scale}
          period={1400 + spread(i, 0.62) * 1400}
          phaseMs={spread(i, 0.29) * 2600}
          topDown
          impact
        />
      ))}
    </View>
  );
}

/**
 * ONE FALLING EMBER.
 *
 * Was a droplet: `Easing.in(Easing.quad)` down a fixed lane, opacity `sin(t*pi)`. Three things made
 * that read as rain on glass rather than as fire (COSMETIC_UI_FIXES §4) — it ACCELERATED, it fell
 * dead straight, and it was uniformly bright for the whole middle of its trip.
 *
 * An ember does none of those. It has already reached terminal velocity by the time you see it, so
 * it falls at a steady rate (EASE_LINEAR); it is light enough to be pushed sideways, so it sways;
 * and it is BURNING OUT as it falls, so it flares up early and dies away long before it lands.
 * `sway` and `flicker` are per-particle so no two fall alike.
 */
function Ember({
  colour,
  left,
  size,
  height,
  duration,
  phase,
  sway,
  flicker,
}: {
  colour: string;
  left: number;
  size: number;
  height: number;
  duration: number;
  phase: number;
  /** Horizontal travel, px peak-to-peak, over roughly two swings of the fall. */
  sway: number;
  /** Cycles of brightness flutter across the trip. */
  flicker: number;
}) {
  const t = usePhasedLoop(phase, duration, EASE_LINEAR, false);

  const style = useAnimatedStyle(() => {
    const p = t.value;
    // Catch (fast, over the first 10%), burn, then die out across the last 45% — an ember that
    // reached the bottom edge at full strength would look like it hit the floor.
    const life = Math.min(1, p / 0.1) * Math.min(1, (1 - p) / 0.45);
    return {
      transform: [
        { translateY: p * height },
        { translateX: Math.sin(p * Math.PI * 2) * sway },
        // Stretched along its own path, and more so the faster it is going.
        { scaleY: 1 + p * 0.35 },
      ],
      opacity: life * (0.72 + 0.28 * Math.sin(p * Math.PI * 2 * flicker)),
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top: -40, opacity: 0 }, style]}>
      <Glow size={size} colour={colour} peak={0.9} stretch={2.4} />
    </Animated.View>
  );
}

/**
 * Acid Rain / the Emberfall rain layer — embers falling down both edges.
 *
 * EDGE LANES ONLY. The old centre lane ran drops down the middle of the screen, which is exactly
 * the full-screen reading the rim exists to replace (punchlist 15.2). `density` scales the count
 * for the season capstone, which wants weather rather than a drizzle.
 */
function Falling({ colour, width, height, density = 1 }: { colour: string; width: number; height: number; density?: number }) {
  const n = Math.round(7 * density);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: n }, (_, i) => {
        const jitter = spread(i, 0.31);
        // Alternating edges, each lane pushed a little way in from its own side. Half the embers
        // start off-screen at the very edge, which is what stops the two columns reading as two
        // tidy lines of dots.
        const fromLeft = i % 2 === 0;
        const inset = -6 + jitter * 46;
        return (
          <Ember
            key={i}
            colour={colour}
            left={fromLeft ? inset : width - inset - 20}
            size={12 + spread(i, 0.77) * 12}
            height={height + 90}
            duration={3600 + jitter * 3200}
            phase={spread(i)}
            sway={(fromLeft ? 1 : -1) * (8 + spread(i, 0.11) * 16)}
            flicker={2 + Math.round(spread(i, 0.44) * 3)}
          />
        );
      })}
    </View>
  );
}

/**
 * ONE TONGUE OF FLAME, on any of the four edges.
 *
 * Was bottom-only, which is why Inferno licked up from the floor and nowhere else. Mock 167's
 * inferno is a full ENGULF: 22 tongues up from the bottom, 22 raining down from the top, and 20 on
 * each lateral edge. Its lore line is "the edges of your screen catch, and nothing puts them out",
 * and three of the four edges were not catching.
 *
 * Still a soft ellipse rather than the mock's clip-path tongue: the no-hard-edges rule from the
 * header still holds for ambient fire, since a hard lozenge pumping up the screen is exactly what
 * punchlist 20.2 rejected. The engulf comes from coverage and count, not from edge definition.
 */
function Lick({
  colour,
  pos,
  len,
  thick,
  phase,
  peak = 0.7,
  edge = 'bottom',
}: {
  colour: string;
  /** Distance along the edge — acts as `left` on top/bottom, `top` on left/right. */
  pos: number;
  /** How far the tongue reaches INTO the screen. */
  len: number;
  /** Its width across the edge. */
  thick: number;
  phase: number;
  peak?: number;
  edge?: 'bottom' | 'top' | 'left' | 'right';
}) {
  const t = usePhasedLoop(phase, 2400, EASE_QUAD, true);
  const vertical = edge === 'bottom' || edge === 'top';

  const style = useAnimatedStyle(() =>
    vertical
      ? { transform: [{ scaleY: 0.72 + t.value * 0.42 }], opacity: 0.55 + t.value * 0.3 }
      : { transform: [{ scaleX: 0.72 + t.value * 0.42 }], opacity: 0.55 + t.value * 0.3 }
  );

  // Anchored half off-screen on its own edge, so the ellipse's own fade does the shaping and no
  // boundary is visible where it meets the screen edge — the same trick the bottom-only version used.
  const anchor =
    edge === 'bottom'
      ? { left: pos, bottom: -len * 0.42, transformOrigin: '50% 100%' as const }
      : edge === 'top'
        ? { left: pos, top: -len * 0.42, transformOrigin: '50% 0%' as const }
        : edge === 'left'
          ? { top: pos, left: -len * 0.42, transformOrigin: '0% 50%' as const }
          : { top: pos, right: -len * 0.42, transformOrigin: '100% 50%' as const };

  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', opacity: 0 }, anchor, style]}>
      {vertical ? (
        <Glow size={thick} colour={colour} peak={peak} stretch={len / thick} />
      ) : (
        <Glow size={len} colour={colour} peak={peak} stretch={thick / len} />
      )}
    </Animated.View>
  );
}

/**
 * INFERNO FLARE — fire on every edge at once.
 *
 * `edges` defaults to the bottom alone because Emberfall Ascendant reuses this as its lava pool and
 * wants a floor, not an engulf. Inferno passes all four.
 *
 * COUNTS ARE THE MOCK'S, LITERALLY: 22 tongues on each of the top and bottom edges, 20 on each
 * lateral. That is 84 animated views for one flare, which is far past the "at most six" this file's
 * header budgets — and it is what mock 167 draws, so it is what ships. Each is a single
 * transform+opacity driven on the UI thread by Reanimated with no React render per frame, which is
 * the cheapest shape 84 of anything can take. If a device ever shows this costing frames, the fix
 * is these two numbers and nothing else.
 */
const PER_EDGE_VERTICAL = 22;
const PER_EDGE_LATERAL = 20;

function Flames({
  colour,
  width,
  height,
  tall = 230,
  peak,
  edges = ['bottom'],
  count,
}: {
  colour: string;
  width: number;
  height: number;
  tall?: number;
  peak?: number;
  edges?: readonly ('bottom' | 'top' | 'left' | 'right')[];
  /** Overrides the per-edge count. Emberfall Ascendant uses this — see the note below. */
  count?: number;
}) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {edges.map((edge, e) => {
        const vertical = edge === 'bottom' || edge === 'top';
        const span = vertical ? width : height;
        const perEdge = count ?? (vertical ? PER_EDGE_VERTICAL : PER_EDGE_LATERAL);
        const lane = span / perEdge;
        return Array.from({ length: perEdge }, (_, i) => (
          <Lick
            key={`${edge}-${i}`}
            colour={colour}
            edge={edge}
            // Overlapping by half a lane each side, so the set never reads as N separate things.
            pos={i * lane - lane * 0.5}
            len={tall * (0.78 + spread(i, e * 0.17) * 0.44)}
            thick={lane * 2}
            phase={spread(i, 0.23 + e * 0.11)}
            peak={peak}
          />
        ));
      })}
    </View>
  );
}

const INFERNO_EDGES = ['bottom', 'top', 'left', 'right'] as const;

/**
 * ONE ACID STREAK.
 *
 * Mock 167 draws acid rain as a 1.6px-wide bar 12-25px tall carrying a three-stop vertical gradient
 * — near-transparent at the head, full #9DFF5A at 55%, dark green at the tail — which is what makes
 * it read as a falling streak rather than as a dot. So this is the one mark in the file that is
 * legitimately a hard-edged rect: at 1.6px wide there is no interior for a gradient to be soft in,
 * and the gradient it does carry runs along its LENGTH, which is where the softness lives.
 */
function Drop({
  colour,
  left,
  w,
  len,
  travel,
  duration,
  phase,
}: {
  colour: string;
  left: number;
  w: number;
  len: number;
  travel: number;
  duration: number;
  phase: number;
}) {
  const id = `acid-${useId()}`;
  const t = usePhasedLoop(phase, duration, EASE_LINEAR, false);
  // Mock 167 `@keyframes fall`: opacity 0 at 0%, 1 by 12%, held to 90%, 0 at 100%.
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: t.value * travel }],
    opacity: Math.min(t.value / 0.12, 1) * (1 - Math.max(0, (t.value - 0.9) / 0.1)),
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top: 0, opacity: 0 }, style]}>
      <Svg width={w} height={len} pointerEvents="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colour} stopOpacity={0.08} />
            <Stop offset="0.55" stopColor={colour} stopOpacity={1} />
            <Stop offset="1" stopColor="#2E7D32" stopOpacity={0.25} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={len} rx={w / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * TOXIC / ACID RAIN — mock 167: a storm bank across the top with drops falling out of it, the full
 * width of the screen.
 *
 * What this replaces: the shared `Falling` ember layer, which ran seven drops down two narrow edge
 * lanes and never drew a cloud. That is a drizzle at the border; the mock is weather across the
 * whole screen, out of the same cloud bank Zeus strikes from.
 */
function ToxicRain({ colour, width, height }: { colour: string; width: number; height: number }) {
  // Mock 167: 24 drops, `top:7%`, width 1.6px, height 12-25px, on a 188px-wide tile.
  const N = 24;
  const scale = width / MOCK_W;
  const bandH = Math.max(30, height * 0.05);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <CloudBank width={width} height={height} />
      {Array.from({ length: N }, (_, i) => {
        const len = (12 + spread(i, 0.53) * 13) * scale;
        return (
          <Drop
            key={i}
            colour={colour}
            left={spread(i, 0.19) * width}
            w={Math.max(1.6, 1.6 * scale)}
            len={len}
            // The mock's drops start at 7% of the height, inside the cloud bank, and `fall` carries
            // them 300px down a 308px box — i.e. clear off the bottom.
            travel={height - bandH * 0.5 + len}
            duration={1200 + spread(i, 0.37) * 1200}
            phase={spread(i, 0.71)}
          />
        );
      })}
    </View>
  );
}

/**
 * EMBERFALL ASCENDANT — the season capstone's own motion layer (mocks 119 + 126 + 167).
 *
 * It used to be literally `<Flames/><Falling/>`, the two stock layers stacked, which is why it read
 * as a blob field rather than as the mythic it is: the same five licks and the same five droplets
 * everyone else's flare has, only twice as busy. The capstone should not share a motion layer with
 * a box drop — the comment in catalog.ts has said so all along; this is the layer catching up.
 *
 * Three parts, and the ORDER is the effect: a deep lava pool banked along the bottom, heavier
 * weather of embers falling into it, and — the ascendant half of the name — motes lifting back OUT
 * of the pool and climbing the edges. Fall, land, rise.
 */
function Ascendant({ colour, width, height }: { colour: string; width: number; height: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* The pool: taller and stronger than Inferno's, because it is the floor everything else
          falls into rather than the whole effect on its own. */}
      {/* FIVE wide licks, not Inferno's 22. The mock's 22/20 is Inferno's own spec — a wall of
          fire on every edge — whereas this is the capstone's lava POOL, a floor for the embers to
          fall into. At 22 the lane width drops to ~37px and the pool renders as a hard sawtooth
          band across the bottom of the screen instead of a soft swell, which is exactly the
          "row of flat bars" punchlist 20.2 removed. Caught on device. */}
      <Flames colour={colour} width={width} height={height} tall={300} peak={0.8} count={5} />
      <Falling colour={colour} width={width} height={height} density={1.7} />
      {/* MIDDLE RISERS. Mock 167's marquee builds the ascendant field in two passes — 24 embers up
          the two edges AND 20 more up the middle third — and only the edge pass existed here, which
          is why the capstone read as two bright margins with a dead centre. The middle band is what
          makes it a field you are inside rather than a frame you are looking at.

          Launched across 24-76% of the width, exactly the mock's `x = 24 + Math.random()*52`. */}
      {Array.from({ length: 6 }, (_, i) => (
        <Drifter
          key={`mid-${i}`}
          colour={colour}
          size={40 + spread(i, 0.61) * 34}
          left={width * (0.24 + spread(i, 0.29) * 0.52)}
          top={height - 90}
          travelY={-height * (0.42 + spread(i, 0.83) * 0.24)}
          travelX={spread(i, 0.47) * 26 - 13}
          duration={6400 + spread(i, 0.11) * 3400}
          phase={spread(i, 0.67)}
          peak={0.42}
        />
      ))}
      {/* Rising motes up the two edges, launched from inside the pool and climbing about a third of
          the screen. Slow and few: this is the part that has to read as ASCENT, and ascent is
          legible only if it is slower than the fall above it. */}
      {Array.from({ length: 4 }, (_, i) => (
        <Drifter
          key={`rise-${i}`}
          colour={colour}
          size={54 + spread(i, 0.5) * 40}
          left={i % 2 === 0 ? -18 + spread(i, 0.19) * 70 : width - 90 - spread(i, 0.19) * 60}
          top={height - 120}
          travelY={-height * (0.3 + spread(i, 0.66) * 0.16)}
          travelX={(i % 2 === 0 ? 1 : -1) * 22}
          duration={7200 + spread(i, 0.37) * 3600}
          phase={spread(i, 0.05)}
          peak={0.5}
        />
      ))}
    </View>
  );
}

// ─────────────────── the APPLIED particle layer (COSMETIC_UI_FIXES §5) ───────────────────
//
// PARTICLE cosmetics have been buyable, equippable and box-droppable since 21f, and until now
// NOTHING painted one. `item-art.tsx` drew the inventory thumbnail and `catalog.ts` carried six of
// them, but the applied component simply did not exist — so a user could open a Mythic, equip Void
// Smoke, and see exactly no difference anywhere in the product. This is that missing surface.
//
// It lives in this file on purpose rather than beside the flame: a particle field is the same
// problem the flare already solved (soft glows on cheap UI-thread loops, never a hard edge, never
// a touch target), and the `Glow` / `Drifter` / `usePhasedLoop` primitives above are the answer to
// it. A second implementation next to SessionFlame would drift from this one within a season.
//
// SCOPED TO THE FLAME, not to the screen. The flare owns the perimeter; particles own the ~1.8x
// box around the flame itself, so the two can be equipped together without becoming one wash.

/** How an equipped particle cosmetic moves. Keyed by id, like CARD_TEXTURE — the lore names a
 *  specific behaviour ("they rise", "the quiet snow", "it hunts"), and rarity cannot express it. */
type ParticleMotion = 'rise' | 'fall' | 'swarm' | 'arc' | 'flicker' | 'coil';

const PARTICLE_MOTION: Record<string, ParticleMotion> = {
  'particle-base-spark': 'rise',
  'particle-floating-sparks': 'rise',
  'particle-falling-ash': 'fall',
  'particle-ember-swarm': 'swarm',
  'particle-solar-flares': 'arc',
  'particle-lightning-tendrils': 'flicker',
  'particle-void-smoke': 'coil',
  'particle-emberfall-ascendant': 'rise',
};

/**
 * Particle count per motion — mock 166's own numbers, exactly.
 *
 * These used to be `{rise:7, fall:8, swarm:8, arc:4, flicker:5, coil:4}`, "capped low and
 * deliberately". The cap is what made every set read as a handful of drifting dots rather than the
 * field the mock draws: Ember Swarm at 8 cannot look like a swarm, and Falling Ash at 8 cannot look
 * like snow. Each mote is one small Svg on a UI-thread transform, so 24 of them is still cheaper
 * than a single re-rendering React tree.
 */
const PARTICLE_COUNT: Record<ParticleMotion, number> = {
  rise: 16,
  fall: 18,
  swarm: 24,
  arc: 10,
  flicker: 8,
  coil: 15,
};

/** Mock 166's stage is 190px tall. Every px distance below is scaled against it so the motion keeps
 *  its proportions on a box of any size. */
const MOCK_STAGE_H = 190;
/**
 * Mock motes are solid dots; ours are radial gradients that fade to nothing at their rim, so only
 * the inner ~45% of the box reads as the mote. This multiplier sizes the BOX so the visible core
 * lands at the mock's stated diameter — without it every particle set renders at roughly half the
 * size the mock draws.
 */
const MOTE_BOX = 2.2;
/** The emission point — the flame's own tip, as a fraction of the box height from the top. Mock 166
 *  puts every emitter at `bottom: 44%`. */
const FLAME_Y = 0.56;

/**
 * The field itself, sized from its own layout so a caller only has to drop it behind a flame.
 *
 * `from` is the body colour and `to` the hot one; alternating between them across the particles is
 * what keeps a two-stop palette reading as two stops (Falling Ash is grey motes with pale white
 * ones through it, not a uniform grey) without paying for a gradient per particle.
 */
export function FlameParticleField({ from, to, motion }: { from: string; to: string; motion: ParticleMotion }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  };

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {box.w > 0 && box.h > 0 && <Particles from={from} to={to} motion={motion} w={box.w} h={box.h} />}
    </View>
  );
}

/**
 * ONE MOTE — the mock's `radial-gradient(circle, HOT, BODY 70%, transparent)`.
 *
 * Two stops rather than `Glow`'s one, because that is what mock 166 specifies for every particle
 * set, and the two-tone core is most of why Falling Ash reads as ash and Ember Swarm as embers.
 */
function Mote({ size, hot, body, peak = 1 }: { size: number; hot: string; body: string; peak?: number }) {
  const id = `mote-${useId()}`;
  return (
    <Svg width={size} height={size} pointerEvents="none">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={hot} stopOpacity={peak} />
          <Stop offset="0.7" stopColor={body} stopOpacity={peak * 0.35} />
          <Stop offset="1" stopColor={body} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

/** Floating Sparks + Falling Ash: a straight travel with a fade in and a long fade out. */
function Travel({
  hot,
  body,
  size,
  left,
  top,
  dx,
  dy,
  duration,
  phase,
  easing,
  fadeIn,
  peak,
  grow,
}: {
  hot: string;
  body: string;
  size: number;
  left: number;
  top: number;
  dx: number;
  dy: number;
  duration: number;
  phase: number;
  easing: EasingFunction;
  fadeIn: number;
  peak: number;
  grow?: readonly [number, number];
}) {
  const t = usePhasedLoop(phase, duration, easing, false);
  const style = useAnimatedStyle(() => {
    const o = t.value < fadeIn ? t.value / fadeIn : 1 - (t.value - fadeIn) / (1 - fadeIn);
    const sc = grow ? grow[0] + (grow[1] - grow[0]) * t.value : 1;
    return {
      transform: [{ translateX: t.value * dx }, { translateY: t.value * dy }, { scale: sc }],
      opacity: Math.max(0, o) * peak,
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top, opacity: 0 }, style]}>
      <Mote size={size} hot={hot} body={body} />
    </Animated.View>
  );
}

/**
 * EMBER SWARM — a true orbit, which is the whole point of the set and the thing it did not do.
 *
 * Mock 166: `@keyframes swarm { rotate(0) translateY(-r) -> rotate(360deg) translateY(-r) }` — the
 * mote is pushed out to radius r and then carried all the way round. What was here instead was a
 * short ping-pong hop, so the "swarm that circulates the fire" hovered beside it and circled
 * nothing. Transform ORDER matters and matches the mock: rotate first, then translate in the
 * rotated frame.
 */
function Orbit({
  hot,
  body,
  size,
  cx,
  cy,
  radius,
  duration,
  phase,
}: {
  hot: string;
  body: string;
  size: number;
  cx: number;
  cy: number;
  radius: number;
  duration: number;
  phase: number;
}) {
  const t = usePhasedLoop(phase, duration, EASE_LINEAR, false);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${t.value * 360}deg` }, { translateY: -radius }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: cx - size / 2, top: cy - size / 2 }, style]}>
      <Mote size={size} hot={hot} body={body} />
    </Animated.View>
  );
}

/**
 * SOLAR FLARES — arcs that loop off the flame and snap back.
 *
 * Mock 166's `solar` keyframes hold a FIXED angle and animate distance: translateX 8 -> 64 -> 10,
 * scale .4 -> 1 -> .3. The outer view carries the static rotation and the inner one the travel,
 * which is the only way to get "out and back along a spoke" instead of a drift.
 */
function SolarArc({
  hot,
  body,
  size,
  cx,
  cy,
  angle,
  reach,
  duration,
  phase,
}: {
  hot: string;
  body: string;
  size: number;
  cx: number;
  cy: number;
  angle: number;
  reach: number;
  duration: number;
  phase: number;
}) {
  const t = usePhasedLoop(phase, duration, EASE_SINE, false);
  const style = useAnimatedStyle(() => {
    // 0 -> .55 travels out to `reach`; .55 -> 1 snaps back almost to the flame.
    const out = t.value < 0.55;
    const k = out ? t.value / 0.55 : (t.value - 0.55) / 0.45;
    const x = out ? reach * (0.125 + 0.875 * k) : reach * (1 - 0.844 * k);
    const sc = out ? 0.4 + 0.6 * k : 1 - 0.7 * k;
    const o = t.value < 0.3 ? t.value / 0.3 : 1 - (t.value - 0.3) / 0.7;
    return { transform: [{ translateX: x }, { scale: sc }], opacity: Math.max(0, o) };
  });
  return (
    <View
      pointerEvents="none"
      // Centred exactly on the flame point so the rotation origin IS the emission point. With
      // `left: cx` the view's own centre — and therefore the spoke's pivot — sat half a mote to
      // the right, which fans the arcs off-centre once the motes are scaled up from the mock's 6px.
      style={{ position: 'absolute', left: cx - size / 2, top: cy - size / 2, transform: [{ rotate: `${angle}deg` }] }}>
      <Animated.View style={[{ opacity: 0 }, style]}>
        <Mote size={size} hot={hot} body={body} />
      </Animated.View>
    </View>
  );
}

/**
 * LIGHTNING TENDRILS — the mock's jagged glyph, not a ball of light.
 *
 * `.bolt` in mock 166 is a 2px-wide bar with a `clip-path` polygon cut into a fork, gradient-filled
 * cyan-to-white, rotated to a random angle about its BOTTOM edge so it reaches outward from the
 * flame. The path below is that clip-path, point for point.
 */
function Tendril({
  hot,
  body,
  cx,
  cy,
  angle,
  len,
  duration,
  phase,
}: {
  hot: string;
  body: string;
  cx: number;
  cy: number;
  angle: number;
  len: number;
  duration: number;
  phase: number;
}) {
  const id = `tendril-${useId()}`;
  const w = Math.max(2, len * 0.075);
  const flash = useSharedValue(0);
  useEffect(() => {
    // mock `@keyframes bolt`: 0 -> 8% on -> 16% .2 -> 24% .9 -> 40% out, then dark for the rest.
    const d = duration;
    flash.value = withDelay(
      phase * d,
      withRepeat(
        withSequence(
          withTiming(1, { duration: d * 0.08 }),
          withTiming(0.2, { duration: d * 0.08 }),
          withTiming(0.9, { duration: d * 0.08 }),
          withTiming(0, { duration: d * 0.16 }),
          withTiming(0, { duration: d * 0.6 })
        ),
        -1,
        false
      )
    );
  }, [flash, duration, phase]);
  const style = useAnimatedStyle(() => ({ opacity: flash.value }));
  // clip-path: polygon(40% 0, 60% 0, 45% 45%, 70% 45%, 30% 100%, 50% 55%, 30% 55%)
  const d = `M ${0.4 * w} 0 L ${0.6 * w} 0 L ${0.45 * w} ${0.45 * len} L ${0.7 * w} ${0.45 * len} L ${0.3 * w} ${len} L ${0.5 * w} ${0.55 * len} L ${0.3 * w} ${0.55 * len} Z`;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: cx - w / 2,
          top: cy - len,
          transformOrigin: '50% 100%' as const,
          transform: [{ rotate: `${angle}deg` }],
          opacity: 0,
        },
        style,
      ]}>
      <Svg width={w} height={len} pointerEvents="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={hot} />
            <Stop offset="1" stopColor={body} />
          </LinearGradient>
        </Defs>
        <Path d={d} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * VOID SMOKE — gothic, and serpentine rather than straight.
 *
 * Mock 166 coils it: at 50% the veil is at `(dx, -58)`, at 100% at `(-dx, -128)` — it sways one way
 * and then back as it climbs, which is what makes it a coil rather than a rising blob. It also
 * swells hard (scale .5 -> 1.4 -> 2.2) and stays heavy and dark. The old version rose in a straight
 * line at constant size, which is why "a funeral veil coiling upward" read as four grey circles.
 */
function Veil({
  hot,
  body,
  size,
  left,
  top,
  dx,
  rise,
  duration,
  phase,
}: {
  hot: string;
  body: string;
  size: number;
  left: number;
  top: number;
  dx: number;
  rise: number;
  duration: number;
  phase: number;
}) {
  const t = usePhasedLoop(phase, duration, EASE_SINE, false);
  const style = useAnimatedStyle(() => {
    // The coil: out to +dx by halfway, then back through zero to -dx at the top.
    const x = t.value < 0.5 ? dx * (t.value / 0.5) : dx * (1 - 2 * ((t.value - 0.5) / 0.5));
    const y = t.value < 0.5 ? rise * 0.45 * (t.value / 0.5) : rise * (0.45 + 0.55 * ((t.value - 0.5) / 0.5));
    const sc = t.value < 0.5 ? 0.5 + 0.9 * (t.value / 0.5) : 1.4 + 0.8 * ((t.value - 0.5) / 0.5);
    const o = t.value < 0.18 ? (t.value / 0.18) * 0.82 : 0.82 * (1 - (t.value - 0.18) / 0.82);
    return { transform: [{ translateX: x }, { translateY: y }, { scale: sc }], opacity: Math.max(0, o) };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top, opacity: 0 }, style]}>
      <Mote size={size} hot={hot} body={body} peak={0.9} />
    </Animated.View>
  );
}

function Particles({ from, to, motion, w, h }: { from: string; to: string; motion: ParticleMotion; w: number; h: number }) {
  const n = PARTICLE_COUNT[motion];
  // `to` is the hot colour and `from` the body. Mock 166 fills every mote
  // `radial-gradient(circle, HOT, BODY 70%, transparent)`, and the catalog's two stops already ARE
  // that pair for all six sets — checked one by one against the mock rather than assumed.
  const hot = to;
  const body = from;
  const cx = w / 2;
  // The emission point is the flame's own tip, not the middle of the box.
  const fy = h * FLAME_Y;
  const k = h / MOCK_STAGE_H;

  switch (motion) {
    // FLOATING SPARKS — off the flame's tip, climbing and spreading. Mock: left 44-56%, bottom 44%.
    case 'rise':
      return (
        <>
          {Array.from({ length: n }, (_, i) => {
            const j = spread(i);
            return (
              <Travel
                key={i}
                hot={hot}
                body={body}
                size={(3 + j * 3) * k * MOTE_BOX}
                left={w * (0.44 + spread(i, 0.31) * 0.12)}
                top={fy}
                dx={(spread(i, 0.63) * 36 - 18) * k}
                dy={-140 * k}
                duration={2000 + j * 1800}
                phase={spread(i, 0.17)}
                easing={EASE_QUAD}
                fadeIn={0.18}
                peak={1}
                grow={[0.5, 1] as const}
              />
            );
          })}
        </>
      );

    // FALLING ASH — the quiet snow, falling across the WHOLE width from the very top. The old
    // version put it in two lanes either side of centre, which is why it read as emitting from the
    // flame rather than settling onto it.
    case 'fall':
      return (
        <>
          {Array.from({ length: n }, (_, i) => {
            const j = spread(i);
            return (
              <Travel
                key={i}
                hot={hot}
                body={body}
                size={(2.5 + j * 2.5) * k * MOTE_BOX}
                left={spread(i, 0.41) * w}
                top={-10 * k}
                dx={(spread(i, 0.77) * 30 - 15) * k}
                dy={150 * k}
                duration={3000 + j * 2500}
                phase={spread(i, 0.29)}
                easing={EASE_LINEAR}
                fadeIn={0.15}
                peak={0.9}
              />
            );
          })}
        </>
      );

    // EMBER SWARM — 24 motes circling the fire at 30-54px.
    case 'swarm':
      return (
        <>
          {Array.from({ length: n }, (_, i) => (
            <Orbit
              key={i}
              hot={hot}
              body={body}
              size={(2.5 + spread(i, 0.19) * 3) * k * MOTE_BOX}
              cx={cx}
              cy={fy}
              radius={(30 + spread(i, 0.53) * 24) * k}
              duration={3600 + spread(i, 0.11) * 800}
              // Evenly staggered round the ring, exactly as the mock's `-(i/N)*4s` delay does, so
              // the band is continuous from the very first frame.
              phase={i / n}
            />
          ))}
        </>
      );

    // SOLAR FLARES — ten spokes, out and back.
    case 'arc':
      return (
        <>
          {Array.from({ length: n }, (_, i) => (
            <SolarArc
              key={i}
              hot={hot}
              body={body}
              size={6 * k * MOTE_BOX}
              cx={cx}
              cy={fy}
              angle={Math.round(spread(i, 0.37) * 360)}
              reach={64 * k}
              duration={1800 + spread(i, 0.71) * 1200}
              phase={spread(i, 0.61)}
            />
          ))}
        </>
      );

    // LIGHTNING TENDRILS — eight forked glyphs reaching out at random angles.
    case 'flicker':
      return (
        <>
          {Array.from({ length: n }, (_, i) => (
            <Tendril
              key={i}
              hot={hot}
              body={body}
              cx={cx}
              cy={fy}
              angle={Math.round(spread(i, 0.23) * 360)}
              len={(26 + spread(i, 0.59) * 26) * k}
              duration={900 + spread(i, 0.43) * 1100}
              phase={spread(i, 0.83)}
            />
          ))}
        </>
      );

    // VOID SMOKE — fifteen heavy veils coiling up off the flame.
    case 'coil':
    default:
      return (
        <>
          {Array.from({ length: n }, (_, i) => {
            const j = spread(i);
            const size = (15 + j * 17) * k * MOTE_BOX;
            return (
              <Veil
                key={i}
                hot={hot}
                body={body}
                size={size}
                left={w * (0.4 + spread(i, 0.29) * 0.2) - size / 2}
                top={h * 0.62}
                dx={(spread(i, 0.67) * 44 - 22) * k}
                rise={-128 * k}
                duration={4200 + j * 2600}
                phase={spread(i, 0.07)}
              />
            );
          })}
        </>
      );
  }
}

/**
 * The equipped particle field, ready to drop behind a flame.
 *
 * Mount it as an absolutely-positioned sibling of the flame inside a wrapper sized to the flame —
 * it fills its parent and works outward from there. Renders nothing when the slot is empty or when
 * the equipped item predates this build's motion table, which is the same newer-server-than-app
 * guard the rest of the economy already follows.
 */
export function EquippedFlameParticles({ dimmed = false }: { dimmed?: boolean }) {
  const item = useEquipped('particle');
  const motion = item ? PARTICLE_MOTION[item.id] : undefined;
  if (!item || !motion) return null;
  // `dimmed` follows SessionFlame's own prop for the gym branch, where the flame is a background
  // layer under a workout log. Particles at full strength behind readable text is the one place
  // this cosmetic could actively make the product worse.
  return (
    <View style={[StyleSheet.absoluteFill, dimmed && { opacity: 0.45 }]} pointerEvents="none">
      <FlameParticleField from={item.art.from} to={item.art.to} motion={motion} />
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
