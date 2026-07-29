import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchMyTodayLockInCount } from '@/lib/api/check-ins';
import { useAuth } from '@/lib/auth/auth-context';
import { getLocalDayBounds } from '@/lib/local-day';

// Home's dynamic greeting (PHILOI_UI_SPEC.md §5) needs "lock-ins logged today," refetched on
// focus so finishing a session and returning to Home picks up the new count immediately.
export function useTodayLockInCount() {
  const { session } = useAuth();
  const [count, setCount] = useState(0);

  const refetch = useCallback(async () => {
    if (!session) return;
    try {
      const { start } = getLocalDayBounds();
      setCount(await fetchMyTodayLockInCount(session.user.id, start.toISOString()));
    } catch {
      // Flavor for the greeting line only — a failed fetch just falls back to the "0" bucket.
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return count;
}
