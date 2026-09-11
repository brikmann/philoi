import { useCallback, useState } from 'react';

import { useGatedInterval } from '@/hooks/use-motion-active';

import { fetchActiveCircleLockIns, type ActiveCircleLockIn } from '@/lib/api/lock-ins';

const POLL_MS = 20000;

// "n locked in now" (PHILOI_UI_SPEC.md §12's header subtitle + live strip, design-mocks/06) —
// same polling cadence as the running-session screen's own body-double poll, since there's no
// Realtime Presence in this codebase yet (see the lock-in build plan).
export function useActiveCircleLockIns(groupId: string) {
  const [activeLockIns, setActiveLockIns] = useState<ActiveCircleLockIn[]>([]);

  // Paused off-screen and in the background. "n locked in now" is a glanceable number on a screen
  // you are looking at; polling it for a screen you are not is a radio wake-up every 20 seconds
  // for a string nobody can read. The gate refetches the moment you come back, so the number is
  // never stale at the only time it is visible.
  const poll = useCallback(async () => {
    try {
      setActiveLockIns(await fetchActiveCircleLockIns(groupId));
    } catch {
      // Ambient presence is a nice-to-have — a failed poll shouldn't surface an error.
    }
  }, [groupId]);
  useGatedInterval(poll, POLL_MS);

  return activeLockIns;
}
