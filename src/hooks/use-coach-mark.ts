import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { type View } from 'react-native';

import {
  dismissCoachMark,
  presentCoachMark,
  registerCoachAnchor,
  waitForCoachAnchor,
} from '@/components/coach-mark';
import { shouldShowCoachMark, type CoachMarkKey } from '@/lib/coach-marks';

// THE ANCHOR HALF OF A COACH-MARK (CODE_PROMPT_coach_marks.md, CODE_PROMPT_tutorial_lands.md).
//
// A screen attaches the returned ref to the control the tip points at, and gets nothing else to
// think about: no visible state, no conditional render, nothing to clean up. Every rule the spec
// lists — first visit only, never stacked, never blocking — is enforced here or in the host, so a
// surface cannot opt into the behaviour and get it subtly wrong.
//
// ⚠️ IT RETURNS A BARE REF, not an object of ref + flags. A hook that hands back a ref alongside
// render values makes every use of those values in JSX a React Compiler ref-taint error at the call
// site, which is a trap for whoever wires up surface number eight. That is also why the guided
// tour's arrival did NOT change this signature: all seven call sites still just do `ref={theRef}`.
//
// ─────────────────────────── IT NOW DOES TWO JOBS ───────────────────────────
//
// 1. REGISTERS the anchor, so the guided tour (components/coach-tour.tsx) can find and measure a
//    control on a screen it navigated to itself, without that screen knowing a tour exists.
// 2. Offers the CONTEXTUAL tip on first visit — the original behaviour, demoted to the catch-up
//    for surfaces the tour could not reach (see lib/coach-marks.ts).

/**
 * How long after the screen is focused before the tip is offered.
 *
 * 🔴 THIS IS NOT A COSMETIC DELAY, it is what makes the whole thing measurable. Every anchor here
 * is below the fold of an async load — the shop's crate row, the inventory grid, the Forge CTA all
 * render at zero size, or not at all, until their query returns. Measuring on the focus frame would
 * hand the host a rectangle from before layout, i.e. a spotlight over the top-left corner.
 *
 * It also buys the screen's own entrance animation a clear run, so the tip arrives on a settled
 * screen rather than sliding in with it.
 */
const SETTLE_MS = 700;

/**
 * And how long it will KEEP looking after that.
 *
 * 🔴 THE OLD CODE MEASURED EXACTLY ONCE and dropped the tip if that one attempt came back empty —
 * one of the two reasons nothing appeared on the last device build. A single sample at a fixed
 * offset is a bet that the network beat a stopwatch. Retrying is the same bet made repeatedly, and
 * it costs one `measureInWindow` every 120ms for at most a few seconds, on a screen the user is
 * already looking at.
 */
const ANCHOR_WAIT_MS = 4_000;

/**
 * Attach the returned ref to the control this surface's tip points at.
 *
 * Anything measurable works — a host `<View>`, or a `<Pressable>`, which forwards its ref to one.
 * A component that does NOT forward refs must be wrapped in a plain `<View ref={...}
 * collapsable={false}>`; the `collapsable` is load-bearing on Android, where a View with no props
 * of its own is flattened out of the native hierarchy and can no longer be measured.
 *
 * 🔴 EVERY FAILURE PATH IS SILENT AND LEAVES THE MARK UNSEEN. Not signed in far enough, screen
 * still loading, anchor unmounted, anchor scrolled off, another mark already up — all of them just
 * return, and the surface stays a first visit, so the tip gets another go next time the user comes
 * back. The spec's "never blocks" is this paragraph: there is no path from here that can leave
 * something on screen the user did not ask for and cannot get rid of.
 */
export function useCoachMark(key: CoachMarkKey): RefObject<View | null> {
  const ref = useRef<View | null>(null);

  // Deliberately UNGATED BY A DEP ARRAY: it re-runs after every render of the host screen, which is
  // exactly what catches an anchor that only exists once its data arrived — the first inventory
  // tile, the Forge CTA. Setting one map entry is cheaper than the render that preceded it.
  useEffect(() => {
    registerCoachAnchor(key, ref.current);
  });

  // Unregister on the way out, so the tour can never measure a control belonging to a screen that
  // has been gone for two navigations. Separate effect because this one is genuinely keyed on the
  // mark, and folding it into the cleanup above would deregister on every single render.
  useEffect(() => () => registerCoachAnchor(key, null), [key]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const timer = setTimeout(() => {
        shouldShowCoachMark(key)
          .then(async (show) => {
            if (cancelled || !show) return;
            // Keeps looking until the control is laid out, on screen and non-zero — or until it is
            // clear it is not coming, which on this path simply means no tip and no seen-key, so
            // the surface is still a first visit next time.
            const rect = await waitForCoachAnchor(key, ANCHOR_WAIT_MS);
            // Re-read after the awaits: the screen may have been left while the flags were being
            // read or the anchor waited for, and a rectangle from a screen nobody is looking at is
            // a spotlight over whatever replaced it.
            if (cancelled || !rect) return;
            presentCoachMark({ key, rect });
          })
          .catch(() => {});
      }, SETTLE_MS);

      return () => {
        cancelled = true;
        clearTimeout(timer);
        // Leaving this screen takes any mark it raised with it — the rectangle the host is lighting
        // only meant something while this screen was on top of the stack. No-ops unless the mark
        // currently showing is this one.
        dismissCoachMark(key);
      };
    }, [key]),
  );

  return ref;
}
