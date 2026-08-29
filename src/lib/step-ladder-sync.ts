// Walking gets a path into the Movement relic ladder (ITEM_CATALOG §4a-2: "total distance MOVED —
// walking counts", migration 0119).
//
// WHY THIS EXISTS AT ALL. Before 0119 there was no persisted step count anywhere in the system.
// `syncStepsFromDevice` (lib/api/fitness-challenge-sync.ts) reads the pedometer live and posts a
// DELTA into `challenge_logs` — and only while a steps CHALLENGE is running, and only for that
// challenge's window. So a user who walks 8 km a day and has never created a steps challenge had a
// lifetime step total of exactly zero as far as the server was concerned, and the Distance ladder
// could only ever be fed by a Strava run. That is the "steps never feed the km tracker" gap.
//
// This is a separate, small sync that runs regardless of any challenge: ask the health store for a
// trailing window of per-day totals, hand them to record_step_days, done. It deliberately does not
// touch challenge progress — that path is delta-tracked for a reason and the two must not both be
// writing the same fact.

import * as SecureStore from 'expo-secure-store';

import { FITNESS_SYNC_ENABLED } from '@/constants/feature-flags';
import { recordStepDays } from '@/lib/api/relics';
import { getDeviceStepsBetween, isDeviceFitnessSupported } from '@/lib/fitness-sync';
import type { StepDayInput } from '@/types/database';

// The same key use-fitness-connection.ts writes. Read directly rather than through the hook so
// this can run from a plain async function — the grant is per-device, so there is nothing on the
// server to ask instead.
const FITNESS_CONNECTED_KEY = 'philoi_fitness_connected';

// How far back a routine sync looks. A trailing week covers the realistic gaps — a few days
// offline, a phone left at home — without re-walking history every foreground.
const WINDOW_DAYS = 7;

// 🔴 THE LADDER IS FORWARD-ONLY. This was 90, and that number instant-unlocked the entire Distance
// relic on a brand-new account.
//
// The reasoning behind the backfill was not silly — the ladder is a LIFETIME total, and seeding it
// with one day looks like a bug. What it missed is that the phone's step history exists completely
// independently of when the Philoi account was created. Health Connect happily hands back 90 days
// of walking somebody did before they had ever heard of us; at a normal ~8k steps/day that is
// roughly 500 km through `steps × stride`, which clears every rung of the Movement ladder including
// the 414 km mythic. So the first sync after connecting handed over Pheidippides' Sandals for
// nothing the user had done here. Noah's call: passive walking still counts, pre-Philoi history
// does not.
//
// 1, not 0: the first connect seeds TODAY, so the ladder starts moving the same day rather than
// waiting for tomorrow's window. Everything after that accrues through WINDOW_DAYS.
const FIRST_RUN_DAYS = 1;

const LAST_SYNC_KEY_PREFIX = 'philoi_step_ladder_synced_';

// The day this device first synced the ladder for this user — "day 0", persisted.
//
// The trailing 7-day window is a re-sync mechanism, and on its own it is a second way for history
// to leak in: a user who connects, closes the app for a fortnight and comes back has a window whose
// START is before their connect date, so it would quietly pull in days they walked before joining.
// Clamping every window to this date closes that, and it is what makes "forward-only" a property of
// the sync rather than a property of the first run.
const FIRST_SYNC_DAY_KEY_PREFIX = 'philoi_step_ladder_day0_';

// Once an hour is plenty for a metric measured in days, and it keeps a tab-focus loop from asking
// the health store on every navigation.
const MIN_INTERVAL_MS = 60 * 60 * 1000;

const syncKey = (userId: string) => `${LAST_SYNC_KEY_PREFIX}${userId}`;
const day0Key = (userId: string) => `${FIRST_SYNC_DAY_KEY_PREFIX}${userId}`;

/** Local 'YYYY-MM-DD' for a Date — the device's calendar date, never a UTC one. */
function localDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Local midnight at the start of `d` — the day boundary the health store is queried against. */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Parse a stored 'YYYY-MM-DD' back to local midnight. Split rather than `new Date(str)` because
 *  the date-only form parses as UTC, which is a day out either side of Greenwich. */
