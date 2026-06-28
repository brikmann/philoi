import { useCallback, useEffect, useState } from 'react';

import { fetchFeed, type FeedCheckIn } from '@/lib/api/check-ins';

export function useFeed(groupId: string) {
  const [items, setItems] = useState<FeedCheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setItems(await fetchFeed(groupId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the feed.');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  return { items, loading, error, refetch };
}
