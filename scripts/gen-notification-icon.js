#!/usr/bin/env node
/**
 * Generates the Android notification small icon: a WHITE FLAME SILHOUETTE ON TRANSPARENT.
 *
 * Android masks small notification icons — it throws away colour and keeps only the alpha channel,
 * then tints the result. Feed it a full-colour logo and every opaque pixel becomes solid tint,
 * which is exactly the placeholder square in the punchlist-16 screenshots (the fallback was
 * applicationInfo.icon, the colour app icon). Only the SHAPE may carry information.
 *
 * Written as a generator rather than a checked-in binary so the silhouette can be re-tuned and
 * re-emitted, and so the geometry lives in readable source next to the flame it comes from.
 *
 * Run: node scripts/gen-notification-icon.js
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
function coverage(px, py, size) {
  const s = 24 / size;
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const x = (px + (sx + 0.5) / 4) * s;
      const y = (py + (sy + 0.5) / 4) * s;
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

function png(size) {
  // RGBA, white everywhere, alpha = coverage. White because Android keeps only alpha — the colour
  // is irrelevant to the OS but white keeps the PNG readable in a previewer.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw[o++] = 255; raw[o++] = 255; raw[o++] = 255;
      raw[o++] = Math.round(coverage(x, y, size) * 255);
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

// 96px = xxxhdpi for a 24dp icon. expo-notifications downscales for the other densities.
const out = path.join(__dirname, '..', 'assets', 'images', 'notification-icon.png');
fs.writeFileSync(out, png(96));
console.log('wrote', path.relative(path.join(__dirname, '..'), out), '(96x96 white-on-transparent)');
