// The equipped flame COLORWAY, resolved to the three-stop ramp the flame vectors already draw.
//
// PHILOI_UI_SPEC §4 HARD CONSTRAINT, restated because it's the whole reason this file is so small:
// a flame cosmetic recolours the ramp and NOTHING else. Never size, never intensity, never
// animation — those carry real activity, and a purchasable item that touched them would be selling
// effort, which Rule 0 forbids outright. So this module exports colours. There is deliberately no
// way for a flame item to reach any other property.

import { Colors } from '@/constants/theme';
import { useEquipped } from '@/lib/economy/loadout';

export type FlameRamp = { outer: string; mid: string; core: string };

/** The stock campfire ramp — what everyone sees with an empty flame slot. */
export const BASE_FLAME_RAMP: FlameRamp = {
  outer: Colors.coral,
  mid: Colors.amber,
  core: Colors.ember,
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/**
 * Catalog flame items carry a two-stop palette (`from` = outer body, `to` = inner core), because
 * that's all the small grid/tile art needs. The live flame is drawn in three layers, so the middle
 * stop is interpolated rather than added to the catalog — one source of truth for the colourway,
 * and a new flame item never has to know how many layers the renderer happens to use.
 */
export function rampFor(item: { art: { from: string; to: string } } | undefined): FlameRamp {
  if (!item) return BASE_FLAME_RAMP;
  return {
    outer: item.art.from,
    mid: mix(item.art.from, item.art.to, 0.55),
    core: item.art.to,
  };
}

/** Hook form — the live flame surfaces call this and get the base ramp when nothing is equipped. */
export function useFlameRamp(): FlameRamp {
  return rampFor(useEquipped('flame'));
}
