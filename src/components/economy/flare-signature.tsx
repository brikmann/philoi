import type { ReactNode } from 'react';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { flashCurve } from '@/components/economy/cosmetic-clock';
import { Colors } from '@/constants/theme';
import type { FlareEffect } from '@/lib/economy/catalog';
import { mix, tint } from '@/lib/economy/colour';

// ── A FLARE'S SIGNATURE, AT AVATAR SCALE ──
//
// THE BUG THIS FIXES: FlareAura drew one radial glow for every flare, and read the effect only for
// its breathing tempo. Asgardian Valor, Inferno and Acid Rain were the same coloured pulse, so a
// profile wearing a mythic flare said nothing about WHICH mythic. The lock-in perimeter
// (flare-perimeter.tsx) has always drawn the real thing: lightning, flames, drips, wisps.
//
// This file is that vocabulary rewritten for radial geometry. FlarePerimeter's marks are SCREEN
// geometry (edge bands, full-height bolts, rain across the width) and mean nothing at 38px, so
// nothing is shared with it except the identity: the effect, the colour, and the two lightning
// palettes, which are fixed per flare there and are fixed here too.
//
// Geometry is authored in a 0-100 box around (cx, cy). The avatar's ring is at `rIn`, the box edge
// at `rOut`, and every mark lives in the annulus between them. The avatar aura and the shop tile
// both draw from `flareSignature`, so the profile and the tile can never disagree about what a
// flare looks like: a buyer names the flare from its tile because it IS the profile drawing.
//
// No randomness. A mark is shaped from its index (`jitter`), so a re-render, a list recycle or a
// captured share card always shows the same bolt.

/** How a mark moves. `static` never does; the others are read off a shared clock (cosmetic-clock). */
export type MarkAnim = 'static' | 'flash' | 'lick' | 'fall' | 'rise' | 'drift';

export type SignatureMark = {
  node: ReactNode;
  anim: MarkAnim;
  /** Loops of this mark per clock cycle. A whole number, so the clock's snap back to 0 is invisible. */
  mult: number;
  /** 0..1 offset into its loop, so marks of one flare never move in lockstep. */
  phase: number;
  /** How far a fall / rise / drift travels, in the 0-100 box's units. */
  travel: number;
  /** Opacity in the parked frame (reduced motion, off-screen, a captured image). 0 = not drawn. */
  still: number;
  /** How far along its travel the parked frame holds a moving mark. */
  stillAt: number;
};

export type SignatureFrame = {
  cx: number;
  cy: number;
  /** The avatar ring's radius. Marks start here. */
  rIn: number;
  /** The outermost a mark may reach. */
  rOut: number;
  /** Pixels per unit — floors stroke widths so a 24px row never draws sub-pixel hairlines. */
  px: number;
};

/**
 * Zeus and Asgard's palettes are fixed, exactly as FlarePerimeter fixes them: cream-gold on white,
 * ice on white. Tinting a bolt to the catalog swatch is what once made the two mythics
 * interchangeable. (Zeus' gold rather than white is the catalog's own note: a white bolt on a dark
 * screen reads as a glitch.)
 */
export const LIGHTNING = {
  zaps: { glow: '#FFE87A', core: '#FFF7D6' },
  hammer: { glow: '#8FD4FF', core: '#EAF7FF' },
} as const;

/**
 * One clock cycle per effect, in ms — four of the flare's breaths (FlareAura's AURA table carried
 * the breath period before the marks existed; the cycle is that x4). The lightning flares snap, the
 * smoke and glow families drift. Every mark's `mult` is loops per THIS cycle, and the avatar aura
 * and the shop tile both run off it, so a flare keeps one tempo wherever it is drawn.
 */
export const SIGNATURE_CYCLE_MS: Record<FlareEffect, number> = {
  glow: 12_800,
  smoke: 18_400,
  plasma: 8_400,
  zaps: 4_600,
  hammer: 6_000,
  falling: 10_400,
  flames: 7_600,
  emberfall: 9_600,
};

