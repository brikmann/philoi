// Renders the PNG assets (og.png, favicon.png, apple-touch-icon.png) from the
// HTML sources in this folder using a headless Chrome/Edge that is already on
// the machine — so the site itself stays a zero-dependency static bundle.
//
//   node site/_assets/build-assets.mjs
//
// Only needs re-running when the logo or the OG card copy changes; the PNGs it
// produces are committed alongside index.html.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');

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

const shots = [
  { src: 'og.html', out: 'og.png', w: 1200, h: 630 },
  { src: 'icon.html', out: 'favicon.png', w: 32, h: 32 },
  { src: 'icon.html', out: 'apple-touch-icon.png', w: 180, h: 180 },
];

for (const { src, out, w, h } of shots) {
  const profile = mkdtempSync(join(tmpdir(), 'philoi-shot-'));
  try {
    execFileSync(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        `--user-data-dir=${profile}`,
        `--window-size=${w},${h}`,
        `--screenshot=${join(site, out)}`,
        pathToFileURL(join(here, src)).href,
      ],
      { stdio: 'ignore', timeout: 60_000 }
    );
    console.log(`wrote ${out} (${w}x${h})`);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
