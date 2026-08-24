import { logChallengeProgress } from '@/lib/api/challenges';
import { getDeviceSleepHoursBetween, getDeviceStepsBetween, getPlatformFitnessSource } from '@/lib/fitness-sync';
import { requestRankRecheck } from '@/lib/rank-watch';
import { syncChallengeFromStrava } from '@/lib/strava';
import { supabase } from '@/lib/supabase';
import { syncChallengeFromWhoop } from '@/lib/whoop';
import type { Challenge } from '@/types/database';

const SYNC_NOTE_BY_SOURCE: Record<string, string> = {
  apple_health: 'Auto-synced from Apple Health',
  health_connect: 'Auto-synced from Health Connect',
};

// Sleep gets its OWN note per source, distinct from the steps notes above. The note is how each
// sync reads back what it specifically contributed, so sharing a string between two metrics on the
// same challenge would make both deltas wrong.
const SLEEP_NOTE_BY_SOURCE: Record<string, string> = {
  apple_health: 'Sleep auto-synced from Apple Health',
  health_connect: 'Sleep auto-synced from Health Connect',
};

/**
 * The absolute instant a challenge's CURRENT period opened.
 *
 * `challenges.period_start` is a Postgres `date` — a bare 'YYYY-MM-DD' carrying no zone at all.
 * `new Date('2026-08-23')` parses that as **UTC** midnight, which is exactly right for a WEEKLY
 * goal (week_start() is Sunday 00:00 UTC by deliberate design — see src/lib/time/week.ts and
 * migration 0071) and wrong for a DAILY one, because migration 0084 rolls daily goals over at the
 * OWNER'S LOCAL midnight.
 *
 * That mismatch is the "weekly totals are right, daily totals are wrong" bug. A daily steps goal
 * asked the health store for [UTC midnight, now]:
 *
 *   - West of Greenwich (Toronto, UTC-4) UTC midnight is 8pm the previous LOCAL evening, so
 *     yesterday evening's steps got counted into today.
 *   - East of it (Tokyo, UTC+9) UTC midnight is 9am local, so everything walked before 9am was
 *     never counted at all — and never could be, since the window only ever moves forward.
 *
 * Weekly hid it because the same offset lands in the small hours of Sunday, where there are
 * almost no steps to misplace and a week's total swamps whatever few there are.
 *
 * Both the health-store window and the already-synced log filter below are derived from this one
 * value, so they stay the same window whichever branch is taken.
 */
function periodStartInstant(challenge: Challenge): Date {
  if (challenge.period !== 'day') return new Date(challenge.period_start);
  // Local midnight of that calendar date. Split rather than `new Date(str)` because the
  // date-only form is the one the spec pins to UTC; a y/m/d constructor is the local one.
  const [y, m, d] = challenge.period_start.split('-').map(Number);
  // Anything that isn't a bare date (a full timestamp from an older server, say) already carries
  // its own zone — leave it to Date to interpret rather than guessing at it.
  if (!y || !m || !d) return new Date(challenge.period_start);
  return new Date(y, m - 1, d);
}

// A device-fitness sync never gates participation (§17/18) — it's purely additive on top of the
// existing manual-log flow, which always keeps working regardless of connection state.
//
// Delta-tracked so a repeated sync never double-counts: log_challenge_progress() ADDS its
// amount to challenge.progress (same as a manual log), so re-submitting the device's cumulative
// total for the whole window every time would compound. Instead this reads back what THIS sync
// mechanism has already logged (tagged with its own per-source note) and only submits the
// difference — through the exact same RPC a manual log uses, never a second, parallel progress
// field.
async function syncStepsFromDevice(challenge: Challenge): Promise<number> {
  const source = getPlatformFitnessSource();
  if (!source) return 0;
  const note = SYNC_NOTE_BY_SOURCE[source];

  // Scope already-synced to the CURRENT period, not all-time. `total` below is the device's step
  // count for [period_start, now]; alreadySynced must cover the SAME window or the delta desyncs.
  // Weekly goals have one fixed period so it never mattered, but a daily goal that resets each day
  // accumulates prior-day logs whose all-time sum exceeds today's device total → negative delta →
  // daily progress silently stops counting. Filtering logs to this period keeps the delta like-for-like.
  const periodStart = periodStartInstant(challenge);
  const { data, error } = await supabase
    .from('challenge_logs')
    .select('amount')
    .eq('challenge_id', challenge.id)
    .eq('note', note)
    .gte('created_at', periodStart.toISOString());
  if (error) throw error;
  const alreadySynced = (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);

  const total = await getDeviceStepsBetween(periodStart, new Date());
  const delta = Math.round(total - alreadySynced);
  if (delta <= 0) return 0;

  await logChallengeProgress(challenge.id, delta, note);
  return delta;
}

