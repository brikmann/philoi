import { awardGoalDay, fetchMyChallenges, logChallengeProgress, type GoalDayAward } from '@/lib/api/challenges';
import { getDeviceSleepHoursBetween, getDeviceStepsBetween, getPlatformFitnessSource } from '@/lib/fitness-sync';
import { pushGoalReveal } from '@/lib/goal-reveal-queue';
import { personalGoalTitle } from '@/lib/goal-types';
import { requestRankRecheck } from '@/lib/rank-watch';
import { syncChallengeFromStrava } from '@/lib/strava';
import { supabase } from '@/lib/supabase';
import { syncChallengeFromWhoop } from '@/lib/whoop';
import type { Challenge } from '@/types/database';

/**
 * What a sync did — and, when it finished the goal, what the server PAID for it.
 *
 * 🐛 THE AWARD USED TO BE THROWN AWAY HERE. Every one of these functions returned a bare `number`,
 * so the only thing that escaped a sync was "how much progress moved". But an auto-tracked goal
 * completes through the exact same `logChallengeProgress` a manual log uses, which means it also
 * runs `economy_award_goal_day` and banks real embers — and that payout went straight into the
 * floor. Noah's repro is precisely this shape: a 10k-step goal filled by Health Connect on focus,
 * embers granted server-side, and nothing on screen because `onLogged` (the card's callback) was
 * never involved. The manual path had a reveal; the automatic one silently paid.
 */
export type ChallengeSyncOutcome = {
  /** Progress units this sync submitted. 0 for every no-op path. */
  synced: number;
  /** The server's payout, only when this sync is what completed the goal. Null otherwise — including
   * when the day was already banked (`already_awarded`), which is not a new payout to announce. */
  award: GoalDayAward | null;
  /** The goal in its own words, so a caller with no card on screen can still title the reveal. */
  goalLabel: string;
};

const nothing = (challenge: Challenge, synced = 0): ChallengeSyncOutcome => ({
  synced,
  award: null,
  goalLabel: personalGoalTitle(challenge),
});

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
async function syncStepsFromDevice(challenge: Challenge): Promise<ChallengeSyncOutcome> {
  const source = getPlatformFitnessSource();
  if (!source) return nothing(challenge);
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
  if (delta <= 0) return nothing(challenge);

  const result = await logChallengeProgress(challenge.id, delta, note);
  return {
    synced: delta,
    // `already_awarded` is not a payout — it means this local day was banked earlier, so announcing
    // it would show embers that did not move. Same rule challenges.tsx applies to a manual log.
    award: result.award && !result.award.already_awarded ? result.award : null,
    goalLabel: personalGoalTitle(challenge),
  };
}

// Strava's token refresh + activity fetch + reduction all happen server-side
// (supabase/functions/strava-sync) — this just invokes it, same delta-tracking logic lives there.
//
// Reports only how much it synced — the Edge Function calls the SQL `log_challenge_progress` as
// the user and throws `just_completed` away, so a completion here pays nothing on its own. That is
// settled centrally by `settleGoalDay` below rather than per route (#167).
async function syncRunOrRideFromStrava(challenge: Challenge): Promise<ChallengeSyncOutcome> {
  return nothing(challenge, await syncChallengeFromStrava(challenge.id));
}

// Whoop's token refresh + record fetch + reduction all happen server-side
// (supabase/functions/whoop-sync), same delta-tracking logic as Strava's. `needsScope` comes back
// when the connection was made for a different Whoop metric and doesn't cover this one — treated
// as "nothing synced" here rather than an error, since the manual log is still right there and
// Settings → Connected apps can widen the grant (§18: never gate participation).
async function syncWhoopMetric(challenge: Challenge): Promise<ChallengeSyncOutcome> {
  const { synced } = await syncChallengeFromWhoop(challenge.id);
  return nothing(challenge, synced);
}

// study_hours and gym_visits credit from the user's OWN lock-ins. Computed entirely server-side so
// the qualification rules (≥20 min, and a gym check-in needs a photo or logged sets) can't be
// argued with by a client — see sync_challenge_from_lock_ins in migration 0068.
async function syncFromLockIns(challenge: Challenge): Promise<ChallengeSyncOutcome> {
  const { data, error } = await supabase.rpc('sync_challenge_from_lock_ins', { p_challenge_id: challenge.id });
  if (error) throw error;
  return nothing(challenge, Number(data ?? 0));
}

