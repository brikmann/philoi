import { useEffect, useId, useState } from 'react';
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

/** Void Plasma — overlapping glows breathing against each other at the corners. */
function Plasma({ colour, width, height }: { colour: string; width: number; height: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Drifter colour={colour} size={230} left={-120} top={-120} travelY={34} duration={7000} phase={0.18} peak={0.6} reverse />
      <Drifter colour={colour} size={210} left={width - 95} top={height - 110} travelY={-34} duration={8200} phase={0.55} peak={0.5} reverse />
      <Drifter colour={colour} size={175} left={width * 0.5 - 88} top={-110} travelY={24} duration={9500} phase={0.82} peak={0.4} reverse />
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
    // A strike is the one driver that keeps its delay rather than a seeded phase: the long dark
    // gap IS the effect, so starting it mid-flash would be wrong. `opacity: 0` underneath is what
    // stops the un-animated first frame painting a full-strength ball of light.
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top, opacity: 0 }, style]}>
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
 * Inferno / Emberfall Ascendant — light welling up off the bottom edge.
 *
 * This was five rounded rectangles 112px tall, which is the single hardest-edged thing the aura
 * ever drew: a row of flat bars pumping up the screen (punchlist 20.2). A tall soft ellipse
 * anchored below the edge gives the same "fire along the bottom" read with no shape to see —
 * only its top half is on screen, so what's visible is a glow that swells and sinks.
 */
function Lick({
  colour,
  left,
  w,
  height,
  phase,
  peak = 0.7,
}: {
  colour: string;
  left: number;
  w: number;
  height: number;
  phase: number;
  peak?: number;
}) {
  const t = usePhasedLoop(phase, 2400, EASE_QUAD, true);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: 0.72 + t.value * 0.42 }],
    opacity: 0.55 + t.value * 0.3,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      // Bottom-anchored and pushed half off-screen: the ellipse's own fade does the shaping, so
      // there is no boundary at the screen edge either. `opacity: 0` under the animated style is
      // the blob guard — this is the driver whose resting value was VISIBLE, so it is the one that
      // was actually being painted static for over a second on every load.
      style={[{ position: 'absolute', left, bottom: -height * 0.42, transformOrigin: '50% 100%', opacity: 0 }, style]}>
      <Glow size={w} colour={colour} peak={peak} stretch={height / w} />
    </Animated.View>
  );
}

function Flames({ colour, width, tall = 230, peak }: { colour: string; width: number; height: number; tall?: number; peak?: number }) {
  const n = 5;
  const w = width / n;
  // Overlapping by half a lane each side, so the five never read as five separate things.
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: n }, (_, i) => (
        <Lick key={i} colour={colour} left={i * w - w * 0.5} w={w * 2} height={tall} phase={spread(i, 0.23)} peak={peak} />
      ))}
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
      <Flames colour={colour} width={width} height={height} tall={300} peak={0.8} />
      <Falling colour={colour} width={width} height={height} density={1.7} />
      {/* Rising motes, launched from inside the pool and climbing about a third of the screen.
          Slow and few: this is the part that has to read as ASCENT, and ascent is legible only if
          it is slower than the fall above it. */}
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

/** Particle count per motion. Capped low and deliberately: this runs for a whole session next to a
 *  flame that is already animating, and the file's CHEAP constraint applies here too. */
const PARTICLE_COUNT: Record<ParticleMotion, number> = { rise: 7, fall: 8, swarm: 8, arc: 4, flicker: 5, coil: 4 };

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

function Particles({ from, to, motion, w, h }: { from: string; to: string; motion: ParticleMotion; w: number; h: number }) {
  const n = PARTICLE_COUNT[motion];
  // Alternating hot/body colour, deterministic per index — see `spread`.
  const hue = (i: number) => (i % 2 === 0 ? to : from);
  // Particles orbit the flame, so their lanes are measured from the box's centre outward.
  const cx = w / 2;

  if (motion === 'flicker') {
    // Lightning Tendrils — it reaches rather than drifts. The Zap primitive already IS a reach: a
    // burst of light with a dark gap after it, which is what "fingers of electricity" looks like at
    // this size. Ringed around the flame instead of pinned to the screen edges.
    return (
      <>
        {Array.from({ length: n }, (_, i) => {
          const a = (i / n) * Math.PI * 2 + 0.4;
          const size = w * (0.2 + spread(i, 0.3) * 0.12);
          return (
            <Zap
              key={i}
              colour={hue(i)}
              left={cx + Math.cos(a) * w * 0.4 - size / 2}
              top={h * 0.52 + Math.sin(a) * w * 0.32 - size / 2}
              size={size}
              delay={Math.round(spread(i) * 2800)}
            />
          );
        })}
      </>
    );
  }

  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const j = spread(i);
        const side = i % 2 === 0 ? 1 : -1;
        // Lanes stay inside the middle of the box: a mote hugging the outer edge reads as belonging
        // to the screen rather than to the flame, which is the flare's job and not this one's.
        const lane = cx + side * (0.08 + spread(i, 0.41) * 0.32) * w;

        switch (motion) {
          // Sparks / Floating Sparks / Ascendant Ash — embers climbing off the fire.
          case 'rise':
            return (
              <Drifter key={i} colour={hue(i)} size={w * (0.09 + j * 0.07)} left={lane} top={h * 0.7}
                travelY={-h * (0.42 + j * 0.26)} travelX={side * w * 0.09}
                duration={3200 + j * 2600} phase={spread(i, 0.17)} peak={0.75} />
            );

          // Falling Ash — the quiet snow. Slower than the rise, and it drifts rather than climbs.
          case 'fall':
            return (
              <Drifter key={i} colour={hue(i)} size={w * (0.06 + j * 0.05)} left={lane} top={-h * 0.1}
                travelY={h * (0.7 + j * 0.3)} travelX={side * w * 0.13}
                duration={5200 + j * 4200} phase={spread(i, 0.29)} peak={0.6} />
            );

          // Ember Swarm — short ping-pong hops around the flame, so it hovers instead of leaving.
          case 'swarm':
            return (
              <Drifter key={i} colour={hue(i)} size={w * (0.07 + j * 0.05)} left={lane} top={h * (0.2 + j * 0.5)}
                travelY={side * h * 0.13} travelX={-side * w * 0.16}
                duration={1900 + j * 1500} phase={spread(i, 0.53)} peak={0.8} reverse />
            );

          // Solar Flares — big slow loops that swing out and snap back. Few and large, which is the
          // only way an arc reads at this scale.
          case 'arc':
            return (
              <Drifter key={i} colour={hue(i)} size={w * (0.26 + j * 0.14)} left={lane - w * 0.15} top={h * (0.28 + j * 0.34)}
                travelY={-h * 0.14} travelX={side * w * 0.34}
                duration={4200 + j * 2400} phase={spread(i, 0.61)} peak={0.55} reverse />
            );

          // Void Smoke — a funeral veil: few, huge, slow, and barely there.
          case 'coil':
          default:
            return (
              <Drifter key={i} colour={hue(i)} size={w * (0.42 + j * 0.22)} left={lane - w * 0.25} top={h * 0.62}
                travelY={-h * (0.5 + j * 0.2)} travelX={side * w * 0.12}
                duration={8000 + j * 5000} phase={spread(i, 0.07)} peak={0.42} stretch={1.25} />
            );
        }
      })}
    </>
  );
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
