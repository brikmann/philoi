import { useId, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useCosmeticClock } from '@/components/economy/cosmetic-clock';
import { useMotionActive } from '@/hooks/use-motion-active';
import { getItem, type Archetype, type CatalogItem, type ParticleArchetype } from '@/lib/economy/catalog';
import { mix, shade, tint } from '@/lib/economy/colour';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PARTICLES, BESPOKE (design-mocks/242-halo-particle-bespoke.html).
//
// One motion per look, grouped by archetype:
//
//   rising      rise      Sparks — embers straight up off the flame.
//               float     Floating Sparks — slower, meandering, lingering.
//   swarm       swarm     Ember Swarm — a cluster that darts up and to the right: it hunts.
//   ash         ash       Falling Ash — flakes drifting down across the whole field.
//               ascendant Ascendant Ash — golden flakes RISING slowly, turning as they sway.
//   solar-arc   solar-arc Solar Flares — arcs loop off the flame, hold, and snap back.
//   lightning   bolt      Lightning Tendrils — forked bolts spring FROM the flame to the edges.
//   void-smoke  smoke     Void Smoke — grey-violet billows that swell as they climb.
//
// Same four rules as campfire-banner-art.tsx: a static Svg per mark with only its View moving on
// the UI thread; capped counts (≤ 14); ONE shared clock (cosmetic-clock.ts, 24s) read by every mark
// at a whole-number multiple; deterministic layout from `spread`, never Math.random. Reduce Motion
// or an off-screen screen draws a frozen frame of the same field.

export type ParticleMotion = 'rise' | 'float' | 'swarm' | 'ash' | 'ascendant' | 'solar-arc' | 'bolt' | 'smoke';

// ─────────────────────────── selection ───────────────────────────

// The fallback for an item without an archetype this build knows, and the tie-break inside a
// two-look archetype (Sparks vs Floating Sparks, Falling vs Ascendant Ash).
const PARTICLE_MOTION_BY_ID: Record<string, ParticleMotion> = {
  'particle-base-spark': 'rise',
  'particle-floating-sparks': 'float',
  'particle-falling-ash': 'ash',
  'particle-ember-swarm': 'swarm',
  'particle-solar-flares': 'solar-arc',
  'particle-lightning-tendrils': 'bolt',
  'particle-void-smoke': 'smoke',
  'particle-emberfall-ascendant': 'ascendant',
};

const ARCHETYPE_MOTIONS: Record<ParticleArchetype, readonly ParticleMotion[]> = {
  rising: ['rise', 'float'],
  swarm: ['swarm'],
  ash: ['ash', 'ascendant'],
  'solar-arc': ['solar-arc'],
  lightning: ['bolt'],
  'void-smoke': ['smoke'],
};

export function isParticleArchetype(a: Archetype | string | undefined): a is ParticleArchetype {
  return a !== undefined && Object.prototype.hasOwnProperty.call(ARCHETYPE_MOTIONS, a);
}

/**
 * The motion for a particle item: archetype first, the id table second, 'rise' for anything
 * unknown so a particle this build predates still paints rather than blanking. Within `rising`,
 * an unlisted common rises and anything rarer floats.
 */
export function particleMotionForItem(item: Pick<CatalogItem, 'id' | 'archetype' | 'rarity'>): ParticleMotion {
  const byId = PARTICLE_MOTION_BY_ID[item.id];
  if (isParticleArchetype(item.archetype)) {
    const family = ARCHETYPE_MOTIONS[item.archetype];
    if (byId && family.includes(byId)) return byId;
    if (item.archetype === 'rising') return item.rarity === 'common' ? 'rise' : 'float';
    return family[0];
  }
  return byId ?? 'rise';
}

/** By id — resolves the catalog item so its archetype still leads. */
export function particleMotionForId(itemId: string): ParticleMotion {
  const item = getItem(itemId);
  return item ? particleMotionForItem(item) : (PARTICLE_MOTION_BY_ID[itemId] ?? 'rise');
}

// ─────────────────────────── the field ───────────────────────────

