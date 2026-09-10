// Checks the exported print files against the specs that cost money to get
// wrong. Run it after every `build.mjs`:
//
//   node outreach-assets/gym-banner/verify.mjs
//
// What it proves, and why each one is here rather than eyeballed:
//
//   1. PDF page size is 856 x 2006 mm. A page that silently came out Letter is
//      the single most common way a browser-printed artboard reaches a printer
//      wrong, and it is invisible in a thumbnail.
//   2. The PDF is VECTOR, not a picture of the banner. Checked two ways:
//      embedded font programs (/FontFile2) and real text-showing operators
//      inside the inflated content stream. A rasterised export would still
//      look fine on screen and fall apart at 850 mm.
//   3. The PNG is at least 150 DPI at full size.
//   4. Both QRs decode, FROM THE EXPORTED PNG, to exactly the URL we meant.
//      Not from the source SVG — from the pixels a scanner would actually see.
//
// (4) carries a negative control. A decode that passes is only evidence if the
// same check can fail: the control feeds the decoder a deliberately shredded
// copy of the same crop and requires it to come back empty. Without that, a
// decoder that returned a stale result would look like a green check.
//
// jsqr + pngjs are pulled into a temp dir on demand, same as inline-assets.mjs
// does for `qrcode`, so none of this touches the app's package.json.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const EXPECT_URL = 'https://philoi.app';
const ARTBOARD_MM = { w: 856, h: 2006 };
const MIN_DPI = 150;
const TOL_PT = 1.5; // Chrome rounds the page box to a fraction of a point

// Both QRs, in artboard millimetres (origin = top-left of the BLEED box, i.e.
// trim coordinates + 3 mm). Kept in step with banner.html by hand — if a QR
// moves, this moves, and the decode below is what catches it if you forget.
const QR_BOXES = [
  // The banner's only QR. Band top 1503 (2006 - 503), .footer-qr at +40 mm
  // with 16 mm padding, right-aligned 10 mm inside the 43 mm gutter.
  { name: 'footer QR', x: 629.0, y: 1559.0, size: 158 },
];
const MIN_QR_MM = 40; // brief's floor for the printed code

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => {
  console.log(`  FAIL  ${msg}`);
  failures++;
};

// ── 1 & 2 · the PDF ─────────────────────────────────────────────────────────
const pdfPath = join(here, 'PHILOI_gym_banner_print.pdf');
if (!existsSync(pdfPath)) throw new Error('no PDF — run build.mjs first');
const pdf = readFileSync(pdfPath);
const pdfLatin = pdf.toString('latin1');

console.log('PDF');
const mb = /\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/.exec(pdfLatin);
if (!mb) {
  bad('no /MediaBox found');
} else {
  const [, x0, y0, x1, y1] = mb.map(Number);
  const wPt = x1 - x0;
  const hPt = y1 - y0;
  const wMm = (wPt / 72) * 25.4;
  const hMm = (hPt / 72) * 25.4;
  const wantW = (ARTBOARD_MM.w / 25.4) * 72;
  const wantH = (ARTBOARD_MM.h / 25.4) * 72;
  const msg = `page ${wMm.toFixed(1)} x ${hMm.toFixed(1)} mm (${wPt.toFixed(1)} x ${hPt.toFixed(1)} pt)`;
  if (Math.abs(wPt - wantW) <= TOL_PT && Math.abs(hPt - wantH) <= TOL_PT) ok(msg);
  else bad(`${msg} — expected ${ARTBOARD_MM.w} x ${ARTBOARD_MM.h} mm`);
}

