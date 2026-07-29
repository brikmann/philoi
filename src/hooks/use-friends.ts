import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchMyFriends, type Friend } from '@/lib/api/friends';
import { getErrorMessage } from '@/lib/errors';

// "Your people" (design-mocks/21) — your real, mutually-accepted friends (the friend graph,
// not campfire co-membership). Refetched on focus so a newly-accepted friend shows up when you
// return to the screen.
export function useFriends() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setFriends(await fetchMyFriends());
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your people.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { friends, loading, error, refetch };
}
