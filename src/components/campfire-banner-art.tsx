import { useId, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { EASE_SINE, spread, usePhasedLoop } from '@/components/economy/flare-perimeter';
import { FLAME_PATH, FLAME_VIEWBOX } from '@/components/ui/flame-logo';
import { Colors } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { DEFAULT_LOADOUT, getItem } from '@/lib/economy/catalog';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE BANNER SET — one bespoke, coded, animated scene per banner (design-mocks/101c-banner-art.html).
//
// WHAT THIS REPLACES. Every banner used to render the same picture: a two-colour sky gradient, one
// ridgeline silhouette, and a drift of embers. `bannerColors(key)` returned {from,to} and that pair
// was the ENTIRE difference between Hearthlight and Obsidian Colosseum. Which meant the banners
// were not really seven cosmetics — they were one cosmetic with a hue slider, and a Legendary drop
// looked like the free default in a different colour. The palette is no longer the identity; the
// SCENE is. `bannerColors` survives, but now as the base palette a scene is tinted with rather than
// as the whole of what a banner is.
//
// THE VIEWBOX IS 216 × 452, which is mock 101c's frame. That is an aspect of 0.478 against a
// typical phone's ~0.462 — within 3% — so a scene composed against the mock lands on device very
// close to as drawn, and every coordinate in this file can be read straight out of 101c.
//
// preserveAspectRatio="none" THROUGHOUT, and that is a deliberate trade. 'slice' would crop rather
// than stretch, which is normally the better answer — but the animated overlays here are RN Views
// positioned in pixels, and they can only line up with the SVG underneath them if the viewBox maps
// LINEARLY onto the box. With 'slice' the torch flame drifts off the end of the arm the moment the
// screen aspect is not exactly 216:452. A ~3% stretch nobody can see beats a torch floating in
// space, and the two aspects are close enough that this is the cheap side of the trade.
//
// ── COST, because these run forever behind a live chat ──────────────────────────────────────────
// A flare lasts one lock-in. A banner is up for as long as anyone has the campfire open, so every
// scene here is built to four rules:
//
//   1. STATIC SVG, ANIMATED VIEWS. The scenery — sky, ridges, skylines, colosseum tiers, the
//      statue — is drawn once as plain SVG and never re-renders. Only small absolutely-positioned
//      <Animated.View>s move, each driven on the UI thread. Nothing in this file re-renders React
//      per frame.
//   2. CAPPED COUNTS. Mock 101c runs up to 30 particles per scene because a browser tab can
//      afford it. Every count here is cut to roughly half that, listed in BUDGET below.
//   3. ONE DRIVER, MANY CONSUMERS where things must agree. The forge's hammer, anvil flare and
//      twenty sparks are one shared value read by every element, not twenty-two independent loops
//      that would drift apart within a minute — which is also why the strike stays synced.
//   4. DETERMINISTIC LAYOUT. Positions come from `spread()` (the flares' golden-ratio sequence),
//      never Math.random(). A re-render cannot reshuffle the weather, and two people looking at
//      the same campfire see the same sky.
//
// REDUCE MOTION renders the static first frame — scenery, no particles — which is also exactly
// what the header strip and the picker tiles get, for the same reason: a dozen animated tiles on
// one screen is the one place this could get expensive.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const VB_W = 216;
const VB_H = 452;

/** Particle counts, in one place so the total cost of a scene is legible at a glance. */
const BUDGET = {
  hearthEmbers: 10,
  nightTwinkles: 8,
  nightEmbers: 5,
  ridgeAsh: 14,
  colosseumWindows: 10,
  forgeSparks: 12,
  ashfallAsh: 12,
  ashfallRoofFlames: 4,
  mythicEmbers: 6,
} as const;

/**
 * A gradient-id suffix that is safe inside `url(#…)`.
 *
 * React's useId() returns tokens shaped like `:r7:`, and a colon is not valid in the fragment of a
 * url() reference. The two shipped components that already do this (primary-button.tsx and the
 * banner art this replaces) interpolate it raw and get away with it, but "gets away with it" is not
 * a thing to have eight copies of — every id in this file goes through here.
 */
function useGradientId(): string {
  return useId().replace(/[^a-zA-Z0-9]/g, '');
}

const FALLBACK = { from: '#2A1A12', to: '#C4701F' };

/** Resolve a banner cosmetic key to its two art colours, falling back to base Hearthlight. */
export function bannerColors(cosmeticKey: string | null | undefined): { from: string; to: string } {
  const item = getItem(cosmeticKey ?? DEFAULT_LOADOUT.banner ?? '');
  if (item?.art?.kind === 'banner') return { from: item.art.from, to: item.art.to };
  return FALLBACK;
}

/**
 * THE LEGIBILITY SCRIM — the one thing every scene shares, and the reason a banner can be this
 * busy and still have a chat on top of it.
 *
 * Lightest at the very top so the scene announces itself behind the campfire name, settling to
 * SCRIM_MAX by the time it is under message bubbles and staying there to the bottom edge.
 *
 * NOT 1.0, deliberately. A scrim that reaches full opacity is not a scrim, it is the end of the
 * picture — that was the specific fault in the version this replaces, which faded the art out
 * entirely by 46% of the screen and left the feed sitting on flat ground.
 */
const SCRIM_MAX = 0.8;

function LegibilityScrim({ w, h, fadeTo, uid }: { w: number; h: number; fadeTo: string; uid: string }) {
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={`scrim-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={fadeTo} stopOpacity={0.2} />
          <Stop offset="0.3" stopColor={fadeTo} stopOpacity={0.58} />
          <Stop offset="0.55" stopColor={fadeTo} stopOpacity={SCRIM_MAX} />
          <Stop offset="1" stopColor={fadeTo} stopOpacity={SCRIM_MAX} />
        </LinearGradient>
      </Defs>
      <Rect width={w} height={h} fill={`url(#scrim-${uid})`} />
    </Svg>
  );
}

// ─────────────────────────── particle primitives ───────────────────────────
//
// All three run on `usePhasedLoop` from flare-perimeter — the flares' own driver, which seeds each
// particle mid-cycle instead of delaying its start. That is what stops a layer arriving as a set of
// identical dots sitting still in lockstep (COSMETIC_UI_FIXES §4, "flares load as blobs"). The
// static `opacity: 0` under every animated style is the second half of that guarantee: if a frame
// is ever painted before Reanimated has applied anything, it paints nothing rather than a
// full-strength particle standing still.

/** An ember rising and burning out. Hearthlight, Emberfall Night, Emberfall Standard. */
function RisingEmber({
  left,
  size,
  colour,
  travel,
  drift,
  duration,
  phase,
}: {
  left: number;
  size: number;
  colour: string;
  travel: number;
  drift: number;
  duration: number;
  phase: number;
}) {
  const t = usePhasedLoop(phase, duration, EASE_SINE, false);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -travel * t.value }, { translateX: drift * t.value }],
    opacity: 0.85 * Math.min(1, t.value / 0.15) * Math.min(1, (1 - t.value) / 0.35),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left,
          bottom: 0,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colour,
          opacity: 0,
        },
        style,
      ]}
    />
  );
}

