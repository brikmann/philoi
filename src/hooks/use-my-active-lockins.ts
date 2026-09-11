import { useCallback, useState } from 'react';

import { useGatedInterval } from '@/hooks/use-motion-active';
import { fetchMyVisibleActiveLockIns, type ActiveCircleLockIn } from '@/lib/api/lock-ins';
import { useAuth } from '@/lib/auth/auth-context';

const POLL_MS = 20000;

// Live "locked in now" across ALL your circles (RLS already scopes lock_in_sessions to
// circle-mates) — the same source the active-session flame + campfire presence strip use, here
// for the friend-ping screen's "Locked in now" section. Polled (no Realtime Presence yet), and
// refetched on focus so the section is current the moment you open the screen.
export function useMyActiveLockIns() {
  const { session } = useAuth();
  const [active, setActive] = useState<ActiveCircleLockIn[]>([]);

  const refetch = useCallback(async () => {
    if (!session) return;
    try {
      setActive(await fetchMyVisibleActiveLockIns(session.user.id));
    } catch {
      // Ambient presence is a nice-to-have — a failed poll shouldn't surface an error.
    }
  }, [session]);

  // useGatedInterval fires a catch-up tick on every resume, which is what the separate
  // useFocusEffect refetch was doing by hand — so the two collapse into one and the poll stops
  // while blurred or backgrounded instead of running forever.
  useGatedInterval(refetch, POLL_MS);

  return active;
}
