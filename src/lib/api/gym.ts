import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type {
  ActiveWorkout,
  Exercise,
  Routine,
  RoutineWithExercises,
  WorkoutEnergy,
  WorkoutRecap,
  WorkoutSet,
} from '@/types/database';

// The lean gym tracker's data layer (migration 0037, PHILOI_UI_SPEC.md §23). Reads go straight
// to the tables (RLS already scopes them); every WRITE to the live log goes through a
// security-definer RPC, because the PR verdict has to be the server's call — a client that
// could insert a workout_set could also hand itself a personal record.

// ───────────────────────────── exercise library ─────────────────────────────

/** Built-in lifts plus the caller's own custom ones — RLS handles that split, so this is one query. */
export async function fetchExercises(): Promise<Exercise[]> {
  const { data, error } = await supabase.from('exercises').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

/** The escape hatch for a lift the seeded library doesn't have. Private to its creator. */
export async function createCustomExercise(userId: string, name: string, muscleGroup?: string | null): Promise<Exercise> {
  const { data, error } = await supabase
    .from('exercises')
    .insert({ name: name.trim(), muscle_group: muscleGroup ?? null, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ───────────────────────────── routines ─────────────────────────────

type RoutineRow = Routine & {
  routine_exercises: { id: string; exercise_id: string; position: number; exercises: { name: string } | null }[];
};

/** "Today's routine — from your routines" (design-mocks/23). Most recently used first, so the
 * routine someone is on a streak with sits at the top without them organising anything. */
export async function fetchMyRoutines(): Promise<RoutineWithExercises[]> {
  const { data, error } = await supabase
    .from('routines')
    .select('*, routine_exercises(id, exercise_id, position, exercises(name))')
    .order('last_used_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;

  return ((data ?? []) as unknown as RoutineRow[]).map((row) => ({
    ...row,
    exercises: [...row.routine_exercises]
      .sort((a, b) => a.position - b.position)
      .map((re) => ({ id: re.id, exercise_id: re.exercise_id, name: re.exercises?.name ?? 'Exercise', position: re.position })),
  }));
}

/** Create or rewrite a routine and its ordered lifts in one transaction. */
export async function saveRoutine(input: { id?: string | null; name: string; exerciseIds: string[] }): Promise<Routine> {
  const { data, error } = await supabase.rpc('save_routine', {
    p_name: input.name,
    p_exercise_ids: input.exerciseIds,
    p_routine_id: input.id ?? null,
  });
  if (error) throw error;
  track('routine_saved', { exercise_count: input.exerciseIds.length, is_edit: Boolean(input.id) });
  return data;
}

export async function deleteRoutine(routineId: string): Promise<void> {
  const { error } = await supabase.from('routines').delete().eq('id', routineId);
  if (error) throw error;
}

/** "Routines build from memory" (§23) — offered on the done screen, so a library assembles
 * itself out of workouts that already happened instead of an authoring chore up front. */
export async function saveWorkoutAsRoutine(workoutId: string, name: string): Promise<Routine> {
  const { data, error } = await supabase.rpc('save_workout_as_routine', { p_workout_id: workoutId, p_name: name });
  if (error) throw error;
  track('routine_saved', { exercise_count: 0, is_edit: false, from_workout: true });
  return data;
}

// ───────────────────────────── the live session ─────────────────────────────

/** Idempotent: called on a fresh gym lock-in AND on reopening the app mid-session, returning
 * the same workout either way (see start_workout()). */
export async function startWorkout(sessionId: string, routineId: string | null, energy: WorkoutEnergy): Promise<void> {
  const { error } = await supabase.rpc('start_workout', {
    p_session_id: sessionId,
    p_routine_id: routineId,
    p_energy: energy,
  });
  if (error) throw error;
  track('gym_workout_started', { energy, from_routine: Boolean(routineId) });
}

/** The whole in-session state — exercises in order, banked sets, each lift's best, and the
 * energy-nudged suggestions — in one round trip. Null when nothing is in progress. */
export async function fetchActiveWorkout(): Promise<ActiveWorkout | null> {
  const { data, error } = await supabase.rpc('get_active_workout');
  if (error) throw error;
  return data ?? null;
}

export async function addWorkoutExercise(workoutId: string, exerciseId: string): Promise<void> {
  const { error } = await supabase.rpc('add_workout_exercise', { p_workout_id: workoutId, p_exercise_id: exerciseId });
  if (error) throw error;
}

/** Swap a lift mid-session when a machine's taken (§23). Any sets already banked under the old
 * lift are dropped server-side — the caller is expected to have warned first. */
export async function replaceWorkoutExercise(workoutExerciseId: string, exerciseId: string): Promise<void> {
  const { error } = await supabase.rpc('replace_workout_exercise', {
    p_workout_exercise_id: workoutExerciseId,
    p_exercise_id: exerciseId,
  });
  if (error) throw error;
}

export async function removeWorkoutExercise(workoutExerciseId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_workout_exercise', { p_workout_exercise_id: workoutExerciseId });
  if (error) throw error;
}

export async function reorderWorkoutExercises(workoutId: string, orderedIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_workout_exercises', { p_workout_id: workoutId, p_ordered_ids: orderedIds });
  if (error) throw error;
}

/** Banks a set. The returned row's `is_pr` is the SERVER's verdict against the stored best for
 * that lift — that's what the badge and the celebration are driven off, never a local guess. */
export async function logWorkoutSet(workoutExerciseId: string, weight: number | null, reps: number): Promise<WorkoutSet> {
  const { data, error } = await supabase.rpc('log_workout_set', {
    p_workout_exercise_id: workoutExerciseId,
    p_weight: weight,
    p_reps: reps,
  });
  if (error) throw error;
  track('workout_set_logged', { weight, reps, is_pr: data.is_pr });
  if (data.is_pr) track('workout_pr_hit', { weight, reps });
  return data;
}

export async function deleteWorkoutSet(setId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_workout_set', { p_set_id: setId });
  if (error) throw error;
}

/** The finished-workout recap behind the done screen's summary and the posted campfire card's
 * lifts/PRs. Null for a check-in that wasn't a tracked gym session. */
export async function fetchWorkoutRecap(checkInId: string): Promise<WorkoutRecap | null> {
  const { data, error } = await supabase.rpc('get_workout_recap', { p_check_in_id: checkInId });
  if (error) throw error;
  return data ?? null;
}
