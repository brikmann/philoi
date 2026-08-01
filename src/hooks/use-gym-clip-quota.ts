import { useCallback, useEffect, useState } from 'react';

import { fetchGymClipQuota, type GymClipQuota } from '@/lib/api/gym-clips';

// "N left this month" (PHILOI_UI_SPEC.md §23) — shown only to free users; paid has no
// countdown, so callers should just check `quota?.tier === 'free'` before rendering it.
export function useGymClipQuota() {
  const [quota, setQuota] = useState<GymClipQuota | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      setQuota(await fetchGymClipQuota());
    } catch {
      // Quota is a soft UI affordance, not a gate the client enforces itself (the server does
      // that) — a failed fetch just hides the counter.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  return { quota, loading, refetch };
}
