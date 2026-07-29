import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchMySocialChallenges } from '@/lib/api/social-challenges';
import { getErrorMessage } from '@/lib/errors';
import type { SocialChallenge } from '@/types/database';

export function useSocialChallenges() {
  const [challenges, setChallenges] = useState<SocialChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setChallenges(await fetchMySocialChallenges());
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load challenges.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { challenges, loading, error, refetch };
}
