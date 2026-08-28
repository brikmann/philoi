// Relic progress + the two things that feed it (migrations 0119/0123).
//
// The GRANTS are entirely server-side — economy_evaluate_relics runs off triggers on check_ins and
// lock_in_sessions, so nothing here decides what anyone has earned. This is the read, plus the two
// writes the server genuinely cannot do on its own: a height (only the user knows it) and a step
// count (only the device has it).

import { supabase } from '@/lib/supabase';
import type { RelicProgressRow, StepDayInput } from '@/types/database';

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
