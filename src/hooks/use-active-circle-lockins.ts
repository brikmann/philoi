import { useEffect, useState } from 'react';

import { fetchActiveCircleLockIns, type ActiveCircleLockIn } from '@/lib/api/lock-ins';

const POLL_MS = 20000;

// "n locked in now" (PHILOI_UI_SPEC.md §12's header subtitle + live strip, design-mocks/06) —
// same polling cadence as the running-session screen's own body-double poll, since there's no
// Realtime Presence in this codebase yet (see the lock-in build plan).
export function useActiveCircleLockIns(groupId: string) {
  const [activeLockIns, setActiveLockIns] = useState<ActiveCircleLockIn[]>([]);

  useEffect(() => {
    let mounted = true;
    async function poll() {
      try {
        const active = await fetchActiveCircleLockIns(groupId);
        if (mounted) setActiveLockIns(active);
      } catch {
        // Ambient presence is a nice-to-have — a failed poll shouldn't surface an error.
      }
    }
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [groupId]);

  return activeLockIns;
}
