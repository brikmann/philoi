import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchUniversityTotals } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import type { UniversityTotal } from '@/types/database';

export function useUniversityTotals() {
  const [totals, setTotals] = useState<UniversityTotal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setTotals(await fetchUniversityTotals());
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load university totals.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { totals, loading, error, refetch };
}
