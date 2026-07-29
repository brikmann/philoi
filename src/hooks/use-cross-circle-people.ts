import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchMyCrossCirclePeople } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import type { CrossCirclePerson } from '@/types/database';

export function useCrossCirclePeople() {
  const [people, setPeople] = useState<CrossCirclePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setPeople(await fetchMyCrossCirclePeople());
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load the leaderboard.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { people, loading, error, refetch };
}
