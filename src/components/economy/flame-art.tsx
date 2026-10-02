import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, Polygon, RadialGradient, Stop } from 'react-native-svg';

import { useCosmeticClock } from '@/components/economy/cosmetic-clock';
import { useMotionActive } from '@/hooks/use-motion-active';
import type { FlameArchetype } from '@/lib/economy/catalog';
import { shade, tint } from '@/lib/economy/colour';
import { useEquipped } from '@/lib/economy/loadout';
import type { Rarity } from '@/lib/economy/rarity';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE FLAME FAMILY — one bespoke drawing per flame ARCHETYPE (design-mocks/240).
//
// Mock 240's audit: every flame was one silhouette recoloured, eleven skins that differed only in
// hue. The call it locked is PER-FAMILY with a flourish for the top two rarities: seven archetypes,
// each its own silhouette and signature marks, all still tinted by the item's `art.from/to` so the
// colour that separates Lime Volt from Electric Cyan is untouched.
//
//   ember    calm, patient — the base drawing (it IS the old generic flame)
//   volt     jagged-edged body, electric arcs thrown off the flanks
//   toxic    a gloopy body, bubbles rising off it, a drip hanging under it
//   solar    a roaring many-tongued body inside a corona, flare rays radiating
//   cosmic   a nebula-filled body with a slow swirl and stars inside it
//   neutron  a needle-thin body round a blinding white core, sharp radiant spokes
//   forge    a billowing hammered body throwing sparks
//
// RARITY FLOURISH (mock 240's footer): Legendary and Mythic get a rim of hot light round the
// silhouette, and Mythic adds the strike — the bolt mock 240 gives Stormforge.
//
// TWO REGISTERS. Every mark is authored in item-art's 0-100 tile box (silhouette bottoms out at
// y=84, centred on x=50, ground shadow at 88). The live flame (flame-icon's FlameSvg) is the brand
// FLAME_PATH in a 24 box, and keeps it — the brand mark is not a cosmetic — so it draws the same
// marks mapped onto that box through MARKS_ON_BRAND, inside the brand's one mirror.
//
// MOTION follows campfire-banner-art's four rules: the drawing is static SVG; the motion is a few
// small Animated.Views (`FlameArchetypeOverlay`) on the UI thread, every one of them reading ONE
// shared cosmetic clock per cadence; counts are capped (≤5 movers per archetype); and every
// position is a constant, never Math.random(). Reduce motion / grids / share captures get the
// static drawing, which carries every mark at its representative frame.
//
// §4 HARD CONSTRAINT: nothing here may touch size, intensity or the activity animation of a live
// flame. The archetype changes the DRAWING and its colours only; the callers keep every state
// signal (dimmed, flick, glow pulse, stage growth) exactly as it was.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const ARCHETYPES: ReadonlySet<string> = new Set<FlameArchetype>([
  'ember',
  'volt',
  'toxic',
  'solar',
  'cosmic',
  'neutron',
  'forge',
]);

/** A flame archetype this build knows how to draw. Anything else falls back to the generic flame. */
export function isFlameArchetype(a: string | undefined | null): a is FlameArchetype {
  return !!a && ARCHETYPES.has(a);
}

function hasFlourish(rarity: Rarity): boolean {
  return rarity === 'legendary' || rarity === 'mythic';
}

/** Safe inside url(#…) — useId's `:r7:` tokens carry colons. */
function idSafe(uid: string): string {
  return uid.replace(/[^a-zA-Z0-9_-]/g, '');
}

// ─────────────────────────── the silhouettes (0-100 tile box) ───────────────────────────

/** The generic flame — item-art's `case 'flame'`, kept verbatim. Ember's drawing and the fallback. */
const GENERIC_BODY =
  'M50 84 C26 72 22 48 36 30 C40 42 48 42 49 32 C50 18 42 12 52 4 C54 22 74 22 75 46 C90 40 86 16 78 8 C96 26 98 58 74 80 C82 66 74 52 64 50 C68 66 62 78 50 84 Z';
