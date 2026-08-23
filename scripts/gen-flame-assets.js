#!/usr/bin/env node
/**
 * Regenerates EVERY native raster of the brand flame from the one glyph in
 * `src/components/ui/flame-logo.tsx` — already mirrored, per CINDY_SPEC rendering rule 1.
 *
 *   node scripts/gen-flame-assets.js
 *
 * Replaces gen-app-icon.js + gen-notification-icon.js, which each carried their OWN hand-flattened
 * copy of the flame as a 32-point polygon. Two copies meant two things to keep in sync (and the
 * facets showed at 1024px); one script reading the real path means the launcher icon, the adaptive
 * icon, the splash, the notification silhouette and the web favicon cannot drift from each other or
 * from the flame the app renders.
 *
 * Sizes below are the EXISTING dimensions of each file and the existing on-canvas scale of each
 * mark — this run changes orientation and edge quality, not layout. The one thing it does fix is
 * centring: FLAME_PATH does not fill its 24x24 viewBox, so mapping the box onto the canvas (what
 * the old scripts did) parked the mark right of centre.
 *
 * These are NATIVE assets. They ship in a build, never over the air — a new `eas build` is required
 * before any of them is visible on a device.
 */
const fs = require('fs');
const path = require('path');

const { readFlameSource, rasterize, encodePng, lerp } = require('./lib/flame-raster');

// Colors.plum and the ember ramp, matching FlameSvg's gradient stops so the icon and the in-app
// flame are the same object lit the same way.
const GROUND_TOP = [0x3a, 0x2e, 0x5c];
const GROUND_BOT = [0x1b, 0x13, 0x2a];
const FLAME_BOT = [0xe0, 0x61, 0x2c];
const FLAME_MID = [0xf2, 0xa3, 0x3c];
const FLAME_TIP = [0xff, 0xd2, 0x7a];

/** The ember ramp sampled bottom-up across the WHOLE canvas, exactly as the SVG gradient runs. */
function ramp(vy) {
  return vy > 0.55
    ? lerp(FLAME_MID, FLAME_BOT, (vy - 0.55) / 0.45)
    : lerp(FLAME_TIP, FLAME_MID, vy / 0.55);
}

const TARGETS = [
  {
    file: 'icon.png',
    size: 1024,
    // App Store Connect and Play both want 1024; Expo downscales for every other density.
    // Opaque ground on purpose — the OS composites a launcher icon over arbitrary wallpaper, and
    // transparency there reads as a hole.
    heightFrac: 0.47,
    note: 'flame on the plum gradient',
    pixel: (cov, vy) => [...lerp(lerp(GROUND_TOP, GROUND_BOT, vy), ramp(vy), cov), 255],
  },
  {
    file: 'favicon.png',
    size: 256,
    // Expo web (app.config.ts `web.favicon`). Same composition as the app icon so a browser tab
    // and a home screen show the same thing. It was still the RETIRED campfire before this run.
    heightFrac: 0.47,
    note: 'flame on the plum gradient',
    pixel: (cov, vy) => [...lerp(lerp(GROUND_TOP, GROUND_BOT, vy), ramp(vy), cov), 255],
  },
  {
    file: 'android-icon-foreground.png',
    size: 1024,
    // Adaptive icon foreground: transparent, and small enough that Android's circle/squircle mask
    // never bites into it. The background layer is a separate committed asset and is unchanged.
    heightFrac: 0.371,
    note: 'flame on transparent (adaptive foreground)',
    pixel: (cov, vy) => [...ramp(vy), Math.round(cov * 255)],
  },
  {
    file: 'android-icon-monochrome.png',
    size: 1024,
    // Themed icons (Android 13+): the system keeps the alpha and tints it, so only the SHAPE may
    // carry information. Same silhouette and same scale as the foreground.
    heightFrac: 0.371,
    note: 'white silhouette on transparent (themed icon)',
    pixel: (cov) => [255, 255, 255, Math.round(cov * 255)],
  },
  {
    file: 'splash-icon.png',
    size: 512,
    // expo-splash-screen draws this at imageWidth 180 over Colors.plum (app.config.ts).
    heightFrac: 0.484,
    note: 'flame on transparent (launch screen)',
    pixel: (cov, vy) => [...ramp(vy), Math.round(cov * 255)],
  },
  {
    file: 'notification-icon.png',
    size: 96,
    // 96px = xxxhdpi for a 24dp icon; expo-notifications downscales for the other densities. This
    // is also what the Live Activity module's smallIcon() looks up. Android throws away the colour
    // and tints the alpha, so a full-colour logo here renders as a solid square.
    heightFrac: 0.79,
    note: 'white silhouette on transparent (notification + Live Activity)',
    pixel: (cov) => [255, 255, 255, Math.round(cov * 255)],
  },
];

const flame = readFlameSource();
const outDir = path.join(__dirname, '..', 'assets', 'images');
const root = path.join(__dirname, '..');

for (const { file, size, heightFrac, note, pixel } of TARGETS) {
  const cov = rasterize({ ...flame, size, heightFrac });
  const png = encodePng(size, (x, y) => pixel(cov[y * size + x], y / size));
  const out = path.join(outDir, file);
  fs.writeFileSync(out, png);
  console.log(`wrote ${path.relative(root, out)} (${size}x${size}, ${note})`);
}

console.log('\nNative assets — only visible after the next `eas build` (delete + reinstall to');
console.log('clear the launcher icon cache).');
