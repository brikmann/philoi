// Hex colour arithmetic for the cosmetic renderers. Every applied cosmetic draws from its catalog
// item's two stops (`art.from` / `art.to`); these derive the hot cores, shaded bases and in-between
// sweeps from those stops, so a recoloured item stays on its own hue instead of picking up a fixed
// white or grey.

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [136, 136, 136];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;
}

/** Toward black — the base of a ramp, which is what gives a shape its underside. */
export function shade(colour: string, amount: number): string {
  const [r, g, b] = channels(colour);
  return toHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

/** Toward white — hot cores and specular edges, kept on the item's own hue rather than flat #fff. */
export function tint(colour: string, amount: number): string {
  const [r, g, b] = channels(colour);
  return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

/** Linear mix, `t` = 0 is `a`, 1 is `b`. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = channels(a);
  const [r2, g2, b2] = channels(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
