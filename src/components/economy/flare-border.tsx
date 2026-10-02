import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';

import { flashCurve, useCosmeticClock } from '@/components/economy/cosmetic-clock';
import { SIGNATURE_CYCLE_MS } from '@/components/economy/flare-signature';
import { useMotionActive } from '@/hooks/use-motion-active';
import { tint } from '@/lib/economy/colour';
import type { FlareEffect } from '@/lib/economy/catalog';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE FLARE AS A CARD BORDER (mock 248 layer 1, mock 243/252 "ambient on profile").
//
// A flare used to exist in two places: the full-screen perimeter during a lock-in (FlarePerimeter)
// and a small aura behind an avatar on list rows (FlareAura). Neither is the profile — mock 248 puts
// the flare around the WHOLE hero card, an animated ember perimeter with the flare's own motion on
// it, so it reads as the frame your identity sits in rather than as a smudge behind your face.
//
// AMBIENT, NOT FULL. This is the at-rest version — the lock-in perimeter is the full-intensity one
// (mock 252's lifecycle). So: a breathing perimeter in the flare's colour, plus the effect's ONE
// most recognisable motion where it has one that fits a card edge — embers climbing for the fire
// family, ash drifting down for `falling`, the double strike flashing the rim for the lightning
// pair. Smoke, plasma and glow are carried by the breath and their colour alone.
//
// COST. One card on a screen, never a list (lists keep FlareAura). The breath and every ember read
// ONE shared clock per effect (cosmetic-clock) — the same cadence the avatar aura and the shop tile
// use, so a flare keeps one tempo wherever it is drawn. Nothing re-renders React per frame, and the
// static branch never subscribes to a clock at all.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type FlareIdentity = { colour: string; effect: FlareEffect };
export type FlareBorderMotion = 'full' | 'still';

/** Effects whose card-edge motion is embers. `rise` climbs from the floor, `fall` drops from the top. */
const EMBERS: Partial<Record<FlareEffect, 'rise' | 'fall'>> = {
  flames: 'rise',
  emberfall: 'rise',
  falling: 'fall',
};

/** The lightning pair flash the rim on the shared double-strike curve instead of breathing. */
const STRIKES: ReadonlySet<FlareEffect> = new Set<FlareEffect>(['zaps', 'hammer']);

/** Where each ember climbs, as a fraction of the card's width, and its offset into the loop. A
 *  deterministic scatter (mock 248's five `.ascend i`) so a re-render never reshuffles them. */
const EMBER_LANES = [
  { x: 0.07, phase: 0 },
  { x: 0.24, phase: 0.4 },
  { x: 0.7, phase: 0.2 },
  { x: 0.93, phase: 0.6 },
  { x: 0.88, phase: 0.77 },
] as const;

