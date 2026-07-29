import { useCallback, useEffect, useState } from 'react';

import { fetchGroup } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import type { Group } from '@/types/database';

export function useGroup(groupId: string) {
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setGroup(await fetchGroup(groupId));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load this Campfire.'));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  return { group, loading, error, refetch };
}
