// The user's recent XP-per-hour rate, which is what turns "1,480 / 2,000 XP" into "~2h to Gold III"
// (#87 / FEATURE_LOCKIN_PILL). A raw XP gap tells you nothing about how far away it is; a time does.

import { supabase } from '@/lib/supabase';

/** How far back to look. Long enough to survive a quiet week, short enough to track a real change. */
const WINDOW_DAYS = 30;

/**
 * Don't project off noise. One 3-minute session would otherwise imply a rate, and the spec is
 * explicit that a user with no meaningful history sees NO projection rather than a made-up one.
 */
const MIN_SESSIONS = 3;
const MIN_SECONDS = 30 * 60;

export type XpRate = {
  /** XP earned per hour actually locked in. */
  xpPerHour: number;
  sessions: number;
  seconds: number;
};

/**
 * Measured, not assumed. The server pays 250 XP per locked-in hour plus a streak bonus of 5 × the
 * user's streak PER CHECK-IN (schema.sql handle_check_in_insert), so a 30-day-streak user doing
 * short sessions genuinely earns far more than 250/hour while someone new earns exactly 250. A
 * constant would be wrong for almost everybody, so this reads what they actually earned.
 *
 * Rows with a NULL duration are excluded from both halves of the ratio. Those are photo check-ins:
 * a flat 100 XP for zero recorded time. Counting their XP without any hours to divide by would
 * inflate the rate toward infinity, and counting them as zero hours is the same bug — so they're
 * dropped entirely, and the rate means "XP per hour of TIMED lock-in".
 *
 * Sub-60s rows are excluded too: the server pays them 0 XP (the anti-farming floor), so including
 * them would drag the rate down with time that could never have earned anything.
 *
 * Returns null when there isn't enough history to say anything honest.
 */
export async function fetchMyXpRate(): Promise<XpRate | null> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('check_ins')
    .select('xp_earned, duration_seconds')
    .gte('created_at', since)
    .is('removed_at', null)
    .not('duration_seconds', 'is', null)
    .gte('duration_seconds', 60);

  if (error || !data || data.length < MIN_SESSIONS) return null;

  let xp = 0;
  let seconds = 0;
  for (const row of data) {
    xp += Number(row.xp_earned ?? 0);
    seconds += Number(row.duration_seconds ?? 0);
  }

  if (seconds < MIN_SECONDS || xp <= 0) return null;

  return { xpPerHour: xp / (seconds / 3600), sessions: data.length, seconds };
}

/**
 * "~2h" / "~35m" / "~3d" — deliberately coarse. This is an estimate off a 30-day average, and
 * rendering it as "2h 14m" would claim a precision the number does not have.
 */
export function formatProjection(hours: number): string | null {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  if (hours < 1) return `~${Math.max(5, Math.round((hours * 60) / 5) * 5)}m`;
  if (hours < 10) return `~${Math.round(hours * 2) / 2}h`.replace('.5h', '½h');
  if (hours < 48) return `~${Math.round(hours)}h`;
  return `~${Math.round(hours / 24)}d`;
}

/**
 * Hours of locked-in time still needed to reach the next division.
 *
 * `xpForNextTier` is the division's FULL WIDTH, not what's left (get_my_ranks in schema.sql), so the
 * remaining gap is the difference. Getting that backwards would project from the wrong number and
 * quietly overstate how close everyone is.
 */
export function hoursToNextDivision(
  xpIntoTier: number,
  xpForNextTier: number,
  rate: XpRate | null
): number | null {
  if (!rate || xpForNextTier <= 0) return null;
  const remaining = xpForNextTier - xpIntoTier;
  if (remaining <= 0) return null;
  return remaining / rate.xpPerHour;
}
