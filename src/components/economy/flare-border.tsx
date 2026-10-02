import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useCosmeticClock } from '@/components/economy/cosmetic-clock';
import { flareTierForMinutes, spread, starPath, type FlareTier } from '@/components/economy/flare-perimeter';
import { LIGHTNING, SIGNATURE_CYCLE_MS, flareDisplayColour } from '@/components/economy/flare-signature';
import { useGatedInterval, useMotionActive } from '@/hooks/use-motion-active';
import type { FlareEffect } from '@/lib/economy/catalog';
import { tint } from '@/lib/economy/colour';
import { creditedSeconds, type LockInClock } from '@/lib/lock-in-clock';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE FLARE AS A CARD BORDER (mock 243 per effect, mock 252/253 for the lifecycle).
//
// A flare used to exist in two places: the full-screen perimeter during a lock-in (FlarePerimeter)
// and a small aura behind an avatar on list rows (FlareAura). Neither is the profile. Mock 243 puts
// each flare's SIGNATURE on the profile card's own edge — the lightning, the drips, the smoke, the
// crackle and the climbing embers all run the card's perimeter — so a profile says WHICH flare you
// wear, not just that you wear one.
//
// TWO STRENGTHS (mock 252's lifecycle):
//   • AMBIENT — the profile at rest. The mock-243 border exactly: base ring breathing .55 -> 1, the
//     effect's marks at the mock's counts and cadences.
//   • SURGE — the owner is locked in RIGHT NOW (`surge` = the session's FlareTier). Same marks, same
//     cadence (cadence never ramps — flare-perimeter's rule), but a brighter ring, an outer surge
//     halo that grows with the tier, and a one-off bloom on every 15/30/60 crossing. The full-screen
//     FlarePerimeter on the lock-in screen is unchanged; this is the card version of the same ramp.
//
// PER EFFECT (mock 243, checked mark by mark):
//   zaps     Zeus — five fast strikes descending from the TOP edge into the card, gold-on-white,
//            each landing with a small four-point star-spark. Never a splash.
//   hammer   Asgard — three slower, heavier strikes, ice-on-white, each with a big star-spark.
//   flames   Inferno — NO ring and NO tongues: a faint warm light breathing INWARD from every edge.
//   falling  Acid Rain — drips running down the edges.
//   smoke    Void Smoke — soft violet billows drifting OFF the edges, outward.
//   plasma   Void Plasma — a bright pulsing ring + jagged filaments crackling IN PLACE at the edge.
//            (Smoke is soft mass leaving; plasma is charge held — the two never read alike.)
//   glow     White Incandescence / Solar — a strong bloom ring, nothing else.
//   emberfall Emberfall Ascendant — embers climbing the card, always rising.
//
// THE FOUR RULES (campfire-banner-art): static SVG in animated Views, nothing re-renders React per
// frame; capped counts (≤ 10 animated views per effect); ONE driver per effect — every ring breath
// and every mark reads the shared cosmetic clock at SIGNATURE_CYCLE_MS, the tempo the avatar aura
// and the shop tile already use; deterministic layout — every position and phase is a constant or
// a `spread()`, never Math.random(). Reduced motion / off-screen / `motion="still"` draw a parked
// frame and never subscribe to a clock. Every SVG gradient id is unique per mount.
//
// COST. One card on a screen, never a list (lists keep FlareAura).
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type FlareIdentity = { colour: string; effect: FlareEffect };
export type FlareBorderMotion = 'full' | 'still';

/** Mock 248's `.hero{padding:3px}` — the gap the perimeter glows in. */
const PAD = 3;

/** Below this card height the border drops to its compact counts (fewer strikes, drips, arcs). */
const COMPACT_BELOW_H = 110;

/** Mock 243's card is ~190pt tall; marks scale off the real card's height against it. */
const MOCK_CARD_H = 190;

/** How a flare's ring is drawn. Inferno has only a hairline (its light is the inward heat). */
type RimKind = 'line' | 'strong' | 'hairline';

const RIM_KIND: Record<FlareEffect, RimKind> = {
  glow: 'strong',
  plasma: 'strong',
  flames: 'hairline',
  smoke: 'line',
  zaps: 'line',
  hammer: 'line',
  falling: 'line',
  emberfall: 'line',
};

/**
 * Ring breaths per clock cycle, so the breath lands near mock 243's own period (2.4s for the base
 * ring, 2s for glow, 2.2s for plasma, 2.6s for Inferno's heat) on the effect's shared clock.
 */
const RING_MULT: Record<FlareEffect, number> = {
  glow: 6, // 12.8s / 6 = 2.13s
  smoke: 8, // 2.3s
  plasma: 4, // 2.1s
  zaps: 2, // 2.3s
  hammer: 2, // 3.0s — the heavy one breathes slower
  falling: 4, // 2.6s
  flames: 3, // 2.53s
  emberfall: 4, // 2.4s
};

/** The outer surge halo's strength per session tier — absent entirely at rest. */
const SURGE_HALO: Record<FlareTier, number> = { 0: 0.35, 1: 0.55, 2: 0.8, 3: 1 };

