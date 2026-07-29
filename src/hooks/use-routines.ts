import { useCallback, useEffect, useState } from 'react';

import { deleteRoutine, fetchMyRoutines, saveRoutine } from '@/lib/api/gym';
import { getErrorMessage } from '@/lib/errors';
import type { RoutineWithExercises } from '@/types/database';

/** The caller's saved routines, most recently used first — "Today's routine … from your
 * routines" in the lock-in picker (design-mocks/23), and the list the routine editor manages. */
export function useRoutines() {
  const [routines, setRoutines] = useState<RoutineWithExercises[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setRoutines(await fetchMyRoutines());
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your routines.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  const save = useCallback(
    async (input: { id?: string | null; name: string; exerciseIds: string[] }) => {
      const saved = await saveRoutine(input);
      await refetch();
      return saved;
    },
    [refetch]
  );

  const remove = useCallback(
    async (routineId: string) => {
      await deleteRoutine(routineId);
      await refetch();
    },
    [refetch]
  );

  return { routines, loading, error, refetch, save, remove };
}
