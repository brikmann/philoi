import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
  fetchMyNotifications,
  fetchUnreadNotificationCount,
  markNotificationsRead,
} from '@/lib/api/notifications';
import { useAuth } from '@/lib/auth/auth-context';
import type { NotificationEvent } from '@/types/database';

// The bell's data. Two shapes on purpose: the badge needs a COUNT everywhere in the app, the feed
// screen needs the ROWS in one place. Fetching the rows just to length them would pull 50 records
// on every header render.
//
// Refreshes on mount and on foreground. Deliberately NOT polled: the count changing a few seconds
// late costs nothing, and a timer per mounted bell would mean a request every few seconds forever
// for a number that is usually zero. Realtime is the eventual answer, not a shorter interval.

export function useNotifications() {
  const { session } = useAuth();
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user.id ?? null;

  const refreshCount = useCallback(async () => {
    // No synchronous setState on the signed-out path — the signed-out ZERO is DERIVED below
    // instead. Setting it here would fire a state update in the effect body before any await,
    // which is the cascading-render pattern react-hooks/set-state-in-effect exists to catch.
    if (!userId) return;
    try {
      setUnread(await fetchUnreadNotificationCount());
    } catch {
      // Ambient. A bell that can't reach the server should render nothing rather than an error —
      // it is a decoration on someone else's screen, not the thing they came for.
    }
  }, [userId]);

  const refreshItems = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchMyNotifications());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  /** What opening the feed does. Clears the badge locally first so the bell responds instantly,
   * then reconciles — the count is cosmetic, so an optimistic zero is safe in a way an optimistic
   * ember balance would not be. */
  const markAllRead = useCallback(async () => {
    setUnread(0);
    try {
      await markNotificationsRead();
      await refreshItems();
    } catch {
      await refreshCount();
    }
  }, [refreshItems, refreshCount]);

  useEffect(() => {
    // The fetch runs inside an async closure rather than as a bare refreshCount() call. The
    // setState genuinely happens after an await either way, but the lint rule is static and
    // cannot see through the callback — and writing it this way is also what lets the stale
    // response be discarded below.
    let current = true;
    (async () => {
      if (!userId) return;
      try {
        const n = await fetchUnreadNotificationCount();
        // Guards a RACE, not an unmount: this cleanup fires on every userId change, so without
        // it a slow response for the previous account could land after a switch and show that
        // account’s count to the new one.
        if (current) setUnread(n);
      } catch {
        // Ambient — see refreshCount.
      }
    })();
    return () => {
      current = false;
    };
  }, [userId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshCount();
    });
    return () => sub.remove();
  }, [refreshCount]);

  // Derived, not stored: signing out must show an empty bell instantly, and deriving it means
  // there is no stale count to clear and no window where the previous account’s number is
  // visible to the next one.
  const signedIn = userId !== null;
  return {
    unread: signedIn ? unread : 0,
    items: signedIn ? items : [],
    loading,
    error,
    refreshCount,
    refreshItems,
    markAllRead,
  };
}