/**
 * The colour a flare is DRAWN in, which is not always its catalog swatch. Inferno's swatch is a deep
 * red (#FF3D1F) — right for the tile and the Live Activity accent, wrong for the light itself: mock
 * 243 draws Inferno as a FAINT WARM light breathing inward (#ff8a3c), and a red glow round an edge
 * is exactly the "red tongues" read it replaced. So the fire family is pulled halfway to amber
 * wherever it paints light. One function, used by the avatar signature, the profile border and the
 * lock-in perimeter, so the three can never disagree about Inferno's colour.
 */
export function flareDisplayColour(effect: FlareEffect, colour: string): string {
  return effect === 'flames' ? mix(colour, '#FFB45A', 0.5) : colour;
}

/** Golden-ratio spread, 0..1 — `spread()` in flare-perimeter.tsx, kept local so this file has no
 *  dependency on the full-screen renderer. */
function jitter(i: number, offset: number): number {
  return ((i + 1) * 0.6180339887 + offset) % 1;
}

type Pt = { x: number; y: number };

const fmt = (n: number) => n.toFixed(2);
const toD = (pts: Pt[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join(' ');

function polar(f: SignatureFrame, r: number, a: number): Pt {
  return { x: f.cx + r * Math.cos(a), y: f.cy + r * Math.sin(a) };
}

/**
 * Every effect's marks, most representative FIRST — `compact` callers (a 24px list row) keep only
 * the head of the list, and a still frame shows only what is flagged `still`, so the order is what
 * guarantees a small or frozen flare still reads as itself.
 */
export function flareSignature(effect: FlareEffect, colour: string, f: SignatureFrame, compact = false): SignatureMark[] {
  const marks = build(effect, colour, f);
  return compact ? marks.slice(0, 3) : marks;
}

function build(effect: FlareEffect, colour: string, f: SignatureFrame): SignatureMark[] {
  const L = f.rOut - f.rIn;
  // Floors, in units: ~1px for a core and ~2.4px for a glow, whatever the avatar size.
  const minCore = 0.9 / f.px;
  const minGlow = 2.4 / f.px;

  switch (effect) {
    // ZEUS — short strikes at scattered points round the ring, fast double-flash. Several, thin.
    case 'zaps':
      return [-2.25, -0.72, 0.9].map((a, i) => ({
        node: bolt(f, a, {
          ...LIGHTNING.zaps,
          glowW: Math.max(L * 0.2, minGlow),
          coreW: Math.max(L * 0.065, minCore),
          segs: 5,
          sway: L * 0.24,
          seed: i * 0.31,
          impact: false,
        }),
        anim: 'flash' as const,
        mult: [4, 3, 5][i],
        phase: jitter(i, 0.17),
        travel: 0,
        // Two parked strikes, not one: scattered strikes ARE Zeus, and a single bolt is Asgard's read.
        still: i < 2 ? 1 : 0,
        stillAt: 0,
      }));

    // ASGARD — fewer, heavier bolts falling onto the TOP of the ring, each landing with a shrapnel
    // burst. The same split as the perimeter: Zeus is weather, Asgard is a hammer.
    case 'hammer':
      return [-Math.PI / 2 - 0.42, -Math.PI / 2 + 0.5].map((a, i) => ({
        node: bolt(f, a, {
          ...LIGHTNING.hammer,
          glowW: Math.max(L * 0.32, minGlow * 1.3),
          coreW: Math.max(L * 0.1, minCore * 1.3),
          segs: 4,
          sway: L * 0.2,
          seed: 0.5 + i * 0.27,
          impact: true,
        }),
        anim: 'flash' as const,
        mult: [2, 3][i],
        phase: jitter(i, 0.29),
        travel: 0,
        still: i === 0 ? 1 : 0,
        stillAt: 0,
      }));

    // INFERNO — faint warm light breathing INWARD onto the ring (mock 243), not tongues: the same
    // read as the profile border and the lock-in perimeter. Two warm bands — a steady one hugging
    // the face and a wider one that swells and contracts toward it on the `lick` pulse.
    case 'flames': {
      const warm = flareDisplayColour('flames', colour);
      const hot = tint(warm, 0.4);
      const steady: SignatureMark = {
        node: <Circle cx={f.cx} cy={f.cy} r={f.rIn + L * 0.14} fill="none" stroke={warm} strokeWidth={Math.max(L * 0.22, minGlow)} opacity={0.4} />,
        anim: 'static',
        mult: 1,
        phase: 0,
        travel: 0,
        still: 1,
        stillAt: 0,
      };
      const swell = [0, 1].map((i) => ({
        node: (
          <G fill="none">
            <Circle cx={f.cx} cy={f.cy} r={f.rIn + L * (0.42 + i * 0.2)} stroke={warm} strokeWidth={Math.max(L * 0.42, minGlow)} opacity={0.22} />
            <Circle cx={f.cx} cy={f.cy} r={f.rIn + L * (0.3 + i * 0.16)} stroke={hot} strokeWidth={Math.max(L * 0.1, minCore)} opacity={0.35} />
          </G>
        ),
        anim: 'lick' as const,
        mult: [6, 5][i],
        phase: [0, 0.5][i],
        travel: 0,
        still: i === 0 ? 0.9 : 0,
        stillAt: 0,
      }));
      return [steady, ...swell];
    }

    // ACID RAIN — drops beading on the lower arc and falling off it.
    case 'falling': {
      const hot = tint(colour, 0.5);
      const angles = [0.5, 0.3, 0.7, 0.4].map((x) => x * Math.PI);
      return angles.map((a, i) => ({
        node: drop(polar(f, f.rIn * 1.02, a), L * (0.15 - (i % 2) * 0.03), colour, hot),
        anim: 'fall' as const,
        mult: [3, 4, 3, 5][i],
        phase: jitter(i, 0.11),
        travel: L * 1.35,
        still: 0.95,
        stillAt: [0.3, 0.6, 0.12, 0.45][i],
      }));
    }

    // VOID SMOKE — slow wisps curling up off the sides.
    case 'smoke': {
      const pale = tint(colour, 0.45);
      const bases = [polar(f, f.rIn * 1.04, Math.PI * 0.96), polar(f, f.rIn * 1.04, Math.PI * 0.04), polar(f, f.rIn * 1.06, Math.PI * 0.32)];
      return bases.map((b, i) => ({
        node: wisp(b, L * 1.4, L * 0.34 * (i % 2 === 0 ? 1 : -1), L, colour, pale),
        anim: 'drift' as const,
        mult: [1, 1, 2][i],
        phase: [0, 0.4, 0.7][i],
        travel: L * 0.9,
        still: 0.85,
        stillAt: 0.3,
      }));
    }

    // VOID PLASMA — a charged band hugging the ring, with tight arcs crackling along it.
    case 'plasma': {
      const core = tint(colour, 0.65);
      const rBand = f.rIn + L * 0.28;
      const band: SignatureMark = {
        node: <Circle cx={f.cx} cy={f.cy} r={rBand} fill="none" stroke={colour} strokeWidth={Math.max(L * 0.1, minCore)} opacity={0.3} />,
        anim: 'static',
        mult: 1,
        phase: 0,
        travel: 0,
        still: 1,
        stillAt: 0,
      };
      const arcs = [0, 1, 2, 3, 4].map((i) => ({
        node: crackle(f, (i * Math.PI * 2) / 5 + 0.3, rBand, L * 0.2, colour, core, Math.max(L * 0.16, minGlow), Math.max(L * 0.05, minCore), i),
        anim: 'flash' as const,
        mult: 7 + (i % 3),
        phase: jitter(i, 0.53),
        travel: 0,
        still: i % 2 === 0 ? 0.9 : 0,
        stillAt: 0,
      }));
      return [band, ...arcs];
    }

    // EMBERFALL ASCENDANT — a molten pool on the lower arc, embers falling into it down the sides
    // and motes climbing back out. The perimeter's capstone layer, curled round an avatar.
    case 'emberfall': {
      const hot = Colors.ember;
      const a0 = Math.PI * 0.2;
      const a1 = Math.PI * 0.8;
      const rPool = f.rIn + L * 0.12;
      const p0 = polar(f, rPool, a0);
      const p1 = polar(f, rPool, a1);
      const arc = `M${fmt(p0.x)} ${fmt(p0.y)} A${fmt(rPool)} ${fmt(rPool)} 0 0 1 ${fmt(p1.x)} ${fmt(p1.y)}`;
      const pool: SignatureMark = {
        node: (
          <G fill="none" strokeLinecap="round">
            <Path d={arc} stroke={colour} strokeWidth={Math.max(L * 0.34, minGlow)} opacity={0.5} />
            <Path d={arc} stroke={hot} strokeWidth={Math.max(L * 0.1, minCore)} opacity={0.8} />
          </G>
        ),
        anim: 'static',
        mult: 1,
        phase: 0,
        travel: 0,
        still: 1,
        stillAt: 0,
      };
      const side = f.rIn + L * 0.5;
      const falling = [-1, 1, -0.82, 0.82].map((s, i) => ({
        node: ember({ x: f.cx + s * side, y: f.cy - f.rIn * 0.85 }, L * (0.17 - (i % 2) * 0.04), colour, hot),
        anim: 'fall' as const,
        mult: [2, 3, 3, 2][i],
        phase: jitter(i, 0.07),
        travel: f.rIn * 1.5,
        still: 1,
        stillAt: [0.35, 0.6, 0.15, 0.8][i],
      }));
      const rising = [0.32, 0.68].map((x, i) => ({
        node: ember(polar(f, rPool, x * Math.PI), L * 0.12, colour, hot),
        anim: 'rise' as const,
        mult: [3, 4][i],
        phase: jitter(i, 0.61),
        travel: L * 1.4,
        still: 0.8,
        stillAt: 0.4,
      }));
      return [pool, falling[0], falling[1], ...rising, falling[2], falling[3]];
    }

    // GLOW — White Incandescence, Solar Flare. The bloom FlareAura already draws IS the signature,
    // exactly as `EffectLayer` returns null for it at full screen.
    case 'glow':
    default:
      return [];
  }
}

// ─────────────────────────── the marks ───────────────────────────

function bolt(
  f: SignatureFrame,
  a: number,
  o: { glow: string; core: string; glowW: number; coreW: number; segs: number; sway: number; seed: number; impact: boolean }
) {
  // From the box edge in to the ring: a strike LANDS on the avatar rather than leaving it.
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  const pts: Pt[] = [];
  for (let k = 0; k <= o.segs; k += 1) {
    const t = k / o.segs;
    const r = f.rOut * 0.98 + (f.rIn - f.rOut * 0.98) * t;
    const off = k === 0 || k === o.segs ? 0 : (k % 2 === 0 ? 1 : -1) * o.sway * (0.45 + 0.55 * jitter(k, o.seed));
    pts.push({ x: f.cx + r * Math.cos(a) + nx * off, y: f.cy + r * Math.sin(a) + ny * off });
  }
  // One fork off the second joint, angled on toward the ring — a branch is what makes a thin line
  // read as lightning rather than as a drawn rule (the perimeter's own lesson).
  const from = pts[Math.min(2, pts.length - 2)];
  const side = jitter(3, o.seed) > 0.5 ? 1 : -1;
  const fa = a + Math.PI + side * 0.75;
  const step = (f.rOut - f.rIn) * 0.22;
  const f1 = { x: from.x + step * Math.cos(fa), y: from.y + step * Math.sin(fa) };
  const f2 = { x: f1.x + step * 0.8 * Math.cos(fa - side * 0.5), y: f1.y + step * 0.8 * Math.sin(fa - side * 0.5) };
  const d = toD(pts);
  const fork = toD([from, f1, f2]);
  const hit = pts[pts.length - 1];

  let burst: string | null = null;
  if (o.impact) {
    // Shrapnel thrown back OUT of the ring where the hammer lands, never in across the face.
    const rays: string[] = [];
    for (let k = 0; k < 5; k += 1) {
      const ra = a + (k - 2) * 0.55;
      const len = (f.rOut - f.rIn) * (0.22 + 0.12 * jitter(k, o.seed));
      rays.push(`M${fmt(hit.x)} ${fmt(hit.y)} L${fmt(hit.x + len * Math.cos(ra))} ${fmt(hit.y + len * Math.sin(ra))}`);
    }
    burst = rays.join(' ');
  }

  return (
    <G fill="none" strokeLinecap="round" strokeLinejoin="round">
      <Path d={d} stroke={o.glow} strokeWidth={o.glowW} opacity={0.42} />
      <Path d={fork} stroke={o.glow} strokeWidth={o.glowW * 0.6} opacity={0.3} />
      <Path d={d} stroke={o.core} strokeWidth={o.coreW} />
      <Path d={fork} stroke={o.core} strokeWidth={o.coreW * 0.7} opacity={0.85} />
      {burst && <Path d={burst} stroke={o.core} strokeWidth={o.coreW * 0.75} opacity={0.9} />}
      <Circle cx={hit.x} cy={hit.y} r={o.coreW * 1.6} fill={o.core} />
    </G>
  );
}

function drop(at: Pt, s: number, colour: string, hot: string) {
  const { x, y } = at;
  const d =
    `M${fmt(x)} ${fmt(y - 1.7 * s)} ` +
    `C${fmt(x + 0.9 * s)} ${fmt(y - 0.4 * s)} ${fmt(x + s)} ${fmt(y + 0.5 * s)} ${fmt(x)} ${fmt(y + s)} ` +
    `C${fmt(x - s)} ${fmt(y + 0.5 * s)} ${fmt(x - 0.9 * s)} ${fmt(y - 0.4 * s)} ${fmt(x)} ${fmt(y - 1.7 * s)} Z`;
  return (
    <G>
      <Circle cx={x} cy={y} r={s * 1.9} fill={colour} opacity={0.22} />
      <Path d={d} fill={colour} />
      <Circle cx={x - s * 0.3} cy={y + s * 0.15} r={s * 0.32} fill={hot} opacity={0.85} />
    </G>
  );
}

function wisp(base: Pt, h: number, w: number, L: number, colour: string, pale: string) {
  const d =
    `M${fmt(base.x)} ${fmt(base.y)} ` +
    `C${fmt(base.x + w)} ${fmt(base.y - h * 0.33)} ${fmt(base.x - w)} ${fmt(base.y - h * 0.66)} ${fmt(base.x + w * 0.4)} ${fmt(base.y - h)}`;
  return (
    <G fill="none" strokeLinecap="round">
      <Path d={d} stroke={colour} strokeWidth={L * 0.42} opacity={0.14} />
      <Path d={d} stroke={colour} strokeWidth={L * 0.2} opacity={0.26} />
      <Path d={d} stroke={pale} strokeWidth={L * 0.07} opacity={0.4} />
    </G>
  );
}

function crackle(f: SignatureFrame, aC: number, r: number, amp: number, colour: string, core: string, glowW: number, coreW: number, i: number) {
  const pts: Pt[] = [];
  const segs = 6;
  for (let k = 0; k <= segs; k += 1) {
    const a = aC - 0.34 + (0.68 * k) / segs;
    const off = k === 0 || k === segs ? 0 : (k % 2 === 0 ? 1 : -1) * amp * (0.5 + 0.5 * jitter(k, i * 0.37));
    pts.push(polar(f, r + off, a));
  }
  const d = toD(pts);
  return (
    <G fill="none" strokeLinecap="round" strokeLinejoin="round">
      <Path d={d} stroke={colour} strokeWidth={glowW} opacity={0.5} />
      <Path d={d} stroke={core} strokeWidth={coreW} />
    </G>
  );
}

function ember(at: Pt, s: number, colour: string, hot: string) {
  return (
    <G>
      <Circle cx={at.x} cy={at.y} r={s * 2.1} fill={colour} opacity={0.28} />
      <Circle cx={at.x} cy={at.y} r={s} fill={colour} />
      <Circle cx={at.x} cy={at.y} r={s * 0.55} fill={hot} />
    </G>
  );
}

// ─────────────────────────── drawing them ───────────────────────────

/**
 * The parked frame, as SVG nodes to drop into a caller's own <Svg>: every static mark, and each
 * moving mark held at its `stillAt`. This is what reduced motion, an off-screen tab and a captured
 * share card all get — a frozen signature, never a blank glow.
 */
export function SignatureStill({ marks }: { marks: SignatureMark[] }) {
  return (
    <>
      {marks.map((m, i) => {
        if (m.anim === 'static') return <G key={i}>{m.node}</G>;
        if (m.still <= 0) return null;
        const dir = m.anim === 'fall' ? 1 : m.anim === 'rise' || m.anim === 'drift' ? -1 : 0;
        return (
          <G key={i} opacity={m.still} transform={`translate(0 ${fmt(dir * m.stillAt * m.travel)})`}>
            {m.node}
          </G>
        );
      })}
    </>
  );
}

/**
 * The live version: static marks in ONE <Svg>, each moving mark in its own Animated.View. Every
 * moving mark reads the same shared clock, so a flare is one driver however many marks it has.
 *
 * The caller positions a `box` x `box` View; these fill it. Geometry is the 0-100 box, so the
 * transform scale on a `lick` pivots on the box centre, which is the avatar centre — a tongue that
 * scales up grows outward from the ring.
 */
export function SignatureLayers({ marks, box, clock }: { marks: SignatureMark[]; box: number; clock: SharedValue<number> }) {
  const fixed = marks.filter((m) => m.anim === 'static');
  const moving = marks.filter((m) => m.anim !== 'static');
  return (
    <>
      {fixed.length > 0 && (
        <Svg width={box} height={box} viewBox="0 0 100 100" style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
          {fixed.map((m, i) => (
            <G key={i}>{m.node}</G>
          ))}
        </Svg>
      )}
      {moving.map((m, i) => (
        <MovingMark key={i} mark={m} box={box} clock={clock} />
      ))}
    </>
  );
}

function MovingMark({ mark, box, clock }: { mark: SignatureMark; box: number; clock: SharedValue<number> }) {
  const { anim, mult, phase } = mark;
  const travelPx = (mark.travel * box) / 100;

  // Same keys every frame whatever the anim — a style whose key set changes is the one thing
  // Reanimated cannot undo (see ItemPedestal).
  const style = useAnimatedStyle(() => {
    const t = (clock.value * mult + phase) % 1;
    let opacity = 1;
    let tx = 0;
    let ty = 0;
    let scale = 1;
    if (anim === 'flash') {
      opacity = flashCurve(t);
    } else if (anim === 'lick') {
      const s = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
      opacity = 0.55 + 0.45 * s;
      scale = 0.93 + 0.1 * s;
    } else if (anim === 'fall') {
      ty = t * travelPx;
      opacity = Math.sin(t * Math.PI);
    } else if (anim === 'rise') {
      ty = -t * travelPx;
      opacity = Math.sin(t * Math.PI);
    } else if (anim === 'drift') {
      ty = -t * travelPx;
      tx = Math.sin(t * Math.PI * 2) * travelPx * 0.12;
      opacity = Math.sin(t * Math.PI) * 0.9;
    }
    return { opacity, transform: [{ translateX: tx }, { translateY: ty }, { scale }] };
  });

  // `opacity: 0` underneath: a frame painted before Reanimated applies anything paints nothing,
  // rather than every mark at full strength at once (FlarePerimeter's blob bug).
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: box, height: box, opacity: 0 }, style]}>
      <Svg width={box} height={box} viewBox="0 0 100 100">
        {mark.node}
      </Svg>
    </Animated.View>
  );
}