/** A fleck of ash falling and tumbling. Ashfall Ridge, Ashfall. Wider, flatter and slower than an
 *  ember, and it does not glow — ash is what is left when the glow has gone. */
function FallingAsh({
  left,
  size,
  colour,
  travel,
  drift,
  duration,
  phase,
}: {
  left: number;
  size: number;
  colour: string;
  travel: number;
  drift: number;
  duration: number;
  phase: number;
}) {
  const t = usePhasedLoop(phase, duration, Easing.linear, false);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: travel * t.value },
      { translateX: drift * t.value },
      { rotate: `${360 * t.value}deg` },
    ],
    opacity: 0.7 * Math.min(1, t.value / 0.12) * Math.min(1, (1 - t.value) / 0.25),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left,
          top: -8,
          width: size,
          height: size * 0.7,
          borderRadius: size / 2,
          backgroundColor: colour,
          opacity: 0,
        },
        style,
      ]}
    />
  );
}

/** A star breathing between dim and bright. Emberfall Night, Obsidian Colosseum. */
function Twinkler({
  left,
  top,
  size,
  duration,
  phase,
  colour = '#FFFFFF',
}: {
  left: number;
  top: number;
  size: number;
  duration: number;
  phase: number;
  colour?: string;
}) {
  const t = usePhasedLoop(phase, duration, EASE_SINE, true);
  const style = useAnimatedStyle(() => ({ opacity: 0.25 + 0.75 * t.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left,
          top,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colour,
          opacity: 0,
        },
        style,
      ]}
    />
  );
}

// ─────────────────────────── scene plumbing ───────────────────────────

type SceneProps = {
  /** Measured pixels. Scenes convert their viewBox coordinates with px()/py() below. */
  w: number;
  h: number;
  from: string;
  to: string;
  /** False for the header strip, the picker tiles, and reduce-motion: scenery only. */
  animated: boolean;
  /**
   * INSTANCE-SCOPED SUFFIX FOR EVERY GRADIENT ID IN THIS FILE, and it is not optional.
   *
   * react-native-svg resolves `url(#id)` against a GLOBAL registry, not per-<Svg>. Two components
   * that both define `<LinearGradient id="sky">` are one definition as far as the renderer is
   * concerned, and on Android every instance after the first paints blank. primary-button.tsx
   * carries the same note for the same reason.
   *
   * That is not hypothetical here: the banner PICKER draws seven of these at once in a grid, and
   * the campfire screen draws one while the header draws another. Every id below is written as
   * `name-${uid}`.
   */
  uid: string;
};

/** viewBox → pixels. Exact, because every scene draws with preserveAspectRatio="none". */
const px = (w: number, x: number) => (x / VB_W) * w;
const py = (h: number, y: number) => (y / VB_H) * h;

/**
 * The shared silhouette pair from mock 101c's RIDGE constant — Hearthlight's whole scenery, and the
 * horizon several other scenes sit their subject on.
 *
 * RE-AUTHORED INTO THE 216-WIDE VIEWBOX, x-coordinates only. 101c draws the ridge in its own
 * `viewBox="0 0 300 452"`, and the obvious way to bring it across — wrapping it in
 * `<G scale={216/300}>` — is wrong: an SVG scale is UNIFORM, so it shrinks the y axis by 0.72 too.
 * The ridge base moves from y=452 to y=325 and the bottom quarter of the screen becomes empty sky
 * with a horizon floating above it. Only the width changed between the two boxes, so only x is
 * rescaled here (×0.72) and every y is left exactly as 101c drew it.
 */
const RIDGE_FAR = 'M0 300 L50.4 240 L86.4 280 L129.6 220 L172.8 270 L216 230 L216 452 L0 452Z';
const RIDGE_NEAR = 'M0 330 L43.2 285 L93.6 320 L144 275 L216 305 L216 452 L0 452Z';

// ─────────────────────────── 1 · Hearthlight (common, default) ───────────────────────────
//
// "Quiet hearth — ridge, embers drifting up." Deliberately the least of the seven: it is what a
// campfire flies on day one, and the set only reads as a ladder if the bottom rung is calm. This is
// essentially the art every banner used to share, kept as the identity of the one banner it was
// always meant to be.