/** `#RRGGBB` + alpha → rgba(). The flare colour is always a six-digit hex in the catalog. */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  if (!Number.isFinite(n)) return `rgba(255,138,44,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Wraps `children` (the hero card) in the equipped flare's perimeter. With no flare it is a plain
 * `padding` box, so the card sits in exactly the same place whether or not one is equipped — an
 * equip in the loadout never shifts the layout under your thumb.
 */
export function FlareBorder({
  flare,
  radius,
  motion = 'full',
  style,
  children,
}: {
  flare: FlareIdentity | null | undefined;
  /** The wrapped card's corner radius. The border hugs it at `radius + PAD`. */
  radius: number;
  motion?: FlareBorderMotion;
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
  const embers = EMBERS[flare.effect];

  return (
    <View style={[styles.wrap, { borderRadius: outer }, style]} onLayout={embers ? onLayout : undefined}>
      {animate ? (
        <LiveRim flare={flare} outer={outer} />
      ) : (
        <Rim colour={flare.colour} outer={outer} />
      )}
      {children}
      {/* IN FRONT of the card, clipped to its edge — mock 248's own note: behind it, the card's
          texture paints over every one of them. */}
      {embers && box.w > 0 ? (
        <View style={[styles.emberClip, { borderRadius: radius }]} pointerEvents="none">
          {animate ? (
            <LiveEmbers colour={flare.colour} effect={flare.effect} dir={embers} w={box.w - PAD * 2} h={box.h - PAD * 2} />
          ) : (
            <StillEmbers colour={flare.colour} dir={embers} w={box.w - PAD * 2} h={box.h - PAD * 2} />
          )}
        </View>
      ) : null}
    </View>
  );
}

/** Mock 248's `.hero{padding:3px}` — the gap the perimeter glows in. */
const PAD = 3;

/**
 * The perimeter itself: a crisp 1.5pt line in the flare's colour and two wider, fainter rings just
 * outside it, which together read as the mock's `0 0 0 1.5px, 0 0 20px` box-shadow without depending
 * on a shadow API that renders differently per platform.
 */
function Rim({ colour, outer }: { colour: string; outer: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.ring, { top: -5, left: -5, right: -5, bottom: -5, borderRadius: outer + 5, borderWidth: 3, borderColor: alpha(colour, 0.12) }]} />
      <View style={[styles.ring, { top: -2, left: -2, right: -2, bottom: -2, borderRadius: outer + 2, borderWidth: 2.5, borderColor: alpha(colour, 0.32) }]} />
      <View style={[styles.ring, { top: 0, left: 0, right: 0, bottom: 0, borderRadius: outer, borderWidth: 1.5, borderColor: colour }]} />
      {/* The inner bleed — the glow falling onto the card's own edge (mock 250's inset shadow). */}
      <View style={[styles.ring, { top: 1.5, left: 1.5, right: 1.5, bottom: 1.5, borderRadius: outer - 1.5, borderWidth: 2, borderColor: alpha(tint(colour, 0.25), 0.28) }]} />
    </View>
  );
}

function LiveRim({ flare, outer }: { flare: FlareIdentity; outer: number }) {
  const clock = useCosmeticClock(SIGNATURE_CYCLE_MS[flare.effect], true);
  const strikes = STRIKES.has(flare.effect);

  const breath = useAnimatedStyle(() => {
    // Two breaths per cycle, sine-eased — FlareAura's tempo, so the avatar aura on a leaderboard row
    // and this border on the profile pulse together.
    const b = 0.5 - 0.5 * Math.cos(clock.value * Math.PI * 4);
    return { opacity: strikes ? 0.55 + 0.15 * b : 0.62 + 0.38 * b };
  });
  // The lightning pair's rim flash: two strikes per cycle off the shared curve, so a Zeus border
  // cracks bright and falls back rather than breathing like a candle.
  const flash = useAnimatedStyle(() => ({ opacity: strikes ? flashCurve((clock.value * 2) % 1) : 0 }));

  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, breath]} pointerEvents="none">
        <Rim colour={flare.colour} outer={outer} />
      </Animated.View>
      {strikes ? (
        <Animated.View style={[StyleSheet.absoluteFill, flash]} pointerEvents="none">
          <Rim colour={tint(flare.colour, 0.55)} outer={outer} />
        </Animated.View>
      ) : null}
    </>
  );
}

function LiveEmbers({
  colour,
  effect,
  dir,
  w,
  h,
}: {
  colour: string;
  effect: FlareEffect;
  dir: 'rise' | 'fall';
  w: number;
  h: number;
}) {
  const clock = useCosmeticClock(SIGNATURE_CYCLE_MS[effect], true);
  return (
    <>
      {EMBER_LANES.map((lane, i) => (
        <Ember key={i} clock={clock} colour={colour} dir={dir} x={lane.x * w} phase={lane.phase} travel={h * 0.85} h={h} />
      ))}
    </>
  );
}

function Ember({
  clock,
  colour,
  dir,
  x,
  phase,
  travel,
  h,
}: {
  clock: SharedValue<number>;
  colour: string;
  dir: 'rise' | 'fall';
  x: number;
  phase: number;
  travel: number;
  h: number;
}) {
  const style = useAnimatedStyle(() => {
    // Three loops per cycle — a whole number, so the clock's snap back to 0 is invisible.
    const t = (clock.value * 3 + phase) % 1;
    // Fade in over the first 15% and out toward the end — mock 248's `climb` keyframes.
    const o = t < 0.15 ? (t / 0.15) * 0.9 : 0.9 * (1 - (t - 0.15) / 0.85);
    const y = dir === 'rise' ? h - t * travel : -10 + t * travel;
    return { opacity: o, transform: [{ translateX: x - EMBER_W / 2 }, { translateY: y }] };
  });
  return <Animated.View style={[styles.ember, emberLook(colour), style]} />;
}

/** The parked frame: three embers held part-way up, so a frozen fire border still reads as fire. */
function StillEmbers({ colour, dir, w, h }: { colour: string; dir: 'rise' | 'fall'; w: number; h: number }) {
  return (
    <>
      {EMBER_LANES.slice(0, 3).map((lane, i) => {
        const t = 0.3 + lane.phase * 0.5;
        const y = dir === 'rise' ? h - t * h * 0.85 : -10 + t * h * 0.85;
        return (
          <View
            key={i}
            style={[styles.ember, emberLook(colour), { opacity: 0.7, transform: [{ translateX: lane.x * w - EMBER_W / 2 }, { translateY: y }] }]}
          />
        );
      })}
    </>
  );
}

const EMBER_W = 5;

function emberLook(colour: string): ViewStyle {
  // A hot core on the flare's own hue, glowing outward — not a fixed orange, so an Emberfall border
  // and a violet one each throw their own sparks.
  return {
    backgroundColor: tint(colour, 0.45),
    shadowColor: colour,
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  };
}

const styles = StyleSheet.create({
  wrap: {
    padding: PAD,
  },
  ring: {
    position: 'absolute',
  },
  emberClip: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    right: PAD,
    bottom: PAD,
    overflow: 'hidden',
  },
  ember: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: EMBER_W,
    height: 7,
    // Mock 248's teardrop: rounder at the top than the bottom.
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    borderBottomLeftRadius: 2.5,
    borderBottomRightRadius: 2.5,
  },
});
