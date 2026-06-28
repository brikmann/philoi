import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchMyGroups, type MyGroup } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';

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
      setError(e instanceof Error ? e.message : 'Could not load your circles.');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { groups, loading, error, refetch };
}