const GENERIC_CORE =
  'M50 78 C40 72 38 58 45 48 C47 55 51 55 51 48 C52 40 47 36 53 28 C55 42 66 42 66 56 C72 52 70 40 66 36 C76 46 76 64 62 76 C66 68 60 60 54 60 C57 68 55 74 50 78 Z';

const BODY: Record<FlameArchetype, string> = {
  ember: GENERIC_BODY,
  // Every edge a zig — the silhouette alone says "electric" at 27pt, before any arc is visible.
  volt: 'M50 84 C32 82 22 68 26 52 L33 56 L31 40 L39 45 L41 28 L47 34 L51 6 L56 28 L63 20 L63 37 L71 31 L69 46 L76 44 C80 66 68 82 50 84 Z',
  // Lumpy, sagging, wider than it is tall-looking — an ooze rather than a lick.
  toxic: 'M50 84 C32 84 22 72 25 58 C27 48 35 44 35 34 C40 39 44 36 44 28 C49 33 54 24 52 12 C61 21 66 30 62 40 C67 37 69 32 69 28 C77 40 80 56 75 69 C71 79 63 84 50 84 Z',
  // Broad and many-tongued — the roar.
  solar: 'M50 84 C29 83 19 66 25 48 C29 54 34 54 34 47 C33 35 38 27 43 19 C44 29 48 31 50 26 C51 18 54 11 58 5 C60 17 64 25 64 32 C68 28 70 23 70 18 C78 30 82 46 77 62 C73 76 63 84 50 84 Z',
  // A smooth curling teardrop — room inside it for the nebula.
  cosmic: 'M50 84 C29 83 22 63 31 45 C37 34 46 30 46 17 C52 23 56 28 54 37 C60 31 63 21 58 7 C72 21 80 42 75 62 C71 76 62 84 50 84 Z',
  // A needle — all the energy pulled into one line.
  neutron: 'M50 84 C37 81 32 66 38 52 C42 42 47 30 50 4 C53 30 58 42 62 52 C68 66 63 81 50 84 Z',
  // A billow with a second tongue thrown sideways, as off a struck bar.
  forge: 'M50 84 C30 82 22 66 28 50 C32 56 38 56 38 48 C38 36 30 30 36 18 C42 28 50 28 52 20 C54 12 52 8 56 4 C62 16 70 22 68 36 C74 32 76 26 74 20 C84 34 84 56 76 68 C70 78 60 84 50 84 Z',
};

/** The inner core of a bespoke silhouette: the body itself, pulled in toward its base. */
const CORE_TRANSFORM = 'translate(50 84) scale(0.6 0.66) translate(-50 -84)';

/**
 * Maps a mark authored in the 0-100 tile box onto the brand FLAME_PATH's 24 box: the tile flame's
 * base (50,84) lands on the brand flame's base (12,18.5), and its 78-unit height on the brand's 16.5.
 */
export const MARKS_ON_BRAND = 'translate(12 18.5) scale(0.2115) translate(-50 -84)';

// ─────────────────────────── the marks (0-100 tile box) ───────────────────────────
//
// Every mark that MOVES at hero size is listed once, here, with its position — the still drawing
// and the overlay both read these tables, so the animated frame and the static one cannot disagree.

const VOLT_ARCS = [
  { d: 'M46 24 L40 16 L44 12 L37 4', cx: 41.5, cy: 14, phase: 0 },
  { d: 'M70 40 L78 34 L76 28 L86 22', cx: 78, cy: 31, phase: 0.33 },
  { d: 'M30 50 L22 46 L24 40 L14 36', cx: 22, cy: 43, phase: 0.66 },
];

const TOXIC_BUBBLES = [
  { x: 40, y: 40, r: 3.2, phase: 0 },
  { x: 58, y: 26, r: 2.4, phase: 0.36 },
  { x: 64, y: 52, r: 1.8, phase: 0.68 },
];
/** The drop forming under the body — static. The bead at its foot is what falls. */
const TOXIC_DRIP = 'M53 81 C53 85 54 86 55 88 C56 86 57 85 57 81 Z';
const TOXIC_BEAD = { x: 55, y: 90.5, r: 2.6 };

