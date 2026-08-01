import { useCallback, useEffect, useState } from 'react';

import { fetchGlobalLeaderboard } from '@/lib/api/leaderboard-social';
import { getErrorMessage } from '@/lib/errors';
import type { GlobalLeaderboardRow } from '@/types/database';

// The Leaderboard tab's "Global" scope (PHILOI_UI_SPEC.md §15's 4th tab) — best individuals
// worldwide, same true-rank-pinning shape as useUniversityLeaderboard.
export function useGlobalLeaderboard() {
  const [rows, setRows] = useState<GlobalLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setRows(await fetchGlobalLeaderboard(50));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load the global leaderboard.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  return { rows, loading, error, refetch };
}
