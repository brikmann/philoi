import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchMyDmThreads } from '@/lib/api/dm';
import { useAuth } from '@/lib/auth/auth-context';

// The ✉ badge on the top bar (ss1). Used to live on the bottom bar's Chat slot, which the ShareSpot
// bar dropped (ss3 handoff). Sum of unread across 1:1 threads only — group chats live in Rooms and
// carry their own counts there. Refreshed on focus, same rule as the bell: tabs stay mounted.

export function useDmUnread(): number {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [unread, setUnread] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let live = true;
      fetchMyDmThreads()
        .then((threads) => {
          if (live) setUnread(threads.reduce((n, t) => n + (t.unread ?? 0), 0));
        })
        .catch(() => {
          // Ambient decoration — a failed count draws no badge rather than an error.
        });
      return () => {
        live = false;
      };
    }, [userId])
  );

  return userId ? unread : 0;
}
