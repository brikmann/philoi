import { useId, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useCosmeticClock } from '@/components/economy/cosmetic-clock';
import { Colors } from '@/constants/theme';
import { useMotionActive } from '@/hooks/use-motion-active';
import { getItem, type Archetype, type CatalogItem, type HaloArchetype } from '@/lib/economy/catalog';
import { mix, shade, tint } from '@/lib/economy/colour';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HALOS, BESPOKE (design-mocks/242-halo-particle-bespoke.html).
//
// The renderer's bones were already right — every mark is a multiple of the avatar's own radius, so
// a ring hugs a 24px badge and a 72px profile avatar alike. What 242 adds is MOTION PER ARCHETYPE:
//
//   warm-ring    three treatments by rarity — Emberring breathes, Copper's metal band turns,
//                Glowing Amber pulses hot with an outer echo.
//   ember-orbit  Ember Halo's coals circle; Emberfall Halo's embers fall THROUGH the ring.
//   prism        a refracting spectrum, turning.
//   fire-ring    Inferno's tongues lick outward (two tongue sets cross-fading).
//   hades        a black hole: a void just outside the avatar, a red accretion ring, and streaks
//                of light pulled inward — converging on the AVATAR'S centre, not the box corner.
//   crown        a crown of molten lava worn on the head (drawn ABOVE the avatar), regal pulse.
//   petals       Sakura: petals fade in at the top, fall, orbit once and dissipate — moved in
//                SCREEN space, so the fall is a fall and not a spin of the whole ring.
//
// The four rules of campfire-banner-art.tsx hold here too:
//   1. STATIC SVG, ANIMATED VIEWS. Each layer is a fixed <Svg>; only a View's transform/opacity
//      moves, on the UI thread. Nothing re-renders React per frame.
//   2. CAPPED COUNTS. At most 7 moving marks per halo.
//   3. ONE DRIVER. Every layer of every halo reads the same 24s cosmetic clock (cosmetic-clock.ts)
//      at a whole-number multiple, so thirty avatars on a leaderboard cost one driver.
//   4. DETERMINISTIC. No Math.random — phases come from the golden-ratio `spread`.
// Reduce Motion, an off-screen screen, or `motion="still"` draws the same art frozen.

/** How a halo's ring is drawn. One per look; an archetype owns one or more of them. */
export type HaloStyle = 'ring' | 'band' | 'double' | 'glow' | 'embers' | 'prism' | 'flare' | 'aura' | 'crown' | 'petals';

/**
 * Which slice of a halo a <HaloRing> draws.
 *
 * `all` is everything, frozen, in one Svg — the shop tile. A worn halo is split into layers
 * around the avatar: `still` (everything that sits behind the avatar, frozen), or, when it is
 * live, `base` plus whichever of `spin` / `pulse` / `lick` / `lick-alt` its style animates.
 * `over` is what sits on top of the avatar (the crown), live or not.
 */
export type HaloPart = 'all' | 'still' | 'base' | 'over' | 'spin' | 'pulse' | 'lick' | 'lick-alt';

type Piece = 'base' | 'spin' | 'pulse' | 'lick' | 'lick-alt' | 'over' | 'frozen';

const PART_PIECES: Record<HaloPart, readonly Piece[]> = {
  all: ['base', 'spin', 'pulse', 'lick', 'over', 'frozen'],
  still: ['base', 'spin', 'pulse', 'lick', 'frozen'],
  base: ['base'],
  over: ['over'],
  spin: ['spin'],
  pulse: ['pulse'],
  lick: ['lick'],
  'lick-alt': ['lick-alt'],
};

// ─────────────────────────── selection ───────────────────────────

// Kept as the fallback for an item that carries no archetype (or one this build predates), and as
// the tie-break inside a multi-look archetype: Ember Halo and Emberfall Halo are both ember-orbit.
const HALO_STYLE_BY_ID: Record<string, HaloStyle> = {
  'halo-base-ring': 'ring',
  'halo-copper-ring': 'band',
  'halo-ember-halo': 'double',
  'halo-glowing-amber': 'glow',
  'halo-diamond-prism': 'prism',
  'halo-inferno-flare': 'flare',
  'halo-hades': 'aura',
  'halo-emberfall': 'embers',
  'halo-emberfall-mythic': 'crown',
  'halo-sakura': 'petals',
};

/** The looks each archetype may draw. The first is its default. */
const ARCHETYPE_STYLES: Record<HaloArchetype, readonly HaloStyle[]> = {
  'warm-ring': ['ring', 'band', 'glow'],
  'ember-orbit': ['double', 'embers'],
  prism: ['prism'],
  'fire-ring': ['flare'],
  hades: ['aura'],
  crown: ['crown'],
  petals: ['petals'],
};

function isHaloArchetype(a: Archetype | undefined): a is HaloArchetype {
  return a !== undefined && Object.prototype.hasOwnProperty.call(ARCHETYPE_STYLES, a);
}

/**
 * The look for a halo item: its ARCHETYPE first (mock 242), then the id table, then the plain ring.
 *
 * Inside an archetype the id still picks between that archetype's own looks, and an unlisted item
 * gets the archetype's default — for warm-ring that is chosen by RARITY, so a new common, uncommon
 * and rare warm ring are three distinct treatments without anyone keying them by id.
 */