/** The one clock every particle reads (shared with the halos — same ms, same driver). */
const PARTICLE_CLOCK_MS = 24_000;

/** Mock 242's stage is 120px tall; every distance is authored against it and scaled by `k`. */
const STAGE_H = 120;
/** The emitter — just under the flame's tip, as a fraction of the box height from the top. */
const EMIT_Y = 0.6;

type MoteGlyph = 'dot' | 'flake' | 'arc' | 'bolt' | 'billow';

/** One mark's fixed layout. Everything the worklet needs is a number. */
type MoteSpec = {
  glyph: MoteGlyph;
  /** Box size of the glyph's view. */
  w: number;
  h: number;
  left: number;
  top: number;
  /** Pivot for rotation/scale — the emitter for arcs and bolts, the centre otherwise. */
  origin: 'center' | 'bottom-left' | 'bottom';
  mult: number;
  phase: number;
  /** Per-motion knobs (px / deg). */
  a: number;
  b: number;
  c: number;
};

/** Mock delays (s) -> a phase on a loop of `cycleS`. A CSS delay d starts the loop d late. */
const delayPhase = (d: number, cycleS: number) => (((1 - d / cycleS) % 1) + 1) % 1;

/** Golden-ratio spread, 0..1 (rule 4). */
function spread(i: number, offset = 0): number {
  return ((i + 1) * 0.6180339887 + offset) % 1;
}

const cycleS = (mult: number) => PARTICLE_CLOCK_MS / mult / 1000;

function layoutFor(motion: ParticleMotion, w: number, h: number): MoteSpec[] {
  const k = h / STAGE_H;
  const cx = w / 2;
  const ey = h * EMIT_Y;
  const centred = (x: number, y: number, s: number, glyph: MoteGlyph, mult: number, phase: number, a = 0, b = 0, c = 0): MoteSpec => ({
    glyph,
    w: s,
    h: s,
    left: x - s / 2,
    top: y - s / 2,
    origin: 'center',
    mult,
    phase,
    a,
    b,
    c,
  });

  switch (motion) {
    // Sparks: straight up, 2.6s. a = sideways drift.
    case 'rise':
      return Array.from({ length: 10 }, (_, i) =>
        centred(cx + (spread(i, 0.31) - 0.5) * 34 * k, ey, (10 + 4 * spread(i)) * k, 'dot', 8 + (i % 3), spread(i, 0.17), (spread(i, 0.63) - 0.5) * 16 * k)
      );
    // Floating sparks: hover and meander, 3.8s. a = mirror (±1).
    case 'float':
      return Array.from({ length: 8 }, (_, i) =>
        centred(cx + (spread(i, 0.37) - 0.5) * 30 * k, ey, 12 * k, 'dot', 5 + (i % 3), spread(i, 0.23), i % 2 === 0 ? 1 : -1)
      );
    // Swarm: a stream of motes darting up-right, 1.6s, an eighth of a cycle apart. a/b = travel.
    case 'swarm':
      return Array.from({ length: 12 }, (_, i) =>
        centred(
          cx + (spread(i, 0.2) - 0.5) * 14 * k - 4 * k,
          ey + (spread(i, 0.5) - 0.5) * 6 * k,
          (9 + 3 * spread(i, 0.8)) * k,
          'dot',
          15,
          (i * 0.125 + spread(i, 0.4) * 0.05) % 1,
          (34 + (spread(i, 0.7) - 0.5) * 14) * k,
          (-60 + (spread(i, 0.9) - 0.5) * 16) * k
        )
      );
    // Falling ash: from the top across the whole width, 3.4s. a = fall, b = sway.
    case 'ash':
      return Array.from({ length: 14 }, (_, i) =>
        centred(w * (0.12 + 0.76 * spread(i, 0.41)), -8 * k, (8 + 3 * spread(i)) * k, 'dot', 6 + (i % 3), spread(i, 0.29), h * 0.9, (spread(i, 0.77) - 0.5) * 10 * k)
      );
    // Ascendant: golden flakes rising slowly, turning, 4.6s. a = mirror.
    case 'ascendant':
      return Array.from({ length: 9 }, (_, i) =>
        centred(cx + (spread(i, 0.33) - 0.5) * 36 * k, ey, 9 * k, 'flake', 5, spread(i, 0.11), i % 2 === 0 ? 1 : -1)
      );
    // Solar arcs: six loops at mock 242's angles, 1.7s. a = angle.
    case 'solar-arc': {
      const s = 46 * k;
      return [
        [-12, 0],
        [40, 0.12],
        [-52, 0.24],
        [92, 0.36],
        [-94, 0.1],
        [150, 0.3],
      ].map(([angle, d]) => ({
        glyph: 'arc' as const,
        w: s,
        h: s,
        left: cx,
        top: ey - 10 * k - s,
        origin: 'bottom-left' as const,
        mult: 14,
        phase: delayPhase(d, cycleS(14)),
        a: angle,
        b: 0,
        c: 0,
      }));
    }
    // Lightning: five bolts out of the flame, 1.3s, mostly dark. a = angle.
    case 'bolt': {
      const bw = 12 * k;
      const bh = 50 * k;
      return [
        [-24, 0],
        [30, 0.3],
        [-64, 0.6],
        [68, 0.15],
        [4, 0.9],
      ].map(([angle, d]) => ({
        glyph: 'bolt' as const,
        w: bw,
        h: bh,
        left: cx - bw / 2,
        top: ey - 12 * k - bh,
        origin: 'bottom' as const,
        mult: 18,
        phase: delayPhase(d, cycleS(18)),
        a: angle,
        b: 0,
        c: 0,
      }));
    }
    // Void smoke: billows that swell as they climb, 4.2s. a = drift.
    case 'smoke':
    default:
      return Array.from({ length: 7 }, (_, i) =>
        centred(cx + (spread(i, 0.29) - 0.5) * 30 * k, ey, 22 * k, 'billow', 5 + (i % 2), spread(i, 0.07), (spread(i, 0.67) - 0.5) * 14 * k)
      );
  }
}