// Strava's token refresh + activity fetch + reduction all happen server-side
// (supabase/functions/strava-sync) — this just invokes it, same delta-tracking logic lives there.
async function syncRunOrRideFromStrava(challenge: Challenge): Promise<number> {
  return syncChallengeFromStrava(challenge.id);
}

// Whoop's token refresh + record fetch + reduction all happen server-side
// (supabase/functions/whoop-sync), same delta-tracking logic as Strava's. `needsScope` comes back
// when the connection was made for a different Whoop metric and doesn't cover this one — treated
// as "nothing synced" here rather than an error, since the manual log is still right there and
// Settings → Connected apps can widen the grant (§18: never gate participation).
async function syncWhoopMetric(challenge: Challenge): Promise<number> {
  const { synced } = await syncChallengeFromWhoop(challenge.id);
  return synced;
}

// study_hours and gym_visits credit from the user's OWN lock-ins. Computed entirely server-side so
// the qualification rules (≥20 min, and a gym check-in needs a photo or logged sets) can't be
// argued with by a client — see sync_challenge_from_lock_ins in migration 0068.
async function syncFromLockIns(challenge: Challenge): Promise<number> {
  const { data, error } = await supabase.rpc('sync_challenge_from_lock_ins', { p_challenge_id: challenge.id });
  if (error) throw error;
  return Number(data ?? 0);
}

// Sleep from the phone's own health store. Same delta-tracking shape as steps: the health total is
// cumulative for the window, so only the difference from what this source already logged is sent.
async function syncSleepFromDevice(challenge: Challenge): Promise<number> {
  const source = getPlatformFitnessSource();
  if (!source) return 0;
  const note = SLEEP_NOTE_BY_SOURCE[source];

  const periodStart = periodStartInstant(challenge);
  const { data, error } = await supabase
    .from('challenge_logs')
    .select('amount')
    .eq('challenge_id', challenge.id)
    .eq('note', note)
    .gte('created_at', periodStart.toISOString());
  if (error) throw error;
  const alreadySynced = (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);

  const total = await getDeviceSleepHoursBetween(periodStart, new Date());
  // Hours are fractional, so round rather than truncate — and 2dp keeps float noise from logging
  // vanishing amounts on every sync.
  const delta = Math.round((total - alreadySynced) * 100) / 100;
  if (delta <= 0) return 0;

  await logChallengeProgress(challenge.id, delta, note);
  return delta;
}

/** Whether this account has a live Whoop connection — decides who owns the sleep metric. */
async function isWhoopConnected(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('get_my_whoop_connection_status');
    if (error) return false;
    return Boolean(data?.[0]?.connected);
  } catch {
    // A failed status check must not block the sync — fall back to health data, which needs no
    // third party and is the default anyway.
    return false;
  }
}

/** One entry point for every auto-tracked challenge type — routes to whichever source is real for
 * it (steps → the platform pedometer, run/ride → Strava, study/gym → your own lock-ins, sleep →
 * health data unless Whoop is connected, workouts/strain → Whoop) and no-ops for everything else. */
export async function syncChallengeFromDevice(challenge: Challenge): Promise<number> {
  const synced = await routeChallengeSync(challenge);
  // Logged progress can finish a challenge, and finishing one pays XP out server-side — which can
  // cross a rank with no lock-in and therefore no done screen (RANKUP_SPEC §6: the moment must fire
  // for EVERY XP source, challenge payouts included). The watcher de-dupes against the rank it last
  // actually showed, so an extra nudge that didn't cross anything costs one query and shows nothing.
  if (synced > 0) requestRankRecheck();
  return synced;
}

async function routeChallengeSync(challenge: Challenge): Promise<number> {
  if (challenge.completed_at) return 0;
  if (challenge.type === 'steps') return syncStepsFromDevice(challenge);
  if (challenge.type === 'run_distance' || challenge.type === 'ride_distance') return syncRunOrRideFromStrava(challenge);
  if (challenge.type === 'study_hours' || challenge.type === 'gym_visits') return syncFromLockIns(challenge);
  if (challenge.type === 'sleep_hours') {
    // Whoop wins only when it's actually the connected source; otherwise the phone's health store.
    return (await isWhoopConnected()) ? syncWhoopMetric(challenge) : syncSleepFromDevice(challenge);
  }
  // Strain is a Whoop-native concept with no health-store equivalent, and workout_minutes stays on
  // Whoop for now. Both no-op harmlessly until a Whoop connection exists (#39).
  if (challenge.type === 'workout_minutes' || challenge.type === 'strain') return syncWhoopMetric(challenge);
  return 0;
}
