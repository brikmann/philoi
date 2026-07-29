import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchMyCampfireHeat } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';

// Heat is a nice-to-have visual, not core data — a failed fetch degrades to every
// CampfireFlame just rendering at 0 heat rather than surfacing an error to the user.
export function useCampfireHeat() {
  const { session } = useAuth();
  const [heatByGroupId, setHeatByGroupId] = useState<Record<string, number>>({});

  const refetch = useCallback(async () => {
    if (!session) return;
    try {
      setHeatByGroupId(await fetchMyCampfireHeat());
    } catch (e) {
      console.warn('[use-campfire-heat] failed to load campfire heat:', e);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return heatByGroupId;
}
