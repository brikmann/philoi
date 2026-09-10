import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, type RefObject } from 'react';
import { Dimensions, type View } from 'react-native';

import { dismissCoachMark, presentCoachMark } from '@/components/coach-mark';
import { shouldShowCoachMark, type CoachMarkKey } from '@/lib/coach-marks';

// THE ANCHOR HALF OF A COACH-MARK (CODE_PROMPT_coach_marks.md).
//
// A screen attaches the returned ref to the control the tip points at, and gets nothing else to
// think about: no visible state, no conditional render, nothing to clean up. Every rule the spec
// lists — first visit only, never stacked, never blocking — is enforced here or in the host, so a
// surface cannot opt into the behaviour and get it subtly wrong.
//
// ⚠️ IT RETURNS A BARE REF, not an object of ref + flags. A hook that hands back a ref alongside
// render values makes every use of those values in JSX a React Compiler ref-taint error at the call
// site, which is a trap for whoever wires up surface number eight.

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

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const timer = setTimeout(() => {
        shouldShowCoachMark(key)
          .then((show) => {
            if (cancelled || !show) return;
            // Re-read after the await: the screen may have been left while the flags were being
            // read, and a measure on an unmounted node returns nothing useful.
            const node = ref.current;
            if (!node) return;

            node.measureInWindow((x, y, width, height) => {
              if (cancelled) return;
              // A zero-size or not-yet-laid-out anchor measures as 0/0/0/0 or NaN depending on
              // platform. Either way there is nothing to point at.
              if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) return;

              // And an anchor scrolled off the screen would light a hole over the edge of the
              // display. Read at fire time rather than module load so a rotation is accounted for.
              const screen = Dimensions.get('window');
              const onScreen = y + height > 0 && y < screen.height && x + width > 0 && x < screen.width;
              if (!onScreen) return;

              presentCoachMark({ key, rect: { x, y, width, height } });
            });
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
