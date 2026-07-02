import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchMyCircleRanks } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import type { MyCircleRank } from '@/types/database';

export function useMyCircleRanks() {
  const [ranks, setRanks] = useState<MyCircleRank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setRanks(await fetchMyCircleRanks());
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your circle rankings.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { ranks, loading, error, refetch };
}