// A page count of 1. If the artboard ever grows a millimetre past the @page
// box it paginates instead of erroring, and the overflow lands on a second
// page that a proof thumbnail will not show you.
const pageObjects = (pdfLatin.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
if (pageObjects === 1) ok('single page — the artboard did not paginate');
else bad(`${pageObjects} page objects — content has split across pages`);

const fontFiles = (pdfLatin.match(/\/FontFile2/g) ?? []).length;
if (fontFiles > 0) ok(`${fontFiles} embedded font program(s) — type is type, not pixels`);
else bad('no /FontFile2 — the PDF has no embedded fonts');

// Inflate every stream we can and look for text-showing operators. A raster
// export would have images and no Tj/TJ at all.
let textOps = 0;
let imageXObjects = (pdfLatin.match(/\/Subtype\s*\/Image/g) ?? []).length;
for (const m of pdfLatin.matchAll(/stream\r?\n/g)) {
  const start = m.index + m[0].length;
  const end = pdfLatin.indexOf('endstream', start);
  if (end === -1) continue;
  try {
    const text = inflateSync(pdf.subarray(start, end)).toString('latin1');
    textOps += (text.match(/\b(Tj|TJ)\b/g) ?? []).length;
  } catch {
    /* not a flate stream (font programs, images) — fine */
  }
}
if (textOps > 100) ok(`${textOps} text-showing operators in the content stream`);
else bad(`only ${textOps} text operators — the page looks rasterised`);
console.log(`  note  ${imageXObjects} image XObject(s) in the file`);

// ── 3 & 4 · the PNG ─────────────────────────────────────────────────────────
const pngPath = join(here, 'PHILOI_gym_banner_print.png');
if (!existsSync(pngPath)) throw new Error('no PNG — run build.mjs first');

const dir = mkdtempSync(join(tmpdir(), 'philoi-verify-'));
let PNG;
let jsQR;
try {
  execFileSync('npm', ['install', '--no-save', '--silent', '--prefix', dir, 'pngjs', 'jsqr'], {
    stdio: 'ignore',
    timeout: 180_000,
    shell: process.platform === 'win32',
  });
  ({ PNG } = await import(pathToFileURL(join(dir, 'node_modules', 'pngjs', 'lib', 'png.js')).href));
  ({ default: jsQR } = await import(pathToFileURL(join(dir, 'node_modules', 'jsqr', 'dist', 'jsQR.js')).href));

  console.log('\nPNG');
  const img = PNG.sync.read(readFileSync(pngPath));
  const dpi = (img.width / (ARTBOARD_MM.w / 25.4));
  const msg = `${img.width} x ${img.height} px = ${dpi.toFixed(0)} DPI at ${ARTBOARD_MM.w} x ${ARTBOARD_MM.h} mm`;
  if (dpi >= MIN_DPI - 0.5) ok(msg);
  else bad(`${msg} — below the ${MIN_DPI} DPI floor`);

  const pxPerMm = img.width / ARTBOARD_MM.w;

  // Crop helper — returns {data,width,height} in the RGBA shape jsQR wants.
  function crop(xMm, yMm, wMm, hMm) {
    const x0 = Math.max(0, Math.round(xMm * pxPerMm));
    const y0 = Math.max(0, Math.round(yMm * pxPerMm));
    const w = Math.min(img.width - x0, Math.round(wMm * pxPerMm));
    const h = Math.min(img.height - y0, Math.round(hMm * pxPerMm));
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      img.data.copy(out, y * w * 4, ((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4);
    }
    return { data: new Uint8ClampedArray(out), width: w, height: h };
  }

  console.log('\nQR — decoded from the exported PNG, not from the source');
  for (const { name, x, y, size } of QR_BOXES) {
    if (size < MIN_QR_MM) bad(`${name}: ${size} mm is under the ${MIN_QR_MM} mm minimum`);

    // Pad the crop by 6 mm so the quiet zone is unambiguously included.
    const pad = 6;
    const c = crop(x - pad, y - pad, size + pad * 2, size + pad * 2);
    const got = jsQR(c.data, c.width, c.height);
    if (got?.data === EXPECT_URL) {
      // The printed code area excludes the 4-module quiet zone drawn inside
      // the same box: 29 of the 37 modules are code.
      const codeMm = (size * 29) / 37;
      ok(`${name}: "${got.data}"  ·  ${codeMm.toFixed(0)} mm code area (min ${MIN_QR_MM})`);
    } else {
      bad(`${name}: decoded ${got ? `"${got.data}"` : 'nothing'} — expected "${EXPECT_URL}"`);
    }

    // Negative control: shred the same crop past what ECC-H can recover. If
    // this still "decodes", the check above proved nothing.
    const shredded = new Uint8ClampedArray(c.data);
    for (let i = 0; i < shredded.length; i += 4) {
      if ((i / 4) % 3 !== 0) continue;
      shredded[i] = shredded[i + 1] = shredded[i + 2] = ((i * 2654435761) >>> 13) & 0xff;
    }
    const control = jsQR(shredded, c.width, c.height);
    if (control?.data === EXPECT_URL) bad(`${name}: NEGATIVE CONTROL decoded a shredded image — the decode above is meaningless`);
    else ok(`${name}: negative control fails to decode, as it must`);
  }
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* %TEMP% gets reaped */
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
