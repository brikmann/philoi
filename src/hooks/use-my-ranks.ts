import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchMyRanks } from '@/lib/api/goals';
import { getErrorMessage } from '@/lib/errors';
import type { MyRank } from '@/types/database';

export function useMyRanks() {
  const [ranks, setRanks] = useState<MyRank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setRanks(await fetchMyRanks());
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your ranks.'));
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
