import { useCallback, useEffect, useState } from 'react';

import { fetchLeaderboard } from '@/lib/api/groups';
import type { LeaderboardRow } from '@/types/database';

export function useLeaderboard(groupId: string) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setRows(await fetchLeaderboard(groupId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the leaderboard.');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  return { rows, loading, error, refetch };
}