function HearthlightScene({ w, h, from, to, animated, uid }: SceneProps) {
  const embers = useMemo(
    () =>
      Array.from({ length: BUDGET.hearthEmbers }, (_, i) => ({
        left: spread(i, 0.11) * w,
        size: 2 + spread(i, 0.37) * 2.4,
        travel: h * (0.55 + spread(i, 0.61) * 0.4),
        drift: (spread(i, 0.23) - 0.5) * 36,
        duration: 5200 + Math.round(spread(i, 0.53) * 4200),
        phase: spread(i, 0.79),
      })),
    [w, h]
  );

  return (
    <>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <Defs>
          <LinearGradient id={`hearthSky-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={to} stopOpacity={0.65} />
            <Stop offset="0.28" stopColor={to} stopOpacity={0.32} />
            <Stop offset="0.62" stopColor={from} stopOpacity={0.85} />
            <Stop offset="1" stopColor={from} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width={VB_W} height={VB_H} fill={`url(#hearthSky-${uid})`} />
        {/* Two depths, because one silhouette reads as a flat swatch with a bite out of it. */}
        <Path d={RIDGE_FAR} fill="#241633" opacity={0.85} />
        <Path d={RIDGE_NEAR} fill="#1A1226" />
      </Svg>
      {animated &&
        embers.map((e, i) => <RisingEmber key={i} colour={to} {...e} />)}
    </>
  );
}

// ─────────────────────────── 2 · Emberfall Night (epic) ───────────────────────────
//
// "Night sky — constellations drawn in the stars." The distinguishing mark is that the stars are
// JOINED: two constellations drawn as faint polylines with brighter nodes at their vertices, so it
// reads as a night someone has been reading rather than as noise.

const CONSTELLATIONS: number[][][] = [
  [[12, 10], [20, 18], [30, 12], [38, 22]],
  [[62, 14], [70, 8], [78, 20], [86, 12], [80, 28]],
];

function EmberfallNightScene({ w, h, from, to, animated, uid }: SceneProps) {
  // Stars are drawn INTO the static SVG; only a handful get an animated twinkle on top. Animating
  // all thirty would be thirty views for an effect that reads identically with eight.
  const stars = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        x: spread(i, 0.17) * VB_W,
        y: spread(i, 0.41) * VB_H * 0.52,
        r: 0.6 + spread(i, 0.67) * 1.1,
        o: 0.3 + spread(i, 0.29) * 0.6,
      })),
    []
  );

  const twinkles = useMemo(
    () =>
      Array.from({ length: BUDGET.nightTwinkles }, (_, i) => ({
        left: px(w, spread(i, 0.31) * VB_W),
        top: py(h, spread(i, 0.73) * VB_H * 0.5),
        size: 1.6 + spread(i, 0.13) * 1.6,
        duration: 1600 + Math.round(spread(i, 0.47) * 2400),
        phase: spread(i, 0.83),
      })),
    [w, h]
  );

  const embers = useMemo(
    () =>
      Array.from({ length: BUDGET.nightEmbers }, (_, i) => ({
        left: spread(i, 0.19) * w,
        size: 2 + spread(i, 0.43) * 2,
        travel: h * (0.6 + spread(i, 0.71) * 0.35),
        drift: (spread(i, 0.37) - 0.5) * 30,
        duration: 6000 + Math.round(spread(i, 0.59) * 4000),
        phase: spread(i, 0.89),
      })),
    [w, h]
  );

  return (
    <>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <Defs>
          <LinearGradient id={`nightSky-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#120c22" />
            <Stop offset="0.6" stopColor={from} />
            <Stop offset="1" stopColor="#0c0814" />
          </LinearGradient>
          {/* The ember glow the banner's `to` colour supplies, held at the top of the sky. */}
          <RadialGradient id={`nightGlow-${uid}`} cx="50%" cy="6%" rx="120%" ry="60%">
            <Stop offset="0" stopColor={to} stopOpacity={0.27} />
            <Stop offset="0.55" stopColor={to} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={VB_W} height={VB_H} fill={`url(#nightSky-${uid})`} />
        <Rect width={VB_W} height={VB_H} fill={`url(#nightGlow-${uid})`} />

        {stars.map((s, i) => (
          <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#FFFFFF" opacity={s.o} />
        ))}

        {/* The constellations. 101c authors these as PERCENTAGES of the frame — x of the width,
            y of the height — so each axis maps to its own dimension. Scaling both by VB_W/100
            (the tempting one-liner) squashes every constellation into the top 6% of the sky and
            they stop reading as constellations at all. */}
        {CONSTELLATIONS.map((c, ci) => (
          <G key={ci}>
            <Path
              d={`M${c.map((pt) => `${(pt[0] / 100) * VB_W} ${(pt[1] / 100) * VB_H}`).join(' L ')}`}
              stroke="rgba(255,220,150,0.5)"
              strokeWidth={1}
              fill="none"
            />
            {c.map((pt, pi) => (
              <Circle
                key={pi}
                cx={(pt[0] / 100) * VB_W}
                cy={(pt[1] / 100) * VB_H}
                r={1.8}
                fill="#FFDD9A"
              />
            ))}
          </G>
        ))}

        <Path d={RIDGE_NEAR} fill="#0d0a18" />
      </Svg>
      {animated && (
        <>
          {twinkles.map((t, i) => (
            <Twinkler key={`t${i}`} {...t} />
          ))}
          {embers.map((e, i) => (
            <RisingEmber key={`e${i}`} colour={to} {...e} />
          ))}
        </>
      )}
    </>
  );
}

// ─────────────────────────── 3 · Ashfall Ridge (epic) ───────────────────────────
//
// "Ash falling over a city in the distance." Muted grey-lavender, and the city is DISTANT — a
// low band of towers along the bottom with lit windows, not a skyline you are standing in. The
// difference between this and Ashfall (§6) is the whole point of having both: this city is far
// away and intact, that one is close and burning.

function AshfallRidgeScene({ w, h, from, to, animated, uid }: SceneProps) {
  const city = useMemo(() => {
    const heights = [70, 110, 90, 140, 105, 160, 120, 95, 130, 150];
    const towers: { x: number; y: number; w: number; h: number; windows: { x: number; y: number; o: number }[] }[] = [];
    let x = 0;
    heights.forEach((hh, i) => {
      const ww = 18 + spread(i, 0.29) * 10;
      const windows: { x: number; y: number; o: number }[] = [];
      let k = 0;
      for (let wy = VB_H - hh + 8; wy < VB_H - 6; wy += 14) {
        for (let wx = x + 3; wx < x + ww - 3; wx += 7) {
          k += 1;
          if (spread(k, 0.61 + i * 0.07) > 0.45) {
            windows.push({ x: wx, y: wy, o: 0.3 + spread(k, 0.13) * 0.5 });
          }
        }
      }
      towers.push({ x, y: VB_H - hh, w: ww, h: hh, windows });
      x += ww + 2;
    });
    return towers;
  }, []);

  const ash = useMemo(
    () =>
      Array.from({ length: BUDGET.ridgeAsh }, (_, i) => ({
        left: spread(i, 0.07) * w,
        size: 3 + spread(i, 0.53) * 2.6,
        travel: h + 40,
        drift: (spread(i, 0.31) - 0.5) * 44,
        duration: 7000 + Math.round(spread(i, 0.67) * 5000),
        phase: spread(i, 0.91),
      })),
    [w, h]
  );

  return (
    <>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <Defs>
          <LinearGradient id={`ridgeSky-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#3b3550" />
            <Stop offset="0.4" stopColor="#2a2440" />
            <Stop offset="1" stopColor={from} />
          </LinearGradient>
        </Defs>
        <Rect width={VB_W} height={VB_H} fill={`url(#ridgeSky-${uid})`} />
        {/* A wash of the banner's grey-lavender over the horizon — the ash already in the air. */}
        <Rect y={VB_H * 0.42} width={VB_W} height={VB_H * 0.3} fill={to} opacity={0.07} />

        {city.map((t, i) => (
          <G key={i}>
            <Rect x={t.x} y={t.y} width={t.w} height={t.h} fill="#15111f" />
            {t.windows.map((win, wi) => (
              <Rect key={wi} x={win.x} y={win.y} width={3} height={4} fill="#e8c98a" opacity={win.o} />
            ))}
          </G>
        ))}
      </Svg>
      {animated && ash.map((a, i) => <FallingAsh key={i} colour="#cfc9d8" {...a} />)}
    </>
  );
}

// ─────────────────────────── 4 · Obsidian Colosseum (legendary) ───────────────────────────
//
// "The Roman colosseum, windows flickering with light." Drawn in 2.5D — NESTED ELLIPTICAL wall
// tiers rather than a front elevation, so you read the full curved bowl of the arena from slightly
// above, the way the building is actually recognisable. A flat façade would just be a wall with
// holes in it.
//
// Arches sit on the FRONT arc of each ellipse only (the 0.08π..0.92π sweep): the far side of the
// bowl is behind the near wall and drawing arches there would turn the tiers into a ring of dots.

const COLOSSEUM_TIERS = [
  { cy: 352, rx: 128, ry: 56, stroke: 13, arches: 10 },
  { cy: 326, rx: 104, ry: 44, stroke: 11, arches: 9 },
  { cy: 304, rx: 82, ry: 34, stroke: 9, arches: 8 },
];

function ColosseumScene({ w, h, to, animated, uid }: SceneProps) {
  const arches = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    COLOSSEUM_TIERS.forEach((t) => {
      for (let i = 0; i < t.arches; i += 1) {
        const a = Math.PI * (0.08 + 0.84 * (i / (t.arches - 1)));
        out.push({ x: 108 + Math.cos(a) * t.rx, y: t.cy + Math.sin(a) * t.ry });
      }
    });
    return out;
  }, []);

  const stars = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        x: spread(i, 0.23) * VB_W,
        y: spread(i, 0.59) * 250,
        r: 0.6 + spread(i, 0.37) * 1.1,
        o: 0.3 + spread(i, 0.71) * 0.6,
      })),
    []
  );

  // Only a subset of the arches flicker — a building where every window pulses in unison reads as a
  // string of fairy lights, not as torches in separate rooms.
  const flickers = useMemo(
    () =>
      Array.from({ length: BUDGET.colosseumWindows }, (_, i) => {
        const a = arches[Math.floor(spread(i, 0.43) * arches.length)];
        return {
          left: px(w, a.x - 2.4),
          top: py(h, a.y - 4),
          size: Math.max(3, px(w, 4.8)),
          duration: 1400 + Math.round(spread(i, 0.61) * 2400),
          phase: spread(i, 0.29),
        };
      }),
    [arches, w, h]
  );

  return (
    <>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <Defs>
          <LinearGradient id={`colSky-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0a0813" />
            <Stop offset="0.55" stopColor="#0d0a17" />
            <Stop offset="1" stopColor="#08060f" />
          </LinearGradient>
          {/* The gold the arena throws up into the night — the banner's `to` colour, low and wide. */}
          <RadialGradient id={`colGlow-${uid}`} cx="50%" cy="80%" rx="52%" ry="24%">
            <Stop offset="0" stopColor={to} stopOpacity={0.26} />
            <Stop offset="1" stopColor={to} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={VB_W} height={VB_H} fill={`url(#colSky-${uid})`} />

        {/* Stars BEHIND the arena, per the brief — the bowl is grounded in a night sky. */}
        {stars.map((s, i) => (
          <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#FFFFFF" opacity={s.o} />
        ))}

        {/* Outer mass, then the sunken arena floor inside it. */}
        <Ellipse cx={108} cy={352} rx={140} ry={66} fill="#0c0a12" />
        <Ellipse cx={108} cy={356} rx={78} ry={30} fill="#060409" />

        {COLOSSEUM_TIERS.map((t, i) => (
          <Ellipse
            key={i}
            cx={108}
            cy={t.cy}
            rx={t.rx}
            ry={t.ry}
            fill="none"
            stroke="#17121f"
            strokeWidth={t.stroke}
          />
        ))}
        {arches.map((a, i) => (
          <Rect key={i} x={a.x - 2.4} y={a.y - 4} width={4.8} height={8} rx={2} fill="#e9c874" opacity={0.8} />
        ))}

        <Rect width={VB_W} height={VB_H} fill={`url(#colGlow-${uid})`} />
      </Svg>
      {animated &&
        flickers.map((f, i) => <Twinkler key={i} colour="#F5C542" {...f} />)}
    </>
  );
}

// ─────────────────────────── 5 · The Great Forge (legendary) ───────────────────────────
//
// "Pure black — a smith strikes a blazing anvil in the distance." The scene is almost entirely
// nothing: a black field with one small, intensely lit point in it. That emptiness IS the design —
// the anvil reads as distant and enormous precisely because there is no other light to measure it
// against, and it makes this the one banner that never competes with a message bubble.
//
// ONE DRIVER FOR THE WHOLE STRIKE. The hammer's swing, the anvil's flare and every spark run off a
// single 2400ms shared value passed down as a prop. Twenty-two independent loops with the same
// nominal period drift apart within a minute, and the moment the sparks stop landing on the
// hammer-fall the scene stops reading as a strike and starts reading as a glitch.
const FORGE_CYCLE = 2400;
/** Where in the cycle the hammer lands. Every element keys off this one number. */
const STRIKE_AT = 0.72;

function GreatForgeScene({ w, h, animated, uid }: SceneProps) {
  const sparks = useMemo(
    () =>
      Array.from({ length: BUDGET.forgeSparks }, (_, i) => {
        const ang = (-90 + (spread(i, 0.17) * 130 - 65)) * (Math.PI / 180);
        const dist = 34 + spread(i, 0.53) * 74;
        return { dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist };
      }),
    []
  );

  // The anvil sits at viewBox (108, 268) — small and high, so it reads as far off.
  const anvilX = px(w, 108);
  const anvilY = py(h, 268);

  return (
    <>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <Defs>
          {/* Not a linear sky: a tight pool of forge-light in the middle of a black field. */}
          <RadialGradient id={`forgeSky-${uid}`} cx="50%" cy="62%" rx="32%" ry="14%">
            <Stop offset="0" stopColor="#3a2408" />
            <Stop offset="0.4" stopColor="#0a0608" />
            <Stop offset="1" stopColor="#030204" />
          </RadialGradient>
        </Defs>
        <Rect width={VB_W} height={VB_H} fill={`url(#forgeSky-${uid})`} />

        {/* The smith and the anvil, both near-black — they are silhouettes against their own fire. */}
        <G>
          <Path
            d="M96 274 H126 L121 282 H105 L102 287 H113 V292 H97 V287 H105 L101 282 H98Z"
            fill="#0a0810"
            stroke="#7a4e18"
            strokeWidth={0.8}
          />
          <Circle cx={88} cy={260} r={4.5} fill="#050409" />
          <Path d="M88 264 q-4 8 -3 20 h9 q2 -12 -1 -20Z" fill="#050409" />
        </G>
      </Svg>

      {animated && <ForgeStrike sparks={sparks} left={anvilX} top={anvilY} scale={w / VB_W} />}
    </>
  );
}

/**
 * The strike, and the ONE shared driver behind all of it.
 *
 * Mounted only when the scene is live, which is the whole reason it is its own component: a
 * `usePhasedLoop` in GreatForgeScene's body would keep a `withRepeat(-1)` loop running on the UI
 * thread forever behind every static picker tile and every reduce-motion screen, driving nothing.
 * A hook cannot be called conditionally; a component can be rendered conditionally.
 */
function ForgeStrike({
  sparks,
  left,
  top,
  scale,
}: {
  sparks: { dx: number; dy: number }[];
  left: number;
  top: number;
  scale: number;
}) {
  const t = usePhasedLoop(0, FORGE_CYCLE, Easing.linear, false);
  return (
    <>
      <AnvilFlare t={t} left={left} top={top} scale={scale} />
      <Hammer t={t} left={left} top={top} scale={scale} />
      {sparks.map((s, i) => (
        <ForgeSpark key={i} t={t} left={left} top={top} dx={s.dx} dy={s.dy} />
      ))}
    </>
  );
}

/** The whole anvil lighting up on the blow — dark through the swing, white-hot at the strike. */
function AnvilFlare({ t, left, top, scale }: { t: SharedValue<number>; left: number; top: number; scale: number }) {
  const uid = useGradientId();
  const size = Math.max(28, 52 * scale);
  const style = useAnimatedStyle(() => {
    const d = t.value - STRIKE_AT;
    // Instant on the hit, ~14% of the cycle to fall back to its resting glow.
    const hot = d >= 0 && d < 0.14 ? 1 - d / 0.14 : 0;
    return { opacity: 0.12 + 0.88 * hot };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: left - size / 2, top: top - size * 0.3, width: size, height: size * 0.6, opacity: 0 },
        style,
      ]}>
      <Svg width={size} height={size * 0.6}>
        <Defs>
          <RadialGradient id={`anvilHot-${uid}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFE7A6" />
            <Stop offset="0.5" stopColor="#FF9A2E" />
            <Stop offset="1" stopColor="#FF9A2E" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={size / 2} cy={size * 0.3} rx={size / 2} ry={size * 0.3} fill={`url(#anvilHot-${uid})`} />
      </Svg>
    </Animated.View>
  );
}

/** The swing. Held back through most of the cycle, whipped over at the strike, then reset. */
function Hammer({ t, left, top, scale }: { t: SharedValue<number>; left: number; top: number; scale: number }) {
  const len = Math.max(16, 26 * scale);
  const style = useAnimatedStyle(() => {
    'worklet';
    let deg = -52;
    if (t.value >= 0.6 && t.value < STRIKE_AT) {
      // wind through: -52° → 8°
      deg = -52 + 60 * ((t.value - 0.6) / (STRIKE_AT - 0.6));
    } else if (t.value >= STRIKE_AT && t.value < 0.8) {
      // recoil back to rest
      deg = 8 - 60 * ((t.value - STRIKE_AT) / (0.8 - STRIKE_AT));
    }
    return { transform: [{ rotate: `${deg}deg` }] };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: left - len * 1.15,
          top: top - len * 0.35,
          width: len,
          height: 3,
          backgroundColor: '#050409',
          borderRadius: 2,
          // Pivots at the smith's hands, not at the hammer head.
          transformOrigin: 'left center',
        },
        style,
      ]}
    />
  );
}

