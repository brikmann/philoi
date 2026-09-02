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
config.resolver.blockList = [...config.resolver.blockList, /[\\/]\.claude[\\/]/];

module.exports = config;
