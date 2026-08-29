import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useActiveSession } from '@/lib/active-session-context';
import {
  armFocusNudge,
  disarmFocusNudge,
  focusNudgeArmed,
  focusNudgeRetreats,
  focusNudgeSelectionSize,
  focusNudgeSelectionCounts,
  focusNudgeSupported,
  isFocusNudgeEnabled,
  reconcileFocusNudge,
  refreshNudgeCopy,
} from '@/lib/focus-nudge';
import { GOAL_TYPE_META } from '@/lib/goal-types';

// Renders nothing. Arms the iOS Screen Time shield for the duration of a lock-in and takes it down
// when the session ends (APP_BLOCKER_SPEC §B/§D) — the Focus Nudge counterpart to LiveActivitySync,
// and mounted in _layout for the same reason: the session outlives the lock-in screen. You can
// minimize it, wander to the valley, background the app entirely, and the shield has to stay armed
// through all of it. Anchoring this to a screen would disarm the moment you navigated away.
//
// Copy is fetched HERE, on the way in, not at the moment of drift — the shield extension renders
// synchronously and cannot await a network call. See the invariants in src/lib/focus-nudge.ts.

export function FocusNudgeSync() {
  const { session, loading } = useActiveSession();

  const sessionId = session?.id ?? null;
  const startedAtMs = session ? session.startedAt.getTime() : 0;
  // Same derivation as LiveActivitySync — the user's own words first, the goal label as a fallback.
  const sessionLabel = session
    ? session.goalDetail?.trim() || GOAL_TYPE_META[session.goalType]?.label || null
    : null;

  // What the cached payload was written against, so a foreground does not spend a generation
  // re-asking for a line about a situation that has not moved.
  const writtenForRef = useRef<{ sessionId: string; retreats: number } | null>(null);

  // ARM / DISARM. Keyed on the session's IDENTITY, not the session object — the context replaces
  // that object on every touchConfirmedAt() tick, and re-arming on each one would reset the
  // retreat history mid-session and undo someone's "continue anyway" a few minutes after they
  // asked for it.
  useEffect(() => {
    // The initial fetch has not resolved yet, so `null` here means "don't know", not "nothing
    // running". Acting on it would disarm a live session on every cold start.
    if (loading) return;
    if (!focusNudgeSupported()) return;

    if (!sessionId) {
      // Deliberately unconditional, and deliberately NOT in a cleanup function — cleanup runs on
      // every dep change, not just unmount (the same trap that froze the gym lock-in). This is the
      // cold-start reconciliation: every resolution to "no session" sweeps the shield, whether
      // that is a Stop, a sign-out, or a launch that found nothing running. A shield outliving its
      // session is the only genuinely harmful failure this feature has.
      writtenForRef.current = null;
      disarmFocusNudge();
      return;
    }

    let current = true;
    (async () => {
      if (!(await isFocusNudgeEnabled())) {
        // The global toggle is off. Sweep rather than simply skip, in case it was turned off while
        // a session was already armed.
        if (current) disarmFocusNudge();
        return;
      }
      if (focusNudgeSelectionSize(focusNudgeSelectionCounts()) === 0) return;

      // Copy first, then arm. The gap is small either way, but written-then-armed means the shield
      // can never come up in the window where the payload is still last session's line.
      await refreshNudgeCopy({ sessionLabel, minutesIntoSession: 0 });
      if (!current) return;
      writtenForRef.current = { sessionId, retreats: focusNudgeRetreats() };
      await armFocusNudge();
    })();

    return () => {
      // Only guards against a late write landing after the session changed. The teardown is the
      // `!sessionId` branch above, which is reached when the session actually ends.
      current = false;
    };
    // sessionLabel is deliberately not a dep: it resolves a beat after the session does, and
    // re-running on it would re-arm and wipe the retreat history for a cosmetic string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, sessionId]);

  // ON RETURN TO THE APP. Two jobs, both cheap:
  //   · put the shield back if a "continue anyway" cooldown lapsed while we were away;
  //   · re-ask Cindy if they have drifted since the line was written — that count is what turns
  //     the tone caring rather than pushy (§C-safety), and the cached line was generated before
  //     any of those retreats had happened.
  useEffect(() => {
    if (!sessionId || !focusNudgeSupported()) return;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      reconcileFocusNudge();

      const retreats = focusNudgeRetreats();
      const written = writtenForRef.current;
      if (!written || written.sessionId !== sessionId || retreats <= written.retreats) return;

      writtenForRef.current = { sessionId, retreats };
      refreshNudgeCopy({
        sessionLabel,
        minutesIntoSession: Math.max(0, Math.round((Date.now() - startedAtMs) / 60_000)),
      });
    });

    return () => subscription.remove();
  }, [sessionId, sessionLabel, startedAtMs]);

  return null;
}

/**
 * Whether the lock-in screen should show the "Focus Nudge on" badge (§B).
 *
 * Re-read on foreground rather than polled: the flag only moves when a session arms or disarms,
 * and both of those happen either in this process or while the app is away. A "continue anyway"
 * deliberately does NOT clear it — the nudge is still on for this session, it is just holding its
 * tongue for a few minutes, and flickering the badge off would read as the feature having quit.
 */
export function useFocusNudgeArmed(): boolean {
  const { session } = useActiveSession();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    // One reader for both paths — no session is simply "not armed". Written this way rather than
    // as an early `setArmed(false)` because a bare setState in an effect body is a cascading
    // render, and the lint rule that catches it is right.
    const check = () => setArmed(!!session && focusNudgeSupported() && focusNudgeArmed());
    check();
    if (!session) return;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, [session]);

  return armed;
}
