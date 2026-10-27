// Refreshes the cosmetic art inlined in site/index.html from the app's own renderers.
//
//   node site/_assets/cosmetic-art/export.mjs
//
// The shop tiles, loadout shelf, profile halo and Flame Pass track on the landing page are not
// redrawn for the web: they are ItemArt / BoxArt / HaloRing / PatronCrest / FlameLogo rendered to
// static SVG with react-dom/server. react-native, react-native-svg and reanimated are swapped for
// the tiny DOM shims in ./shims, and anything native (expo-*, supabase, posthog) for a do-nothing
// proxy, so the drawing code runs unchanged at its still frame.
//
// It renders from `git archive HEAD src`, never the working tree: a sibling session's uncommitted
// item must not reach the public site before it ships. Then every `<!--art:KEY-->…<!--/art-->`
// span in index.html is refilled with that key from ./art.jsx. Re-run after an art or catalog
// change and commit index.html; the page itself stays a zero-dependency static file.

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const page = join(repo, 'site', 'index.html');
const shim = (f) => join(here, 'shims', f);
const STUB_FILE = shim('stub.js').replace(/\\/g, '/');

const work = mkdtempSync(join(tmpdir(), 'philoi-art-'));
try {
  // 1. HEAD's src, and an esbuild to bundle it with (kept out of the app's package.json).
  execSync(`git -C "${repo}" archive HEAD src | tar -x -C "${work.replace(/\\/g, '/')}"`, { stdio: 'inherit', shell: 'bash' });
  writeFileSync(join(work, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] }, jsx: 'react-jsx' } }));
  const tools = join(tmpdir(), 'philoi-art-esbuild');
  if (!existsSync(join(tools, 'node_modules', 'esbuild'))) {
    mkdirSync(tools, { recursive: true });
    execSync('npm i --no-save --silent esbuild@0.24.0', { cwd: tools, stdio: 'inherit' });
  }
  const esbuild = await import(pathToFileURL(join(tools, 'node_modules', 'esbuild', 'lib', 'main.js')).href);

  // 2. Bundle art.jsx against the shims.
  const STUB_RE = /^(expo|expo-.*|@expo\/.*|@supabase\/.*|@react-native.*|react-native-.*|@shopify\/.*|lottie.*|@sentry\/.*|posthog.*)$/;
  const swap = [
    [/[\\/]src[\\/]lib[\\/]supabase\.ts$/, 'supabase.js'],
    [/[\\/]src[\\/]lib[\\/](analytics|posthog)\.ts$/, 'analytics.js'],
    [/[\\/]src[\\/]hooks[\\/]use-motion-active\.tsx?$/, 'motion.js'],
  ];
  const plugin = {
    name: 'rn-web-shim',
    setup(b) {
      b.onResolve({ filter: /\.(mp3|wav|m4a|png|jpg|jpeg|gif|webp|ttf|otf|mp4|lottie)$/ }, () => ({ path: shim('stub.js') }));
      b.onResolve({ filter: /^react-native$/ }, () => ({ path: shim('rn.js') }));
      b.onResolve({ filter: /^react-native-svg$/ }, () => ({ path: shim('svg.js') }));
      b.onResolve({ filter: /^react-native-reanimated$/ }, () => ({ path: shim('rea.js') }));
      b.onResolve({ filter: STUB_RE }, (a) => ({ path: `${a.path}|${a.importer}`, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => {
        const i = a.path.indexOf('|');
        return { contents: stubFor(a.path.slice(0, i), a.path.slice(i + 1)), loader: 'js', resolveDir: here };
      });
      b.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, (a) => {
        for (const [re, f] of swap) if (re.test(a.path)) return { contents: readFileSync(shim(f), 'utf8'), loader: 'js', resolveDir: join(here, 'shims') };
        return undefined;
      });
    },
  };
  const bundle = join(work, 'art.mjs');
  await esbuild.build({
    entryPoints: [join(here, 'art.jsx')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    plugins: [plugin],
    tsconfig: join(work, 'tsconfig.json'),
    nodePaths: [join(repo, 'node_modules')],
    jsx: 'automatic',
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
    define: { __DEV__: 'false', 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  });
  const art = JSON.parse(execFileSync(process.execPath, [bundle], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }));

  // 3. Refill the markers. Each placement gets its own id prefix: every render restarts useId at
  //    the same value, and on one page a url(#id) resolves to the FIRST element with that id.
  let n = 0;
  const missing = new Set();
  const html = readFileSync(page, 'utf8').replace(/<!--art:([\w-]+)-->[\s\S]*?<!--\/art-->/g, (_, key) => {
    if (!art[key]) {
      missing.add(key);
      return _;
    }
    n += 1;
    return `<!--art:${key}-->${clean(art[key], `a${n}`)}<!--/art-->`;
  });
  if (missing.size) throw new Error(`no art for: ${[...missing].join(', ')}`);
  writeFileSync(page, html);
  console.log(`refilled ${n} art spans in site/index.html`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

/** One root <svg>, sized by CSS (class="art"), hidden from AT, with page-unique ids. */
function clean(markup, prefix) {
  const svgs = markup.match(/<svg[\s\S]*<\/svg>/);
  if (!svgs) throw new Error(`no <svg> in ${markup.slice(0, 80)}`);
  let svg = svgs[0];
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of new Set(ids)) {
    const safe = `${prefix}-${id.replace(/[^\w-]/g, '')}`;
    svg = svg.split(`id="${id}"`).join(`id="${safe}"`).split(`url(#${id})`).join(`url(#${safe})`).split(`href="#${id}"`).join(`href="#${safe}"`);
  }
  return svg.replace(/^<svg([^>]*)>/, (_, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} class="art" aria-hidden="true" focusable="false">`);
}

/** An ESM stub exporting exactly the names `importer` takes from `spec`, each the do-anything proxy. */
function stubFor(spec, importer) {
  const src = importer && existsSync(importer) ? readFileSync(importer, 'utf8') : '';
  const esc = spec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const names = new Set();
  const re = new RegExp(`import\\s+(type\\s+)?([^;]*?)\\s+from\\s+['"]${esc}['"]`, 'g');
  for (const m of src.matchAll(re)) {
    if (m[1]) continue;
    const named = m[2].match(/\{([^}]*)\}/);
    if (named) {
      for (const raw of named[1].split(',')) {
        const part = raw.trim();
        if (part && !part.startsWith('type ')) names.add(part.split(/\s+as\s+/)[0]);
      }
    }
    const ns = m[2].match(/\*\s+as\s+(\w+)/);
    if (ns) for (const k of src.matchAll(new RegExp(`\\b${ns[1]}\\.(\\w+)`, 'g'))) names.add(k[1]);
  }
  names.delete('default');
  return [`import P from ${JSON.stringify(STUB_FILE)};`, 'export default P;', ...[...names].map((x) => `export const ${x} = P;`)].join('\n');
}