const SOLAR_CENTRE = { x: 50, y: 50 };
/** Four upper diagonals, started outside the body so they can breathe in front of it. */
const SOLAR_RAYS = [-162, -126, -54, -18];

const COSMIC_STARS = [
  { x: 44, y: 40, s: 3, phase: 0 },
  { x: 60, y: 52, s: 2.4, phase: 0.32 },
  { x: 48, y: 64, s: 2, phase: 0.59 },
  { x: 38, y: 54, s: 1.6, phase: 0.82 },
];

const NEUTRON_CORE = { x: 50, y: 60 };
const NEUTRON_AXES = [-90, 0, 90, 180];
const NEUTRON_DIAGONALS = [-135, -45, 45, 135];

const FORGE_SPARKS = [
  { x: 36, y: 40, dx: -14, phase: 0 },
  { x: 64, y: 30, dx: 16, phase: 0.3 },
  { x: 56, y: 18, dx: 6, phase: 0.6 },
  { x: 42, y: 26, dx: -8, phase: 0.8 },
];
const FORGE_RISE = 40;

const MYTHIC_BOLT = { d: 'M80 4 L70 18 L76 19 L64 34', cx: 72, cy: 19 };

function rayPoints(cx: number, cy: number, deg: number, r0: number, r1: number, w: number): string {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x0 = cx + r0 * c;
  const y0 = cy + r0 * s;
  const f = (n: number) => n.toFixed(2);
  return `${f(x0 - w * s)},${f(y0 + w * c)} ${f(x0 + w * s)},${f(y0 - w * c)} ${f(cx + r1 * c)},${f(cy + r1 * s)}`;
}

/** A four-point sparkle — concave sides, reads as a star rather than as a diamond. */
function sparkle(x: number, y: number, s: number): string {
  return `M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s} Z`;
}

