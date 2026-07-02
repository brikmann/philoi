import { useCallback, useEffect, useState } from 'react';

import { fetchChallengeFeedEvents, type FeedChallengeEvent } from '@/lib/api/challenges';
import { getErrorMessage } from '@/lib/errors';

export function useChallengeFeed(groupId: string) {
  const [events, setEvents] = useState<FeedChallengeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setEvents(await fetchChallengeFeedEvents(groupId));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load challenge activity.'));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  return { events, loading, error, refetch };
}
