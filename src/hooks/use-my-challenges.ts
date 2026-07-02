import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchMyChallenges } from '@/lib/api/challenges';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { Challenge } from '@/types/database';

export function useMyChallenges() {
  const { session } = useAuth();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!session) return;
    try {
      setError(null);
      setChallenges(await fetchMyChallenges(session.user.id));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your challenges.'));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { challenges, loading, error, refetch };
}