export function haloStyleForItem(item: Pick<CatalogItem, 'id' | 'archetype' | 'rarity'>): HaloStyle {
  const byId = HALO_STYLE_BY_ID[item.id];
  if (isHaloArchetype(item.archetype)) {
    const family = ARCHETYPE_STYLES[item.archetype];
    if (byId && family.includes(byId)) return byId;
    if (item.archetype === 'warm-ring') {
      return item.rarity === 'common' ? 'ring' : item.rarity === 'uncommon' ? 'band' : 'glow';
    }
    return family[0];
  }
  return byId ?? 'ring';
}

/** By id — resolves the catalog item so the archetype still leads. Unknown ids get the plain ring. */
export function haloStyleFor(itemId: string): HaloStyle {
  const item = getItem(itemId);
  return item ? haloStyleForItem(item) : (HALO_STYLE_BY_ID[itemId] ?? 'ring');
}

// ─────────────────────────── geometry + motion tables ───────────────────────────

/**
 * How far outside the avatar each style's art reaches, as a multiple of the avatar's RADIUS. The
 * box is derived from this and every mark from the avatar, which is what keeps a ring centred and
 * unclipped at every size and aura tier.
 */
export const HALO_REACH: Record<HaloStyle, number> = {
  ring: 1.2,
  band: 1.2,
  double: 1.22,
  glow: 1.3,
  embers: 1.34,
  prism: 1.22,
  flare: 1.42,
  aura: 1.48,
  crown: 1.52,
  petals: 1.36,
};

/** The one clock every halo layer reads. Each layer's cadence is a whole-number multiple of it. */
export const HALO_CLOCK_MS = 24_000;

type HaloLive = {
  /** Turns per clock cycle; negative turns the other way. Only for looks round all the way. */
  spin?: number;
  /** Breaths per cycle, and the opacity at the bottom of a breath. */
  pulse?: { mult: number; lo: number };
  /** Tongue swaps per cycle (fire-ring). */
  lick?: number;
  /** Marks that travel their own path. */
  movers?: 'embers' | 'streaks' | 'petals';
};

// Mock cadences, rounded to the nearest whole multiple of the 24s clock.
const HALO_LIVE: Record<HaloStyle, HaloLive> = {
  ring: { pulse: { mult: 8, lo: 0.6 } }, // 3s breathe
  band: { spin: 4 }, // 6s copper turn
  glow: { pulse: { mult: 13, lo: 0.55 } }, // ~1.8s hot pulse
  double: { spin: -5 }, // ~5s orbit
  embers: { movers: 'embers' },
  prism: { spin: 6 }, // 4s spectrum
  flare: { lick: 30 }, // 0.8s tongues
  aura: { pulse: { mult: 16, lo: 0.5 }, movers: 'streaks' }, // 1.5s flicker
  crown: { pulse: { mult: 12, lo: 0.3 } }, // 2s regal pulse
  petals: { movers: 'petals' },
};

/** Styles that draw something on top of the avatar. */
const HALO_OVER: Partial<Record<HaloStyle, true>> = { crown: true };

const fmt = (n: number) => n.toFixed(2);

/** Golden-ratio spread, 0..1 — deterministic phases (rule 4). */
function spread(i: number, offset = 0): number {
  return ((i + 1) * 0.6180339887 + offset) % 1;
}

// The molten crown, authored in mock 242's own 80 x 46 box.
const CROWN_D = 'M5 42 L9 38 L13 20 L20 34 L27 12 L33 30 L40 5 L47 30 L53 12 L60 34 L67 20 L71 38 L75 42 L75 46 L5 46 Z';

/** Places the 80x46 crown on the head: its band 0.72R above centre, 1.5R wide. */
function crownTransform(R: number): string {
  const s = (1.5 * R) / 80;
  return `translate(${fmt(50 - 40 * s)} ${fmt(50 - 0.72 * R - 41 * s)}) scale(${fmt(s)})`;
}

// A sakura petal in a 12-unit box centred on 0: rounded, notched at the top, pointed at the base.
const PETAL_D =
  'M0 5 C-4.6 2.4 -5 -2.6 -2.2 -4.6 C-1.2 -5.2 -0.4 -4.6 0 -3.4 C0.4 -4.6 1.2 -5.2 2.2 -4.6 C5 -2.6 4.6 2.4 0 5 Z';

/** Petal scale in viewBox units — a petal is about a third of the avatar's radius long. */
const petalScale = (rAvatar: number) => (rAvatar * 0.34) / 10;

/** The sakura orbit: on the ring, a hair outside it. */
const petalOrbit = (R: number) => R + R / 42;

// ─────────────────────────── the drawing ───────────────────────────

export type HaloRingProps = {
  style: HaloStyle;
  from: string;
  to: string;
  /** Extra opacity from the live-session aura tier. */
  boost: number;
  /** The aura tier's outward bloom, 0-3. */
  spread: number;
  /** The avatar's radius in the Svg's 0-100 space. */
  rAvatar: number;
  uid: string;
  part?: HaloPart;
};

/**
 * One halo, as SVG nodes centred on (50, 50) in a 0-100 box. Exported for the shop tile, which
 * draws `part="all"` inside its own single Svg.
 */