type Pose = { x: number; y: number; rot: number; sx: number; sy: number; o: number };

/** Linear interpolation through (t, v) keyframes. */
function keys(t: number, ts: readonly number[], vs: readonly number[]): number {
  'worklet';
  for (let i = 1; i < ts.length; i += 1) {
    if (t <= ts[i]) return vs[i - 1] + ((vs[i] - vs[i - 1]) * (t - ts[i - 1])) / (ts[i] - ts[i - 1]);
  }
  return vs[vs.length - 1];
}

/** Where a mark is at loop-time `t`. Pure — read on the UI thread live, on the JS thread frozen. */
function poseAt(motion: ParticleMotion, t: number, a: number, b: number, k: number): Pose {
  'worklet';
  switch (motion) {
    case 'rise': {
      const o = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      return { x: a * t, y: (16 - 86 * t) * k, rot: 0, sx: 0.5 + 0.5 * t, sy: 0.5 + 0.5 * t, o };
    }
    case 'float': {
      const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      const T = [0, 0.45, 0.72, 1];
      const s = keys(e, T, [0.5, 1, 0.95, 0.9]);
      const o = t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82;
      return { x: keys(e, T, [0, 10, -8, 4]) * k * a, y: keys(e, T, [12, -24, -44, -62]) * k, rot: 0, sx: s, sy: s, o };
    }
    case 'swarm': {
      const e = t * t;
      const s = 0.6 + 0.4 * e;
      const o = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      return { x: a * e, y: b * e, rot: 0, sx: s, sy: s, o };
    }
    case 'ash': {
      const o = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      return { x: b * Math.sin(t * Math.PI * 2), y: a * t, rot: 0, sx: 1, sy: 1, o };
    }
    case 'ascendant': {
      const e = 1 - (1 - t) * (1 - t);
      const s = 0.6 + 0.4 * e;
      const o = t < 0.22 ? t / 0.22 : 1 - (t - 0.22) / 0.78;
      return { x: 6 * k * e * a + 3 * k * Math.sin(t * Math.PI * 3) * a, y: (22 - 92 * e) * k, rot: 230 * e * a, sx: s, sy: s, o };
    }
    case 'solar-arc': {
      // Out (0-48%), hold (48-64%), snap back (64-100%).
      const out = t < 0.48 ? t / 0.48 : 1;
      const s = t < 0.48 ? out * out * (3 - 2 * out) : t < 0.64 ? 1 : 1 - 0.95 * ((t - 0.64) / 0.36) * ((t - 0.64) / 0.36);
      const o = t < 0.14 ? t / 0.14 : t < 0.64 ? 1 : 1 - (t - 0.64) / 0.36;
      return { x: 0, y: 0, rot: a, sx: s, sy: s, o };
    }
    case 'bolt': {
      // steps(1): dark, a double strike, dark.
      const o = t < 0.7 ? 0 : t < 0.76 ? 1 : t < 0.78 ? 0.25 : t < 0.86 ? 1 : 0;
      return { x: 0, y: 0, rot: a, sx: 1, sy: 1, o };
    }
    case 'smoke':
    default: {
      const e = t * t;
      const s = 0.5 + 2 * e;
      const o = t < 0.2 ? (0.8 * t) / 0.2 : t < 0.6 ? 0.8 - (0.3 * (t - 0.2)) / 0.4 : 0.5 * (1 - (t - 0.6) / 0.4);
      return { x: a * e, y: (16 - 76 * e) * k, rot: 0, sx: s, sy: s, o };
    }
  }
}

