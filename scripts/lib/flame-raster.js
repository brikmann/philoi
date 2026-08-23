/**
 * Rasterizes the brand flame — THE flipped FLAME_PATH from src/components/ui/flame-logo.tsx — to
 * an RGBA buffer, plus a minimal PNG encoder.
 *
 * Why a real path rasterizer and not the flattened polygon the two icon generators used to carry:
 * the polygon was faceted enough to see at 1024px (the launcher icon had visible straight edges
 * where the in-app SVG has curves), and worse, it was a SECOND copy of the geometry that had to be
 * flipped by hand alongside the path. Everything here reads the one path string, so the mark on
 * the launcher, the splash and the notification shade cannot drift from the mark in the app.
 *
 * Zero dependencies on purpose (zlib is built in) — `node scripts/gen-flame-assets.js` must work on
 * a clean checkout with no install step.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── the glyph ────────────────────────────────────────────────────────────────
// Parsed out of the TS source rather than duplicated, so this file cannot fall out of sync with
// the component. If flame-logo stops exporting a single-quoted FLAME_PATH this throws loudly
// instead of silently rendering a stale mark.
function readFlameSource() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'components', 'ui', 'flame-logo.tsx'),
    'utf8',
  );
  const d = src.match(/export const FLAME_PATH\s*=\s*\n?\s*'([^']+)'/);
  if (!d) throw new Error('FLAME_PATH not found in src/components/ui/flame-logo.tsx');
  const vb = src.match(/export const FLAME_VIEWBOX\s*=\s*(\d+(?:\.\d+)?)/);
  if (!vb) throw new Error('FLAME_VIEWBOX not found in src/components/ui/flame-logo.tsx');
  return { d: d[1], viewBox: Number(vb[1]) };
}

// ── path -> polygon ──────────────────────────────────────────────────────────
/**
 * Flattens an SVG path to a list of closed polylines. Supports exactly what FLAME_PATH uses —
 * M/m, C/c, S/s, A/a, L/l, H/h, V/v, Z/z — at a fixed 64 segments per curve, which at 1024px is
 * well under a pixel of chord error.
 */
const CURVE_STEPS = 64;

function flatten(d) {
  const tokens = d.match(/[MmLlHhVvCcSsAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const rings = [];
  let ring = null;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastCtrlX = null, lastCtrlY = null;
  let i = 0, cmd = null;
  const num = () => Number(tokens[i++]);
  const push = (x, y) => { ring.push([x, y]); cx = x; cy = y; };
  const open = (x, y) => { ring = [[x, y]]; rings.push(ring); sx = cx = x; sy = cy = y; };

  const cubic = (x1, y1, x2, y2, x, y) => {
    const x0 = cx, y0 = cy;
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS, u = 1 - t;
      ring.push([
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
      ]);
    }
    lastCtrlX = x2; lastCtrlY = y2;
    cx = x; cy = y;
  };

  // Endpoint-parameterised arc -> centre parameterisation (SVG spec F.6.5), then sampled directly.
  const arc = (rx, ry, rot, largeArc, sweep, x, y) => {
    const x0 = cx, y0 = cy;
    if (rx === 0 || ry === 0) return push(x, y);
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (rot * Math.PI) / 180, cosP = Math.cos(phi), sinP = Math.sin(phi);
    const dx2 = (x0 - x) / 2, dy2 = (y0 - y) / 2;
    const x1 = cosP * dx2 + sinP * dy2, y1 = -sinP * dx2 + cosP * dy2;
    // Scale the radii up if they are too small to span the chord (spec F.6.6).
    const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lambda > 1) { const k = Math.sqrt(lambda); rx *= k; ry *= k; }
    const sign = largeArc === sweep ? -1 : 1;
    const numer = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const denom = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    const co = sign * Math.sqrt(Math.max(0, numer / denom));
    const cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx;
    const ccx = cosP * cx1 - sinP * cy1 + (x0 + x) / 2;
    const ccy = sinP * cx1 + cosP * cy1 + (y0 + y) / 2;
    const ang = (ux, uy, vx, vy) => {
      const dot = ux * vx + uy * vy;
      const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      const a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
      return ux * vy - uy * vx < 0 ? -a : a;
    };
    const theta = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let delta = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    if (sweep && delta < 0) delta += 2 * Math.PI;
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = theta + (delta * s) / CURVE_STEPS;
      const px = rx * Math.cos(t), py = ry * Math.sin(t);
      ring.push([cosP * px - sinP * py + ccx, sinP * px + cosP * py + ccy]);
    }
    lastCtrlX = null; lastCtrlY = null;
    cx = x; cy = y;
  };

  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        const x = num() + ox, y = num() + oy;
        open(x, y);
        cmd = rel ? 'l' : 'L'; // subsequent pairs after an M are an implicit lineto
        break;
      }
      case 'L': push(num() + ox, num() + oy); lastCtrlX = null; break;
      case 'H': push(num() + ox, cy); lastCtrlX = null; break;
      case 'V': push(cx, num() + oy); lastCtrlX = null; break;
      case 'C': cubic(num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy); break;
      case 'S': {
        // Reflect the previous cubic's second control point through the current point.
        const rx = lastCtrlX === null ? cx : 2 * cx - lastCtrlX;
        const ry = lastCtrlY === null ? cy : 2 * cy - lastCtrlY;
        cubic(rx, ry, num() + ox, num() + oy, num() + ox, num() + oy);
        break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num();
        // Arc flags are single digits and may be packed against the next number ("0013 0"), which
        // the tokenizer hands back glued together. Peel them off one character at a time.
        const t = tokens[i];
        let large, sweep;
        if (t.length > 1) {
          large = Number(t[0]); sweep = Number(t[1]);
          tokens[i] = t.slice(2);
          if (tokens[i] === '' || tokens[i] === '.') tokens.splice(i, 1);
        } else { large = num(); sweep = num(); }
        arc(rx, ry, rot, large, sweep, num() + ox, num() + oy);
        break;
      }
      case 'Z': ring.push([sx, sy]); cx = sx; cy = sy; lastCtrlX = null; break;
      default: throw new Error(`unsupported path command: ${cmd}`);
    }
  }
  return rings;
}

