import { useCallback, useEffect, useState } from 'react';

import { bubbleDigest, dismissCindyBubble, fetchCindyBubble, type CoachBubble } from '@/lib/api/coach';

/**
 * Cindy's proactive home message (CINDY_SPEC "Channel 1 — HOME", mock 115 frame 1).
 *
 * 🔴 This is the WARM channel and only the warm channel. It cannot render the protective voice:
 * the server hardcodes surface='home' for this row, and the home routing block contains no
 * pushback instructions at all. The heavy voice lives at the social intercept, where it is earned.
 *
 * Fetched on a DIGEST rather than on an interval. Home mounts constantly — on every tab switch,
 * every back-navigation — and regenerating there would be both expensive and incoherent (a
 * different greeting each time you swipe). The digest covers exactly the facts that would change
 * the message, so the line is stable while the day is, and refreshes the moment it isn't.
 */
export function useCindyBubble(input: {
  enabled: boolean;
  streak: number;
  todayCount: number;
  inSession: boolean;
}) {
  const { enabled, streak, todayCount, inSession } = input;
  const [bubble, setBubble] = useState<CoachBubble | null>(null);

  // Bucketed to the nearest 3 hours so "morning" vs "evening" moves the message, but a minute
  // ticking over never does.
  const hourBucket = Math.floor(new Date().getHours() / 3);
  const digest = bubbleDigest({ streak, todayCount, inSession, hourBucket });

  useEffect(() => {
    // Disabled is handled by DERIVING the return value below, not by clearing state here — a
    // synchronous setState in an effect body causes a cascading render, and the lint rule that
    // catches it is right: there is nothing to store when the feature is off.
    if (!enabled) return;

    let active = true;

    fetchCindyBubble(digest)
      .then((next) => {
        // The flag is checked here rather than in a cleanup that clears state: this effect
        // re-runs whenever the digest changes, and clearing on every dep change would blank a
        // perfectly good bubble mid-day. All we need is to not write a stale response.
        if (active) setBubble(next);
      })
      .catch((e) => {
        // The bubble is encouragement, not data — a failed fetch just means Cindy is quiet this
        // time, and Home renders exactly as it would without her.
        console.error('[useCindyBubble] fetch failed:', e);
        if (active) setBubble(null);
      });

    return () => {
      active = false;
    };
  }, [enabled, digest]);

  const dismiss = useCallback(async () => {
    setBubble(null);
    try {
      await dismissCindyBubble();
    } catch {
      // A failed dismiss only means it may come back on the next digest change — not worth an
      // error state on a decoration the user just asked to go away.
    }
  }, []);

  return { bubble: enabled ? bubble : null, dismiss };
}