/** The frozen frame: each mark at its own phase, except the marks that are mostly dark — a still
 *  lightning field shows its bolts, and a still solar field its loops fully out. */
function stillT(motion: ParticleMotion, spec: MoteSpec, i: number): number {
  if (motion === 'bolt') return i % 2 === 0 ? 0.8 : spec.phase;
  if (motion === 'solar-arc') return 0.5;
  return spec.phase;
}

const ORIGIN = { center: '50% 50%', 'bottom-left': '0% 100%', bottom: '50% 100%' } as const;

/**
 * The particle field, sized from its own layout so a caller only has to drop it behind a flame.
 * `from` is the body colour and `to` the hot one.
 */
export function ParticleArtField({ from, to, motion }: { from: string; to: string; motion: ParticleMotion }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  };
  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {box.w > 0 && box.h > 0 && <ParticleMotes from={from} to={to} motion={motion} w={box.w} h={box.h} />}
    </View>
  );
}

function ParticleMotes({ from, to, motion, w, h }: { from: string; to: string; motion: ParticleMotion; w: number; h: number }) {
  const reduceMotion = useReducedMotion();
  const active = useMotionActive();
  const specs = layoutFor(motion, w, h);
  const k = h / STAGE_H;
  if (reduceMotion || !active) {
    return (
      <>
        {specs.map((spec, i) => {
          const p = poseAt(motion, stillT(motion, spec, i), spec.a, spec.b, k);
          return (
            <View
              key={i}
              pointerEvents="none"
              style={[
                frame(spec),
                {
                  opacity: Math.max(0, p.o),
                  transform: [{ translateX: p.x }, { translateY: p.y }, { rotate: `${p.rot}deg` }, { scaleX: p.sx }, { scaleY: p.sy }],
                },
              ]}>
              <Glyph spec={spec} from={from} to={to} />
            </View>
          );
        })}
      </>
    );
  }
  return <LiveMotes specs={specs} from={from} to={to} motion={motion} k={k} />;
}

function LiveMotes({ specs, from, to, motion, k }: { specs: MoteSpec[]; from: string; to: string; motion: ParticleMotion; k: number }) {
  const clock = useCosmeticClock(PARTICLE_CLOCK_MS, true);
  return (
    <>
      {specs.map((spec, i) => (
        <LiveMote key={i} clock={clock} spec={spec} motion={motion} k={k}>
          <Glyph spec={spec} from={from} to={to} />
        </LiveMote>
      ))}
    </>
  );
}

