import { useCallback, useEffect, useMemo, useState } from 'react';

import { createCustomExercise, fetchExercises } from '@/lib/api/gym';
import { getErrorMessage } from '@/lib/errors';
import type { Exercise } from '@/types/database';

/** The lift library behind the exercise picker (add / replace / routine editing). Small and
 * fully client-side searchable — the seeded library is ~50 rows plus whatever the user added,
 * so filtering locally beats a query per keystroke. */
export function useExerciseLibrary() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setExercises(await fetchExercises());
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load the exercise library.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  const addCustom = useCallback(async (userId: string, name: string) => {
    const created = await createCustomExercise(userId, name);
    setExercises((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created;
  }, []);

  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  return { exercises, byId, loading, error, refetch, addCustom };
}
