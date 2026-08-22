import { useCallback, useEffect, useState } from 'react';

import { fetchGroup } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import type { Group } from '@/types/database';

export function useGroup(groupId: string) {
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    // No id = nothing to fetch. The report screen mounts this with an empty id when the thing
    // being reported isn't a campfire, and firing a query for '' just produces a uuid-cast error
    // nobody reads.
    if (!groupId) {
      setLoading(false);
      return;
    }
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