/** One spark. Invisible until the strike, then thrown and burned out before the next swing. */
function ForgeSpark({
  t,
  left,
  top,
  dx,
  dy,
}: {
  t: SharedValue<number>;
  left: number;
  top: number;
  dx: number;
  dy: number;
}) {
  const style = useAnimatedStyle(() => {
    const d = t.value - STRIKE_AT;
    if (d < 0 || d > 0.28) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }] };
    const k = d / 0.28;
    return {
      opacity: 1 - k,
      transform: [{ translateX: dx * k }, { translateY: dy * k }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left,
          top,
          width: 3,
          height: 3,
          borderRadius: 1.5,
          backgroundColor: '#FFD9A0',
          opacity: 0,
        },
        style,
      ]}
    />
  );
}

// ─────────────────────────── 6 · Ashfall (legendary) ───────────────────────────
//
// "A man on a mountain, torch raised; a city burns behind him; ash rains; one eye flickers."
//
// The most literal scene in the set and the only one that is a picture of a PERSON. He is
// back-facing and turned slightly right so exactly one eye catches the light — the whole read is
// that he is looking back at what he did, and you never see his face. Cryptic on purpose: he has
// turned the city to ash and he is still holding the torch.
//
// Composition, bottom to top: a burning horizon of small towers across the full width, a fire-lit
// glow behind them, a narrow foreground mountain so the skyline reads on BOTH sides of it, tall
// close buildings flanking it also alight, and the figure on the summit.

