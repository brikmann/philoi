import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchOrCreateDailyFire } from '@/lib/api/daily-fire';
import { useAuth } from '@/lib/auth/auth-context';
import type { DailyFire } from '@/types/database';

// The daily flame meter (PHILOI_UI_SPEC.md §5) — refetched on focus so returning to Home
// right after a lock-in picks up the freshly-earned XP (and, if it crosses the goal, the
// completion bonus) without any extra plumbing between the lock-in screen and Home.
export function useDailyFire() {
  const { session } = useAuth();
  const [dailyFire, setDailyFire] = useState<DailyFire | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refetch = useCallback(async () => {
    if (!session) return;
    try {
      setDailyFire(await fetchOrCreateDailyFire());
      setError(false);
    } catch (e) {
      // The meter is flavor/motivation, not core data — a failed fetch shouldn't crash Home.
      // But silently swallowing this previously made a genuinely broken RPC (an ambiguous
      // column reference, fixed in migration 0028) indistinguishable from "no data yet" for
      // a long time — always log it, and surface `error` so the UI can show a subtle distinct
      // state instead of rendering nothing (see flame-meter.tsx).
      console.error('[useDailyFire] fetchOrCreateDailyFire failed:', e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { dailyFire, loading, error, refetch };
}