function parseLocalDayKey(raw: string): Date | null {
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * The earliest day this account may ever sync on this device — its first connect.
 *
 * Recorded on the first run and never moved afterwards. Returns today (and stores it) when there is
 * nothing recorded yet, which covers both a genuine first connect and a user who connected under
 * the old backfilling code: for the latter, "day 0" becomes the day they first ran this build, so
 * the clamp stops NEW history from arriving even though it cannot retract what already landed.
 */
async function firstSyncDay(userId: string, today: Date): Promise<Date> {
  try {
    const raw = await SecureStore.getItemAsync(day0Key(userId));
    const stored = raw ? parseLocalDayKey(raw) : null;
    if (stored) return stored;
    await SecureStore.setItemAsync(day0Key(userId), localDayKey(today));
  } catch {
    // SecureStore unavailable — fall through to today, which is the conservative answer: it can
    // only ever narrow the window, never widen it back over pre-Philoi history.
  }
  return today;
}

async function isConnected(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(FITNESS_CONNECTED_KEY)) === 'true';
  } catch {
    return false;
  }
}

/**
 * Read a trailing window of daily step totals and record them.
 *
 * Returns how many day-rows the server wrote (0 for every no-op path: flag off, no health store,
 * not connected, throttled, or nothing walked).
 *
 * BEST-EFFORT AND SILENT, like every other fitness sync in the app (§18 — a sync must never gate
 * participation). A refused permission or an unavailable store means the ladder simply does not
 * move; it never surfaces an error, because there is no action the user could take from wherever
 * this happened to be called.
 *
 * DAY BY DAY, not one range query, because the server stores a per-day total and the whole
 * idempotency argument in record_step_days rests on that: one bucket per calendar day means a
 * re-sync overwrites rather than accumulates. A single range total could only ever be an insert.
 */
export async function syncStepLadder(userId: string, opts?: { force?: boolean }): Promise<number> {
  if (!FITNESS_SYNC_ENABLED || !isDeviceFitnessSupported()) return 0;
  if (!(await isConnected())) return 0;

  let lastSynced: number | null = null;
  try {
    const raw = await SecureStore.getItemAsync(syncKey(userId));
    lastSynced = raw ? Number(raw) : null;
    if (lastSynced !== null && !Number.isFinite(lastSynced)) lastSynced = null;
  } catch {
    lastSynced = null;
  }

  const now = Date.now();
  if (!opts?.force && lastSynced !== null && now - lastSynced < MIN_INTERVAL_MS) return 0;

  // No record of a previous sync means either a fresh install or a first connect. Either way the
  // ladder starts at today and grows from there — see FIRST_RUN_DAYS.
  const requestedDays = lastSynced === null ? FIRST_RUN_DAYS : WINDOW_DAYS;

  const today = startOfLocalDay(new Date());

  // Clamp the window to the connect date. Without this the trailing 7 days is its own backfill: a
  // fortnight away and the window's start sits before the user ever joined, so days they walked
  // pre-Philoi would arrive through the routine path even though the first run refused them.
  const day0 = await firstSyncDay(userId, today);
  const daysSinceDay0 = Math.round((today.getTime() - day0.getTime()) / (24 * 60 * 60 * 1000));
  // `daysSinceDay0` can go negative if the device clock moves backwards; max(1) keeps that from
  // producing an empty loop and silently freezing the ladder.
  const days = Math.max(1, Math.min(requestedDays, daysSinceDay0 + 1));

  const batch: StepDayInput[] = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i + 1);
    try {
      const steps = await getDeviceStepsBetween(start, end);
      // A zero day is not worth a row: the ladder sums what exists, and writing zeroes would
      // just make every batch the size of the window.
      if (steps > 0) batch.push({ day: localDayKey(start), steps: Math.round(steps) });
    } catch {
      // One unreadable day must not abandon the rest of the window.
    }
  }

  let written = 0;
  try {
    written = await recordStepDays(batch);
  } catch {
    // Leave the timestamp unwritten so the next call retries rather than waiting out the hour.
    return 0;
  }

  try {
    await SecureStore.setItemAsync(syncKey(userId), String(now));
  } catch {
    // A failed write only costs a repeat sync later.
  }

  return written;
}

/** Sign-out cleanup, so the next account on this device does not inherit a sync timestamp — or a
 *  connect date, which would otherwise let a new account on a shared phone start its window
 *  somewhere in the previous owner's history. */
export async function clearStepLadderSyncState(userId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(syncKey(userId));
  } catch {
    // Nothing actionable — the timestamp is per user id, so a stale one is never read again.
  }
  try {
    await SecureStore.deleteItemAsync(day0Key(userId));
  } catch {
    // Same — and losing it only means day 0 is re-recorded as the next sign-in's today, which is
    // the conservative direction.
  }
}