// ── coverage ─────────────────────────────────────────────────────────────────
/**
 * Antialiased fill: non-zero winding, 4 scanlines per pixel row with EXACT horizontal span
 * coverage. Returns a Float64Array of per-pixel coverage in [0,1].
 *
 * `mirror` is THE flip (CINDY_SPEC rendering rule 1) — x -> viewBox - x, the raster twin of
 * FLAME_MIRROR_TRANSFORM. Applied to the geometry once, here, for the same reason the components
 * apply it once in flame-logo: so no downstream step can double it.
 *
 * `heightFrac` is how much of the canvas height the INKED glyph should occupy; the mark is then
 * centred on its own bounding box. Fitting the ink rather than the viewBox matters because
 * FLAME_PATH does not fill its 24x24 box (it runs x 7.5..20.5, y 2..21) — mapping the box straight
 * onto the canvas, which is what the old generators did, left every icon sitting visibly right of
 * centre. Omit it to map the viewBox 1:1 and only centre.
 */
const SUBSCANS = 4;

function rasterize({ d, viewBox, size, heightFrac = null, mirror = true }) {
  const rings = flatten(d).map((r) => r.map(([x, y]) => [mirror ? viewBox - x : x, y]));

  let minX = Infinity, minGY = Infinity, maxX = -Infinity, maxGY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minGY) minGY = y;
      if (y > maxGY) maxGY = y;
    }
  }
  const scale = heightFrac === null ? size / viewBox : (size * heightFrac) / (maxGY - minGY);
  // Centre the ink, not the box.
  const offX = size / 2 - ((minX + maxX) / 2) * scale;
  const offY = size / 2 - ((minGY + maxGY) / 2) * scale;
  const cov = new Float64Array(size * size);

  // Edge list in DEVICE space, so the inner loop is pure arithmetic.
  const edges = [];
  let minY = Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (let k = 0; k < ring.length - 1; k++) {
      const [ax, ay] = ring[k], [bx, by] = ring[k + 1];
      const y0 = ay * scale + offY, y1 = by * scale + offY;
      if (y0 === y1) continue;
      edges.push({ x0: ax * scale + offX, y0, x1: bx * scale + offX, y1 });
      minY = Math.min(minY, y0, y1);
      maxY = Math.max(maxY, y0, y1);
    }
  }

  const yStart = Math.max(0, Math.floor(minY)), yEnd = Math.min(size - 1, Math.ceil(maxY));
  const xs = [];
  for (let py = yStart; py <= yEnd; py++) {
    for (let sy = 0; sy < SUBSCANS; sy++) {
      const y = py + (sy + 0.5) / SUBSCANS;
      xs.length = 0;
      for (const e of edges) {
        if (e.y0 > y === e.y1 > y) continue;
        xs.push({ x: e.x0 + ((y - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0), w: e.y1 > e.y0 ? 1 : -1 });
      }
      if (!xs.length) continue;
      xs.sort((a, b) => a.x - b.x);
      // Non-zero winding: a span is inside wherever the running winding number is not 0.
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k].w;
        if (wind === 0) continue;
        const spanA = xs[k].x, spanB = xs[k + 1].x;
        const pxA = Math.max(0, Math.floor(spanA)), pxB = Math.min(size - 1, Math.ceil(spanB));
        for (let px = pxA; px <= pxB; px++) {
          const c = Math.min(px + 1, spanB) - Math.max(px, spanA);
          if (c > 0) cov[py * size + px] += c / SUBSCANS;
        }
      }
    }
  }
  for (let k = 0; k < cov.length; k++) cov[k] = Math.min(1, cov[k]);
  return cov;
}

// ── PNG ──────────────────────────────────────────────────────────────────────
let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** 8-bit RGBA, no interlacing, filter 0 on every row. `pixel(x, y)` returns [r, g, b, a]. */
function encodePng(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const p = pixel(x, y);
      raw[o++] = p[0]; raw[o++] = p[1]; raw[o++] = p[2]; raw[o++] = p[3];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

module.exports = { readFlameSource, flatten, rasterize, encodePng, lerp };
