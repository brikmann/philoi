import { useCallback, useEffect, useState } from 'react';

import { fetchCampfireStats } from '@/lib/api/groups';
import type { CampfireStats } from '@/types/database';

// design-mocks/94's stat strip. Same posture as useCampfireHeat: this is flavour on top of the
// member view, so a failed fetch leaves `stats` null and the strip simply doesn't render — it never
// blocks the screen or surfaces an error over the leaderboard.
export function useCampfireStats(groupId: string) {
  const [stats, setStats] = useState<CampfireStats | null>(null);

  const refetch = useCallback(async () => {
    try {
      setStats(await fetchCampfireStats(groupId));
    } catch (e) {
      console.warn('[use-campfire-stats] failed to load campfire stats:', e);
    }
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  return { stats, refetch };
}
