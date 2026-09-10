// Rebuilds the GENERATED ASSETS block inside `banner.html` — the base64 Inter
// faces, the QR code and the flame mark.
//
//   node outreach-assets/gym-banner/inline-assets.mjs
//
// WHY the artboard carries megabytes of base64 instead of <link>s and <img>s:
// this file gets emailed to a print shop. `brand/README.md` already records what
// happens when type is fetched over the network at render time — the render
// silently falls back to Segoe UI and nobody notices until the proof. A print
// run is a worse place to notice. Everything the banner needs is inside the one
// HTML file, so it renders identically on a machine that has never seen this
// repo and has no internet.
//
// The QR needs `qrcode` from npm. It is NOT a dependency of the app and must not
// become one — the script installs it into a temp dir on demand and throws it
// away, exactly so `package.json` stays untouched. Everything else is read from
// files already in the repo.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

// The one URL both QRs resolve to. Change it here, re-run, re-export — never
// hand-edit the path data in banner.html, it is machine-generated.
const QR_URL = 'https://philoi.app';

const BEGIN = '<!-- BEGIN GENERATED ASSETS · node inline-assets.mjs -->';
const END = '<!-- END GENERATED ASSETS -->';

// ── Fonts ────────────────────────────────────────────────────────────────────
// Inter, the app's only typeface (src/constants/theme.ts § Fonts) and the
// marketing site's (site/index.html). Read from the copy the app itself ships
// so the banner cannot drift onto a different cut of Inter than the screens it
// is showing photos of.
const FACES = [
  { weight: 400, dir: '400Regular', file: 'Inter_400Regular.ttf' },
  { weight: 500, dir: '500Medium', file: 'Inter_500Medium.ttf' },
  { weight: 600, dir: '600SemiBold', file: 'Inter_600SemiBold.ttf' },
  { weight: 700, dir: '700Bold', file: 'Inter_700Bold.ttf' },
  { weight: 900, dir: '900Black', file: 'Inter_900Black.ttf' },
];

function fontFaces() {
  return FACES.map(({ weight, dir, file }) => {
    const path = join(repo, 'node_modules', '@expo-google-fonts', 'inter', dir, file);
    if (!existsSync(path)) {
      throw new Error(`Inter ${weight} not found at ${path} — run \`npm install\` in the repo root first.`);
    }
    const b64 = readFileSync(path).toString('base64');
    return `@font-face{font-family:'Inter';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/ttf;base64,${b64}) format('truetype')}`;
  }).join('\n');
}

// ── QR ───────────────────────────────────────────────────────────────────────
// Error-correction level H (30% recoverable) because this one gets printed
// once, hung in a gym, and then lives with whatever scuffs and glare the room
// gives it. The 4-module quiet zone is part of the QR spec, not padding — a
// scanner needs it, so it is drawn into the viewBox rather than left to the
// layout to remember.
// async, and awaited inside the try: the `finally` below deletes the temp
// install, and a returned-but-unresolved promise would race it — the dir was
// already gone by the time the dynamic import went looking for the module.
async function qrPath() {
  const dir = mkdtempSync(join(tmpdir(), 'philoi-qr-'));
  try {
    execFileSync('npm', ['install', '--no-save', '--silent', '--prefix', dir, 'qrcode'], {
      stdio: 'ignore',
      timeout: 180_000,
      shell: process.platform === 'win32',
    });
    const modUrl = pathToFileURL(join(dir, 'node_modules', 'qrcode', 'lib', 'index.js')).href;
    const { default: QRCode } = await import(modUrl);
    const qr = QRCode.create(QR_URL, { errorCorrectionLevel: 'H' });
    const size = qr.modules.size;
    const data = qr.modules.data;
    const QUIET = 4;
    const total = size + QUIET * 2;
    let d = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[y * size + x]) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
      }
    }
    console.log(`  QR  ${QR_URL} · version ${qr.version} · ECC H · ${size}x${size} modules (+${QUIET} quiet)`);
    return { d, total, version: qr.version, size };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows sometimes still holds the handle; %TEMP% gets reaped anyway. */
    }
  }
}

// ── SVG assets already in the repo ───────────────────────────────────────────
// Both are pulled in as <symbol>s so the artboard can <use> them at any size and
// they stay real vectors all the way into the PDF.
function symbolFrom(path, id, { stripIds = false } = {}) {
  const raw = readFileSync(path, 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(raw)?.[1];
  if (!viewBox) throw new Error(`no viewBox in ${path}`);
  let inner = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>[\s\S]*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '');
  // `url(#…)` fills are how philoi-flame-mark.svg gets its ember ramp, and the
  // id they point at lives in the same file. Stripping ids there would silently
  // turn the flame black — which is exactly the kind of thing you notice on the
  // printed banner and not before — so the guard is loud instead.
  const refs = [...inner.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
  if (stripIds && refs.length > 0) {
    throw new Error(`refusing to strip ids from ${path}: it references ${refs.join(', ')}`);
  }
  for (const ref of refs) {
    if (!inner.includes(`id="${ref}"`)) throw new Error(`${path} references #${ref} but does not define it`);
  }
  if (stripIds) inner = inner.replace(/\s+id="[^"]*"/g, '');
  return `<symbol id="${id}" viewBox="${viewBox}">${inner}</symbol>`;
}

const { d: qrD, total: qrTotal, version: qrVersion, size: qrModules } = await qrPath();

const generated = [
  BEGIN,
  '<style>',
  fontFaces(),
  '</style>',
  '<svg width="0" height="0" style="position:absolute" aria-hidden="true">',
  // The flame mark is read from the repo-root original, never a copy —
  // brand/README.md's rule, for the same reason: one edit, every export.
  symbolFrom(join(repo, 'philoi-flame-mark.svg'), 'philoi-flame'),
  `<symbol id="qr" viewBox="0 0 ${qrTotal} ${qrTotal}"><path d="${qrD}"/></symbol>`,
  '</svg>',
  `<!-- qr: ${QR_URL} · v${qrVersion} · ECC H · ${qrModules}x${qrModules} modules -->`,
  END,
].join('\n');

const htmlPath = join(here, 'banner.html');
const html = readFileSync(htmlPath, 'utf8');
const start = html.indexOf(BEGIN);
const stop = html.indexOf(END);
if (start === -1 || stop === -1) throw new Error(`missing ${BEGIN} / ${END} markers in banner.html`);

writeFileSync(htmlPath, html.slice(0, start) + generated + html.slice(stop + END.length));
console.log(`  fonts  Inter ${FACES.map((f) => f.weight).join('/')} embedded as base64 TTF`);
console.log(`wrote banner.html (${(readFileSync(htmlPath).length / 1e6).toFixed(2)} MB)`);
