// Exports the print files from banner.html with a headless Chrome/Edge that is
// already on the machine — the same zero-dependency approach as
// brand/build-banners.mjs and site/_assets/build-assets.mjs.
//
//   node outreach-assets/gym-banner/build.mjs
//
// Two outputs, for two different jobs:
//
//   PHILOI_gym_banner_print.pdf  — what the printer gets. Chrome's print path
//     keeps text as text and gradients as gradients, so the 96 mm headline is
//     resolution-independent and the QR is drawn from path data rather than
//     from pixels. The page is 856 x 2006 mm: 850 x 2000 trim plus 3 mm bleed
//     on every edge, set by @page in banner.html.
//
//   PHILOI_gym_banner_print.png — a proof to email and to eyeball. Rendered at
//     150 DPI at full size, which is the floor the brief sets for raster. It is
//     a real render at that size, never an upscale of a smaller one.
//
// The 150 DPI number: 1 CSS px is 1/96 in, so the artboard is 856 mm =
// 3234.14 px wide at scale 1 — that IS 96 DPI. Multiply by 150/96 = 1.5625 and
// Chrome renders the same layout at 5053 x 11842 device pixels. Chrome's
// screenshot surface tops out around 16384 px, so there is headroom, but not a
// lot: going much past 200 DPI here will start returning a truncated image
// rather than an error, so check the dimensions the script prints.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('No Chrome/Edge found. Install one, or add its path to CANDIDATES.');
  process.exit(1);
}

const ARTBOARD_MM = { w: 856, h: 2006 };
const PX_PER_MM = 96 / 25.4; // 1 CSS px = 1/96 in
const DPI = 150;

const cssW = ARTBOARD_MM.w * PX_PER_MM;
const cssH = ARTBOARD_MM.h * PX_PER_MM;
const scale = DPI / 96;

const src = pathToFileURL(join(here, 'banner.html')).href;

function run(args, label) {
  const profile = mkdtempSync(join(tmpdir(), 'philoi-banner-'));
  try {
    execFileSync(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        `--user-data-dir=${profile}`,
        // The artboard has no network dependencies at all — fonts, QR and badge
        // are inlined — but the budget also covers layout/paint settling.
        '--virtual-time-budget=8000',
        ...args,
        src,
      ],
      { stdio: 'ignore', timeout: 300_000 }
    );
  } finally {
    // brand/build-banners.mjs hit this too: on Windows Chrome can still hold
    // the profile dir the instant after exit, and an unhandled EPERM would
    // abort the build AFTER the file had been written correctly.
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* %TEMP% gets reaped by the OS */
    }
  }
  const out = args.find((a) => a.startsWith('--print-to-pdf=') || a.startsWith('--screenshot='))?.split('=').slice(1).join('=');
  if (!out || !existsSync(out)) throw new Error(`${label} produced no file`);
  console.log(`  ${label.padEnd(4)} ${out.split(/[\\/]/).pop()}  ${(statSync(out).size / 1e6).toFixed(2)} MB`);
}

const pdf = join(here, 'PHILOI_gym_banner_print.pdf');
const png = join(here, 'PHILOI_gym_banner_print.png');

console.log(`artboard  ${ARTBOARD_MM.w} x ${ARTBOARD_MM.h} mm  (trim 850 x 2000 + 3 mm bleed)`);
run(['--no-pdf-header-footer', `--print-to-pdf=${pdf}`], 'pdf');
console.log(`png       ${DPI} DPI -> ${Math.round(cssW * scale)} x ${Math.round(cssH * scale)} px`);
run(
  [
    `--force-device-scale-factor=${scale}`,
    `--window-size=${Math.round(cssW)},${Math.round(cssH)}`,
    `--screenshot=${png}`,
  ],
  'png'
);
