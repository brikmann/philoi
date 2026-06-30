import { useCallback, useEffect, useState } from 'react';

import { fetchDiscoverableGroups } from '@/lib/api/groups';
import type { DiscoverableGroup } from '@/types/database';

export function useDiscoverGroups() {
  const [groups, setGroups] = useState<DiscoverableGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      setGroups(await fetchDiscoverableGroups());
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  return { groups, loading, refetch };
}
