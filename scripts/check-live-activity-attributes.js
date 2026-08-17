#!/usr/bin/env node
/**
 * Silent-failure guard: the two copies of the Live Activity's ActivityAttributes MUST be identical.
 *
 *   targets/lockin/Attributes.swift                    (widget extension target)
 *   modules/philoi-live-activity/ios/Attributes.swift  (app-side ActivityKit bridge)
 *
 * They cannot share a module — the widget is its own Xcode target and the bridge builds as its own
 * CocoaPod, so neither can import the other. Each compiles its own copy and ActivityKit matches them
 * STRUCTURALLY at runtime, across a process boundary, by field name and type.
 *
 * Which makes drift invisible in the worst way. There is no build error and no runtime error you can
 * see: the widget's decoder throws inside a system daemon, and the Lock Screen card just never
 * appears. You'd go looking at entitlements and provisioning profiles for an afternoon before
 * suspecting a renamed field.
 *
 * Same shape as check-iap-ids.js — plain text comparison, no bundler, no dependencies.
 *
 * Run: npm run check:live-activity  (also runs as part of npm run typecheck)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WIDGET = path.join(ROOT, 'targets', 'lockin', 'Attributes.swift');
const BRIDGE = path.join(ROOT, 'modules', 'philoi-live-activity', 'ios', 'Attributes.swift');

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

function read(file) {
  if (!fs.existsSync(file)) {
    console.error(`✗ missing: ${rel(file)}`);
    process.exit(1);
  }
  // Normalize line endings only. Everything else — comments included — must match, so that a
  // corrected comment in one copy is a prompt to correct the other rather than a silent divergence.
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

const widget = read(WIDGET);
const bridge = read(BRIDGE);

if (widget === bridge) {
  console.log(`✓ Live Activity attributes identical (${rel(WIDGET)} ↔ ${rel(BRIDGE)})`);
  process.exit(0);
}

console.error('✗ Live Activity ActivityAttributes have DRIFTED between the widget and the bridge.');
console.error(`    ${rel(WIDGET)}`);
console.error(`    ${rel(BRIDGE)}`);
console.error('');

const widgetLines = widget.split('\n');
const bridgeLines = bridge.split('\n');

// A line-by-line report rather than a diff library: this only ever has to point at the first place
// the two disagree, which is enough to fix it.
for (let i = 0; i < Math.max(widgetLines.length, bridgeLines.length); i += 1) {
  const a = widgetLines[i];
  const b = bridgeLines[i];
  if (a === b) continue;
  console.error(`  line ${i + 1}:`);
  console.error(`    widget: ${a === undefined ? '<end of file>' : a}`);
  console.error(`    bridge: ${b === undefined ? '<end of file>' : b}`);
}

console.error('');
console.error('Fix: make the two files byte-identical. If the change is intentional, apply it to BOTH.');
process.exit(1);
