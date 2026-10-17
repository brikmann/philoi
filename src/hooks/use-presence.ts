import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppActive } from '@/hooks/use-motion-active';
import { fetchPresence } from '@/lib/api/presence';
import type { PresenceRow } from '@/types/database';

// Live status for every user a screen is painting, in ONE get_presence call — the same batching
// usePublicLoadouts does for gear, so a 13-row board costs one request, not thirteen.
//
// Re-read on focus and every POLL_MS while the screen is focused and the app is foregrounded. A
// badge has to CLEAR when someone stops, and polling the visible set is what bounds that: at most
// POLL_MS after the session ends, the next read comes back locked_in = false.
//
// Screen-only: useFocusEffect needs a navigation context (see the note on
// useRefreshPublicLoadoutsOnFocus). Leaf components take a PresenceRow prop instead.

const POLL_MS = 45_000;

export function usePresence(userIds: (string | null | undefined)[]): Record<string, PresenceRow> {
  const key = useMemo(() => Array.from(new Set(userIds.filter(Boolean) as string[])).sort().join(','), [userIds]);
  const [byId, setById] = useState<Record<string, PresenceRow>>({});
  const [focused, setFocused] = useState(false);
  const appActive = useAppActive();
  const latest = useRef(key);
  useEffect(() => {
    latest.current = key;
  }, [key]);

  const load = useCallback(() => {
    const ids = latest.current ? latest.current.split(',') : [];
    if (ids.length === 0) return;
    fetchPresence(ids)
      .then((rows) => {
        // Only the latest request's ids are replaced. A user missing from the response (deleted,
        // disabled) is reset to nothing rather than left glowing from an older read.
        setById((prev) => {
          const next = { ...prev };
          for (const id of ids) delete next[id];
          for (const r of rows) next[r.user_id] = r;
          return next;
        });
      })
      // Presence is decoration. A failed read keeps whatever was on screen and the next tick retries.
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  // A new visible set (scope switch, search results) and every focus/foreground both read now.
  useEffect(() => {
    if (!focused || !appActive || !key) return;
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [focused, appActive, key, load]);

  return byId;
}

/** Single-user convenience for a profile header. */
export function usePresenceOf(userId: string | null | undefined): PresenceRow | undefined {
  const map = usePresence([userId]);
  return userId ? map[userId] : undefined;
}