// Sleep from the phone's own health store. Same delta-tracking shape as steps: the health total is
// cumulative for the window, so only the difference from what this source already logged is sent.
async function syncSleepFromDevice(challenge: Challenge): Promise<ChallengeSyncOutcome> {
  const source = getPlatformFitnessSource();
  if (!source) return nothing(challenge);
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
  if (delta <= 0) return nothing(challenge);

  const result = await logChallengeProgress(challenge.id, delta, note);
  return {
    synced: delta,
    award: result.award && !result.award.already_awarded ? result.award : null,
    goalLabel: personalGoalTitle(challenge),
  };
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
/**
 * 🐛 #167 — the goal-day payout for a completion this module did not personally log.
 *
 * `awardGoalDay` fires from `logChallengeProgress` (lib/api/challenges.ts), so only the two routes
 * that go through that wrapper — steps and sleep — ever paid. The other three reach
 * `log_challenge_progress` by a different door:
 *
 *   · study_hours / gym_visits → `sync_challenge_from_lock_ins`, which `perform`s the SQL function
 *     and returns a bare numeric;
 *   · run_distance / ride_distance → the strava-sync Edge Function, which calls the RPC as the user
 *     and returns `{ synced }`;
 *   · workout_minutes / strain / sleep-via-Whoop → whoop-sync, same shape.
 *
 * All three drop `just_completed` on the floor, and nothing downstream awards. So finishing a
 * 10-hour study goal with lock-ins, or a 20 km run goal on Strava, banked exactly zero embers —
 * silently, because the goal DID complete and the XP DID land. Only the drip was missing.
 *
 * Settled here, once, rather than in each route: the routes disagree about what they return and two
 * of them are Edge Functions we would have to change in lockstep, whereas "did this sync finish the
 * goal?" is one question with one answer — re-read the row.
 *
 * 🔒 SAFE TO CALL TWICE. `economy_award_goal_day` is keyed on (goal, local day) server-side (0085),
 * so a manual log and a sync that both complete the same goal on the same day pay once; the loser
 * gets `already_awarded: true`, which is not a payout and is not revealed. The re-read costs one
 * small select and only runs on the completion edge — `routeChallengeSync` has already returned
 * early for anything with a `completed_at`, so an established goal never reaches this.
 */
async function settleGoalDay(challenge: Challenge): Promise<GoalDayAward | null> {
  try {
    const { data, error } = await supabase
      .from('challenges')
      .select('completed_at')
      .eq('id', challenge.id)
      .maybeSingle();
    if (error || !data?.completed_at) return null;
    const award = await awardGoalDay(challenge.id);
    return award && !award.already_awarded ? award : null;
  } catch {
    // Best-effort, like every other sync in this file (§18 — a sync must never gate participation).
    // The award is idempotent per local day, so the next focus settles what this attempt missed.
    return null;
  }
}

export async function syncChallengeFromDevice(challenge: Challenge): Promise<ChallengeSyncOutcome> {
  const outcome = await routeChallengeSync(challenge);
  // Logged progress can finish a challenge, and finishing one pays XP out server-side — which can
  // cross a rank with no lock-in and therefore no done screen (RANKUP_SPEC §6: the moment must fire
  // for EVERY XP source, challenge payouts included). The watcher de-dupes against the rank it last
  // actually showed, so an extra nudge that didn't cross anything costs one query and shows nothing.
  if (outcome.synced > 0) requestRankRecheck();

  // The routes that log through a door this module does not own still owe a goal-day payout (#167).
  // Only asked when this sync actually moved something AND the route did not already report an
  // award — steps and sleep come back paid, so they never re-read.
  const settled =
    outcome.synced > 0 && !outcome.award ? await settleGoalDay(challenge) : null;
  const award = outcome.award ?? settled;

  // A payout the user never asked for goes on the reveal queue rather than back to the caller alone.
  // Both callers need this and only one of them is in a position to use a return value: the
  // Challenges tab is mounted and watching, but challenge/create.tsx fires this and immediately
  // `router.back()`s, so its screen is gone before the promise settles. Queued here — once, at the
  // single point every sync passes through — the reveal survives either way.
  if (award) pushGoalReveal({ award, goalLabel: outcome.goalLabel });
  return { ...outcome, award };
}

/**
 * Every metric a device or a connected service fills on its own.
 *
 * Lifted out of use-my-challenges.ts so the Challenges tab is no longer the only thing that knows
 * the list — see syncAllDeviceChallenges below for why a second caller needed it.
 */
export const DEVICE_METRIC_TYPES: Challenge['type'][] = [
  'steps',
  'run_distance',
  'ride_distance',
  'workout_minutes',
  'strain',
  'sleep_hours',
];

/**
 * Catch up every open device-metric goal this user has, and report how much moved.
 *
 * §A — WHY THIS IS NOT JUST useMyChallenges' JOB ANY MORE. Until now the only thing that ever
 * noticed a goal being finished by the phone was the Challenges tab coming into focus. A 10k-step
 * goal completed mid-walk banked its embers server-side the moment the sync ran — and that sync
 * ran when, and only when, the user happened to open that one tab. The celebration arrived
 * detached from the achievement, sometimes hours later, which is the whole thing Noah is asking to
 * fix: the moment is worth the most at the moment.
 *
 * Anything queued here reaches the screen through pushGoalReveal (see syncChallengeFromDevice), so
 * a caller does not have to be mounted, watching, or on any particular screen.
 */
export async function syncAllDeviceChallenges(userId: string): Promise<number> {
  const all = await fetchMyChallenges(userId);
  const open = all.filter((c) => DEVICE_METRIC_TYPES.includes(c.type) && !c.completed_at);
  if (open.length === 0) return 0;
  const outcomes = await Promise.all(open.map((c) => syncChallengeFromDevice(c).catch(() => null)));
  return outcomes.reduce((total, o) => total + (o?.synced ?? 0), 0);
}

async function routeChallengeSync(challenge: Challenge): Promise<ChallengeSyncOutcome> {
  if (challenge.completed_at) return nothing(challenge);
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
  return nothing(challenge);
}
