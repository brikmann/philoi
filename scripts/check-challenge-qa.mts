#!/usr/bin/env node
/**
 * New-Challenge Q&A guard: the sentences from the device reports, read and routed end to end.
 *
 * Each case is a sentence someone actually typed (or the spec's acceptance line) and the challenge it
 * must become. Runs the PURE half of challenge/create.tsx — parseQa → nextStep → verdictRouteFor —
 * with a fixed clock, so a regex change that turns a run into "Lift 500 lb" fails here, not on a
 * phone. Cindy's extraction is not exercised (it needs the network); this is the fast path she sits
 * behind, and the floor every answer gets when she is off.
 *
 * Run: npm run check:challenge-qa  (also part of `npm run typecheck`)
 */
import {
  EMPTY_ANSWERS,
  nextStep,
  parseQa,
  verdictRouteFor,
  type QaAnswers,
  type QaParse,
  type QaStep,
} from '../src/lib/challenge-qa.ts';

const NOW = new Date(2026, 9, 10, 12, 0, 0); // Oct 10 2026 — fall term
const CIRCLE = { id: 'c1', name: 'Run Club', isAdmin: true };
let failures = 0;

function fail(name: string, msg: string) {
  failures++;
  console.error(`✗ ${name}: ${msg}`);
}

function merge(a: QaAnswers, p: QaParse): QaAnswers {
  const out: QaAnswers = { ...a };
  if (p.what) out.what = p.what;
  if (p.customName) out.customName = p.customName;
  if (p.target != null) {
    out.target = p.target;
    out.unit = p.unit ?? out.unit;
  }
  if (p.cadence) out.cadence = p.cadence;
  if (p.deadline) out.deadline = p.deadline;
  if (p.windowHours) out.windowHours = p.windowHours;
  if (p.who) out.who = p.who;
  if (p.campfireKind) out.campfireKind = p.campfireKind;
  if (p.contributorReward) out.contributorReward = true;
  return out;
}

/** Answer a sequence of typed lines, each read against the step that is open when it is typed. */
function run(lines: string[], start: Partial<QaAnswers> = {}): QaAnswers {
  let a: QaAnswers = { ...EMPTY_ANSWERS, ...start };
  for (const line of lines) {
    const step: QaStep = nextStep(a);
    a = merge(a, parseQa(line, NOW, { step }));
    if (a.who === 'campfire' && !a.circle) a.circle = CIRCLE;
  }
  return a;
}

function expect(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(name, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ── #1 · a placement race asks no number ──
{
  const a = run(['Most distance ran by end of semester', 'Run Club, race for the most']);
  expect('#1 step', nextStep(a), 'score');
  const r = verdictRouteFor(a, NOW).params;
  expect('#1 branch', r.branch, 'placement');
  expect('#1 metric', r.metric, 'distance');
  if (/\d+\s*km/.test(r.label)) fail('#1 label', `a placement race names a target: "${r.label}"`);
}

// ── #2 / #3 · a pooled distance total with a contributor payout, never "Lift 500 lb" ──
{
  const a = run(['500 km cumulatively as a club by Dec 31, pay the top contributor']);
  expect('#3 step', nextStep(a), 'score');
  const r = verdictRouteFor(a, NOW).params;
  expect('#3 branch', r.branch, 'pooled');
  expect('#3 metric', r.metric, 'distance');
  expect('#3 raw metres', r.target, '500000');
  expect('#3 reward', r.rewardTop, '1');
  if (/\blb\b|lift/i.test(r.label)) fail('#2 label', `a run became lifting: "${r.label}"`);
}
{
  // The same ask through the chips: run → campfire → "together as a club" → the total.
  const a = run(['A run', 'A campfire', 'everyone contributes cumulatively, whoever contributes most gets paid', '500 km', '2 months']);
  const r = verdictRouteFor(a, NOW).params;
  expect('#3 chips branch', r.branch, 'pooled');
  expect('#3 chips target', r.target, '500000');
}

// ── #2 · the number ──
expect('#2 typo 500kkm', parseQa('500kkm by december', NOW).target, 500);
expect('#2 typo unit', parseQa('500kkm by december', NOW).unit, 'km');
expect('#2 5k run', parseQa('run a 5k', NOW).target, 5);
expect('#2 10k steps', parseQa('10k steps a day', NOW).target, 10000);
expect('#2 10k steps what', parseQa('10k steps a day', NOW).what, 'steps');
expect('#2 miles', parseQa('run 10 miles this week', NOW).target, 16.1);

// ── #4 · a bare timeframe answers "when" ──
expect('#4 bare 2 months', parseQa('2 months', NOW, { step: 'when' }).windowHours, 60 * 24);
expect('#4 five weeks', parseQa('five weeks', NOW, { step: 'when' }).windowHours, 5 * 168);
expect('#4 9 days', parseQa('for 9 days', NOW).windowHours, 9 * 24);
expect('#4 rate is not a window', parseQa('3 days a week', NOW, { step: 'when' }).windowHours, undefined);
expect('#4 bare span off-step', parseQa('2 months', NOW, { step: 'specifics' }).windowHours, undefined);
{
  const d = parseQa('by end of semester', NOW).deadline;
  expect('#4 semester', d ? [d.getMonth(), d.getDate()] : null, [11, 31]);
}

// ── #7 · custom goals ──
{
  const a = run(['1,000 pushups by December', 'Just me']);
  expect('#7 pushups name', a.customName, 'pushups');
  expect('#7 pushups target', a.target, 1000);
  const r = verdictRouteFor(a, NOW).params;
  expect('#7 pushups type', r.goalType, 'custom');
  expect('#7 pushups mode', r.countMode, 'manual');
}
{
  const a = run(['2 hours of guitar a day', 'Just me']);
  expect('#7 guitar name', a.customName, 'guitar');
  const r = verdictRouteFor(a, NOW).params;
  expect('#7 guitar period', r.period, 'day');
  expect('#7 guitar counts lock-in time', r.countMode, 'lockin_time');
  expect('#7 guitar label', r.label, 'Guitar');
}

// ── controls: the shapes that already worked still route where they did ──
{
  const a = run(['everyone runs 50 km by December'], { who: 'campfire' });
  const r = verdictRouteFor(a, NOW).params;
  expect('control together branch', r.branch, 'collective');
  expect('control together target', r.target, '50000');
}
{
  const a = run(['gym 3x a week', 'Just me']);
  const r = verdictRouteFor(a, NOW).params;
  expect('control solo gym', [r.branch, r.goalType, r.period, r.target], ['solo', 'gym_visits', 'week', '3']);
}
{
  // A count cannot be pooled: it falls back to a bar each, and SAYS so.
  const a = run(['1000 pushups cumulatively as a club by December']);
  const route = verdictRouteFor(a, NOW);
  expect('control pooled count branch', route.params.branch, 'campfire');
  if (!route.note) fail('control pooled count', 'fell back to a bar each without telling the user');
}

if (failures) {
  console.error(`\ncheck-challenge-qa FAILED (${failures})`);
  process.exit(1);
}
console.log('✓ challenge Q&A reads and routes every reported sentence');
