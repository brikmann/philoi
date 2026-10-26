import { supabase } from '@/lib/supabase';
import type {
  DisputeResult,
  ExerciseAgg,
  ExerciseLibraryRow,
  ExerciseUnit,
  MetricCatalogRow,
  MetricLeaderboardRow,
  MetricScope,
  MetricWindow,
  VersusRow,
} from '@/types/house';
import type { WorkoutSet } from '@/types/database';

// Client wrappers for the stat library, the fitness / any-exercise board, head-to-head and PR
// verification (0265, 0266). Every read is security definer and privacy-gated server-side: a
// private climber is never on a board and `versus` refuses them (hint 'rank_private').

/** The 26-stat library (mock 293), in display order. */
export async function fetchMetricCatalog(): Promise<MetricCatalogRow[]> {
  const { data, error } = await supabase.from('metric_catalog').select('*').order('sort');
  if (error) throw error;
  return data ?? [];
}

export async function fetchMetricLeaderboard(args: {
  metric: string;
  scope: MetricScope;
  window: MetricWindow;
  limit?: number | null;
  verifiedOnly?: boolean;
  /** 0276: also list everyone in scope with nothing logged (rank null, value 0), after the ranked. */
  includeUnranked?: boolean;
}): Promise<MetricLeaderboardRow[]> {
  const base = {
    p_metric: args.metric,
    p_scope: args.scope,
    p_window: args.window,
    p_limit: args.limit ?? 100,
    p_verified_only: args.verifiedOnly ?? false,
  };
  let { data, error } = args.includeUnranked
    ? await supabase.rpc('get_metric_leaderboard', { ...base, p_include_unranked: true })
    : await supabase.rpc('get_metric_leaderboard', base);
  // A server without 0276 has no p_include_unranked — PostgREST answers PGRST202 (no function with
  // that signature). Fall back to the ranked-only board rather than failing it.
  if (error && args.includeUnranked && error.code === 'PGRST202') {
    ({ data, error } = await supabase.rpc('get_metric_leaderboard', base));
  }
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, value: Number(r.value) }));
}

/** One row per stat asked for, in the order asked. */
export async function fetchVersus(a: string, b: string, metricKeys: string[]): Promise<VersusRow[]> {
  const { data, error } = await supabase.rpc('versus', { p_a: a, p_b: b, p_metric_keys: metricKeys });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, a_value: Number(r.a_value), b_value: Number(r.b_value) }));
}

/** True when a versus/board error is the privacy wall rather than a fault. */
export function isRankPrivateError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { hint?: string }).hint === 'rank_private';
}

export async function searchExerciseLibrary(query: string, limit = 40): Promise<ExerciseLibraryRow[]> {
  const { data, error } = await supabase.rpc('search_exercise_library', { p_query: query.trim() || null, p_limit: limit });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, lifters: Number(r.lifters) }));
}

/** Finds or creates — "bench  press" returns the built-in Bench press. Returns the exercise id. */
export async function createExercise(name: string, muscleGroup: string | null, unit: ExerciseUnit): Promise<string> {
  const { data, error } = await supabase.rpc('create_exercise', { p_name: name, p_muscle_group: muscleGroup, p_unit: unit });
  if (error) throw error;
  return data;
}

/** Rank or hide a set, and consent to moderator review of its clip (mock 295). */
export async function setWorkoutSetRanking(workoutSetId: string, opts: { private: boolean; consent: boolean }): Promise<WorkoutSet> {
  const { data, error } = await supabase.rpc('set_workout_set_ranking', {
    p_workout_set_id: workoutSetId,
    p_private: opts.private,
    p_consent: opts.consent,
  });
  if (error) throw error;
  return data;
}

/** Disputes a ranked PR. Fires the moderator alert the same way the report screen does. */
export async function disputePr(workoutSetId: string, note?: string): Promise<DisputeResult> {
  const { data, error } = await supabase.rpc('dispute_pr', { p_workout_set_id: workoutSetId, p_note: note ?? null });
  if (error) throw error;
  void supabase.functions.invoke('report_alert', { body: { reportId: data.report_id } });
  return data;
}

/** The board metric key for any exercise: 'ex:<slug>:<agg>'. */
export function exerciseMetricKey(slug: string, agg: ExerciseAgg): string {
  return `ex:${slug}:${agg}`;
}

/** The aggregations that make sense for an exercise's unit (mock 294's toggle). */
export function aggsForUnit(unit: ExerciseUnit): ExerciseAgg[] {
  switch (unit) {
    case 'weight':
      return ['e1rm', 'max_weight', 'max_reps'];
    case 'reps':
    case 'time':
    case 'distance':
      return ['max_reps'];
  }
}
