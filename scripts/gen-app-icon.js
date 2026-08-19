#!/usr/bin/env node
/**
 * Generates the APP ICON: the flame glyph on the deep plum gradient (punchlist 17 P4).
 *
 * Shares the notification icon's flame polygon and PNG encoder deliberately — one geometry for the
 * mark means the launcher icon can't drift from the in-app flame the way the tri-colour campfire
 * did. What differs is everything around it: this one is FULL COLOUR on an opaque gradient ground,
 * because a launcher icon is composited by the OS onto arbitrary wallpaper, where transparency
 * reads as a hole. The notification icon is the opposite — alpha only, because Android masks it.
 *
 * Run: node scripts/gen-app-icon.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// The flame outline as a closed polygon in a 24x24 space, matching mock 92's `#flameMark`
// silhouette. Deliberately a polygon and not the real bezier path: a notification icon renders at
// 24dp, where flattening curves to line segments is invisible, and it keeps this script free of a
// path parser (the source path uses relative curves AND an arc).
const FLAME = [
  [13.8, 2.0], [14.3, 4.2], [13.4, 5.9], [11.9, 7.4], [10.6, 8.7], [9.2, 10.2],
  [8.2, 11.8], [7.5, 13.6], [7.5, 15.2], [8.1, 17.0], [9.3, 18.4], [11.0, 19.3],
  [12.9, 19.6], [14.8, 19.3], [16.5, 18.4], [17.7, 17.0], [18.4, 15.2], [18.5, 13.9],
  [18.1, 12.4], [17.3, 10.9], [16.9, 12.1], [16.2, 13.0], [15.1, 13.5], [15.6, 12.2],
  [15.8, 10.8], [15.4, 9.4], [14.6, 8.2], [13.6, 7.2], [14.6, 5.9], [15.2, 4.6],
  [15.0, 3.2], [14.4, 2.4],
];

/** Even-odd point-in-polygon. Sampled 4x4 per pixel so the edge gets real antialiasing. */
// Inset to ~62% so the flame sits inside the launcher's safe area — Android masks app icons to
// circles/squircles and anything near the edge gets clipped.
const INSET = 0.19;
function coverage(px, py, size) {
  const s = 24 / (size * (1 - INSET * 2));
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const x = (px - size * INSET + (sx + 0.5) / 4) * s;
      const y = (py - size * INSET + (sy + 0.5) / 4) * s;
      let inside = false;
      for (let i = 0, j = FLAME.length - 1; i < FLAME.length; j = i++) {
        const [xi, yi] = FLAME[i];
        const [xj, yj] = FLAME[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) hits++;
    }
  }
  return hits / 16;
}

/** Colours: Colors.plum ground, ember ramp for the flame (deep base -> pale tip). */
const GROUND_TOP = [0x3a, 0x2e, 0x5c];   // Colors.plum
const GROUND_BOT = [0x1b, 0x13, 0x2a];
const FLAME_BOT = [0xe0, 0x61, 0x2c];
const FLAME_MID = [0xf2, 0xa3, 0x3c];
const FLAME_TIP = [0xff, 0xd2, 0x7a];
const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function png(size) {
  // RGBA, white everywhere, alpha = coverage. White because Android keeps only alpha — the colour
  // is irrelevant to the OS but white keeps the PNG readable in a previewer.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const cov = coverage(x, y, size);
      const vy = y / size;
      // Ground: vertical plum gradient, fully opaque — never transparent (see the note above).
      const ground = lerp(GROUND_TOP, GROUND_BOT, vy);
      // Flame: the ember ramp bottom-up, matching FlameSvg's gradient stops.
      const flame = vy > 0.55 ? lerp(FLAME_MID, FLAME_BOT, (vy - 0.55) / 0.45) : lerp(FLAME_TIP, FLAME_MID, vy / 0.55);
      const px = lerp(ground, flame, cov);
      raw[o++] = px[0]; raw[o++] = px[1]; raw[o++] = px[2];
      raw[o++] = 255;
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

// 1024 is what App Store Connect and Play both want; Expo downscales for every other density.
const out = path.join(__dirname, '..', 'assets', 'images', 'icon.png');
fs.writeFileSync(out, png(1024));
console.log('wrote', path.relative(path.join(__dirname, '..'), out), '(1024x1024, flame on plum)');
