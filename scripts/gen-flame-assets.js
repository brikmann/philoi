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

const { readFlameSource, flatten, rasterize, encodePng, lerp } = require('./lib/flame-raster');

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
  {
    file: 'flame.png',
    // NOT assets/images — this one is bundled into the Focus Nudge shield extension's own asset
    // catalogue, because an icon read out of the App Group container can be missing and a
    // half-drawn shield over someone's Instagram is worse than a plain one.
    dir: path.join('targets', 'shield-configuration'),
    // 300px ≈ 3x for the ~100pt icon a ShieldConfiguration draws. The notification silhouette
    // above is 96px and was visibly soft at that size.
    size: 300,
    heightFrac: 0.82,
    // White, like the notification icon, and for the same reason: the extension tints it at
    // runtime — ember on the reinforce card, cool blue when the tone turns to care (mock 116) —
    // and withTintColor only has a shape to work with if the source carries no colour of its own.
    note: 'white silhouette on transparent (Focus Nudge shield)',
    pixel: (cov) => [255, 255, 255, Math.round(cov * 255)],
  },
];

const flame = readFlameSource();
const outDir = path.join(__dirname, '..', 'assets', 'images');
const root = path.join(__dirname, '..');

for (const { file, dir, size, heightFrac, note, pixel } of TARGETS) {
  const cov = rasterize({ ...flame, size, heightFrac });
  const png = encodePng(size, (x, y) => pixel(cov[y * size + x], y / size));
  // Everything lands in assets/images except the shield's flame, which has to sit inside its own
  // extension target's directory for @bacons/apple-targets to fold it into that target's catalogue.
  const out = dir ? path.join(root, dir, file) : path.join(outDir, file);
  fs.writeFileSync(out, png);
  console.log(`wrote ${path.relative(root, out)} (${size}x${size}, ${note})`);
}


// ── the Android overlay's flame ──────────────────────────────────────────────
/**
 * The Focus Nudge overlay (Android) draws the flame as a real Path, not a raster.
 *
 * WHY NOT A PNG, like the iOS shield's flame.png above: the overlay's Gradle module carries NO
 * dependencies and NO resource merging on purpose (see modules/philoi-focus-nudge/android/
 * build.gradle — an accessibility service that PLAY_ACCESSIBILITY_DECLARATION.md swears never
 * talks to the network is easiest to keep honest when nothing can be linked into it). A drawable
 * resource would be the first thing to breach that, and a bitmap could only be tinted flat where
 * mock 182 wants the ember ramp running up the glyph.
 *
 * WHY GENERATED rather than a Path hand-written in Kotlin: that is precisely the second hand-copy
 * of the flame this script exists to abolish (see the header). The geometry below comes from the
 * same FLAME_PATH, through the same mirror, as every raster above — so the overlay cannot drift
 * into showing a different flame from the app, and cannot silently unflip it.
 */
const DECIMATE_EPS = 0.0006; // of the glyph's own height — ~0.3px on a 480px-tall flame

/** Ramer–Douglas–Peucker. 322 flattened curve points is far more than a ~150dp glyph can show. */
function decimate(points, eps) {
  if (points.length < 3) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let best = -1;
    let bestAt = -1;
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = points[i];
      const dist =
        len === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (dist > best) {
        best = dist;
        bestAt = i;
      }
    }
    if (best > eps) {
      keep[bestAt] = true;
      stack.push([a, bestAt], [bestAt, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

{
  const { d, viewBox } = flame;
  const rings = flatten(d);
  if (rings.length !== 1) {
    // Two rings would mean the glyph grew a hole, and the single-Path emitter below would fill it
    // in. Better to stop than to ship a flame with its tongue-lick notch quietly closed up.
    throw new Error(`expected FLAME_PATH to flatten to 1 ring, got ${rings.length}`);
  }

  // THE flip (CINDY_SPEC rendering rule 1), x -> viewBox - x. Same line as rasterize()'s, and the
  // only place it happens on this side — nothing downstream in Kotlin may mirror again.
  let ring = rings[0].map(([x, y]) => [viewBox - x, y]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) ring = ring.slice(0, -1);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // Normalised to the INK box, not the viewBox — FLAME_PATH runs x 6..18, y 2..18.5 inside its
  // 24x24, and the same off-centre bug the rasters had would put the overlay's flame right of the
  // rays it is supposed to sit inside.
  const w = maxX - minX;
  const h = maxY - minY;
  const norm = ring.map(([x, y]) => [(x - minX) / w, (y - minY) / h]);
  const closed = decimate(norm.concat([norm[0]]), DECIMATE_EPS);

  const nums = [];
  for (const [x, y] of closed) nums.push(`${x.toFixed(5)}f, ${y.toFixed(5)}f`);
  const rows = [];
  for (let i = 0; i < nums.length; i += 4) rows.push(`    ${nums.slice(i, i + 4).join(', ')},`);

  const kotlin = `package expo.modules.philoifocusnudge

import android.graphics.Path

// ══════════════════════════════════════════════════════════════════════════════════════════════
// GENERATED FILE — DO NOT EDIT BY HAND.
//
//   node scripts/gen-flame-assets.js
//
// The Cindy flame, as geometry, for the Focus Nudge overlay (FocusNudgeShieldView). Written from
// the ONE glyph in src/components/ui/flame-logo.tsx, already mirrored by
// FLAME_MIRROR_TRANSFORM (CINDY_SPEC rendering rule 1) — so do NOT flip it again here or at the
// call site. Two flips cancel and the overlay silently renders the retired orientation.
//
// Points are the outline decimated to ${DECIMATE_EPS} of the glyph's height and normalised to its
// INK bounding box: x and y both run 0..1, with ASPECT carrying the real width:height so the
// caller can size it without stretching.
// ══════════════════════════════════════════════════════════════════════════════════════════════

internal object FocusNudgeFlame {

  /** width / height of the inked glyph. */
  const val ASPECT = ${(w / h).toFixed(6)}f

  /** Closed outline, x,y interleaved, both normalised 0..1 over the ink box. */
  private val POINTS = floatArrayOf(
${rows.join('\n')}
  )

  /** The flame as a Path filling [width] x [height], offset to ([left], [top]). */
  fun path(left: Float, top: Float, width: Float, height: Float): Path {
    val path = Path()
    var i = 0
    while (i < POINTS.size) {
      val x = left + POINTS[i] * width
      val y = top + POINTS[i + 1] * height
      if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
      i += 2
    }
    path.close()
    return path
  }
}
`;

  const kotlinOut = path.join(
    root, 'modules', 'philoi-focus-nudge', 'android', 'src', 'main', 'java',
    'expo', 'modules', 'philoifocusnudge', 'FocusNudgeFlame.kt',
  );
  fs.writeFileSync(kotlinOut, kotlin);
  console.log(
    `wrote ${path.relative(root, kotlinOut)} (${closed.length} points, aspect ${(w / h).toFixed(4)})`,
  );
}

console.log('\nNative assets — only visible after the next `eas build` (delete + reinstall to');
console.log('clear the launcher icon cache).');