export function HaloRing({ style, from, to, boost, spread: bloom, rAvatar, uid, part = 'all' }: HaloRingProps) {
  const pieces = PART_PIECES[part];
  const has = (p: Piece) => pieces.includes(p);
  const o = (base: number) => Math.min(1, base + boost);
  // The ring sits just clear of the avatar's edge — 6% of its radius.
  const R = rAvatar * 1.06;
  // Every offset below was tuned against R = 42; `u` rescales that to the R in hand.
  const u = R / 42;
  const sweepId = `haloSweep-${uid}`;
  const crestId = `haloCrest-${uid}`;
  const lavaId = `haloLava-${uid}`;
  const petalId = `haloPetal-${uid}`;
  const pullId = `haloPull-${uid}`;
  const sweep = `url(#${sweepId})`;
  const hot = tint(to, 0.55);

  // A soft outer glow without a blur filter: three widening strokes, each fainter than the last.
  const glow = (r: number, colour: string, w: number) => (
    <G fill="none" stroke={colour}>
      <Circle cx="50" cy="50" r={r} strokeWidth={w * 3.2} opacity={0.05} />
      <Circle cx="50" cy="50" r={r} strokeWidth={w * 2} opacity={0.09} />
      <Circle cx="50" cy="50" r={r} strokeWidth={w * 1.3} opacity={0.14} />
    </G>
  );
  const ring = (r: number, stroke: string, w: number, opacity = 1) => (
    <Circle cx="50" cy="50" r={r} fill="none" stroke={stroke} strokeWidth={w} opacity={opacity} />
  );
  const at = (r: number, a: number) => ({ x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) });
  const arc = (r: number, a0: number, a1: number) => {
    const p0 = at(r, a0);
    const p1 = at(r, a1);
    return `M${fmt(p0.x)} ${fmt(p0.y)} A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(p1.x)} ${fmt(p1.y)}`;
  };

  // The live-session tier blooms OUTWARD (HALO_REACH reserved the room). Nothing at tier 0.
  const tierBloom =
    has('base') && bloom > 0 ? <Circle cx="50" cy="50" r={R + (3 + bloom * 2.6) * u} fill={to} opacity={0.07 + bloom * 0.02} /> : null;

  // Hades' pull: transparent at the avatar's edge, hottest at the streak's outer end.
  const pullR = R + 15 * u;

  const defs = (
    <Defs>
      <LinearGradient id={sweepId} x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={tint(to, 0.25)} />
        <Stop offset="0.5" stopColor={from} />
        <Stop offset="1" stopColor={to} />
      </LinearGradient>
      <LinearGradient id={crestId} x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={tint(to, 0.35)} />
        <Stop offset="1" stopColor={from} />
      </LinearGradient>
      {style === 'crown' && (
        // Mock 242's lava ramp: white-hot crest, orange body, the item's own red, a cooled crust.
        <LinearGradient id={lavaId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#fff0a8" />
          <Stop offset="0.35" stopColor="#ff9a2c" />
          <Stop offset="0.72" stopColor={mix(from, '#e23d1e', 0.5)} />
          <Stop offset="1" stopColor={shade(from, 0.4)} />
        </LinearGradient>
      )}
      {style === 'petals' && (
        <RadialGradient id={petalId} cx="38%" cy="30%" r="75%">
          <Stop offset="0" stopColor={to} />
          <Stop offset="0.7" stopColor={from} />
          <Stop offset="1" stopColor={shade(from, 0.15)} />
        </RadialGradient>
      )}
      {style === 'aura' && (
        <RadialGradient id={pullId} cx="50" cy="50" r={pullR} fx="50" fy="50" gradientUnits="userSpaceOnUse">
          <Stop offset={rAvatar / pullR} stopColor={to} stopOpacity={0} />
          <Stop offset="1" stopColor={tint(to, 0.35)} stopOpacity={1} />
        </RadialGradient>
      )}
    </Defs>
  );

  switch (style) {
    // ── warm-ring · uncommon — Copper Ring: a metal band, its light turning round it. ──
    case 'band': {
      const n = 24;
      const dark = shade(from, 0.35);
      const light = tint(to, 0.4);
      return (
        <>
          {defs}
          {has('base') && (
            <>
              {tierBloom}
              {glow(R, to, 3 * u)}
              {ring(R, shade(from, 0.45), 5 * u, o(0.9))}
              {ring(R + 2.2 * u, sweep, 1.4 * u)}
              {ring(R - 2.2 * u, sweep, 1.4 * u)}
            </>
          )}
          {has('spin') && (
            <G fill="none">
              {/* The conic metal of mock 242: three highlights running round a dark band. */}
              {Array.from({ length: n }, (_, i) => {
                const a0 = (i * Math.PI * 2) / n;
                const a1 = ((i + 1) * Math.PI * 2) / n + 0.01;
                const lit = 0.5 + 0.5 * Math.cos(((i + 0.5) * Math.PI * 6) / n);
                return <Path key={i} d={arc(R, a0, a1)} stroke={mix(dark, light, lit)} strokeWidth={3 * u} opacity={o(0.95)} />;
              })}
              {[0, 1, 2].map((k) => {
                const a = (k * Math.PI * 2) / 3 - 0.08;
                return <Path key={`g${k}`} d={arc(R, a, a + 0.16)} stroke="#ffffff" strokeWidth={0.9 * u} strokeLinecap="round" opacity={0.75} />;
              })}
            </G>
          )}
        </>
      );
    }

    // ── ember-orbit — Ember Halo: two condensed rings, an orbit of coals between them. ──
    case 'double':
      return (
        <>
          {defs}
          {has('base') && (
            <>
              {tierBloom}
              {glow(R + u, from, 2.4 * u)}
              {ring(R + 3 * u, sweep, 2.6 * u, o(0.95))}
              {ring(R - 3 * u, to, 1.4 * u, o(0.8))}
            </>
          )}
          {has('spin') &&
            Array.from({ length: 6 }, (_, i) => {
              const p = at(R, (i * Math.PI * 2) / 6);
              return (
                <G key={i}>
                  <Circle cx={p.x} cy={p.y} r={4 * u} fill={to} opacity={0.18} />
                  <Circle cx={p.x} cy={p.y} r={2.3 * u} fill={from} />
                  <Circle cx={p.x - 0.5 * u} cy={p.y - 0.5 * u} r={1.1 * u} fill={hot} />
                </G>
              );
            })}
        </>
      );

    // ── warm-ring · rare+ — Glowing Amber: honey-light, pulsing hot, with an outer echo. ──
    case 'glow':
      return (
        <>
          {defs}
          {has('base') && (
            <>
              {tierBloom}
              {ring(R, from, 6 * u, o(0.5))}
              {ring(R, sweep, 3.6 * u, o(0.95))}
              {ring(R + 5.6 * u, to, 0.7 * u, 0.3)}
            </>
          )}
          {has('pulse') && (
            <>
              {glow(R, to, 5 * u)}
              {ring(R, tint(to, 0.6), 1.2 * u, o(0.9))}
              {ring(R + 5.6 * u, tint(to, 0.3), 1.1 * u, 0.35)}
            </>
          )}
        </>
      );

    // ── ember-orbit — Emberfall Halo: a ring of falling embers that never reaches the ground. ──
    // Live, the embers fall through the ring (EmberFall); frozen, they hang off its lower arc.
    case 'embers':
      return (
        <>
          {defs}
          {has('base') && (
            <>
              {tierBloom}
              {glow(R, from, 3 * u)}
              {ring(R, sweep, 3.2 * u, o(0.95))}
            </>
          )}
          {has('frozen') &&
            Array.from({ length: 7 }, (_, i) => {
              const p = at(R + (2.6 + (i % 3) * 2.6) * u, Math.PI * (0.18 + i * 0.107));
              const r = (1.9 - (i % 3) * 0.4) * u;
              return (
                <G key={i}>
                  <Circle cx={p.x} cy={p.y} r={r * 2} fill={to} opacity={0.2} />
                  <Circle cx={p.x} cy={p.y} r={r} fill={to} />
                  <Circle cx={p.x} cy={p.y} r={r * 0.5} fill={hot} />
                </G>
              );
            })}
        </>
      );

    // ── prism — Diamond Prism: a faceted spectrum sweeping round inside a fine bezel. ──
    case 'prism': {
      const n = 12;
      const gap = 0.07;
      return (
        <>
          {defs}
          {has('base') && (
            <>
              {tierBloom}
              {glow(R, mix(from, to, 0.5), 3 * u)}
              {ring(R + 3.3 * u, '#ffffff', 0.5 * u, 0.35)}
              {ring(R - 3.3 * u, '#ffffff', 0.5 * u, 0.3)}
            </>
          )}
          {has('spin') && (
            <G fill="none" strokeLinecap="round">
              {Array.from({ length: n }, (_, i) => {
                const tri = 1 - Math.abs((2 * i) / n - 1);
                return (
                  <Path
                    key={i}
                    d={arc(R, (i * Math.PI * 2) / n + gap, ((i + 1) * Math.PI * 2) / n - gap)}
                    stroke={mix(from, to, tri)}
                    strokeWidth={4.4 * u}
                    opacity={o(0.95)}
                  />
                );
              })}
              {[0, 4, 8].map((i) => {
                const a = (i * Math.PI * 2) / n + 0.18;
                return <Path key={`g${i}`} d={arc(R + 0.4 * u, a, a + 0.2)} stroke="#ffffff" strokeWidth={1.5 * u} opacity={0.9} />;
              })}
            </G>
          )}
        </>
      );
    }

    // ── fire-ring ★ — Inferno Flare: a ring of fire, tongues licking outward. Live, two tongue
    // sets (long-short and short-long) cross-fade so every tongue flares and drops in turn. ──
    case 'flare': {
      const tongues = (alt: boolean) =>
        flameRing(R, u, 14, 1, (k) => ((k % 2 === 0) !== alt ? 8 : 5.4));
      return (
        <>
          {defs}
          {has('lick') && <Path d={tongues(false)} fill={to} opacity={o(0.88)} />}
          {has('lick-alt') && <Path d={tongues(true)} fill={to} opacity={o(0.88)} />}
          {has('base') && (
            <>
              {tierBloom}
              {glow(R + 2 * u, to, 4 * u)}
              <Path d={flameRing(R, u, 14, 0.5, (k) => (k % 2 === 0 ? 4.6 : 3))} fill={hot} opacity={o(0.9)} />
              {ring(R, sweep, 4 * u, o(0.95))}
            </>
          )}
        </>
      );
    }

    // ── hades ★ — a black hole: a void hugging the avatar, a red accretion ring outside it, and
    // light pulled inward along six spokes that all meet at the avatar's centre. ──
    case 'aura': {
      let spokes = '';
      for (let k = 0; k < 6; k += 1) {
        const a = (k * Math.PI) / 3 + Math.PI / 6;
        const p0 = at(R + 13 * u, a);
        const p1 = at(rAvatar, a);
        spokes += `M${fmt(p0.x)} ${fmt(p0.y)} L${fmt(p1.x)} ${fmt(p1.y)} `;
      }
      return (
        <>
          {defs}
          {has('base') && (
            <>
              {tierBloom}
              {/* The event horizon — darker than the night behind it. */}
              {ring(R + 1.5 * u, '#05000a', 6 * u, 0.95)}
              {ring(R + 5 * u, shade(to, 0.6), 2.6 * u, o(0.9))}
              {ring(R + 7.4 * u, to, 2.4 * u, o(0.95))}
              {ring(R + 7.4 * u, tint(to, 0.45), 0.7 * u, o(0.9))}
            </>
          )}
          {has('pulse') && (
            <>
              {glow(R + 7.4 * u, to, 4 * u)}
              {ring(R + 10.5 * u, to, 2.4 * u, 0.16)}
            </>
          )}
          {has('frozen') && <Path d={spokes} stroke={`url(#${pullId})`} strokeWidth={1.4 * u} strokeLinecap="round" fill="none" />}
        </>
      );
    }

    // ── crown ★ — Emberfall Crown: a ring, and a crown of molten lava worn on the head. ──
    case 'crown': {
      const place = crownTransform(R);
      return (
        <>
          {defs}
          {has('base') && (
            <>
              {tierBloom}
              {glow(R, from, 3 * u)}
              {ring(R, sweep, 3.6 * u, o(0.95))}
              {ring(R - 1.1 * u, '#ffffff', 0.6 * u, 0.2)}
            </>
          )}
          {has('pulse') && (
            <>
              {glow(R, to, 2.6 * u)}
              {/* The crown's heat-haze, behind it: the drop-shadow swell of mock 242. */}
              <G transform={place}>
                <Path d={CROWN_D} fill="none" stroke="#ff8a3c" strokeWidth={7} strokeLinejoin="round" opacity={0.22} />
                <Path d={CROWN_D} fill="none" stroke="#ffc478" strokeWidth={3} strokeLinejoin="round" opacity={0.3} />
              </G>
            </>
          )}
          {has('over') && (
            <G transform={place}>
              <Path d={CROWN_D} fill={`url(#${lavaId})`} stroke="#ffc478" strokeWidth={0.8} strokeLinejoin="round" />
              {/* Molten seams down the three tall points. */}
              <Path d="M40 9 L40 28 M27 16 L28 30 M53 16 L52 30" stroke="#fff0a8" strokeWidth={1.1} strokeLinecap="round" opacity={0.55} />
              <Rect x="5" y="39.5" width="70" height="3.5" fill="#ffe3a0" opacity={0.32} />
              <Circle cx="40" cy="12.5" r="4.2" fill="#ff4d4d" stroke="#ffd0d0" strokeWidth={0.8} />
              <Circle cx="39" cy="11.4" r="1.3" fill="#ffffff" opacity={0.7} />
              <Circle cx="13" cy="24" r="2.3" fill="#ffcf5a" />
              <Circle cx="67" cy="24" r="2.3" fill="#ffcf5a" />
            </G>
          )}
        </>
      );
    }

    // ── petals ★ — Sakura: not fire. A faint ring the petals ride round. ──
    case 'petals': {
      const Ro = petalOrbit(R);
      const sc = petalScale(rAvatar);
      // Frozen: five petals mid-orbit and one still falling in from the top.
      const frozen = [
        { x: 50 - 6 * u, y: 50 - Ro - 3.5 * u, rot: 20 },
        ...[34, 100, 168, 236, 300].map((deg, i) => {
          const th = (deg * Math.PI) / 180;
          return { x: 50 + Ro * Math.sin(th), y: 50 - Ro * Math.cos(th), rot: deg + 40 + i * 9 };
        }),
      ];
      return (
        <>
          {defs}
          {has('base') && (
            <>
              {tierBloom}
              {glow(R, from, 2 * u)}
              {ring(R, from, 1.1 * u, o(0.4))}
            </>
          )}
          {has('frozen') &&
            frozen.map((p, i) => (
              <G key={i} transform={`translate(${fmt(p.x)} ${fmt(p.y)}) rotate(${p.rot}) scale(${fmt(sc)})`}>
                <Path d={PETAL_D} fill={`url(#${petalId})`} />
              </G>
            ))}
        </>
      );
    }

    // ── warm-ring · common — Emberring, the base: one clean swept ring with a specular inner
    // edge, breathing. The plain one on purpose: everything above has to read as an upgrade. ──
    case 'ring':
    default:
      return (
        <>
          {defs}
          {tierBloom}
          {has('pulse') && (
            <>
              {glow(R, to, 3 * u)}
              {ring(R, sweep, 3.4 * u, o(0.95))}
              {ring(R - 1.1 * u, '#ffffff', 0.6 * u, 0.22)}
            </>
          )}
        </>
      );
  }
}