/** `#RRGGBB` + alpha → rgba(). The flare colour is always a six-digit hex in the catalog. */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  if (!Number.isFinite(n)) return `rgba(255,138,44,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A CSS animation-delay as a phase into a loop of `period` — `(clock*mult + phase) % 1`. */
const delayPhase = (delay: number, period: number) => (1 - (delay / period) % 1) % 1;

// ─────────────────────────── the session ramp ───────────────────────────

/**
 * The flare tier for a live session, or null when there is none — feed it to FlareBorder's `surge`.
 *
 * Only your OWN card can know this: there is no live-session feed for anyone else, and inventing a
 * surge for a visitor would be dishonest (the same reasoning as useAuraTier). Ticks once a minute —
 * the thresholds are 15/30/60 minutes apart — and holds through a pause, because it reads credited
 * time (0218), exactly as the lock-in screen's own ramp does.
 */
export function useFlareSurge(clock: LockInClock | null | undefined): FlareTier | null {
  const [now, setNow] = useState(() => Date.now());
  useGatedInterval(() => setNow(Date.now()), 60_000, Boolean(clock));
  if (!clock) return null;
  return flareTierForMinutes(creditedSeconds(clock, now) / 60);
}

// ─────────────────────────── the border ───────────────────────────

/**
 * Wraps `children` (the hero card) in the equipped flare's perimeter. With no flare it is a plain
 * `padding` box, so the card sits in exactly the same place whether or not one is equipped — an
 * equip in the loadout never shifts the layout under your thumb.
 */
export function FlareBorder({
  flare,
  radius,
  motion = 'full',
  surge = null,
  compact,
  style,
  children,
}: {
  flare: FlareIdentity | null | undefined;
  /** The wrapped card's corner radius. The border hugs it at `radius + PAD`. */
  radius: number;
  motion?: FlareBorderMotion;
  /**
   * null (the default) = AMBIENT, the profile at rest. A tier = the owner is locked in right now and
   * this is how deep they are (useFlareSurge): brighter ring, a surge halo that grows per tier, and
   * a bloom on each step up.
   */
  surge?: FlareTier | null;
  /** Force the compact counts. Left unset, cards under COMPACT_BELOW_H tall get them automatically. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const active = useMotionActive();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) => (Math.abs(prev.w - width) < 0.5 && Math.abs(prev.h - height) < 0.5 ? prev : { w: width, h: height }));
  };

  const outer = radius + PAD;
  if (!flare) {
    return <View style={[styles.wrap, { borderRadius: outer }, style]}>{children}</View>;
  }

  const animate = motion === 'full' && !reduceMotion && active;
  const colour = flareDisplayColour(flare.effect, flare.colour);
  const kind = RIM_KIND[flare.effect];
  const card: Card = {
    w: Math.max(0, box.w - PAD * 2),
    h: Math.max(0, box.h - PAD * 2),
    k: clamp((box.h - PAD * 2) / MOCK_CARD_H, 0.6, 1.25),
    compact: compact ?? (box.h > 0 && box.h - PAD * 2 < COMPACT_BELOW_H),
  };

  return (
    <View style={[styles.wrap, { borderRadius: outer }, style]} onLayout={onLayout}>
      {animate ? (
        <LiveRim effect={flare.effect} colour={colour} kind={kind} outer={outer} surge={surge} />
      ) : (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {surge != null ? <SurgeHalo colour={colour} outer={outer} strength={SURGE_HALO[surge]} /> : null}
          <Rim colour={colour} kind={kind} outer={outer} />
        </View>
      )}
      {children}
      {/* IN FRONT of the card. The card paints its own texture edge to edge, so anything behind it
          is invisible — mock 248's own note. Everything here is pointer-inert. */}
      {card.w > 0 ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {/* Clipped to the card's edge: strikes, heat, drips, crackle, embers. */}
          <View style={[styles.clip, { borderRadius: radius, opacity: surge == null ? 0.92 : 1 }]}>
            {animate ? (
              <LiveMarks effect={flare.effect} colour={colour} card={card} />
            ) : (
              <StillMarks effect={flare.effect} colour={colour} card={card} />
            )}
          </View>
          {/* Unclipped: smoke drifts OFF the edge, so it must be allowed past it. */}
          {flare.effect === 'smoke' ? (
            <View style={styles.free}>
              <Smoke colour={colour} card={card} animate={animate} />
            </View>
          ) : null}
          {animate && surge != null ? <SurgeBloom colour={colour} outer={outer} tier={surge} /> : null}
        </View>
      ) : null}
    </View>
  );
}

type Card = { w: number; h: number; k: number; compact: boolean };

// ─────────────────────────── the ring ───────────────────────────

/**
 * The perimeter itself, drawn as concentric bordered Views rather than a box-shadow (which renders
 * differently per platform and not at all for an inset on Android). Together they read as mock
 * 243's `inset 0 0 0 1.5px, 0 0 16px 1px` (`line`), `2px + 22px bloom + 18px inset` (`strong`), or
 * Inferno's lone 1px edge (`hairline`).
 */
function Rim({ colour, kind, outer }: { colour: string; kind: RimKind; outer: number }) {
  const line = tint(colour, 0.15);
  if (kind === 'hairline') {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={[styles.ring, ringAt(0, outer), { borderWidth: 1, borderColor: alpha(colour, 0.75) }]} />
      </View>
    );
  }
  if (kind === 'strong') {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={[styles.ring, ringAt(-12, outer), { borderWidth: 5, borderColor: alpha(colour, 0.06) }]} />
        <View style={[styles.ring, ringAt(-7, outer), { borderWidth: 4, borderColor: alpha(colour, 0.16) }]} />
        <View style={[styles.ring, ringAt(-3, outer), { borderWidth: 3, borderColor: alpha(colour, 0.36) }]} />
        <View style={[styles.ring, ringAt(0, outer), { borderWidth: 2, borderColor: line }]} />
        {/* The inset bloom — the glow falling inward onto the card's own edge. */}
        <View style={[styles.ring, ringAt(2, outer), { borderWidth: 3, borderColor: alpha(colour, 0.3) }]} />
        <View style={[styles.ring, ringAt(5, outer), { borderWidth: 4, borderColor: alpha(colour, 0.13) }]} />
        <View style={[styles.ring, ringAt(9, outer), { borderWidth: 5, borderColor: alpha(colour, 0.05) }]} />
      </View>
    );
  }
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.ring, ringAt(-6, outer), { borderWidth: 3, borderColor: alpha(colour, 0.1) }]} />
      <View style={[styles.ring, ringAt(-2.5, outer), { borderWidth: 2.5, borderColor: alpha(colour, 0.3) }]} />
      <View style={[styles.ring, ringAt(0, outer), { borderWidth: 1.5, borderColor: line }]} />
      <View style={[styles.ring, ringAt(1.5, outer), { borderWidth: 2, borderColor: alpha(tint(colour, 0.25), 0.26) }]} />
    </View>
  );
}

/** The SURGE halo — wide faint rings well outside the card, only while the owner is locked in. */
function SurgeHalo({ colour, outer, strength }: { colour: string; outer: number; strength: number }) {
  return (
    <View style={[StyleSheet.absoluteFill, { opacity: strength }]} pointerEvents="none">
      <View style={[styles.ring, ringAt(-22, outer), { borderWidth: 7, borderColor: alpha(colour, 0.04) }]} />
      <View style={[styles.ring, ringAt(-15, outer), { borderWidth: 6, borderColor: alpha(colour, 0.09) }]} />
      <View style={[styles.ring, ringAt(-9, outer), { borderWidth: 4, borderColor: alpha(colour, 0.18) }]} />
    </View>
  );
}

/** A ring `inset` pt inside (negative = outside) the wrap's edge, its radius following. */
function ringAt(inset: number, outer: number): ViewStyle {
  return { top: inset, left: inset, right: inset, bottom: inset, borderRadius: Math.max(0, outer - inset) };
}

function LiveRim({
  effect,
  colour,
  kind,
  outer,
  surge,
}: {
  effect: FlareEffect;
  colour: string;
  kind: RimKind;
  outer: number;
  surge: FlareTier | null;
}) {
  const clock = useCosmeticClock(SIGNATURE_CYCLE_MS[effect], true);
  const mult = RING_MULT[effect];
  // Mock 243's `pulse`: .55 -> 1 and back. During a lock-in the trough lifts — the ring never
  // dims as far, which is most of what "full intensity" reads as on a card.
  const lo = surge == null ? 0.55 : 0.68 + 0.06 * surge;
  const breath = useAnimatedStyle(() => {
    const b = 0.5 - 0.5 * Math.cos(clock.value * mult * Math.PI * 2);
    return { opacity: lo + (1 - lo) * b };
  });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: lo }, breath]} pointerEvents="none">
      {surge != null ? <SurgeHalo colour={colour} outer={outer} strength={SURGE_HALO[surge]} /> : null}
      <Rim colour={colour} kind={kind} outer={outer} />
    </Animated.View>
  );
}

/**
 * THE STEP-UP BEAT, card-sized — flare-perimeter's SurgeBloom for the border. A one-off bright ring
 * swelling out over ~0.4s and falling away over ~1.1s when the session crosses 15/30/60. Never on
 * mount (opening your profile mid-session must not bloom for a step taken ten minutes ago), never
 * on a decrease, and no haptic — the lock-in screen owns the haptic for the same crossing.
 */
function SurgeBloom({ colour, outer, tier }: { colour: string; outer: number; tier: FlareTier }) {
  const t = useSharedValue(0);
  const seen = useRef<FlareTier | null>(null);

  useEffect(() => {
    const previous = seen.current;
    seen.current = tier;
    if (previous === null || tier <= previous) return;
    t.value = 0;
    t.value = withSequence(
      withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 1150, easing: Easing.in(Easing.quad) })
    );
  }, [tier, t]);

  const style = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ scale: 1 + t.value * 0.025 }] }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: 0 }, style]} pointerEvents="none">
      <Rim colour={tint(colour, 0.35)} kind="strong" outer={outer} />
    </Animated.View>
  );
}

// ─────────────────────────── the marks, live ───────────────────────────

function LiveMarks({ effect, colour, card }: { effect: FlareEffect; colour: string; card: Card }) {
  const clock = useCosmeticClock(SIGNATURE_CYCLE_MS[effect], true);
  switch (effect) {
    case 'zaps':
      return <Strikes clock={clock} spec={ZEUS} card={card} />;
    case 'hammer':
      return <Strikes clock={clock} spec={VALOR} card={card} />;
    case 'flames':
      return <Heat clock={clock} colour={colour} card={card} />;
    case 'falling':
      return <Drips clock={clock} colour={colour} card={card} />;
    case 'plasma':
      return <Arcs clock={clock} colour={colour} card={card} />;
    case 'emberfall':
      return <Embers clock={clock} colour={colour} card={card} />;
    // Smoke lives in the unclipped layer; glow is its ring alone.
    case 'smoke':
    case 'glow':
      return null;
  }
}

// ── LIGHTNING: Zeus' Wrath + Asgardian Valor ──

/**
 * One family of strikes, as mock 243 specifies it. Points are the mock's own `polyline` (24 x 100
 * viewBox), so the jag IS the mock's jag; odd strikes are mirrored so five bolts are not five
 * copies. `on`/`off` are the visible window of each loop (the mock's `steps(1)` keyframes), and the
 * mark (the star-spark) blooms from `on` to the end of the loop.
 */
type StrikeSpec = {
  palette: { glow: string; core: string };
  pts: readonly (readonly [number, number])[];
  /** Strike x positions as a fraction of the card's width (mock 243's `left:`s over its 210pt card). */
  xs: readonly number[];
  /** CSS animation-delays, seconds, against `period`. */
  delays: readonly number[];
  period: number;
  /** Loops per clock cycle — SIGNATURE_CYCLE_MS / mult ≈ the mock period. */
  mult: number;
  /** Which strikes a compact card keeps. */
  compactKeep: readonly number[];
  /** Bolt length as a fraction of the card's height, and its drawn width at mock scale. */
  len: number;
  boltW: number;
  coreW: number;
  /** The star's size at mock scale, and its scale-in range. */
  mark: number;
  markScale: readonly [number, number];
  on: number;
  off: number;
};

/** Zeus: five fast, scattered strikes (mock 243 `.fx-wrath`, 1.4s, visible 66-80%). */
const ZEUS: StrikeSpec = {
  palette: LIGHTNING.zaps,
  pts: [[13, 0], [8, 22], [18, 27], [6, 48], [17, 53], [7, 74], [16, 80], [4, 100]],
  xs: [28 / 210, 68 / 210, 108 / 210, 148 / 210, 184 / 210],
  delays: [0, 0.4, 0.8, 0.2, 0.6],
  period: 1.4,
  mult: 3, // 4.6s / 3 = 1.53s
  compactKeep: [0, 2, 4],
  len: 0.74,
  boltW: 18,
  coreW: 1.6,
  mark: 12,
  markScale: [0.3, 1.6],
  on: 0.64,
  off: 0.8,
};

/** Asgard: three heavy single strikes (mock 243 `.fx-valor`, 2.6s, visible 83-94%). */
const VALOR: StrikeSpec = {
  palette: LIGHTNING.hammer,
  pts: [[14, 0], [6, 24], [19, 30], [5, 52], [18, 58], [6, 80], [17, 86], [3, 100]],
  xs: [46 / 210, 150 / 210, 100 / 210],
  delays: [0, 0.9, 1.7],
  period: 2.6,
  mult: 2, // 6.0s / 2 = 3.0s
  compactKeep: [0, 1],
  len: 0.86,
  boltW: 24,
  coreW: 2.2,
  mark: 18,
  markScale: [0.2, 2.1],
  on: 0.81,
  off: 0.94,
};

function Strikes({ clock, spec, card }: { clock: SharedValue<number>; spec: StrikeSpec; card: Card }) {
  const keep = card.compact ? spec.compactKeep : spec.xs.map((_, i) => i);
  return (
    <>
      {keep.map((i) => (
        <Strike key={i} clock={clock} spec={spec} card={card} index={i} />
      ))}
    </>
  );
}

function Strike({ clock, spec, card, index }: { clock: SharedValue<number>; spec: StrikeSpec; card: Card; index: number }) {
  const { k } = card;
  const bw = spec.boltW * k;
  const g = 6 * k; // room for the glow stroke either side
  const len = card.h * spec.len;
  const mirror = index % 2 === 1;
  const pts = spec.pts.map(([x, y]) => ({ x: g + ((mirror ? 24 - x : x) / 24) * bw, y: (y / 100) * len }));
  const d = `M ${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}`;
  const left = spec.xs[index] * card.w - bw / 2 - g;
  const end = pts[pts.length - 1];
  const m = spec.mark * k;

  const { mult, on, off } = spec;
  const [s0, s1] = spec.markScale;
  const phase = delayPhase(spec.delays[index], spec.period);

  const boltStyle = useAnimatedStyle(() => {
    const u = (clock.value * mult + phase) % 1;
    let o = 0;
    if (u >= on && u < off) {
      const p = (u - on) / (off - on);
      // Snap on, a double-strike dip a third of the way in, a fast fade out: lightning, not a pulse.
      o = p < 0.08 ? p / 0.08 : p > 0.34 && p < 0.44 ? 0.3 : p > 0.82 ? (1 - p) / 0.18 : 1;
    }
    return { opacity: o };
  });
  const markStyle = useAnimatedStyle(() => {
    const u = (clock.value * mult + phase) % 1;
    const p = u < on ? 0 : (u - on) / (1 - on);
    const o = u < on ? 0 : p < 0.12 ? p / 0.12 : 1 - (p - 0.12) / 0.88;
    return { opacity: o, transform: [{ scale: s0 + (s1 - s0) * p }] };
  });

  const { glow, core } = spec.palette;
  const c = m / 2;
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', left, top: 0, width: bw + g * 2, height: len + g, opacity: 0 }, boltStyle]}>
        <Svg width={bw + g * 2} height={len + g} pointerEvents="none">
          <Path d={d} stroke={glow} strokeWidth={spec.coreW * 4.5 * k} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.22} />
          <Path d={d} stroke={glow} strokeWidth={spec.coreW * 2.2 * k} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
          <Path d={d} stroke={core} strokeWidth={spec.coreW * k} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Animated.View>
      {/* The impact: a four-point star-spark where the bolt lands (mock 243 `.mark`). */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', left: left + end.x - c, top: end.y - c, width: m, height: m, opacity: 0 }, markStyle]}>
        <Svg width={m} height={m} pointerEvents="none">
          <Path d={starPath(c, c, c * 0.62, 0.22, Math.PI / 4)} fill={glow} opacity={0.5} />
          <Path d={starPath(c, c, c, 0.2)} fill={glow} />
          <Path d={starPath(c, c, c * 0.55, 0.2)} fill={core} />
        </Svg>
      </Animated.View>
    </>
  );
}

// ── INFERNO: warm light breathing inward ──

/**
 * Mock 243 `.fx-inferno`: `inset 0 0 16px 3px -> inset 0 0 36px 13px`, opacity .45 -> .85, 2.6s —
 * light arriving from every edge and pressing inward, no flame drawn anywhere. A shallow band that
 * is always there and a deep one that swells in over it, crossfaded on the clock: the inset shadow
 * growing, without animating a shadow.
 */
function Heat({ clock, colour, card }: { clock: SharedValue<number>; colour: string; card: Card }) {
  const uid = useId();
  const mult = RING_MULT.flames;
  const shallow = useAnimatedStyle(() => {
    const s = 0.5 - 0.5 * Math.cos(clock.value * mult * Math.PI * 2);
    return { opacity: 0.5 + 0.35 * s };
  });
  const deep = useAnimatedStyle(() => {
    const s = 0.5 - 0.5 * Math.cos(clock.value * mult * Math.PI * 2);
    return { opacity: s };
  });
  const base = Math.min(card.w, card.h);
  return (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: 0 }, shallow]}>
        <Bands id={`heatS-${uid}`} w={card.w} h={card.h} depth={clamp(base * 0.12, 12, 24)} colour={colour} peak={0.6} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: 0 }, deep]}>
        <Bands id={`heatD-${uid}`} w={card.w} h={card.h} depth={clamp(base * 0.3, 26, 56)} colour={colour} peak={0.5} />
      </Animated.View>
    </>
  );
}

/** Four edge ramps of `depth`, overlapping in the corners (flare-perimeter's rim construction). */
function Bands({ id, w, h, depth, colour, peak }: { id: string; w: number; h: number; depth: number; colour: string; peak: number }) {
  const edges = [
    { k: 't', x1: '0', y1: '0', x2: '0', y2: '1' },
    { k: 'b', x1: '0', y1: '1', x2: '0', y2: '0' },
    { k: 'l', x1: '0', y1: '0', x2: '1', y2: '0' },
    { k: 'r', x1: '1', y1: '0', x2: '0', y2: '0' },
  ] as const;
  return (
    <Svg width={w} height={h} pointerEvents="none">
      <Defs>
        {edges.map((e) => (
          <LinearGradient key={e.k} id={`${id}-${e.k}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}>
            <Stop offset="0" stopColor={colour} stopOpacity={peak} />
            <Stop offset="0.35" stopColor={colour} stopOpacity={peak * 0.4} />
            <Stop offset="0.7" stopColor={colour} stopOpacity={peak * 0.1} />
            <Stop offset="1" stopColor={colour} stopOpacity={0} />
          </LinearGradient>
        ))}
      </Defs>
      <Rect x={0} y={0} width={w} height={depth} fill={`url(#${id}-t)`} />
      <Rect x={0} y={h - depth} width={w} height={depth} fill={`url(#${id}-b)`} />
      <Rect x={0} y={0} width={depth} height={h} fill={`url(#${id}-l)`} />
      <Rect x={w - depth} y={0} width={depth} height={h} fill={`url(#${id}-r)`} />
    </Svg>
  );
}

