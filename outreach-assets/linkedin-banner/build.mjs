// Renders PHILOI_linkedin_banner.png (1128x191 at 3x = 3384x573) from banner.html
// with a headless Chrome/Edge already on the machine. Same approach as site/_assets/build-assets.mjs.
//
//   node outreach-assets/linkedin-banner/build.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
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

const profile = mkdtempSync(join(tmpdir(), 'philoi-shot-'));
try {
  execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=3',
      '--virtual-time-budget=5000', // let Google Fonts land before the shot
      `--user-data-dir=${profile}`,
      '--window-size=1128,191',
      `--screenshot=${join(here, 'PHILOI_linkedin_banner.png')}`,
      pathToFileURL(join(here, 'banner.html')).href,
    ],
    { stdio: 'ignore', timeout: 60_000 }
  );
  console.log('wrote PHILOI_linkedin_banner.png (3384x573)');
} finally {
  rmSync(profile, { recursive: true, force: true });
}
