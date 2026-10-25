import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useGatedInterval } from '@/hooks/use-motion-active';
import { useAuth } from '@/lib/auth/auth-context';
import {
  cheerPresetMeta,
  fetchFriendsLockedIn,
  fetchMyLockInCheers,
  setLockInInboundSurfaceActive,
  subscribeToLockInInbound,
  type FriendLockedIn,
  type LockInInbound,
  type ReceivedCheer,
} from '@/lib/api/lockin-cheers';

// Lock-in cheers (0270) for one screen: who of your friends is live, what you've received this
// session, and the inbound banners. Used by Home (the "friends locked in now" strip) and the
// running timer (the "Locked in with you" cluster).
//
// Realtime does the work; the 30s poll is the floor that clears a friend who just stopped (an
// ended session sends no INSERT) and repairs a dropped socket. Both run only while the screen is
// focused and the app is foregrounded, and Home and the timer are never focused at once, so there
// is at most one subscription per device.

const POLL_MS = 30_000;
const NO_CHEERS: ReceivedCheer[] = [];

export type LockInCheerBanner = {
  id: string;
  name: string;
  avatarUrl: string | null;
  kind: 'cheer' | 'message';
  text: string;
};

export function useLockInCheers({ live, banners: bannersEnabled = false }: { live: boolean; banners?: boolean }) {
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const [friends, setFriends] = useState<FriendLockedIn[]>([]);
  const [cheers, setCheers] = useState<ReceivedCheer[]>([]);
  const [banners, setBanners] = useState<LockInCheerBanner[]>([]);
  const [focused, setFocused] = useState(false);
  // Bumped on every inbound event, so an open thread re-reads the moment a reply lands.
  const [inboundSeq, setInboundSeq] = useState(0);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  const refetch = useCallback(async () => {
    try {
      const [nextFriends, nextCheers] = await Promise.all([
        fetchFriendsLockedIn(),
        liveRef.current ? fetchMyLockInCheers() : Promise.resolve([] as ReceivedCheer[]),
      ]);
      setFriends(nextFriends);
      setCheers(nextCheers);
      return { friends: nextFriends, cheers: nextCheers };
    } catch {
      // Decoration, like presence: a failed read keeps what's on screen and the next tick retries.
      return null;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  useGatedInterval(refetch, POLL_MS, focused && !!me);

  // The OS banner for these pushes is suppressed only while a screen is showing our own.
  useEffect(() => {
    if (!bannersEnabled || !focused) return;
    setLockInInboundSurfaceActive(true);
    return () => setLockInInboundSurfaceActive(false);
  }, [bannersEnabled, focused]);

  useEffect(() => {
    if (!focused || !me) return;
    const onInbound = (e: LockInInbound) => {
      setInboundSeq((n) => n + 1);
      void refetch().then((fresh) => {
        if (!bannersEnabled) return;
        const friend = fresh?.friends.find((f) => f.userId === e.fromUserId);
        const cheer = fresh?.cheers.find((c) => c.fromUserId === e.fromUserId);
        const name = friend?.name ?? cheer?.name ?? 'A friend';
        const avatarUrl = friend?.avatarUrl ?? cheer?.avatarUrl ?? null;
        setBanners((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${e.fromUserId}`,
            name,
            avatarUrl,
            kind: e.kind,
            text: e.kind === 'cheer' ? cheerPresetMeta(e.preset).line : e.body,
          },
        ]);
      });
    };
    return subscribeToLockInInbound(me, onInbound);
  }, [focused, me, bannersEnabled, refetch]);

  const dismissBanner = useCallback((id: string) => {
    setBanners((prev) => prev.filter((b) => b.id !== id));
  }, []);

  /** Optimistic ✓ after a cheer, before the next read confirms it. */
  const markCheered = useCallback((userId: string) => {
    setFriends((prev) => prev.map((f) => (f.userId === userId ? { ...f, iCheered: true } : f)));
  }, []);

  /** Opening a thread reads it; clear its badge without waiting for the poll. */
  const markThreadRead = useCallback((userId: string) => {
    setFriends((prev) => prev.map((f) => (f.userId === userId ? { ...f, unread: 0 } : f)));
  }, []);

  const unreadTotal = friends.reduce((n, f) => n + f.unread, 0);

  // A finished session's cheers never outlive it, even before the next read lands.
  return { friends, cheers: live ? cheers : NO_CHEERS, unreadTotal, banners, inboundSeq, dismissBanner, markCheered, markThreadRead, refetch };
}