function frame(spec: MoteSpec) {
  return {
    position: 'absolute' as const,
    left: spec.left,
    top: spec.top,
    width: spec.w,
    height: spec.h,
    transformOrigin: ORIGIN[spec.origin],
  };
}

function LiveMote({
  clock,
  spec,
  motion,
  k,
  children,
}: {
  clock: SharedValue<number>;
  spec: MoteSpec;
  motion: ParticleMotion;
  k: number;
  children: ReactNode;
}) {
  const { mult, phase, a, b } = spec;
  const style = useAnimatedStyle(() => {
    const p = poseAt(motion, (clock.value * mult + phase) % 1, a, b, k);
    return {
      opacity: Math.max(0, p.o),
      transform: [{ translateX: p.x }, { translateY: p.y }, { rotate: `${p.rot}deg` }, { scaleX: p.sx }, { scaleY: p.sy }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[frame(spec), { opacity: 0 }, style]}>
      {children}
    </Animated.View>
  );
}

// The arc and bolt are authored in mock 242's own boxes (46 x 46, and 8 x 48 widened for glow).
const ARC_D = 'M7.8 38.2 A21.5 21.5 0 0 1 38.2 7.8';
const BOLT_D = 'M5.68 0 L6.8 15.36 L5.2 19.2 L6.96 29.76 L5.36 33.6 L6.64 48 L4.4 30.72 L6.16 26.88 L4.72 14.4 Z';

/** One mark, static. Gradient ids are unique per mount (useId). */
function Glyph({ spec, from, to }: { spec: MoteSpec; from: string; to: string }) {
  const id = `ptl-${useId()}`;
  switch (spec.glyph) {
    case 'flake':
      return (
        <Svg width={spec.w} height={spec.h} viewBox="0 0 12 12">
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#fff0c0" />
              <Stop offset="1" stopColor={from} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="12" height="12" rx="3" fill={to} opacity={0.3} />
          <Rect x="2.5" y="2.5" width="7" height="7" rx="1.5" fill={`url(#${id})`} />
        </Svg>
      );
    case 'arc':
      return (
        <Svg width={spec.w} height={spec.h} viewBox="0 0 46 46">
          <Path d={ARC_D} fill="none" stroke={from} strokeWidth={7} strokeLinecap="round" opacity={0.35} />
          <Path d={ARC_D} fill="none" stroke={to} strokeWidth={3} strokeLinecap="round" />
        </Svg>
      );
    case 'bolt':
      return (
        <Svg width={spec.w} height={spec.h} viewBox="0 0 12 48">
          <Path d={BOLT_D} fill="none" stroke={from} strokeWidth={2.4} strokeLinejoin="round" opacity={0.6} />
          <Path d={BOLT_D} fill={to} stroke={to} strokeWidth={0.6} strokeLinejoin="round" />
        </Svg>
      );
    case 'billow':
      return (
        <Svg width={spec.w} height={spec.h} viewBox="0 0 20 20">
          <Defs>
            <RadialGradient id={id} cx="40%" cy="38%" r="60%">
              <Stop offset="0" stopColor={mix(to, '#8a7aa6', 0.55)} />
              <Stop offset="0.5" stopColor={mix(from, to, 0.35)} stopOpacity={0.85} />
              <Stop offset="0.78" stopColor={from} stopOpacity={0.5} />
              <Stop offset="1" stopColor={from} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx="10" cy="10" r="10" fill={`url(#${id})`} />
        </Svg>
      );
    case 'dot':
    default:
      // mock: radial(#ffe8b0, FROM) with a TO glow round it — the box is twice the core.
      return (
        <Svg width={spec.w} height={spec.h} viewBox="0 0 20 20">
          <Defs>
            <RadialGradient id={id} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={tint(to, 0.6)} />
              <Stop offset="0.3" stopColor={to} />
              <Stop offset="0.5" stopColor={from} stopOpacity={0.8} />
              <Stop offset="1" stopColor={to} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx="10" cy="10" r="10" fill={`url(#${id})`} />
        </Svg>
      );
  }
}

// ─────────────────────────── the tile ───────────────────────────

// item-art.tsx's generic particle flame, verbatim — the fallback, and the flame every archetype
// below draws its particles around (smaller, so the particles have room).
const FLAME_D = 'M50 80 C32 70 30 52 42 38 C44 48 50 48 50 40 C51 28 45 24 53 16 C55 32 70 32 70 50 C70 66 60 76 50 80 Z';

/**
 * The particle item's TILE drawing, as SVG nodes in item-art's 0-100 viewBox register — one static
 * frame of the archetype's motion that still reads at 27pt. Unknown or missing archetypes draw
 * item-art's generic particle silhouette exactly. Brings its own gradient (ids from `uid`).
 */
export function ParticleArchetypeShape({
  archetype,
  from,
  to,
  uid,
}: {
  archetype: Archetype | string | undefined;
  from: string;
  to: string;
  uid: string;
}) {
  const bodyId = `particleBody-${uid}`;
  const smokeId = `particleSmoke-${uid}`;
  const body = `url(#${bodyId})`;
  // item-art's own derivations, so the fallback is pixel-identical.
  const hot = tint(from, 0.62);
  const defs = (
    <Defs>
      <LinearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
        <Stop offset="0.4" stopColor={from} />
        <Stop offset="1" stopColor={shade(to, 0.55)} />
      </LinearGradient>
      {archetype === 'void-smoke' && (
        <RadialGradient id={smokeId} cx="42%" cy="40%" r="58%">
          <Stop offset="0" stopColor={mix(to, '#b6a6d6', 0.4)} stopOpacity={0.95} />
          <Stop offset="0.5" stopColor={mix(from, to, 0.45)} stopOpacity={0.75} />
          <Stop offset="0.82" stopColor={from} stopOpacity={0.35} />
          <Stop offset="1" stopColor={from} stopOpacity={0} />
        </RadialGradient>
      )}
    </Defs>
  );

  // The flame, shrunk about its base so the particles get the top of the frame.
  const flame = (
    <G transform="translate(50 84) scale(0.7) translate(-50 -80)">
      <Path d={FLAME_D} fill={body} opacity={0.9} />
    </G>
  );
  // An ember: soft glow, body, white-hot heart. Radius in viewBox units.
  const ember = (x: number, y: number, r: number, key: string | number) => (
    <G key={key}>
      <Circle cx={x} cy={y} r={r * 1.9} fill={to} opacity={0.22} />
      <Circle cx={x} cy={y} r={r} fill={to} />
      <Circle cx={x} cy={y} r={r * 0.5} fill={tint(to, 0.6)} />
    </G>
  );

  if (!isParticleArchetype(archetype)) {
    return (
      <>
        {defs}
        <Path d={FLAME_D} fill={body} opacity={0.8} />
        <G fill={body}>
          <Circle cx="20" cy="30" r="5" />
          <Circle cx="80" cy="38" r="4.4" />
          <Circle cx="14" cy="58" r="3.6" />
          <Circle cx="84" cy="64" r="3.2" />
          <Circle cx="30" cy="14" r="3" />
          <Circle cx="66" cy="12" r="3.6" />
        </G>
        <G fill={hot} opacity={0.75}>
          <Circle cx="18.6" cy="28.4" r="1.7" />
          <Circle cx="78.8" cy="36.6" r="1.5" />
          <Circle cx="65" cy="10.8" r="1.2" />
        </G>
      </>
    );
  }

  switch (archetype) {
    // A column of sparks climbing off the tip, each trailing a short streak.
    case 'rising': {
      const sparks: [number, number, number][] = [
        [50, 28, 4.6],
        [42, 17, 3.6],
        [57, 9, 3],
        [33, 40, 3.2],
        [67, 33, 3.8],
      ];
      return (
        <>
          {defs}
          <G stroke={to} strokeLinecap="round" opacity={0.4}>
            {sparks.map(([x, y, r], i) => (
              <Path key={i} d={`M${x} ${y + r} L${x} ${y + r + 7}`} strokeWidth={r * 1.1} />
            ))}
          </G>
          {flame}
          {sparks.map(([x, y, r], i) => ember(x, y, r, i))}
        </>
      );
    }

    // A stream of motes hunting up and to the right.
    case 'swarm': {
      const motes: [number, number, number][] = [
        [58, 38, 3],
        [64, 31, 3.8],
        [70, 25, 4.4],
        [76, 19, 3.6],
        [83, 12, 3],
        [67, 35, 2.4],
        [74, 13, 2.4],
        [80, 26, 2.2],
      ];
      return (
        <>
          {defs}
          <Path d="M52 44 L84 12" stroke={to} strokeWidth={9} strokeLinecap="round" opacity={0.14} />
          {flame}
          {motes.map(([x, y, r], i) => ember(x, y, r, i))}
        </>
      );
    }

    // Flakes drifting down across the frame onto the flame.
    case 'ash': {
      const flakes: [number, number, number][] = [
        [20, 14, 3.4],
        [38, 7, 2.8],
        [62, 11, 3.2],
        [81, 19, 3.6],
        [27, 32, 2.6],
        [75, 38, 2.8],
        [14, 50, 2.4],
        [87, 56, 2.6],
      ];
      return (
        <>
          {defs}
          {flame}
          <G stroke={from} strokeLinecap="round" opacity={0.35}>
            {flakes.map(([x, y, r], i) => (
              <Path key={i} d={`M${x - 1} ${y - r - 6} L${x} ${y - r}`} strokeWidth={r * 0.9} />
            ))}
          </G>
          {flakes.map(([x, y, r], i) => (
            <G key={i}>
              <Circle cx={x} cy={y} r={r * 1.7} fill={from} opacity={0.3} />
              <Circle cx={x} cy={y} r={r} fill={to} />
            </G>
          ))}
        </>
      );
    }

    // Arcs looping off the flame's tip, as mock 242's quarter-loops at their full reach.
    case 'solar-arc': {
      const loops = [-100, -45, 5, 55];
      return (
        <>
          {defs}
          {flame}
          {loops.map((a, i) => (
            <G key={i} transform={`translate(50 46) rotate(${a}) scale(${i % 2 === 0 ? 0.7 : 0.6}) translate(0 -46)`}>
              <Path d={ARC_D} fill="none" stroke={from} strokeWidth={9} strokeLinecap="round" opacity={0.3} />
              <Path d={ARC_D} fill="none" stroke={to} strokeWidth={4.6} strokeLinecap="round" />
            </G>
          ))}
          {ember(50, 44, 3.4, 'core')}
        </>
      );
    }

    // Forked bolts springing out of the flame toward the edges.
    case 'lightning': {
      const forks = [-60, -20, 22, 62];
      const fork = 'M0 0 L3 -10 L-2 -16 L4 -27 L-1 -33 L3 -43';
      return (
        <>
          {defs}
          {flame}
          {forks.map((a, i) => (
            <G key={i} transform={`translate(50 46) rotate(${a}) scale(${i % 2 === 0 ? 0.95 : 0.8})`}>
              <Path d={fork} fill="none" stroke={from} strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" opacity={0.4} />
              <Path d={fork} fill="none" stroke={to} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
            </G>
          ))}
          <Circle cx={50} cy={46} r={4} fill={to} />
        </>
      );
    }

    // Billows of void smoke swelling as they rise off the flame.
    case 'void-smoke':
    default:
      return (
        <>
          {defs}
          {flame}
          <Circle cx={43} cy={34} r={11} fill={`url(#${smokeId})`} />
          <Circle cx={60} cy={22} r={14} fill={`url(#${smokeId})`} />
          <Circle cx={38} cy={12} r={9} fill={`url(#${smokeId})`} />
          {ember(55, 40, 2.2, 'a')}
          {ember(66, 10, 1.8, 'b')}
        </>
      );
  }
}