function AshfallScene({ w, h, from, to, animated, uid }: SceneProps) {
  const horizon = useMemo(() => {
    const base = 318;
    const out: { x: number; y: number; w: number; h: number; windows: { x: number; y: number; o: number }[]; fire: number | null }[] = [];
    for (let i = 0; i < 16; i += 1) {
      const x = i * 13.5;
      const hh = 26 + spread(i, 0.19) * 54;
      const ww = 11 + spread(i, 0.47) * 3;
      const y = base - hh;
      const windows: { x: number; y: number; o: number }[] = [];
      let k = 0;
      for (let wy = y + 6; wy < base - 4; wy += 9) {
        for (let wx = x + 2; wx < x + ww - 2; wx += 5) {
          k += 1;
          if (spread(k, 0.29 + i * 0.11) > 0.5) windows.push({ x: wx, y: wy, o: 0.4 + spread(k, 0.17) * 0.5 });
        }
      }
      out.push({ x, y, w: ww, h: hh, windows, fire: spread(i, 0.83) > 0.35 ? x + ww / 2 : null });
    }
    return out;
  }, []);

  const foreground = useMemo(
    () =>
      ([[-6, 150], [14, 190], [34, 120], [150, 140], [172, 200], [196, 160]] as const).map(([x, hh], i) => {
        const ww = 30;
        const y = VB_H - hh;
        const windows: { x: number; y: number; o: number }[] = [];
        let k = 0;
        for (let wy = y + 10; wy < VB_H - 6; wy += 13) {
          for (let wx = x + 5; wx < x + ww - 5; wx += 8) {
            k += 1;
            if (spread(k, 0.37 + i * 0.13) > 0.5) windows.push({ x: wx, y: wy, o: 0.4 + spread(k, 0.23) * 0.5 });
          }
        }
        return { x, y, w: ww, h: hh, windows, fireX: x + ww / 2 };
      }),
    []
  );

  const ash = useMemo(
    () =>
      Array.from({ length: BUDGET.ashfallAsh }, (_, i) => ({
        left: spread(i, 0.13) * w,
        size: 3 + spread(i, 0.59) * 2.2,
        travel: h + 40,
        drift: (spread(i, 0.41) - 0.5) * 40,
        duration: 6500 + Math.round(spread(i, 0.71) * 4500),
        phase: spread(i, 0.97),
      })),
    [w, h]
  );

  const flamePath = (cx: number, y: number, tall: number) =>
    `M${cx} ${y - tall} C ${cx - tall * 0.35} ${y - tall * 0.3} ${cx - tall * 0.28} ${y} ${cx} ${y} C ${cx + tall * 0.28} ${y} ${cx + tall * 0.35} ${y - tall * 0.3} ${cx} ${y - tall} Z`;

  return (
    <>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <Defs>
          <LinearGradient id={`ashSky-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#17120f" />
            <Stop offset="0.7" stopColor={from} />
            <Stop offset="1" stopColor="#0b0806" />
          </LinearGradient>
          <RadialGradient id={`ashHalo-${uid}`} cx="50%" cy="40%" rx="42%" ry="30%">
            <Stop offset="0" stopColor={to} stopOpacity={0.2} />
            <Stop offset="1" stopColor={to} stopOpacity={0} />
          </RadialGradient>
          {/* The heat haze the burning city throws up behind the skyline. */}
          <LinearGradient id={`firelit-${uid}`} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#E0612C" stopOpacity={0.5} />
            <Stop offset="0.5" stopColor="#8a2a12" stopOpacity={0.28} />
            <Stop offset="1" stopColor="#3a1520" stopOpacity={0} />
          </LinearGradient>
          {/* Rim light: he is lit only down his right edge, by the fire he is standing over. */}
          <LinearGradient id={`rim-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#0a0709" />
            <Stop offset="0.78" stopColor="#0a0709" />
            <Stop offset="1" stopColor="#43331f" />
          </LinearGradient>
        </Defs>

        <Rect width={VB_W} height={VB_H} fill={`url(#ashSky-${uid})`} />
        <Rect width={VB_W} height={VB_H} fill={`url(#ashHalo-${uid})`} />
        <Rect x={0} y={250} width={VB_W} height={90} fill={`url(#firelit-${uid})`} />

        {horizon.map((b, i) => (
          <G key={i}>
            <Rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#0d0910" />
            {b.windows.map((win, wi) => (
              <Rect key={wi} x={win.x} y={win.y} width={2.4} height={3} fill="#FFB03A" opacity={win.o} />
            ))}
            {b.fire != null && <Path d={flamePath(b.fire, b.y, 14)} fill="#FF7A2E" opacity={0.92} />}
          </G>
        ))}

        {/* The mountain — narrow, so the burning skyline still reads on both sides of it. */}
        <Path d="M40 452 L100 168 L124 214 L184 452 Z" fill="#0b0810" />
        <Path d="M100 168 L124 214 L106 232 Z" fill="#070509" />

        {foreground.map((b, i) => (
          <G key={i}>
            <Rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#08060c" />
            {b.windows.map((win, wi) => (
              <Rect key={wi} x={win.x} y={win.y} width={3} height={4} fill="#FF9A3A" opacity={win.o} />
            ))}
            <Path d={flamePath(b.fireX, b.y, 20)} fill="#FF7A2E" opacity={0.95} />
          </G>
        ))}

        {/* The figure. Cloak, flexed left arm, right arm raised with the torch, head turned right. */}
        <G translateY={-8}>
          <Path
            d="M100 176 C 84 168 82 138 88 118 C 92 104 100 98 104 98 C 114 100 120 112 120 132 C 121 150 116 170 106 176 Z"
            fill={`url(#rim-${uid})`}
          />
          <Path d="M104 112 C 105 132 105 154 105 172" stroke="#05040a" strokeWidth={1.6} fill="none" opacity={0.6} />
          <Path d="M90 128 C 74 124 70 108 78 98 C 84 106 92 112 96 120 Z" fill="#0a0709" />
          <Path d="M116 122 L138 86" stroke={`url(#rim-${uid})`} strokeWidth={6} strokeLinecap="round" />
          <Path d="M104 100 C 96 99 93 88 98 80 C 103 74 113 76 116 85 C 118 94 112 100 104 100 Z" fill={`url(#rim-${uid})`} />
          {/* The static eye. The animated flicker sits on top of it when the scene is live, so a
              still frame still has a lit eye rather than a blank socket. */}
          <Ellipse cx={115} cy={80} rx={2.2} ry={1.5} fill="#FFB03A" opacity={0.45} />
        </G>
      </Svg>

      {animated && (
        <>
          <TorchFlame left={px(w, 139)} top={py(h, 62)} scale={w / VB_W} />
          <EyeFlicker left={px(w, 112.8)} top={py(h, 78.5)} size={Math.max(3, px(w, 4.4))} />
          {foreground.slice(0, BUDGET.ashfallRoofFlames).map((b, i) => (
            <RoofFlicker
              key={i}
              left={px(w, b.fireX - 7)}
              top={py(h, b.y - 22)}
              w={px(w, 14)}
              h={py(h, 24)}
              phase={spread(i, 0.31)}
            />
          ))}
          {ash.map((a, i) => (
            <FallingAsh key={`a${i}`} colour="#c9c2cf" {...a} />
          ))}
        </>
      )}
    </>
  );
}

/** The torch at the top of the raised arm — the brightest single point in the scene. */
function TorchFlame({ left, top, scale }: { left: number; top: number; scale: number }) {
  const uid = useGradientId();
  const t = usePhasedLoop(0.3, 1100, EASE_SINE, true);
  const wdt = Math.max(8, 15 * scale);
  const hgt = Math.max(13, 24 * scale);
  const style = useAnimatedStyle(() => ({
    opacity: 0.85 + 0.15 * t.value,
    transform: [{ scaleY: 1 + 0.2 * t.value }, { translateY: -2 * t.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left, top, width: wdt, height: hgt, opacity: 0, transformOrigin: 'bottom center' },
        style,
      ]}>
      <Svg width={wdt} height={hgt}>
        <Defs>
          <RadialGradient id={`torch-${uid}`} cx="50%" cy="72%" r="60%">
            <Stop offset="0" stopColor="#FFE9A8" />
            <Stop offset="0.52" stopColor="#F2A33C" />
            <Stop offset="1" stopColor="#E0612C" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={wdt / 2} cy={hgt * 0.55} rx={wdt / 2} ry={hgt * 0.45} fill={`url(#torch-${uid})`} />
      </Svg>
    </Animated.View>
  );
}

/** The one eye. Irregular on purpose — a smooth sine would read as a slow blink rather than as
 *  firelight moving across a face. */
function EyeFlicker({ left, top, size }: { left: number; top: number; size: number }) {
  const t = usePhasedLoop(0, 1400, Easing.linear, false);
  const style = useAnimatedStyle(() => {
    const v = t.value;
    const o = v < 0.22 ? 0.45 + 2.5 * v : v < 0.48 ? 1 - 2.7 * (v - 0.22) : v < 0.7 ? 0.3 + 3.2 * (v - 0.48) : 1 - 2.2 * (v - 0.7);
    return { opacity: Math.max(0.25, Math.min(1, o)) };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left,
          top,
          width: size,
          height: size * 0.68,
          borderRadius: size / 2,
          backgroundColor: '#FFB03A',
          opacity: 0,
        },
        style,
      ]}
    />
  );
}