/** `count` flame tongues round a ring of radius R, as one compound path — one draw call, not 14. */
function flameRing(R: number, u: number, count: number, scale: number, length: (k: number) => number): string {
  let d = '';
  for (let k = 0; k < count; k += 1) {
    const a = (k * Math.PI * 2) / count;
    const half = 0.12 * scale + 0.04;
    const base = R + 0.5 * u;
    const tip = R + length(k) * u;
    // A lean, so the tongues curl the same way round the ring instead of standing out like spokes.
    const lean = 0.09;
    const b0 = { x: 50 + base * Math.cos(a - half), y: 50 + base * Math.sin(a - half) };
    const b1 = { x: 50 + base * Math.cos(a + half), y: 50 + base * Math.sin(a + half) };
    const t = { x: 50 + tip * Math.cos(a + lean), y: 50 + tip * Math.sin(a + lean) };
    const mid = (base + tip) / 2;
    const c0 = { x: 50 + mid * Math.cos(a - half * 0.6), y: 50 + mid * Math.sin(a - half * 0.6) };
    const c1 = { x: 50 + mid * Math.cos(a + half * 1.1 + lean), y: 50 + mid * Math.sin(a + half * 1.1 + lean) };
    d += `M${fmt(b0.x)} ${fmt(b0.y)} Q${fmt(c0.x)} ${fmt(c0.y)} ${fmt(t.x)} ${fmt(t.y)} Q${fmt(c1.x)} ${fmt(c1.y)} ${fmt(b1.x)} ${fmt(b1.y)} Z `;
  }
  return d;
}

