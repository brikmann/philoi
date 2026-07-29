import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { fetchMyGroups, type MyGroup } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';

export function useMyGroups() {
  const { session } = useAuth();
  const [groups, setGroups] = useState<MyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!session) return;
    try {
      setError(null);
      const data = await fetchMyGroups(session.user.id);
      setGroups(data);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your Campfires.'));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  // useFocusEffect only re-fires on an actual focus event, not on `refetch`'s identity
  // changing — if this hook's consumer (e.g. the valley page) is already focused at the
  // moment auth restore finishes (session flips from null to real), the effect above never
  // reruns and `groups` stays permanently empty until the user leaves and returns to the tab.
  // This plain effect closes that race (e.g. "My fires shows nothing though I'm in a campfire").
  useEffect(() => {
    if (session) refetch();
  }, [session, refetch]);

  return { groups, loading, error, refetch };
}