/** A rooftop fire guttering on one of the close buildings. */
function RoofFlicker({ left, top, w, h, phase }: { left: number; top: number; w: number; h: number; phase: number }) {
  const uid = useGradientId();
  const t = usePhasedLoop(phase, 900, EASE_SINE, true);
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 + 0.45 * t.value,
    transform: [{ scaleY: 0.85 + 0.3 * t.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left, top, width: w, height: h, opacity: 0, transformOrigin: 'bottom center' },
        style,
      ]}>
      <Svg width={w} height={h}>
        <Defs>
          <RadialGradient id={`roofFire-${uid}`} cx="50%" cy="75%" r="60%">
            <Stop offset="0" stopColor="#FFD08A" />
            <Stop offset="0.6" stopColor="#FF7A2E" />
            <Stop offset="1" stopColor="#FF7A2E" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={w / 2} cy={h * 0.6} rx={w / 2} ry={h * 0.4} fill={`url(#roofFire-${uid})`} />
      </Svg>
    </Animated.View>
  );
}

// ─────────────────────────── 7 · Emberfall Standard (mythic) ───────────────────────────
//
// "ONE giant pulsing Cindy flame; the screen borders flicker with its aura." The apex of the set,
// and the only banner whose subject is the app's own mark rather than a place.
//
// The aura is the flare treatment, and that is the point of it — this is the mythic season banner,
// so the screen edges breathe the way a Mythic flare's perimeter does. It is drawn as four
// full-edge gradient bands that OVERLAP in the corners rather than four mitred bands that meet at
// a diagonal, which is the whole lesson of flare-perimeter's rim: four bands cut to meet leave four
// visible seams, four bands that overlap leave none and the corners simply land brightest, exactly
// as an inset box-shadow does.
//
// ONE DRIVER again, shared by the flame and all four edges — a border that breathes out of step
// with the flame it is supposed to be the aura OF is worse than no aura.
const MYTHIC_CYCLE = 1900;