// ─────────────────────────── the worn halo ───────────────────────────

type RingArt = Omit<HaloRingProps, 'uid' | 'part'>;

/**
 * A halo worn round `children` (the avatar). The box is larger than `size` by the style's reach, so
 * the ring never crops the face it surrounds. `motion="still"` freezes it (lists, image captures);
 * Reduce Motion and an off-screen screen freeze it too.
 */
export function HaloFrame({
  item,
  size,
  boost = 0,
  spread: bloom = 0,
  motion = 'full',
  children,
}: {
  item: CatalogItem | undefined;
  size: number;
  boost?: number;
  spread?: number;
  motion?: 'full' | 'still';
  children: ReactNode;
}) {
  const uid = useId();
  const from = item?.art.from ?? Colors.ember;
  const to = item?.art.to ?? Colors.amber;
  const style = item ? haloStyleForItem(item) : 'ring';
  const reach = HALO_REACH[style] + bloom * 0.09;
  const pad = (size / 2) * (reach - 1);
  const box = size + pad * 2;
  // The avatar's radius in the Svg's 0-100 space — every mark is a multiple of it.
  const ring: RingArt = { style, from, to, boost, spread: bloom, rAvatar: 50 * (size / box) };
  const live = motion === 'full';

  return (
    <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      {live ? <HaloUnderLive ring={ring} box={box} uid={uid} /> : <HaloStill ring={ring} box={box} uid={uid} />}
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>{children}</View>
      {HALO_OVER[style] && (
        <Svg width={box} height={box} viewBox="0 0 100 100" style={StyleSheet.absoluteFill} pointerEvents="none">
          <HaloRing {...ring} uid={`${uid}o`} part="over" />
        </Svg>
      )}
      {live && HALO_LIVE[style].movers === 'petals' && <HaloOverLive ring={ring} box={box} uid={uid} />}
    </View>
  );
}