// ── ACID RAIN: drips running down the edges ──

/** Mock 243 `.fx-drip i` — (x as a fraction of width or an edge, top offset, delay). */
const DRIPS: readonly { x: number | 'L' | 'R'; top: number; delay: number }[] = [
  { x: 'L', top: 8, delay: 0 },
  { x: 'R', top: 8, delay: 1.2 },
  { x: 40 / 210, top: 0, delay: 0.6 },
  { x: 1 - 50 / 210, top: 0, delay: 1.8 },
  { x: 0.6, top: 8, delay: 0.9 },
];
const DRIP_PERIOD = 2.4;
const DRIP_MULT = 4; // 10.4s / 4 = 2.6s

function dripLeft(x: number | 'L' | 'R', w: number, dw: number): number {
  return x === 'L' ? 1 : x === 'R' ? w - dw - 1 : x * w - dw / 2;
}

function Drips({ clock, colour, card }: { clock: SharedValue<number>; colour: string; card: Card }) {
  const list = card.compact ? DRIPS.slice(0, 3) : DRIPS;
  return (
    <>
      {list.map((dr, i) => (
        <Drip key={i} clock={clock} colour={colour} card={card} spec={dr} />
      ))}
    </>
  );
}

function Drip({ clock, colour, card, spec }: { clock: SharedValue<number>; colour: string; card: Card; spec: (typeof DRIPS)[number] }) {
  const dw = 5 * card.k;
  const dh = 11 * card.k;
  const travel = card.h * 0.34;
  const phase = delayPhase(spec.delay, DRIP_PERIOD);
  const style = useAnimatedStyle(() => {
    const u = (clock.value * DRIP_MULT + phase) % 1;
    // ease-in: a drip gathers, then runs.
    return { opacity: u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85, transform: [{ translateY: u * u * travel }] };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: dripLeft(spec.x, card.w, dw) - dw * 0.5, top: spec.top * card.k, opacity: 0 }, style]}>
      <DripGlyph colour={colour} dw={dw} dh={dh} />
    </Animated.View>
  );
}