function VoltArc({ d, to }: { d: string; to: string }) {
  return (
    <>
      <Path d={d} fill="none" stroke={to} strokeWidth={4.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.28} />
      <Path d={d} fill="none" stroke={tint(to, 0.55)} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function Bubble({ x, y, r, from, to }: { x: number; y: number; r: number; from: string; to: string }) {
  return (
    <>
      <Circle cx={x} cy={y} r={r} fill={tint(to, 0.15)} stroke={from} strokeWidth={0.6} opacity={0.88} />
      <Circle cx={x - r * 0.35} cy={y - r * 0.35} r={r * 0.32} fill="#ffffff" opacity={0.7} />
    </>
  );
}

function SolarRay({ deg, to }: { deg: number; to: string }) {
  return <Polygon points={rayPoints(SOLAR_CENTRE.x, SOLAR_CENTRE.y, deg, 35, 49, 1.8)} fill={to} opacity={0.6} />;
}

function NeutronRay({ deg, r0, r1 }: { deg: number; r0: number; r1: number }) {
  return <Polygon points={rayPoints(NEUTRON_CORE.x, NEUTRON_CORE.y, deg, r0, r1, 1.1)} fill="#ffffff" opacity={0.7} />;
}

function NeutronCore({ id }: { id: string }) {
  return (
    <>
      <Circle cx={NEUTRON_CORE.x} cy={NEUTRON_CORE.y} r={12} fill={`url(#${id})`} />
      <Circle cx={NEUTRON_CORE.x} cy={NEUTRON_CORE.y} r={3.6} fill="#ffffff" />
    </>
  );
}

function NeutronCoreDefs({ id }: { id: string }) {
  return (
    <RadialGradient id={id} cx="50%" cy="50%" r="50%">
      <Stop offset="0" stopColor="#ffffff" stopOpacity={1} />
      <Stop offset="0.5" stopColor="#dfe8ff" stopOpacity={0.75} />
      <Stop offset="1" stopColor="#dfe8ff" stopOpacity={0} />
    </RadialGradient>
  );
}

function ForgeSpark({ x, y, dx, to, t }: { x: number; y: number; dx: number; to: string; t: number }) {
  // Drawn `t` of the way along its flight, with the trail pointing back where it came from.
  const px = x + dx * t;
  const py = y - FORGE_RISE * t;
  return (
    <>
      <Path d={`M${px} ${py} L${px - dx * 0.18} ${py + FORGE_RISE * 0.18}`} stroke={to} strokeWidth={1.1} strokeLinecap="round" opacity={0.6} />
      <Circle cx={px} cy={py} r={1.7} fill="#ffe9b0" />
    </>
  );
}

function Bolt({ d }: { d: string }) {
  return (
    <>
      <Path d={d} fill="none" stroke="#bcd4ff" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" opacity={0.3} />
      <Path d={d} fill="none" stroke="#eef4ff" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </>
  );
}

type MarkProps = {
  archetype: FlameArchetype;
  rarity: Rarity;
  from: string;
  to: string;
  /** Already id-safe. */
  ids: string;
  /** True when FlameArchetypeOverlay is drawing the moving marks — the still drawing leaves them out. */
  live: boolean;
};

/** Marks BEHIND the body — the corona, the neutron's spokes. */
function BackMarks({ archetype, from, to, live }: MarkProps) {
  switch (archetype) {
    case 'solar':
      return (
        <>
          <Circle cx={SOLAR_CENTRE.x} cy={SOLAR_CENTRE.y} r={36} fill="none" stroke={from} strokeWidth={7} opacity={0.2} />
          <Circle cx={SOLAR_CENTRE.x} cy={SOLAR_CENTRE.y} r={36} fill="none" stroke={tint(to, 0.3)} strokeWidth={1.2} opacity={0.45} />
          {/* Straight up and the two lower diagonals radiate from behind the body; they never move. */}
          <Polygon points={rayPoints(SOLAR_CENTRE.x, SOLAR_CENTRE.y, -90, 0, 49, 2)} fill={to} opacity={0.4} />
          <Polygon points={rayPoints(SOLAR_CENTRE.x, SOLAR_CENTRE.y, 54, 0, 44, 1.8)} fill={to} opacity={0.35} />
          <Polygon points={rayPoints(SOLAR_CENTRE.x, SOLAR_CENTRE.y, 126, 0, 44, 1.8)} fill={to} opacity={0.35} />
        </>
      );
    case 'neutron':
      return (
        <>
          {NEUTRON_AXES.map((deg) => (
            <NeutronRay key={deg} deg={deg} r0={0} r1={deg === -90 ? 56 : 40} />
          ))}
          {live ? null : NEUTRON_DIAGONALS.map((deg) => <NeutronRay key={deg} deg={deg} r0={14} r1={42} />)}
        </>
      );
    default:
      return null;
  }
}

/** Marks IN FRONT of the body — the signature itself. */
function FrontMarks({ archetype, rarity, from, to, ids, live }: MarkProps) {
  const mythicBolt = rarity === 'mythic' && !live ? <Bolt d={MYTHIC_BOLT.d} /> : null;
  switch (archetype) {
    case 'volt':
      return (
        <>
          {live ? null : VOLT_ARCS.map((a) => <VoltArc key={a.d} d={a.d} to={to} />)}
          {mythicBolt}
        </>
      );
    case 'toxic':
      return (
        <>
          <Path d={TOXIC_DRIP} fill={to} />
          {live ? null : (
            <>
              <Circle cx={TOXIC_BEAD.x} cy={TOXIC_BEAD.y} r={TOXIC_BEAD.r} fill={to} />
              {TOXIC_BUBBLES.map((b) => (
                <Bubble key={b.phase} x={b.x} y={b.y} r={b.r} from={from} to={to} />
              ))}
            </>
          )}
          {mythicBolt}
        </>
      );
    case 'solar':
      return (
        <>
          {live ? null : SOLAR_RAYS.map((deg) => <SolarRay key={deg} deg={deg} to={to} />)}
          {mythicBolt}
        </>
      );
    case 'cosmic':
      return (
        <>
          <Path d="M40 68 C35 56 47 44 58 50 C65 54 61 63 53 61" fill="none" stroke={tint(to, 0.45)} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
          {live ? null : COSMIC_STARS.map((st) => <Path key={st.phase} d={sparkle(st.x, st.y, st.s)} fill="#ffffff" />)}
          {mythicBolt}
        </>
      );
    case 'neutron':
      return (
        <>
          <Defs>
            <NeutronCoreDefs id={`flameNeutron-${ids}`} />
          </Defs>
          {live ? null : <NeutronCore id={`flameNeutron-${ids}`} />}
          {mythicBolt}
        </>
      );
    case 'forge':
      return (
        <>
          {/* Hammer marks — the body has been struck. */}
          <Path d="M40 68 L47 60 M55 72 L62 63" stroke={tint(to, 0.5)} strokeWidth={1.4} strokeLinecap="round" opacity={0.45} />
          {live ? null : FORGE_SPARKS.map((sp) => <ForgeSpark key={sp.phase} x={sp.x} y={sp.y} dx={sp.dx} to={to} t={0.45} />)}
          {mythicBolt}
        </>
      );
    case 'ember':
    default:
      return mythicBolt;
  }
}

/**
 * The archetype's decoration round a silhouette the CALLER draws — what the brand flame wears.
 *
 * `which="back"` goes before the body path and `which="front"` after it. `bodyPath` is the caller's
 * silhouette in its own coordinates (for the rim light and the cosmic nebula wash); `marksTransform`
 * maps the 0-100-authored marks onto that box (MARKS_ON_BRAND for FLAME_PATH). Static only — no
 * motion reaches the live flame, whose animation is the activity signal (§4).
 */
export function FlameArchetypeDecor({
  which,
  archetype,
  rarity,
  from,
  to,
  uid,
  bodyPath,
  rimWidth,
  marksTransform,
}: {
  which: 'back' | 'front';
  archetype: string | undefined;
  rarity: Rarity;
  from: string;
  to: string;
  uid: string;
  bodyPath: string;
  /** Rim-light stroke width in the body path's own units. */
  rimWidth: number;
  marksTransform?: string;
}): ReactNode {
  if (!isFlameArchetype(archetype)) return null;
  const ids = `${idSafe(uid)}-${which}`;
  const props: MarkProps = { archetype, rarity, from, to, ids, live: false };
  if (which === 'back') {
    return (
      <G transform={marksTransform}>
        <BackMarks {...props} />
      </G>
    );
  }
  const nebulaId = `flameNebulaWash-${ids}`;
  return (
    <>
      {archetype === 'cosmic' ? (
        <>
          <Defs>
            <RadialGradient id={nebulaId} cx="50%" cy="72%" r="60%">
              <Stop offset="0" stopColor={tint(to, 0.6)} stopOpacity={0.75} />
              <Stop offset="0.55" stopColor={from} stopOpacity={0.25} />
              <Stop offset="1" stopColor={shade(from, 0.6)} stopOpacity={0.55} />
            </RadialGradient>
          </Defs>
          <Path d={bodyPath} fill={`url(#${nebulaId})`} />
        </>
      ) : null}
      {hasFlourish(rarity) ? <Path d={bodyPath} fill="none" stroke={tint(to, 0.5)} strokeWidth={rimWidth} opacity={0.75} /> : null}
      <G transform={marksTransform}>
        <FrontMarks {...props} />
      </G>
    </>
  );
}

// ─────────────────────────── the tile drawing ───────────────────────────

/**
 * A flame item's drawing in item-art's 0-100 register: SVG nodes, no <Svg> wrapper. An unknown or
 * missing archetype draws the generic flame exactly as item-art always has (installed builds meet
 * archetypes added after they shipped).
 *
 * `live` — pass the same value given to FlameArchetypeOverlay's `live`. When true the marks the
 * overlay animates are left out of the still drawing, so they are not drawn twice.
 */
export function FlameArchetypeShape({
  archetype,
  rarity,
  from,
  to,
  uid,
  live = false,
}: {
  archetype: string | undefined;
  rarity: Rarity;
  from: string;
  to: string;
  uid: string;
  live?: boolean;
}): ReactNode {
  const ids = idSafe(uid);
  const bodyId = `flameArtBody-${ids}`;
  const nebulaId = `flameArtNebula-${ids}`;
  const hot = tint(from, 0.62);
  const known = isFlameArchetype(archetype);
  const kind: FlameArchetype = known ? archetype : 'ember';
  const body = BODY[kind];
  const props: MarkProps = { archetype: kind, rarity, from, to, ids, live };

  return (
    <>
      <Defs>
        {/* item-art's body ramp — specular white, the item's colour, a shaded base. */}
        <LinearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <Stop offset="0.4" stopColor={from} />
          <Stop offset="1" stopColor={shade(to, 0.55)} />
        </LinearGradient>
        {kind === 'cosmic' ? (
          // Mock 240's nebula: a pale heart low in the body, the item's colour, a deep-space rim.
          <RadialGradient id={nebulaId} cx="50%" cy="75%" r="70%">
            <Stop offset="0" stopColor={tint(to, 0.6)} />
            <Stop offset="0.55" stopColor={from} />
            <Stop offset="1" stopColor={shade(from, 0.6)} />
          </RadialGradient>
        ) : null}
      </Defs>
      {known ? <BackMarks {...props} /> : null}
      <Path d={body} fill={kind === 'cosmic' ? `url(#${nebulaId})` : `url(#${bodyId})`} />
      {kind === 'ember' ? (
        <Path d={GENERIC_CORE} fill={hot} opacity={0.6} />
      ) : kind === 'neutron' ? (
        // The neutron's core is the white star, not a lighter copy of the body.
        <G transform={CORE_TRANSFORM}>
          <Path d={body} fill="#ffffff" opacity={0.35} />
        </G>
      ) : (
        <G transform={CORE_TRANSFORM}>
          <Path d={body} fill={hot} opacity={kind === 'cosmic' ? 0.3 : 0.6} />
        </G>
      )}
      {known && hasFlourish(rarity) ? <Path d={body} fill="none" stroke={tint(to, 0.5)} strokeWidth={1.4} opacity={0.75} /> : null}
      {known ? <FrontMarks {...props} /> : null}
    </>
  );
}

/** True when FlameArchetypeOverlay draws anything for this item — callers can skip mounting it. */
export function flameArchetypeAnimates(archetype: string | undefined, rarity: Rarity): boolean {
  if (!isFlameArchetype(archetype)) return false;
  return archetype !== 'ember' || rarity === 'mythic';
}

// ─────────────────────────── the hero overlay ───────────────────────────

/** One cadence per archetype (mock 240's CSS durations). Every mover of that archetype reads it. */
const CYCLE_MS: Record<FlameArchetype, number> = {
  ember: 2600,
  volt: 1800, // read ×2 — mock's .9s zap
  toxic: 2800,
  solar: 2200,
  cosmic: 2200,
  neutron: 1400,
  forge: 1300,
};
const BOLT_MS = 2400;

type Motion = 'flash' | 'rise' | 'drip' | 'breathe' | 'twinkle' | 'shimmer' | 'fly' | 'strike';

/**
 * One animated mark: an Animated.View boxed round (cx, cy) ± r in tile units, holding a little
 * <Svg> whose viewBox is that same box — so the children are drawn in tile coordinates and every
 * scale pivots on the mark's own centre. All motion is derived on the UI thread from the shared
 * clock; React never re-renders per frame.
 */
function Mover({
  clock,
  mult,
  phase,
  motion,
  cx,
  cy,
  r,
  px,
  dx = 0,
  dy = 0,
  children,
}: {
  clock: SharedValue<number>;
  mult: number;
  phase: number;
  motion: Motion;
  cx: number;
  cy: number;
  r: number;
  /** Pixels per tile unit. */
  px: number;
  /** Travel in tile units (rise / drip / fly). */
  dx?: number;
  dy?: number;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const t = (clock.value * mult + phase) % 1;
    let o = 1;
    let tx = 0;
    let ty = 0;
    let s = 1;
    const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
    switch (motion) {
      case 'flash':
        o = t > 0.7 ? 1 : 0;
        break;
      case 'rise':
        ty = -dy * t * px;
        s = 0.5 + 0.6 * t;
        o = t < 0.25 ? (t / 0.25) * 0.85 : 0.85 * (1 - (t - 0.25) / 0.75);
        break;
      case 'drip':
        ty = t < 0.6 ? 0 : ((t - 0.6) / 0.4) * dy * px;
        o = t < 0.6 ? 0.95 : 0.95 * (1 - (t - 0.6) / 0.4);
        break;
      case 'breathe':
        s = 1 + 0.1 * wave;
        o = 0.7 + 0.3 * wave;
        break;
      case 'twinkle':
        s = 0.6 + 0.6 * wave;
        o = 0.2 + 0.8 * wave;
        break;
      case 'shimmer':
        o = 0.35 + 0.5 * wave;
        break;
      case 'fly':
        tx = dx * t * px;
        ty = -dy * t * px;
        s = 1 - 0.7 * t;
        o = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
        break;
      case 'strike':
        o = t >= 0.88 && t < 0.96 ? 1 : 0;
        break;
    }
    // Same keys every run — gate the value, never the key.
    return { opacity: o, transform: [{ translateX: tx }, { translateY: ty }, { scale: s }] };
  });
  const side = 2 * r * px;
  return (
    <Animated.View pointerEvents="none" style={[styles.mover, { left: (cx - r) * px, top: (cy - r) * px, width: side, height: side }, style]}>
      <Svg width={side} height={side} viewBox={`${cx - r} ${cy - r} ${2 * r} ${2 * r}`}>
        {children}
      </Svg>
    </Animated.View>
  );
}

/**
 * The archetype's motion at hero size — pass as ItemPedestal's `overlay`. Draws into a `size` ×
 * `size` square that maps the 0-100 tile box (exactly the square ItemPedestal hands an overlay).
 *
 * `live` must already be "this pedestal floats AND reduce-motion is off" — the same gate item-art
 * uses for a flare's live marks — and must be the value given to FlameArchetypeShape's `live`.
 * When `live` is false this renders nothing and the still drawing carries every mark. While the
 * screen is blurred or backgrounded the shared clock stops and the marks hold their frame.
 */
export function FlameArchetypeOverlay({
  archetype,
  rarity,
  from,
  to,
  size,
  live,
  uid,
}: {
  archetype: string | undefined;
  rarity: Rarity;
  from: string;
  to: string;
  size: number;
  live: boolean;
  uid: string;
}): ReactNode {
  if (!live || !flameArchetypeAnimates(archetype, rarity) || !isFlameArchetype(archetype)) return null;
  return <OverlayLayers archetype={archetype} rarity={rarity} from={from} to={to} size={size} uid={uid} />;
}

function OverlayLayers({
  archetype,
  rarity,
  from,
  to,
  size,
  uid,
}: {
  archetype: FlameArchetype;
  rarity: Rarity;
  from: string;
  to: string;
  size: number;
  uid: string;
}) {
  const motionActive = useMotionActive();
  const clock = useCosmeticClock(CYCLE_MS[archetype], motionActive && archetype !== 'ember');
  const mythic = rarity === 'mythic';
  const boltClock = useCosmeticClock(BOLT_MS, motionActive && mythic);
  const px = size / 100;
  const ids = idSafe(uid);

  let movers: ReactNode = null;
  switch (archetype) {
    case 'volt':
      movers = VOLT_ARCS.map((a) => (
        <Mover key={a.d} clock={clock} mult={2} phase={a.phase} motion="flash" cx={a.cx} cy={a.cy} r={12} px={px}>
          <VoltArc d={a.d} to={to} />
        </Mover>
      ));
      break;
    case 'toxic':
      movers = (
        <>
          {TOXIC_BUBBLES.map((b) => (
            <Mover key={b.phase} clock={clock} mult={1} phase={b.phase} motion="rise" cx={b.x} cy={b.y + 22} r={b.r + 1} dy={44} px={px}>
              <Bubble x={b.x} y={b.y + 22} r={b.r} from={from} to={to} />
            </Mover>
          ))}
          <Mover clock={clock} mult={1} phase={0.15} motion="drip" cx={TOXIC_BEAD.x} cy={TOXIC_BEAD.y} r={TOXIC_BEAD.r + 1} dy={8} px={px}>
            <Circle cx={TOXIC_BEAD.x} cy={TOXIC_BEAD.y} r={TOXIC_BEAD.r} fill={to} />
          </Mover>
        </>
      );
      break;
    case 'solar':
      movers = (
        <Mover clock={clock} mult={1} phase={0} motion="breathe" cx={SOLAR_CENTRE.x} cy={SOLAR_CENTRE.y} r={50} px={px}>
          {SOLAR_RAYS.map((deg) => (
            <SolarRay key={deg} deg={deg} to={to} />
          ))}
        </Mover>
      );
      break;
    case 'cosmic':
      movers = COSMIC_STARS.map((st) => (
        <Mover key={st.phase} clock={clock} mult={1} phase={st.phase} motion="twinkle" cx={st.x} cy={st.y} r={st.s + 0.5} px={px}>
          <Path d={sparkle(st.x, st.y, st.s)} fill="#ffffff" />
        </Mover>
      ));
      break;
    case 'neutron': {
      const coreId = `flameNeutronLive-${ids}`;
      movers = (
        <>
          <Mover clock={clock} mult={1} phase={0} motion="shimmer" cx={NEUTRON_CORE.x} cy={NEUTRON_CORE.y} r={44} px={px}>
            {NEUTRON_DIAGONALS.map((deg) => (
              <NeutronRay key={deg} deg={deg} r0={14} r1={42} />
            ))}
          </Mover>
          <Mover clock={clock} mult={1} phase={0.5} motion="breathe" cx={NEUTRON_CORE.x} cy={NEUTRON_CORE.y} r={13} px={px}>
            <Defs>
              <NeutronCoreDefs id={coreId} />
            </Defs>
            <NeutronCore id={coreId} />
          </Mover>
        </>
      );
      break;
    }
    case 'forge':
      movers = FORGE_SPARKS.map((sp) => (
        <Mover key={sp.phase} clock={clock} mult={1} phase={sp.phase} motion="fly" cx={sp.x} cy={sp.y} r={3} dx={sp.dx} dy={FORGE_RISE} px={px}>
          <ForgeSpark x={sp.x} y={sp.y} dx={sp.dx} to={to} t={0} />
        </Mover>
      ));
      break;
    case 'ember':
      break;
  }

  return (
    <View pointerEvents="none" style={{ width: size, height: size }}>
      {movers}
      {mythic ? (
        <Mover clock={boltClock} mult={1} phase={0} motion="strike" cx={MYTHIC_BOLT.cx} cy={MYTHIC_BOLT.cy} r={17} px={px}>
          <Bolt d={MYTHIC_BOLT.d} />
        </Mover>
      ) : null}
    </View>
  );
}

// ─────────────────────────── the equipped flame ───────────────────────────

/**
 * The equipped flame item's archetype and rarity — what the live flame decorates itself with.
 * Colour is NOT here: that stays useFlameRamp's job (it also folds in an equipped flare's colour).
 * Empty slot → no archetype → the plain brand flame.
 */
export function useEquippedFlameArchetype(): { archetype: string | undefined; rarity: Rarity } {
  const flame = useEquipped('flame');
  return { archetype: flame?.archetype, rarity: flame?.rarity ?? 'common' };
}

const styles = StyleSheet.create({
  mover: {
    position: 'absolute',
  },
});