function HaloLayerSvg({ ring, box, uid, part }: { ring: RingArt; box: number; uid: string; part: HaloPart }) {
  return (
    <Svg width={box} height={box} viewBox="0 0 100 100" pointerEvents="none">
      <HaloRing {...ring} uid={`${uid}${part}`} part={part} />
    </Svg>
  );
}

function HaloStill({ ring, box, uid }: { ring: RingArt; box: number; uid: string }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <HaloLayerSvg ring={ring} box={box} uid={uid} part="still" />
    </View>
  );
}

/** Behind the avatar. Parks on the frozen frame under Reduce Motion or off-screen. */
function HaloUnderLive({ ring, box, uid }: { ring: RingArt; box: number; uid: string }) {
  const reduceMotion = useReducedMotion();
  const active = useMotionActive();
  if (reduceMotion || !active) return <HaloStill ring={ring} box={box} uid={uid} />;
  return <HaloLiveLayers ring={ring} box={box} uid={uid} />;
}

function HaloLiveLayers({ ring, box, uid }: { ring: RingArt; box: number; uid: string }) {
  const clock = useCosmeticClock(HALO_CLOCK_MS, true);
  const live = HALO_LIVE[ring.style];
  return (
    <>
      {/* Tongues go UNDER the base so the ring and its hot inner flames stay on top of them. */}
      {live.lick !== undefined && (
        <>
          <LickLayer clock={clock} mult={live.lick} alt={false}>
            <HaloLayerSvg ring={ring} box={box} uid={uid} part="lick" />
          </LickLayer>
          <LickLayer clock={clock} mult={live.lick} alt>
            <HaloLayerSvg ring={ring} box={box} uid={uid} part="lick-alt" />
          </LickLayer>
        </>
      )}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <HaloLayerSvg ring={ring} box={box} uid={uid} part="base" />
      </View>
      {live.spin !== undefined && (
        <SpinLayer clock={clock} mult={live.spin}>
          <HaloLayerSvg ring={ring} box={box} uid={uid} part="spin" />
        </SpinLayer>
      )}
      {live.pulse && (
        <PulseLayer clock={clock} mult={live.pulse.mult} lo={live.pulse.lo}>
          <HaloLayerSvg ring={ring} box={box} uid={uid} part="pulse" />
        </PulseLayer>
      )}
      {live.movers === 'embers' && <EmberFall clock={clock} ring={ring} box={box} />}
      {live.movers === 'streaks' && <HadesStreaks clock={clock} ring={ring} box={box} uid={uid} />}
    </>
  );
}