/** A drip: a soft halo with a rounded-bottom bead inside it (mock `border-radius:0 0 60% 60%`). */
function DripGlyph({ colour, dw, dh }: { colour: string; dw: number; dh: number }) {
  const W = dw * 2;
  const x0 = dw * 0.5;
  const d = `M ${x0} 0 L ${x0 + dw} 0 L ${x0 + dw} ${dh * 0.45} Q ${x0 + dw} ${dh} ${x0 + dw / 2} ${dh} Q ${x0} ${dh} ${x0} ${dh * 0.45} Z`;
  return (
    <Svg width={W} height={dh + dw * 0.5} pointerEvents="none">
      <Ellipse cx={W / 2} cy={dh * 0.6} rx={dw} ry={dh * 0.62} fill={colour} opacity={0.22} />
      <Path d={d} fill={colour} />
      <Circle cx={x0 + dw * 0.35} cy={dh * 0.62} r={dw * 0.18} fill={tint(colour, 0.6)} opacity={0.9} />
    </Svg>
  );
}

// ── VOID PLASMA: filaments crackling in place ──

/** Mock 243 `.fx-plasmaarc i` — (x frac or edge, y frac or edge, delay). Vertical filaments. */
const ARCS: readonly { x: number | 'L' | 'R'; y: number | 'T' | 'B'; delay: number }[] = [
  { x: 24 / 210, y: 'T', delay: 0 },
  { x: 'R', y: 0.25, delay: 0 },
  { x: 1 - 40 / 210, y: 'B', delay: 0.6 },
  { x: 'L', y: 0.25, delay: 0.3 },
  { x: 1 - 30 / 210, y: 'T', delay: 0.45 },
  { x: 36 / 210, y: 'B', delay: 0.15 },
];
const ARC_PERIOD = 1.4;
const ARC_MULT = 6; // 8.4s / 6 = 1.4s

