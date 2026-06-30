import { useCallback, useEffect, useState } from 'react';

import { fetchUniversityLeaderboard } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import type { UniversityLeaderboardRow } from '@/types/database';

export function useUniversityLeaderboard(university: string) {
  const [rows, setRows] = useState<UniversityLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setRows(await fetchUniversityLeaderboard(university));
    } catch (e) {
      console.error('[university-leaderboard] failed:', e);
      setError(getErrorMessage(e, 'Could not load the school leaderboard.'));
    } finally {
      setLoading(false);
    }
  }, [university]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  return { rows, loading, error, refetch };
}