/** On top of the avatar — only Sakura's petals, which must never be hidden behind a face. */
function HaloOverLive({ ring, box, uid }: { ring: RingArt; box: number; uid: string }) {
  const reduceMotion = useReducedMotion();
  const active = useMotionActive();
  if (reduceMotion || !active) return null; // the frozen petals are in the still layer
  return <PetalFall ring={ring} box={box} uid={uid} />;
}

type Clock = SharedValue<number>;

function SpinLayer({ clock, mult, children }: { clock: Clock; mult: number; children: ReactNode }) {
  // The box is square and centred on the avatar, so the view's own centre IS the pivot.
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${clock.value * mult * 360}deg` }] }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      {children}
    </Animated.View>
  );
}

function PulseLayer({ clock, mult, lo, children }: { clock: Clock; mult: number; lo: number; children: ReactNode }) {
  const style = useAnimatedStyle(() => ({
    opacity: lo + (1 - lo) * (0.5 - 0.5 * Math.cos(clock.value * mult * Math.PI * 2)),
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      {children}
    </Animated.View>
  );
}

function LickLayer({ clock, mult, alt, children }: { clock: Clock; mult: number; alt: boolean; children: ReactNode }) {
  const style = useAnimatedStyle(() => {
    const w = 0.5 + 0.5 * Math.cos(clock.value * mult * Math.PI * 2);
    const k = alt ? 1 - w : w;
    // Scaling about the avatar's centre pushes the tongues OUTWARD as they flare.
    return { opacity: 0.25 + 0.75 * k, transform: [{ scale: 0.97 + 0.06 * k }] };
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      {children}
    </Animated.View>
  );
}

// ── Emberfall Halo: six embers falling through the ring, lanes spread across its width. ──

const EMBER_LANES = [-0.92, -0.58, -0.22, 0.2, 0.56, 0.9];

function EmberFall({ clock, ring, box }: { clock: Clock; ring: RingArt; box: number }) {
  const p = box / 100;
  const R = ring.rAvatar * 1.06;
  const u = R / 42;
  const size = 8.4 * u * p;
  const yTop = 50 - R - 5 * u;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {EMBER_LANES.map((lane, i) => (
        <FallingEmber
          key={i}
          clock={clock}
          mult={8 + (i % 3)}
          phase={spread(i, 0.3)}
          left={(50 + lane * R) * p - size / 2}
          top={yTop * p - size / 2}
          travel={(2 * R + 10 * u) * p}
          size={size}
          to={ring.to}
        />
      ))}
    </View>
  );
}

function FallingEmber({
  clock,
  mult,
  phase,
  left,
  top,
  travel,
  size,
  to,
}: {
  clock: Clock;
  mult: number;
  phase: number;
  left: number;
  top: number;
  travel: number;
  size: number;
  to: string;
}) {
  const style = useAnimatedStyle(() => {
    const t = (clock.value * mult + phase) % 1;
    // mock `efall`: in by 12%, dimming to .6 by 72%, out at the bottom.
    const o = t < 0.12 ? t / 0.12 : t < 0.72 ? 1 - (0.4 * (t - 0.12)) / 0.6 : 0.6 * (1 - (t - 0.72) / 0.28);
    return { opacity: o, transform: [{ translateY: t * travel }] };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left, top, width: size, height: size, opacity: 0 }, style]} pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 20 20">
        <Circle cx="10" cy="10" r="10" fill={to} opacity={0.2} />
        <Circle cx="10" cy="10" r="5" fill={to} />
        <Circle cx="10" cy="10" r="2.5" fill={tint(to, 0.55)} />
      </Svg>
    </Animated.View>
  );
}

// ── Hades: six streaks pulled into the void. Each is a full-box view rotated about the avatar's
// centre and squashed TOWARD it (scaleY about the same centre), so every streak converges on the
// middle of the ring — never on a corner of the box. ──

const STREAKS: readonly { angle: number; delay: number }[] = [
  { angle: 0, delay: 0 },
  { angle: 60, delay: 0.2 },
  { angle: 120, delay: 0.4 },
  { angle: 180, delay: 0.6 },
  { angle: 240, delay: 0.3 },
  { angle: 300, delay: 0.5 },
];
const STREAK_MULT = 18; // ~1.33s, mock 1.3s

function HadesStreaks({ clock, ring, box, uid }: { clock: Clock; ring: RingArt; box: number; uid: string }) {
  const R = ring.rAvatar * 1.06;
  const u = R / 42;
  const outer = R + 15 * u;
  const inner = ring.rAvatar;
  const cycle = HALO_CLOCK_MS / STREAK_MULT / 1000;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {STREAKS.map((s, i) => (
        <Streak
          key={i}
          clock={clock}
          phase={(1 - s.delay / cycle + 1) % 1}
          angle={s.angle}
          outer={outer}
          inner={inner}
          width={1.4 * u}
          box={box}
          to={ring.to}
          id={`haloStreak-${uid}-${i}`}
        />
      ))}
    </View>
  );
}

function Streak({
  clock,
  phase,
  angle,
  outer,
  inner,
  width,
  box,
  to,
  id,
}: {
  clock: Clock;
  phase: number;
  angle: number;
  outer: number;
  inner: number;
  width: number;
  box: number;
  to: string;
  id: string;
}) {
  // At full squash the bright tip reaches the avatar's edge and goes under it — into the hole.
  const sMin = inner / outer;
  const style = useAnimatedStyle(() => {
    const t = (clock.value * STREAK_MULT + phase) % 1;
    const s = 1 - (1 - sMin) * t * t;
    const o = t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75;
    return { opacity: o, transform: [{ rotate: `${angle}deg` }, { scaleY: s }] };
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: 0 }, style]} pointerEvents="none">
      <Svg width={box} height={box} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={id} cx="50" cy="50" r={outer} fx="50" fy="50" gradientUnits="userSpaceOnUse">
            <Stop offset={sMin * 0.9} stopColor={to} stopOpacity={0} />
            <Stop offset="1" stopColor={tint(to, 0.35)} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Path d={`M50 ${fmt(50 - outer)} L50 ${fmt(50 - inner * 0.9)}`} stroke={`url(#${id})`} strokeWidth={width} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

// ── Sakura: seven petals, each on the same screen-space path, a seventh of a cycle apart. ──

const PETAL_COUNT = 7;
const PETAL_MULT = 3; // 8s per petal life, mock 7s

function PetalFall({ ring, box, uid }: { ring: RingArt; box: number; uid: string }) {
  const clock = useCosmeticClock(HALO_CLOCK_MS, true);
  const p = box / 100;
  const R = ring.rAvatar * 1.06;
  const size = 12 * petalScale(ring.rAvatar) * p;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: PETAL_COUNT }, (_, i) => (
        <Petal
          key={i}
          clock={clock}
          phase={i / PETAL_COUNT}
          orbit={petalOrbit(R) * p}
          // Petals appear just inside the box's top edge, centred over the avatar.
          drop={(50 - size / p / 2 - 1) * p}
          centre={50 * p}
          size={size}
          from={ring.from}
          to={ring.to}
          id={`haloPetalLive-${uid}-${i}`}
        />
      ))}
    </View>
  );
}

