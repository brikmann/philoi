import { useCallback, useEffect, useRef, useState } from 'react';

import { useGatedInterval, useMotionActive } from '@/hooks/use-motion-active';
import {
  beatLockInPresence,
  endLockInPresence,
  fetchLockInPresence,
  presenceCountFor,
  subscribeToLockInPresence,
} from '@/lib/api/lockin-presence';
import type { LockInPresence } from '@/types/database';

/**
 * One beat covers three, so a phone that misses two in a row is still counted. Anything shorter
 * wakes the radio for no gain; anything longer and the 90s reaper starts dropping people who are
 * sitting right there.
 */
const BEAT_MS = 45_000;

/**
 * The live "locked in with you" count for the session on screen.
 *
 * ── WHAT MAKES THIS CHEAP ──────────────────────────────────────────────────────────────────
 *
 * Nothing here polls for the number. There are exactly two recurring costs while a lock-in runs:
 *
 *   1. ONE 45s timer, which beats the heartbeat and refreshes the windowed number. It is a
 *      `useGatedInterval`, so it stops dead on blur or background and fires a catch-up tick the
 *      moment the screen comes back — which is also what re-registers presence after a member
 *      backgrounds long enough to be reaped.
 *   2. A broadcast subscription, which is idle until the server has something new to say. The
 *      server sends one coalesced message to the whole channel on a 30s wall-clock tick and only
 *      when the count changed, so a quiet half-hour is zero messages and zero re-renders.
 *
 * The 45s timer does both jobs rather than running a heartbeat clock and a refetch clock side by
 * side: two timers is twice the wakeups, and it also removes a race — the beat lands before the
 * read, so the first number a member sees already includes them.
 *
 * ── WHAT MAKES IT FEEL INSTANT ─────────────────────────────────────────────────────────────
 *
 * The gated interval's catch-up tick IS the instant-on-join fetch. The pill has a real number in
 * it on the first frame after mount rather than sitting blank for up to 30s waiting for the next
 * global tick. After that one read it just rides the shared broadcasts.
 */
export function useLockInPresence(sessionId: string | null): LockInPresence | null {
  const [presence, setPresence] = useState<LockInPresence | null>(null);
  /**
   * The most recent broadcast number, tagged with the room it was about.
   *
   * The tag is what makes this safe without a reset effect: a push belongs to one (topic, key),
   * so when the member's scope widens or they start a different kind of session, the stale push
   * simply stops matching and is ignored. Clearing it in an effect instead would be a setState in
   * an effect body — a cascading render on the one screen that is expected to sit still.
   */
  const [pushed, setPushed] = useState<{ topic: string; key: string; count: number } | null>(null);
  const active = useMotionActive();

  // Every async read carries the session it was issued for. A response that lands after the
  // member has stopped and started something else would otherwise overwrite the new session's
  // line with the old one's — and unlike a stale list, a stale COUNT looks perfectly plausible,
  // so it would never be noticed.
  const forRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    forRef.current = sessionId;
    try {
      await beatLockInPresence(sessionId);
      const next = await fetchLockInPresence();
      if (forRef.current !== sessionId) return;
      setPresence(next);
    } catch {
      // Ambient social proof. A failed read leaves the last good line on screen (or nothing at
      // all on the first one) — there is nothing to tell the member and nothing they could do,
      // and an error toast over a running lock-in would be a worse outcome than no number.
    }
  }, [sessionId]);

  useGatedInterval(refresh, BEAT_MS, !!sessionId);

  const topic = presence?.display === 'count' && presence.live ? presence.topic : null;
  const key = presence?.display === 'count' ? presence.key : null;

  useEffect(() => {
    // 🔴 Subscribe only while this screen is focused and the app is foregrounded. `active` is a
    // dependency rather than a check inside, so blurring actually tears the channel down: a
    // subscription held open behind three other screens is the cost this design exists to avoid.
    if (!topic || !key || !active) return;
    return subscribeToLockInPresence(topic, (counts) => {
      setPushed({ topic, key, count: presenceCountFor(key, counts) });
    });
  }, [topic, key, active]);

  // The goodbye, and the one place in this file where "cleanup runs on every dependency change,
  // not only on unmount" is the feature rather than the trap: this cleanup ends the session it
  // was CREATED with, so a stop (id -> null) and a switch (A -> B) both say goodbye to exactly
  // the right one. Ending presence for whatever the current id happens to be would cancel the new
  // session the instant it started.
  useEffect(() => {
    if (!sessionId) return;
    return () => {
      endLockInPresence(sessionId).catch(() => {});
    };
  }, [sessionId]);

  if (!presence) return null;
  // A broadcast only ever replaces a LIVE number. A 'today' or 'this week' count is a different
  // question with a different answer, and swapping in concurrency under that label would make the
  // label a lie — the refresh above is what moves those.
  if (
    presence.display === 'count' &&
    presence.live &&
    pushed !== null &&
    pushed.topic === presence.topic &&
    pushed.key === presence.key
  ) {
    return { ...presence, count: pushed.count };
  }
  return presence;
}
