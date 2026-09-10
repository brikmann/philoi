// Relic progress + the two things that feed it (migrations 0119/0123).
//
// The GRANTS are entirely server-side — economy_evaluate_relics runs off triggers on check_ins and
// lock_in_sessions, so nothing here decides what anyone has earned. This is the read, plus the two
// writes the server genuinely cannot do on its own: a height (only the user knows it) and a step
// count (only the device has it).
//
// The bodyweight write (0178) is filed here too, for adjacency rather than because it belongs to a
// ladder — it is the other half of the same onboarding step as height, and no relic reads it.

import { supabase } from '@/lib/supabase';
import type { RelicProgressRow, StepDayInput, UnseenRelicUnlock } from '@/types/database';

/**
 * Where every discipline relic stands, including the ones at zero.
 *
 * All five ladders come back whether or not the user has started them, so the Trophy Hall can draw
 * the full set with "0 / 10 h" rather than an empty shelf — a locked ladder is information, and
 * §4a-2 shows ladder thresholds (only the §4a ancient relics stay secret).
 */
export async function fetchMyRelicProgress(): Promise<RelicProgressRow[]> {
  const { data, error } = await supabase.rpc('get_my_relic_progress');
  if (error) throw error;
  return (data ?? []) as RelicProgressRow[];
}

/**
 * Height, in centimetres — the stride estimate behind the Movement ladder.
 *
 * Optional everywhere: with no height the server falls back to a 0.75 m adult-average stride, so
 * skipping this costs accuracy and nothing else.
 */
export async function setMyHeightCm(heightCm: number): Promise<void> {
  const { error } = await supabase.rpc('set_my_height_cm', { p_height_cm: heightCm });
  if (error) throw error;
}

/**
 * Bodyweight, in kilograms — the DENOMINATOR Cindy scores a load goal against (migration 0178).
 *
 * Filed next to the height write because they are the same two rulers on the same two screens
 * (onboarding step 3/4, and body-metrics.tsx), and separating them is what makes the pair hard to
 * find. It is NOT a relic input: nothing on any ladder reads it.
 *
 * 🔒 IT PAYS NOTHING. DIFFICULTY_SCOPING.md's 🔴 decision is that a one-off strength PR grants no
 * box and no currency — fitness loot comes from consistency goals and relic rungs. Weight makes a
 * lift read fairly as a FLEX (share card, leaderboard order, effort inside a duel) and reaches
 * nothing in the economy. 0178 asserts that the reward paths cannot see it.
 *
 * Pass `null` to clear a stored weight; `unit` is a display preference (which unit to say it back
 * in) and is left alone when omitted. Optional everywhere — with no weight the coach asks once or
 * falls back to the demographic anchors, so skipping costs fairness on load goals and nothing else.
 */
export async function setMyWeightKg(weightKg: number | null, unit?: 'lb' | 'kg'): Promise<void> {
  const { error } = await supabase.rpc('set_my_weight_kg', {
    p_weight_kg: weightKg,
    p_weight_unit: unit ?? null,
  });
  if (error) throw error;
}

/**
 * Push a window of daily step totals to the server.
 *
 * IDEMPOTENT BY CONSTRUCTION, which is the whole reason this takes a per-day TOTAL rather than a
 * delta. record_step_days upserts on (user, day) and keeps the LARGER value, so re-sending today
 * at noon and again at 9pm lands the 9pm figure, and a second device that saw fewer steps cannot
 * subtract. Nothing on the client has to remember what it already sent — which is exactly the
 * bookkeeping fitness-challenge-sync.ts has to do against `challenge_logs`, and the reason that
 * path could never be used as a lifetime total.
 *
 * Returns the number of day-rows written.
 */
export async function recordStepDays(days: StepDayInput[]): Promise<number> {
  if (days.length === 0) return 0;
  const { data, error } = await supabase.rpc('record_step_days', { p_days: days });
  if (error) throw error;
  return (data as number) ?? 0;
}

// ─────────────────────────── The unlock inbox (migration 0176) ───────────────────────────
//
// 🔒 BOTH OF THESE ARE PRESENTATION PLUMBING. The read is a pure select over cosmetics_owned and the
// write can only stamp a timestamp — neither can grant a relic. That matters more here than it looks:
// the whole reason a relic unlock was silent is that the grant happens deep in a trigger with no
// client present, and the temptation when wiring a reveal to a silent grant is to have the reveal
// do the granting. It cannot, and it must not.

/**
 * Relics the user owns and has never been shown — oldest first.
 *
 * Almost always empty, which is the intended cost: this runs on every mount and foreground, and the
 * usual answer is zero rows. The rows that do come back are ones the server decided were owed, so
 * the client keeps no queue of its own and nothing needs clearing on sign-out.
 */
export async function fetchUnseenRelicUnlocks(): Promise<UnseenRelicUnlock[]> {
  const { data, error } = await supabase.rpc('get_unseen_relic_unlocks');
  if (error) throw error;
  return (data ?? []) as UnseenRelicUnlock[];
}

/**
 * Spend one relic's fire-once budget.
 *
 * Idempotent server-side (the update carries its own `reveal_seen_at is null` guard), so a double
 * dismiss is free, and scoped to auth.uid(), so it can only ever spend the caller's own.
 */
export async function markRelicUnlockSeen(relicKey: string): Promise<void> {
  const { error } = await supabase.rpc('mark_relic_unlock_seen', { p_relic_key: relicKey });
  if (error) throw error;
}
