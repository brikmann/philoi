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

/**
 * Hook form — every live flame surface calls this, and gets the base ramp when nothing is equipped.
 *
 * 🔴 AN EQUIPPED FLARE OVERRIDES THE FLAME'S COLOURWAY, everywhere.
 *
 * This was first done as a `tint` prop on the lock-in screen's flame, which fixed that one screen
 * and left home, Cindy, the done screen and the share cards on the old colour — so the same flame
 * was two different colours depending which screen you were on. The rule belongs here, at the one
 * place that answers "what colour is my flame", rather than being threaded through thirteen call
 * sites and forgotten at the fourteenth.
 *
 * The product trade, stated plainly: while a flare is equipped you do not see your FLAME slot's
 * colourway on any live surface. That is intentional — a hellfire perimeter around a pale blue
 * flame reads as two unrelated cosmetics rather than one fire, and the lock-in screen already
 * dimmed the flame for an equipped flare, so the flare already influenced it. This extends that
 * from brightness to hue.
 *
 * What it does NOT touch: inventory and shop tiles, which draw from `item.art` through item-art.tsx
 * and never call this. So the flame you own still shows its true colours in the place you go to
 * look at it — the override is on the live surfaces only.
 *
 * Deep body, ember core, matching what the Ascendant's flame risers render, so the big flame and
 * the embers rising off it are visibly the same fire.
 */
export function useFlameRamp(): FlameRamp {
  const flareColour = useEquipped('flare')?.flare?.colour;
  const flame = useEquipped('flame');
  if (flareColour) return rampFor({ art: { from: flareColour, to: Colors.ember } });
  return rampFor(flame);
}
