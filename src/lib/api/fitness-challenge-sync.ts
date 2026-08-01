import { logChallengeProgress } from '@/lib/api/challenges';
import { getDeviceStepsBetween, getPlatformFitnessSource } from '@/lib/fitness-sync';
import { syncChallengeFromStrava } from '@/lib/strava';
import { supabase } from '@/lib/supabase';
import { syncChallengeFromWhoop } from '@/lib/whoop';
import type { Challenge } from '@/types/database';

const SYNC_NOTE_BY_SOURCE: Record<string, string> = {
  apple_health: 'Auto-synced from Apple Health',
  health_connect: 'Auto-synced from Health Connect',
};

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
  const { data, error } = await supabase
    .from('challenge_logs')
    .select('amount')
    .eq('challenge_id', challenge.id)
    .eq('note', note)
    .gte('created_at', challenge.period_start);
  if (error) throw error;
  const alreadySynced = (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);

  const total = await getDeviceStepsBetween(new Date(challenge.period_start), new Date());
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

/** One entry point for every device-metric challenge type — routes to whichever source is real
 * for it (steps → the platform pedometer, run/ride → Strava, workouts/strain/sleep → Whoop) and
 * no-ops for everything else. */
export async function syncChallengeFromDevice(challenge: Challenge): Promise<number> {
  if (challenge.completed_at) return 0;
  if (challenge.type === 'steps') return syncStepsFromDevice(challenge);
  if (challenge.type === 'run_distance' || challenge.type === 'ride_distance') return syncRunOrRideFromStrava(challenge);
  if (challenge.type === 'workout_minutes' || challenge.type === 'strain' || challenge.type === 'sleep_hours') {
    return syncWhoopMetric(challenge);
  }
  return 0;
}