function Arcs({ clock, colour, card }: { clock: SharedValue<number>; colour: string; card: Card }) {
  const list = card.compact ? ARCS.slice(0, 4) : ARCS;
  return (
    <>
      {list.map((a, i) => (
        <Arc key={i} clock={clock} colour={colour} card={card} spec={a} index={i} />
      ))}
    </>
  );
}

function arcBox(spec: (typeof ARCS)[number], card: Card) {
  const aw = 8 * card.k;
  const ah = 22 * card.k;
  const edge = 5 * card.k;
  const left = spec.x === 'L' ? edge - aw / 2 + 2 : spec.x === 'R' ? card.w - edge - aw / 2 - 2 : spec.x * card.w - aw / 2;
  const top = spec.y === 'T' ? edge : spec.y === 'B' ? card.h - edge - ah : spec.y * card.h;
  return { aw, ah, left, top };
}

function ArcGlyph({ colour, aw, ah, index }: { colour: string; aw: number; ah: number; index: number }) {
  // The mock's clip-path zigzag, as a stroke, with each filament's kinks nudged by `spread`.
  const segs = 6;
  const pts: string[] = [];
  for (let s = 0; s <= segs; s++) {
    const off = s === 0 || s === segs ? 0 : (s % 2 === 0 ? 1 : -1) * aw * 0.28 * (0.5 + 0.5 * spread(s, index * 0.31));
    pts.push(`${(aw / 2 + off).toFixed(1)} ${((ah * s) / segs).toFixed(1)}`);
  }
  const d = `M ${pts.join(' L ')}`;
  return (
    <Svg width={aw} height={ah} pointerEvents="none">
      <Path d={d} stroke={colour} strokeWidth={aw * 0.55} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.35} />
      <Path d={d} stroke={tint(colour, 0.6)} strokeWidth={aw * 0.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function Arc({ clock, colour, card, spec, index }: { clock: SharedValue<number>; colour: string; card: Card; spec: (typeof ARCS)[number]; index: number }) {
  const { aw, ah, left, top } = arcBox(spec, card);
  const phase = delayPhase(spec.delay, ARC_PERIOD);
  // Mock `arcflick`: opacity .15 <-> 1, scaleY .7 <-> 1.1, ease-in-out — gentle, never a strobe.
  const style = useAnimatedStyle(() => {
    const s = 0.5 - 0.5 * Math.cos(((clock.value * ARC_MULT + phase) % 1) * Math.PI * 2);
    return { opacity: 0.15 + 0.85 * s, transform: [{ scaleY: 0.7 + 0.4 * s }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top, width: aw, height: ah, opacity: 0 }, style]}>
      <ArcGlyph colour={colour} aw={aw} ah={ah} index={index} />
    </Animated.View>
  );
}

// ── EMBERFALL ASCENDANT: embers climbing the border ──

/** Mock 243 `.fx-climb i` — lanes as a fraction of width, delays against 2.6s. Always rising. */
const EMBER_LANES: readonly { x: number; delay: number }[] = [
  { x: 0.01, delay: 0 },
  { x: 20 / 210, delay: 0.7 },
  { x: 0.99, delay: 1.1 },
  { x: 1 - 24 / 210, delay: 1.9 },
  { x: 0.5, delay: 0.4 },
  { x: 0.7, delay: 2.1 },
];
const EMBER_PERIOD = 2.6;
const EMBER_MULT = 4; // 9.6s / 4 = 2.4s

function Embers({ clock, colour, card }: { clock: SharedValue<number>; colour: string; card: Card }) {
  const list = card.compact ? EMBER_LANES.slice(0, 4) : EMBER_LANES;
  return (
    <>
      {list.map((lane, i) => (
        <Ember key={i} clock={clock} colour={colour} card={card} x={lane.x} phase={delayPhase(lane.delay, EMBER_PERIOD)} />
      ))}
    </>
  );
}

function Ember({ clock, colour, card, x, phase }: { clock: SharedValue<number>; colour: string; card: Card; x: number; phase: number }) {
  const s = 5 * card.k;
  const travel = card.h * 0.7;
  const h = card.h;
  const style = useAnimatedStyle(() => {
    const t = (clock.value * EMBER_MULT + phase) % 1;
    // Mock `climb`: in by 14%, linear rise, out at the top.
    const o = t < 0.14 ? t / 0.14 : 1 - (t - 0.14) / 0.86;
    return { opacity: o, transform: [{ translateY: h - s - t * travel }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: clamp(x * card.w - s, 0, card.w - s * 2), opacity: 0 }, style]}>
      <EmberGlyph colour={colour} s={s} />
    </Animated.View>
  );
}

/** Mock `radial-gradient(#ffe8b0, var(--c))` with a glow — as discs, no gradient id needed. */
function EmberGlyph({ colour, s }: { colour: string; s: number }) {
  return (
    <Svg width={s * 2} height={s * 2} pointerEvents="none">
      <Circle cx={s} cy={s} r={s} fill={colour} opacity={0.3} />
      <Circle cx={s} cy={s} r={s * 0.5} fill={colour} />
      <Circle cx={s} cy={s} r={s * 0.26} fill="#FFE8B0" />
    </Svg>
  );
}

// ── VOID SMOKE: billows drifting off the edges ──

/** Mock 243 `.fx-smoke i` — anchor (fractions of the card, centred on its edge), outward drift
 *  (mock px), delay against 3.8s. */
const WISPS: readonly { x: number; y: number; dx: number; dy: number; delay: number }[] = [
  { x: 40 / 210, y: 0, dx: 0, dy: -18, delay: 0 },
  { x: 1 - 40 / 210, y: 0, dx: 0, dy: -18, delay: 1.3 },
  { x: 0, y: 0.3, dx: -16, dy: 0, delay: 1 },
  { x: 1, y: 0.36, dx: 16, dy: 0, delay: 0.4 },
  { x: 50 / 210, y: 1, dx: 0, dy: 16, delay: 0.7 },
  { x: 1 - 50 / 210, y: 1, dx: 0, dy: 16, delay: 2 },
];
const WISP_PERIOD = 3.8;
const WISP_MULT = 5; // 18.4s / 5 = 3.68s

function Smoke({ colour, card, animate }: { colour: string; card: Card; animate: boolean }) {
  const uid = useId();
  const list = card.compact ? WISPS.slice(0, 4) : WISPS;
  if (!animate) {
    // The parked frame: two billows mid-life, so a frozen Void Smoke still reads as smoke.
    return (
      <>
        {list.slice(0, 2).map((wp, i) => (
          <StillWisp key={i} id={`${uid}-s${i}`} colour={colour} card={card} spec={wp} />
        ))}
      </>
    );
  }
  return <LiveSmoke uid={uid} colour={colour} card={card} list={list} />;
}

function LiveSmoke({ uid, colour, card, list }: { uid: string; colour: string; card: Card; list: typeof WISPS }) {
  const clock = useCosmeticClock(SIGNATURE_CYCLE_MS.smoke, true);
  return (
    <>
      {list.map((wp, i) => (
        <Wisp key={i} id={`${uid}-w${i}`} clock={clock} colour={colour} card={card} spec={wp} />
      ))}
    </>
  );
}

function wispBox(spec: (typeof WISPS)[number], card: Card) {
  const size = 24 * card.k;
  return { size, left: spec.x * card.w - size / 2, top: spec.y * card.h - size / 2 };
}

function WispGlyph({ id, colour, size }: { id: string; colour: string; size: number }) {
  // Mock: `radial-gradient(#8a7aa6, #352b52 55%, transparent 80%)` under blur + screen — a pale,
  // greyed violet core going dark and then to nothing. Soft at every edge, never a disc.
  const core = tint(colour, 0.35);
  return (
    <Svg width={size} height={size} pointerEvents="none">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="46%" r="50%">
          <Stop offset="0" stopColor={core} stopOpacity={0.85} />
          <Stop offset="0.55" stopColor={colour} stopOpacity={0.4} />
          <Stop offset="1" stopColor={colour} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

function Wisp({ id, clock, colour, card, spec }: { id: string; clock: SharedValue<number>; colour: string; card: Card; spec: (typeof WISPS)[number] }) {
  const { size, left, top } = wispBox(spec, card);
  const phase = delayPhase(spec.delay, WISP_PERIOD);
  const dx = spec.dx * card.k * 2;
  const dy = spec.dy * card.k * 2;
  // Mock `billow`: scale .4 -> 2.3 while drifting outward, opacity 0 -> .75 at 30% -> 0, ease-in.
  const style = useAnimatedStyle(() => {
    const u = (clock.value * WISP_MULT + phase) % 1;
    const p = u * u;
    const o = u < 0.3 ? (u / 0.3) * 0.75 : 0.75 * (1 - (u - 0.3) / 0.7);
    return { opacity: o, transform: [{ translateX: dx * p }, { translateY: dy * p }, { scale: 0.4 + 1.9 * p }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top, width: size, height: size, opacity: 0 }, style]}>
      <WispGlyph id={id} colour={colour} size={size} />
    </Animated.View>
  );
}

function StillWisp({ id, colour, card, spec }: { id: string; colour: string; card: Card; spec: (typeof WISPS)[number] }) {
  const { size, left, top } = wispBox(spec, card);
  const p = 0.35;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left,
        top,
        width: size,
        height: size,
        opacity: 0.6,
        transform: [{ translateX: spec.dx * card.k * 2 * p }, { translateY: spec.dy * card.k * 2 * p }, { scale: 0.4 + 1.9 * p }],
      }}>
      <WispGlyph id={id} colour={colour} size={size} />
    </View>
  );
}

// ─────────────────────────── the marks, parked ───────────────────────────

/**
 * Reduced motion, an off-screen tab, `motion="still"`: mock 243's own note is "a static glowing
 * border" — so the ring, plus a representative frozen frame where an effect has one that still
 * reads when it is not moving. Lightning has none: a frozen bolt reads as a crack in the glass.
 */
function StillMarks({ effect, colour, card }: { effect: FlareEffect; colour: string; card: Card }) {
  const uid = useId();
  const base = Math.min(card.w, card.h);
  switch (effect) {
    case 'flames':
      return (
        <>
          <View style={[StyleSheet.absoluteFill, { opacity: 0.75 }]}>
            <Bands id={`heatS-${uid}`} w={card.w} h={card.h} depth={clamp(base * 0.12, 12, 24)} colour={colour} peak={0.6} />
          </View>
          <View style={[StyleSheet.absoluteFill, { opacity: 0.45 }]}>
            <Bands id={`heatD-${uid}`} w={card.w} h={card.h} depth={clamp(base * 0.3, 26, 56)} colour={colour} peak={0.5} />
          </View>
        </>
      );
    case 'plasma':
      return (
        <>
          {(card.compact ? ARCS.slice(0, 4) : ARCS).map((a, i) => {
            const { aw, ah, left, top } = arcBox(a, card);
            return (
              <View key={i} style={{ position: 'absolute', left, top, opacity: i % 2 === 0 ? 0.85 : 0.4 }}>
                <ArcGlyph colour={colour} aw={aw} ah={ah} index={i} />
              </View>
            );
          })}
        </>
      );
    case 'falling':
      return (
        <>
          {DRIPS.slice(0, 3).map((dr, i) => {
            const dw = 5 * card.k;
            const t = [0.3, 0.55, 0.15][i];
            return (
              <View
                key={i}
                style={{
                  position: 'absolute',
                  left: dripLeft(dr.x, card.w, dw) - dw * 0.5,
                  top: dr.top * card.k + t * t * card.h * 0.34,
                  opacity: 0.85,
                }}>
                <DripGlyph colour={colour} dw={dw} dh={11 * card.k} />
              </View>
            );
          })}
        </>
      );
    case 'emberfall':
      return (
        <>
          {EMBER_LANES.slice(0, 4).map((lane, i) => {
            const s = 5 * card.k;
            const t = [0.25, 0.55, 0.4, 0.7][i];
            return (
              <View
                key={i}
                style={{ position: 'absolute', left: clamp(lane.x * card.w - s, 0, card.w - s * 2), top: card.h - s - t * card.h * 0.7, opacity: 0.8 }}>
                <EmberGlyph colour={colour} s={s} />
              </View>
            );
          })}
        </>
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  wrap: {
    padding: PAD,
  },
  ring: {
    position: 'absolute',
  },
  clip: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    right: PAD,
    bottom: PAD,
    overflow: 'hidden',
  },
  free: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    right: PAD,
    bottom: PAD,
  },
});
