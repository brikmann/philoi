import { useCallback, useEffect, useRef, useState } from 'react';

import { dismissCindyBubble, fetchCindyBubble, lockInDigest } from '@/lib/api/coach';
import { track } from '@/lib/analytics';

/**
 * Cindy's proactive line during a live lock-in (CINDY_SPEC "Entry points — Lock-in", mock 117 §C
 * Option A: ABOVE the flame, under the header).
 *
 * 🔴 MILESTONES ONLY. This is the one rule that decides whether the feature helps or ruins the
 * screen it lives on. A lock-in exists to be uninterrupted, so she speaks at 30 / 60 / 90 minutes
 * and on a PR — never on a timer, never twice for the same moment, and the line auto-dismisses
 * itself rather than sitting there needing to be closed.
 *
 * Consent-gated end to end: `enabled` false means no line AND no fetch, exactly like the home
 * bubble. Un-consented, this hook is inert.
 */

/** CINDY_SPEC: "fires at milestones only (30 / 60 / 90 min or a PR)". */
const MILESTONE_MINUTES = [30, 60, 90];

/** Long enough to read twice, short enough that it never becomes furniture on the screen. */
const AUTO_DISMISS_MS = 14_000;

export function useCindyLockInLine(input: {
  enabled: boolean;
  sessionId: string | null;
  elapsedSeconds: number;
}) {
  const { enabled, sessionId, elapsedSeconds } = input;
  const [line, setLine] = useState<string | null>(null);
  /** Bumped by notePr(); a PR is a milestone that the clock cannot predict. */
  const [prCount, setPrCount] = useState(0);

  // The highest milestone crossed. Derived rather than stored, so the once-per-milestone rule
  // below compares two numbers instead of trusting a timer to have fired exactly once — this
  // screen re-renders every second, and anything scheduled would have to survive all of them.
  const minutes = Math.floor(elapsedSeconds / 60);
  const milestone = MILESTONE_MINUTES.filter((m) => minutes >= m).pop() ?? 0;

  // What has already been spoken for. `null` until the first run seeds it — see below.
  const firedRef = useRef<{ milestone: number; pr: number } | null>(null);
  const lastMessageRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  const dismiss = useCallback(() => {
    setLine(null);
    // Marks the row this hook overwrote as dismissed, so a stale mid-session line cannot surface
    // later as the home greeting. Failure only means it may reappear on home until the next
    // digest change, which is not worth an error state on a line the user is done with.
    dismissCindyBubble().catch(() => {});
  }, []);

  /** Call when a set comes back a personal record — the unscheduled milestone. */
  const notePr = useCallback(() => setPrCount((n) => n + 1), []);

  useEffect(() => {
    if (!sessionId) return;

    // A second session inside one mount starts from nothing: its clock restarts at zero, so
    // milestones already consumed by the previous one would otherwise silence it forever.
    if (sessionRef.current !== sessionId) {
      sessionRef.current = sessionId;
      firedRef.current = null;
      lastMessageRef.current = null;
    }

    // SEED, don't fire, on the first run of a session. Returning to a session already 45 minutes
    // deep must not spend a generation replaying the 30-minute mark — only milestones crossed
    // while the screen is open are hers to speak on.
    if (firedRef.current === null) {
      firedRef.current = { milestone, pr: prCount };
      return;
    }

    if (!enabled) return;

    const fired = firedRef.current;
    // A PR wins a tie: if both moved in the same render, the specific moment is the better line,
    // and marking the clock milestone consumed is the point — she says ONE thing, not two.
    const cue =
      prCount > fired.pr ? `pr:${prCount}` : milestone > fired.milestone ? `min:${milestone}` : null;
    if (!cue) return;
    firedRef.current = { milestone, pr: prCount };

    let active = true;
    fetchCindyBubble(lockInDigest(sessionId, cue))
      .then((bubble) => {
        if (!active || !bubble) return;
        // Over the daily bubble cap the server replays its last line rather than returning
        // nothing. That is the right call on home; here it would read as Cindy repeating herself
        // at 60 minutes, so an unchanged message is simply not shown.
        if (bubble.message === lastMessageRef.current) return;
        lastMessageRef.current = bubble.message;
        setLine(bubble.message);
        track('cindy_lockin_line', { cue });
      })
      .catch((e) => {
        // Encouragement, not data — a failed fetch means she is quiet at this milestone and the
        // session screen renders exactly as it would without her.
        console.error('[useCindyLockInLine] fetch failed:', e);
      });

    return () => {
      // Only guards against writing a stale response; the line itself is deliberately NOT cleared
      // on a dep change, because this effect re-runs on every milestone and the previous line is
      // still mid-read when the next one is being fetched.
      active = false;
    };
  }, [enabled, sessionId, milestone, prCount]);

  // Auto-dismiss. In a separate effect so the timer restarts on each new line and is cleared on
  // unmount — a session that ends while she is talking must not leave a pending setState.
  useEffect(() => {
    if (!line) return;
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [line, dismiss]);

  return { line: enabled ? line : null, dismiss, notePr };
}
