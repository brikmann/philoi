const path = require('path');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// getSentryExpoConfig wraps Expo's default Metro config (expo/metro-config) and additionally
// configures module resolution for Sentry's own dual ESM/CJS packages — without it, Metro
// fails to resolve @sentry/core's internal exports-mapped submodules (e.g.
// "./tracing/measurement.js") even though the files exist on disk.
const config = getSentryExpoConfig(__dirname);

// `.claude/worktrees/` holds thirteen git worktrees of THIS SAME app, nested inside the project
// root — each with its own `src/app` of ~42 route files, and seven of them with a full
// `node_modules` of their own. Metro's default blockList covers `.expo/types`, `__tests__` and the
// native build dirs; it has never heard of `.claude`, so every one of those copies was crawled on
// startup and then watched for changes.
//
// Two costs, both paid continuously. The module graph gains a dozen duplicates of every route file
// and of every package in the seven vendored `node_modules` — same package.json `name` field in
// each, which is precisely the shape that produces haste collisions. And the watch tree becomes
// large enough that the server keeps working while nothing at all is happening: measured at ~10% of
// a core sitting idle, with no file in the project or any worktree modified for half an hour.
//
// Scoped to `.claude` rather than `.claude/worktrees` so the agent scratch dirs beside it are
// covered too. Nothing under here is ever imported by the app — it is sibling checkouts and tooling
// state, not source — so excluding it changes no resolution the bundle actually depends on.
// `.deno-cache/` is the second offender, and it does something worse than waste CPU: it KILLS the
// server. Deno (the Supabase edge-function toolchain) writes short-lived `.tmp` files under it, and
// Metro's FallbackWatcher on Windows tries to `fs.watch` each new file it discovers. When the temp
// file is gone by the time the watch attaches — which is the normal case for a download temp — the
// ENOENT is thrown from a watcher callback with nothing to catch it, and the process exits:
//
//   Error: ENOENT: no such file or directory, watch
//   '...\.deno-cache\npm\registry.npmjs.org\@supabase\realtime-js\2.116.2ccc36a9.tmp'
//     at FSWatcher.<computed> (node:internal/fs/watchers)
//     at #watchdir (@expo/metro-file-map/build/watchers/FallbackWatcher.js)
//
// This crashed the dev server repeatedly — exit codes 4, 7 and 127 on different runs, which looked
// like three unrelated faults and was one. The directory is often absent by the time you go looking,
// because Deno cleans up after itself, so the evidence only survives in the crash log.
//
// Nothing under either path is ever imported by the app — sibling checkouts, tooling state and a
// package cache for a different runtime — so excluding them changes no resolution the bundle depends on.
//
// `.deno-cache` turned out to be one instance, not the bug. The next crash was the identical ENOENT on
// `marketing\launch-video\node_modules\.ansi-styles-11NYDr31` — npm's rename-into-place temp dir,
// from an `npm install` in a separate project that happens to live inside this root. The fault is
// FallbackWatcher dying on ANY path that vanishes mid-crawl, so every independent npm project nested
// here is a way to kill the dev server. There are two: `admin/` (a Next.js app with its own full
// dependency tree) and `marketing/launch-video/`. Neither is imported by anything under src/, and
// eslint.config.js already ignores `marketing/**` for the same reason.
//
// These two are ANCHORED to this project root, unlike the dot-dirs above. A bare /[\\/]admin[\\/]/
// would also swallow any future `src/app/admin/` route or a package's internal `admin/` folder, and
// Metro would report it as a missing module rather than as a block. Dot-prefixed names carry no such
// risk, which is why those two stay unanchored.
const escapeForRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The drive letter is matched either case (`[cC]:`) because the same root shows up as both `c:\`
// and `C:\` depending on how the process was launched. This must be done INSIDE the pattern, not
// with an `i` flag: Expo composes every blockList entry into one RegExp and throws at startup —
// "Cannot combine blockList patterns, because they have different flags" — if any entry's flags
// differ from Metro's defaults. That took the server down once; composeMetroIgnorePatterns is the
// thing to test against, not each pattern in isolation.
const underRoot = (dir) => {
  const escaped = escapeForRegExp(path.join(__dirname, dir));
  const anyCaseDrive = escaped.replace(/^([A-Za-z]):/, (_, d) => `[${d.toLowerCase()}${d.toUpperCase()}]:`);
  return new RegExp(`^${anyCaseDrive}[\\\\/]`);
};

config.resolver.blockList = [
  ...config.resolver.blockList,
  /[\\/]\.claude[\\/]/,
  /[\\/]\.deno-cache[\\/]/,
  underRoot('admin'),
  underRoot('marketing'),
];

// USE WATCHMAN. Everything above treats symptoms of one choice this config never made explicitly.
//
// `resolver.useWatchman` comes through as null, and Expo's file map reads that as false
// (createFileMap-fork: `config.resolver.useWatchman ?? false`). Its watcher order is
// Watchman > NativeWatcher > FallbackWatcher, and NativeWatcher is macOS-only
// (`platform() === 'darwin'`), so on Windows a null here means FallbackWatcher, always. That
// watcher has now failed this project both ways it can:
//   - it throws an uncaught ENOENT when any file vanishes mid-crawl (the three crashes above);
//   - it walks the tree attaching an fs.watch per directory, and on this repo that no longer fits
//     inside the 240s MAX_WAIT_TIME — "Failed to start watch mode." — so the server can't start.
//
// Watchman (installed via winget) walks and watches natively, and tolerates files disappearing
// under it. It advertises all four capabilities the file map requires — field-content.sha1hex,
// relative_root, suffix-set, wildmatch — plus watcher-win32. And this is fail-safe: the file map
// runs that capability check at startup and falls back to FallbackWatcher if watchman is missing
// or broken, so on a machine without watchman this line changes nothing.
config.resolver.useWatchman = true;

module.exports = config;