function Petal({
  clock,
  phase,
  orbit,
  drop,
  centre,
  size,
  from,
  to,
  id,
}: {
  clock: Clock;
  phase: number;
  orbit: number;
  drop: number;
  centre: number;
  size: number;
  from: string;
  to: string;
  id: string;
}) {
  const style = useAnimatedStyle(() => {
    const t = (clock.value * PETAL_MULT + phase) % 1;
    let x = 0;
    let y = -drop;
    let o = 1;
    let rot = 0;
    let sc = 1;
    if (t < 0.09) {
      // Fade in, hanging at the top.
      o = t / 0.09;
    } else if (t < 0.24) {
      // Fall straight down onto the top of the ring.
      const k = (t - 0.09) / 0.15;
      const e = k * k * (3 - 2 * k);
      y = -drop + (drop - orbit) * e;
      rot = 40 * k;
    } else {
      // One clockwise orbit from the top, dissipating over its last stretch.
      const k = (t - 0.24) / 0.76;
      const th = k * Math.PI * 2;
      x = orbit * Math.sin(th);
      y = -orbit * Math.cos(th);
      rot = 40 + 324 * k;
      if (t > 0.86) {
        const f = (t - 0.86) / 0.14;
        o = 1 - f;
        sc = 1 - 0.45 * f;
      }
    }
    return { opacity: o, transform: [{ translateX: x }, { translateY: y }, { rotate: `${rot}deg` }, { scale: sc }] };
  });
  return (
    <Animated.View
      style={[{ position: 'absolute', left: centre - size / 2, top: centre - size / 2, width: size, height: size, opacity: 0 }, style]}
      pointerEvents="none">
      <Svg width={size} height={size} viewBox="-6 -6 12 12">
        <Defs>
          <RadialGradient id={id} cx="38%" cy="30%" r="75%">
            <Stop offset="0" stopColor={to} />
            <Stop offset="0.7" stopColor={from} />
            <Stop offset="1" stopColor={shade(from, 0.15)} />
          </RadialGradient>
        </Defs>
        <Path d={PETAL_D} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}