function EmberfallStandardScene({ w, h, from, to, animated, uid }: SceneProps) {
  const embers = useMemo(
    () =>
      Array.from({ length: BUDGET.mythicEmbers }, (_, i) => ({
        left: spread(i, 0.29) * w,
        size: 2 + spread(i, 0.61) * 2.4,
        travel: h * (0.5 + spread(i, 0.19) * 0.35),
        drift: (spread(i, 0.43) - 0.5) * 30,
        duration: 5000 + Math.round(spread(i, 0.77) * 3500),
        phase: spread(i, 0.11),
      })),
    [w, h]
  );

  const flameW = w * 0.62;
  const flameH = flameW * 1.28;

  return (
    <>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <Defs>
          <LinearGradient id={`mythSky-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={from} stopOpacity={0.9} />
            <Stop offset="0.55" stopColor="#1a0703" />
            <Stop offset="1" stopColor="#0b0402" />
          </LinearGradient>
          <RadialGradient id={`mythGlow-${uid}`} cx="50%" cy="38%" rx="70%" ry="42%">
            <Stop offset="0" stopColor={to} stopOpacity={0.22} />
            <Stop offset="1" stopColor={to} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={VB_W} height={VB_H} fill={`url(#mythSky-${uid})`} />
        <Rect width={VB_W} height={VB_H} fill={`url(#mythGlow-${uid})`} />
      </Svg>

      {/* The flame is painted either way, so reduce-motion and the picker tiles still show the
          hero rather than an empty red field — only the pulse, the aura and the embers are the live
          half, and they share ONE driver so the border can never breathe out of step with the flame
          it is supposed to be the aura OF. Same conditional-mount reasoning as ForgeStrike. */}
      {animated ? (
        <MythicPulse w={w} h={h} flameW={flameW} flameH={flameH} colour={to} embers={embers} />
      ) : (
        <StaticFlame w={flameW} h={flameH} left={(w - flameW) / 2} top={h * 0.22} colour={to} />
      )}
    </>
  );
}

function MythicPulse({
  w,
  h,
  flameW,
  flameH,
  colour,
  embers,
}: {
  w: number;
  h: number;
  flameW: number;
  flameH: number;
  colour: string;
  embers: { left: number; size: number; travel: number; drift: number; duration: number; phase: number }[];
}) {
  const t = usePhasedLoop(0.25, MYTHIC_CYCLE, EASE_SINE, true);
  return (
    <>
      <GiantFlame t={t} w={flameW} h={flameH} left={(w - flameW) / 2} top={h * 0.22} colour={colour} />
      <AuraEdge t={t} colour={colour} edge="top" w={w} h={h} />
      <AuraEdge t={t} colour={colour} edge="bottom" w={w} h={h} />
      <AuraEdge t={t} colour={colour} edge="left" w={w} h={h} />
      <AuraEdge t={t} colour={colour} edge="right" w={w} h={h} />
      {embers.map((e, i) => (
        <RisingEmber key={i} colour={colour} {...e} />
      ))}
    </>
  );
}

/** The still version of the hero, for picker tiles and reduce-motion. No driver, no wrapper. */
function StaticFlame({ w, h, left, top, colour }: { w: number; h: number; left: number; top: number; colour: string }) {
  const uid = useGradientId();
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left, top, width: w, height: h, opacity: 0.92 }}>
      <Svg width={w} height={h} viewBox={`0 0 ${FLAME_VIEWBOX} ${FLAME_VIEWBOX}`} preserveAspectRatio="xMidYMid meet">
        <Defs>
          <LinearGradient id={`cindyStill-${uid}`} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#E0612C" />
            <Stop offset="0.55" stopColor={colour} />
            <Stop offset="1" stopColor="#FFF0C4" />
          </LinearGradient>
        </Defs>
        <Path d={FLAME_PATH} fill={`url(#cindyStill-${uid})`} />
      </Svg>
    </View>
  );
}

