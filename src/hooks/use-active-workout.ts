import { useCallback, useEffect, useState } from 'react';

import {
  addWorkoutExercise,
  deleteWorkoutSet,
  fetchActiveWorkout,
  logWorkoutSet,
  removeWorkoutExercise,
  reorderWorkoutExercises,
  replaceWorkoutExercise,
} from '@/lib/api/gym';
import { getErrorMessage } from '@/lib/errors';
import type { ActiveWorkout, WorkoutSet, WorkoutSetClipRefs } from '@/types/database';

/** The in-session workout log's state (PHILOI_UI_SPEC.md §23, design-mocks/24).
 *
 * Every set is persisted the moment it's banked rather than batched to Finish like the old
 * proof-of-effort logger (migration 0033) — a phone dying mid-session in a gym is a real
 * scenario, and the PR verdict has to be decided at the moment the set lands, which is the
 * beat the whole feature is built around.
 *
 * Banking/removing a single set patches local state from the row the server returns (no
 * refetch — that's the hot path, and the response is already authoritative). The rarer
 * structural edits (add/replace/remove/reorder an exercise) refetch the whole workout, since
 * they shift positions and can invalidate suggestions. */
export function useActiveWorkout(enabled: boolean) {
  const [workout, setWorkout] = useState<ActiveWorkout | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled) {
      setWorkout(null);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      setWorkout(await fetchActiveWorkout());
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your workout.'));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  /** Banks a set and returns the server's row — `is_pr` on it is the real verdict, which the
   * caller uses to fire the PR celebration. Throws on failure so the caller can keep the
   * draft row on screen instead of silently losing what was typed. */
  const logSet = useCallback(async (workoutExerciseId: string, weight: number | null, reps: number): Promise<WorkoutSet> => {
    const set = await logWorkoutSet(workoutExerciseId, weight, reps);
    setWorkout((prev) =>
      prev
        ? {
            ...prev,
            exercises: prev.exercises.map((ex) =>
              ex.id === workoutExerciseId
                ? {
                    ...ex,
                    sets: [
                      ...ex.sets,
                      {
                        id: set.id,
                        set_index: set.set_index,
                        weight: set.weight,
                        reps: set.reps,
                        is_pr: set.is_pr,
                        video_key: set.video_key,
                        thumb_key: set.thumb_key,
                      },
                    ],
                    // A new best immediately becomes the bar the next set is measured against,
                    // so the badge can't fire twice for the same numbers within one session.
                    best: set.is_pr ? { weight: set.weight, reps: set.reps } : ex.best,
                  }
                : ex
            ),
          }
        : prev
    );
    return set;
  }, []);

  /** Patches one already-banked set's clip references in place (PHILOI_UI_SPEC.md §23 phase-2).
   * Local-only: the write already happened through attach/remove_workout_set_clip, and a full
   * refetch here would throw away every half-typed draft row in the logger. */
  const patchSetClip = useCallback((workoutExerciseId: string, refs: WorkoutSetClipRefs) => {
    setWorkout((prev) =>
      prev
        ? {
            ...prev,
            exercises: prev.exercises.map((ex) =>
              ex.id === workoutExerciseId
                ? {
                    ...ex,
                    sets: ex.sets.map((s) =>
                      s.id === refs.id ? { ...s, video_key: refs.video_key, thumb_key: refs.thumb_key } : s
                    ),
                  }
                : ex
            ),
          }
        : prev
    );
  }, []);

  const removeSet = useCallback(async (workoutExerciseId: string, setId: string) => {
    await deleteWorkoutSet(setId);
    setWorkout((prev) =>
      prev
        ? {
            ...prev,
            exercises: prev.exercises.map((ex) =>
              ex.id === workoutExerciseId ? { ...ex, sets: ex.sets.filter((s) => s.id !== setId) } : ex
            ),
          }
        : prev
    );
  }, []);

  const addExercise = useCallback(
    async (exerciseId: string) => {
      if (!workout) return;
      await addWorkoutExercise(workout.id, exerciseId);
      await refetch();
    },
    [workout, refetch]
  );

  const replaceExercise = useCallback(
    async (workoutExerciseId: string, exerciseId: string) => {
      await replaceWorkoutExercise(workoutExerciseId, exerciseId);
      await refetch();
    },
    [refetch]
  );

  const removeExercise = useCallback(
    async (workoutExerciseId: string) => {
      await removeWorkoutExercise(workoutExerciseId);
      await refetch();
    },
    [refetch]
  );

  /** Moves one exercise up or down by a step and persists the resulting order. */
  const moveExercise = useCallback(
    async (workoutExerciseId: string, direction: -1 | 1) => {
      if (!workout) return;
      const order = workout.exercises.map((e) => e.id);
      const from = order.indexOf(workoutExerciseId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= order.length) return;
      [order[from], order[to]] = [order[to], order[from]];

      // Reordered locally first — this is a direct-manipulation control, so waiting on a
      // round trip before the row visibly moves would feel broken.
      setWorkout((prev) =>
        prev ? { ...prev, exercises: order.map((id) => prev.exercises.find((e) => e.id === id)!) } : prev
      );
      await reorderWorkoutExercises(workout.id, order);
    },
    [workout]
  );

  return {
    workout,
    loading,
    error,
    setError,
    refetch,
    logSet,
    removeSet,
    patchSetClip,
    addExercise,
    replaceExercise,
    removeExercise,
    moveExercise,
  };
}
