#!/usr/bin/env node
/**
 * Silent-failure guard: the FOUR copies of the Focus Nudge App-Group contract MUST be identical.
 *
 *   modules/philoi-focus-nudge/ios/FocusNudgeShared.swift   (the app-side bridge / CocoaPod)
 *   targets/device-activity-monitor/FocusNudgeShared.swift  (DeviceActivityMonitor extension)
 *   targets/shield-configuration/FocusNudgeShared.swift     (ShieldConfiguration extension)
 *   targets/shield-action/FocusNudgeShared.swift            (ShieldAction extension)
 *
 * They cannot share a module: each extension is its own Xcode target and the bridge builds as its
 * own CocoaPod, so none of the four can import another. Each compiles its own copy and they meet
 * only at runtime, across process boundaries, through UserDefaults keys matched BY STRING.
 *
 * Which makes drift invisible in the worst way — exactly like the Live Activity attributes this is
 * modelled on (check-live-activity-attributes.js). Rename a key in the app's copy and there is no
 * build error and no runtime error you can see: the write lands under the new name, the shield
 * reads the old one, finds nothing, and quietly draws its built-in fallback copy over someone's
 * Instagram forever. You would go looking at entitlements and provisioning profiles for an
 * afternoon before suspecting a string.
 *
 * Fix: re-copy the app-side file over the other three.
 *   cp modules/philoi-focus-nudge/ios/FocusNudgeShared.swift targets/device-activity-monitor/
 *   cp modules/philoi-focus-nudge/ios/FocusNudgeShared.swift targets/shield-configuration/
 *   cp modules/philoi-focus-nudge/ios/FocusNudgeShared.swift targets/shield-action/
 *
 * Run: npm run check:focus-nudge  (also runs as part of npm run typecheck)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'modules', 'philoi-focus-nudge', 'ios', 'FocusNudgeShared.swift');
const MIRRORS = [
  path.join(ROOT, 'targets', 'device-activity-monitor', 'FocusNudgeShared.swift'),
  path.join(ROOT, 'targets', 'shield-configuration', 'FocusNudgeShared.swift'),
  path.join(ROOT, 'targets', 'shield-action', 'FocusNudgeShared.swift'),
];

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

function read(file) {
  if (!fs.existsSync(file)) {
    console.error(`✗ missing: ${rel(file)}`);
    process.exit(1);
  }
  // Normalize line endings only. Everything else — comments included — must match, so that a
  // corrected comment in one copy is a prompt to correct the others rather than a silent divergence.
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

const source = read(SOURCE);
const drifted = MIRRORS.filter((file) => read(file) !== source);

if (drifted.length === 0) {
  console.log(`✓ Focus Nudge app-group contract identical across 4 targets (${rel(SOURCE)})`);
  process.exit(0);
}

console.error('✗ The Focus Nudge app-group contract has DRIFTED between targets.');
console.error(`    source: ${rel(SOURCE)}`);
console.error('');

const sourceLines = source.split('\n');

// A line-by-line report rather than a diff library: this only ever has to point at the first place
// a copy disagrees, which is enough to fix it.
for (const file of drifted) {
  const mirrorLines = read(file).split('\n');
  console.error(`  ${rel(file)}`);
  for (let i = 0; i < Math.max(sourceLines.length, mirrorLines.length); i += 1) {
    if (sourceLines[i] === mirrorLines[i]) continue;
    console.error(`    line ${i + 1}:`);
    console.error(`      source: ${sourceLines[i] === undefined ? '<end of file>' : sourceLines[i]}`);
    console.error(`      mirror: ${mirrorLines[i] === undefined ? '<end of file>' : mirrorLines[i]}`);
    break;
  }
}

console.error('');
console.error('Fix: copy the app-side file over the other three (see the header of this script).');
process.exit(1);