function GiantFlame({
  t,
  w,
  h,
  left,
  top,
  colour,
}: {
  t: SharedValue<number>;
  w: number;
  h: number;
  left: number;
  top: number;
  colour: string;
}) {
  const uid = useGradientId();
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 0.9 + 0.24 * t.value }],
    opacity: 0.85 + 0.15 * t.value,
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left, top, width: w, height: h, transformOrigin: 'center bottom' }, style]}>
      <Svg width={w} height={h} viewBox={`0 0 ${FLAME_VIEWBOX} ${FLAME_VIEWBOX}`} preserveAspectRatio="xMidYMid meet">
        <Defs>
          <LinearGradient id={`cindy-${uid}`} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#E0612C" />
            <Stop offset="0.55" stopColor={colour} />
            <Stop offset="1" stopColor="#FFF0C4" />
          </LinearGradient>
        </Defs>
        <Path d={FLAME_PATH} fill={`url(#cindy-${uid})`} />
      </Svg>
    </Animated.View>
  );
}

/** One edge of the perimeter aura. Spans its FULL edge so the four overlap in the corners. */
function AuraEdge({
  t,
  colour,
  edge,
  w,
  h,
}: {
  t: SharedValue<number>;
  colour: string;
  edge: 'top' | 'bottom' | 'left' | 'right';
  w: number;
  h: number;
}) {
  // One px thickness for all four, so the rim reads identically on every edge rather than coming
  // out twice as thick top-and-bottom the way a percentage radius would (flare-perimeter's §3).
  const thickness = Math.round(Math.min(w, h) * 0.16);
  const horizontal = edge === 'top' || edge === 'bottom';
  const bw = horizontal ? w : thickness;
  const bh = horizontal ? thickness : h;

  const uid = useGradientId();
  const style = useAnimatedStyle(() => ({ opacity: 0.3 + 0.6 * t.value }));

  const pos =
    edge === 'top'
      ? { top: 0, left: 0 }
      : edge === 'bottom'
        ? { bottom: 0, left: 0 }
        : edge === 'left'
          ? { top: 0, left: 0 }
          : { top: 0, right: 0 };

  // Each band fades from the edge inward to nothing — no hard inner boundary, which is what stops
  // an overlay reading as a BOX instead of as light.
  const [x1, y1, x2, y2] =
    edge === 'top' ? [0, 0, 0, 1] : edge === 'bottom' ? [0, 1, 0, 0] : edge === 'left' ? [0, 0, 1, 0] : [1, 0, 0, 0];

  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: bw, height: bh, opacity: 0 }, pos, style]}>
      <Svg width={bw} height={bh}>
        <Defs>
          <LinearGradient id={`aura-${edge}-${uid}`} x1={String(x1)} y1={String(y1)} x2={String(x2)} y2={String(y2)}>
            <Stop offset="0" stopColor={colour} stopOpacity={0.55} />
            <Stop offset="1" stopColor={colour} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width={bw} height={bh} fill={`url(#aura-${edge}-${uid})`} />
      </Svg>
    </Animated.View>
  );
}

// ─────────────────────────── the dispatcher ───────────────────────────

const SCENES: Record<string, (p: SceneProps) => ReactNode> = {
  'banner-base-hearth': HearthlightScene,
  'banner-emberfall-night': EmberfallNightScene,
  'banner-ashfall-ridge': AshfallRidgeScene,
  'banner-obsidian-colosseum': ColosseumScene,
  'banner-the-great-forge': GreatForgeScene,
  'banner-ashfall': AshfallScene,
  'banner-emberfall-mythic': EmberfallStandardScene,
};

type CampfireBannerArtProps = {
  /**
   * The cosmetic key — `groups.banner_item_id`, or a catalog id when drawing a picker tile. This
   * is what selects the SCENE; the palette is derived from it too.
   *
   * An unknown key (including the two banners cut in §0, which live accounts may still own) falls
   * back to Hearthlight, which is the same thing bannerColors already did for the palette.
   */
  itemKey: string | null | undefined;
  /** Where the scrim finishes — the colour the content sits on. Defaults to the app background. */
  fadeTo?: string;
  /**
   * 'screen' is the full-bleed campfire backdrop. 'header' is the strip behind the campfire header
   * and the swatch in the banner pickers — same scene, scenery only, so a grid of tiles is still
   * recognisable per banner without a dozen particle systems running at once.
   */
  variant?: 'header' | 'screen';
  /** Motion. Ignored (forced off) for 'header' and whenever the OS asks for reduced motion. */
  animated?: boolean;
};

export function CampfireBannerArt({
  itemKey,
  fadeTo = Colors.bgRadialTo,
  variant = 'header',
  animated = false,
}: CampfireBannerArtProps) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const reduceMotion = useReduceMotion();
  // One id for this instance, suffixed onto every gradient the scene and the scrim define. See
  // SceneProps.uid for why a literal would blank out the picker grid on Android.
  const uid = useGradientId();

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const { from, to } = bannerColors(itemKey);
  const Scene = SCENES[itemKey ?? ''] ?? HearthlightScene;
  const live = animated && variant === 'screen' && !reduceMotion;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {/* Numeric width/height from onLayout, never `width="100%"` — a percentage-sized <Svg> inside
          an absolutely-positioned parent measures as ZERO on Android, which is the mechanical
          reason the original hero art never appeared on device while looking fine in the tree. */}
      {size.w > 0 && size.h > 0 && (
        <>
          <Scene w={size.w} h={size.h} from={from} to={to} animated={live} uid={uid} />
          <LegibilityScrim w={size.w} h={size.h} fadeTo={fadeTo} uid={uid} />
        </>
      )}
    </View>
  );
}
