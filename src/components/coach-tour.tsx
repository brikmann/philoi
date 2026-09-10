import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { presentCoachTourStep, waitForCoachAnchor } from '@/components/coach-mark';
import { revealFloorBusy } from '@/components/economy/reward-reveal';
import { track } from '@/lib/analytics';
import { fetchMyGroups } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
import {
  COACH_TOUR_STEPS,
  hasCoachTourRunThisSession,
  isCoachTourDone,
  markAllCoachMarksSeen,
  markCoachMarkSeen,
  markCoachTourDone,
  noteCoachTourRan,
  setCoachTourActive,
  type CoachTourStep,
} from '@/lib/coach-marks';
import { isTutorialDone } from '@/lib/tutorial';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE GUIDED TOUR DRIVER — CODE_PROMPT_tutorial_lands.md. Client/OTA, no native, no migration.
//
// 🔴 THIS EXISTS BECAUSE THE COACH-MARKS NEVER FIRED ON DEVICE, and the reason they never fired is
// that nothing was DRIVING them. The old design was seven independent screens each hoping to catch
// a first visit at the exact moment its control happened to be laid out, behind a sixty-second
// cooldown that was still running when the user arrived. Every one of those gates was individually
// defensible and collectively unpassable — see the header of lib/coach-marks.ts for the full
// post-mortem.
//
// So the tour stops waiting to be visited. This walks the seven surfaces itself: navigate, wait for
// the target to actually exist, point at it, wait for the user, move on.
//
// ─────────────────────────── THE ONE RULE THAT SHAPES EVERYTHING ───────────────────────────
//
// 🔴 A MISSING TARGET SKIPS ONE STEP. IT NEVER ENDS THE TOUR. The surfaces most likely to have no
// anchor are precisely the ones a brand-new account cannot populate — an empty Forge renders no
// Forge button, an empty inventory has no first tile, an account with no campfire has no ＋. An
// abort on the first absent anchor would mean the tour died two thirds of the way through for
// exactly the users it was written for. And a skipped step is NOT marked seen, so the contextual
// tip (hooks/use-coach-mark.ts) still catches that surface the week the user can finally use it.
//
// 🔒 IT TOUCHES NOTHING. Navigation, seven local flags and three analytics events. It reads one
// query — the user's campfires, to find a ＋ to point at — and writes nothing anywhere.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * How long after landing on Home before the tour begins.
 *
 * Long enough for the tab bar, the flame and the CTA to finish their entrance, short enough that it
 * still reads as part of the same first-run flow rather than as something that ambushed you later.
 * The per-step anchor wait does the real work; this is only about the join.
 */
const START_DELAY_MS = 900;

/**
 * How long to keep looking for each step's target before giving up on it.
 *
 * Generous, because every one of these screens is one navigation plus one query old by the time we
 * look, and the cost of waiting is a beat of nothing on a screen the user can already read, while
 * the cost of being impatient is a step of the tutorial silently missing.
 */
const ANCHOR_WAIT_MS = 5_000;

/** And how long to let a reward celebration have the screen before pressing on regardless. */
const FLOOR_WAIT_MS = 8_000;
const POLL_MS = 150;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Where step `n` lives.
 *
 * Only the campfire ＋ needs resolving: it is inside a specific circle, and which one depends on
 * the account. Null means "this user has nowhere for this step to happen", which is a skip.
 */
async function resolveRoute(step: CoachTourStep, userId: string): Promise<string | null> {
  if (typeof step.route === 'string') return step.route;
  try {
    const groups = await fetchMyGroups(userId);
    // Onboarding forces circle creation, so a fresh account always has one — but "always" here is
    // a claim about another screen's behaviour, and a tutorial must not be the thing that breaks
    // when that changes.
    return groups.length > 0 ? `/group/${groups[0].id}` : null;
  } catch {
    // An offline first run is a first run. Skip the step, keep the tour.
    return null;
  }
}

/** Let any celebration on screen finish; never wait forever for one. */
async function waitForClearScreen(): Promise<void> {
  const deadline = Date.now() + FLOOR_WAIT_MS;
  while (revealFloorBusy() && Date.now() < deadline) await wait(POLL_MS);
}

async function runTour(
  userId: string,
  navigate: (route: string) => void,
  total: number,
): Promise<void> {
  setCoachTourActive(true);
  track('coach_tour_started', { steps: total });

  // The numerator of "3 of 7" counts steps ACTUALLY SHOWN, not position in the plan. A tour that
  // skipped the Forge should read 1, 2, 3, 4, 5 rather than jumping from 4 to 6 — the gap would
  // look like a bug in the tutorial rather than like an empty Forge.
  let shown = 0;
  let skipped = 0;
  let how: 'completed' | 'skipped' | 'interrupted' = 'completed';

  try {
    for (let i = 0; i < COACH_TOUR_STEPS.length; i++) {
      const step = COACH_TOUR_STEPS[i];
      const isLast = i === COACH_TOUR_STEPS.length - 1;

      const route = await resolveRoute(step, userId);
      if (route === null) {
        skipped += 1;
        track('coach_tour_step_skipped', { key: step.key, reason: 'no_route' });
        continue;
      }

      navigate(route);
      const rect = await waitForCoachAnchor(step.key, ANCHOR_WAIT_MS);
      if (rect === null) {
        // Deliberately NOT marked seen — this surface has still never been explained, so the
        // contextual tip should get its go once the control exists.
        skipped += 1;
        track('coach_tour_step_skipped', { key: step.key, reason: 'no_anchor' });
        continue;
      }

      await waitForClearScreen();
      const action = await presentCoachTourStep(step.key, rect, { index: shown + 1, total, isLast });
      if (action === 'unavailable') {
        // Nothing was drawn, so nothing was taught. Leave every key as it was and stop.
        skipped += 1;
        track('coach_tour_step_skipped', { key: step.key, reason: 'no_host' });
        break;
      }

      shown += 1;
      // Shown counts as taught however they left it — they read the line before they pressed
      // anything, and re-showing it later would be the app forgetting a conversation it just had.
      await markCoachMarkSeen(step.key);

      if (action === 'skip') {
        how = 'skipped';
        // Skip means skip: the five surfaces they will not now be walked through must not come
        // back one at a time as contextual tips. See markAllCoachMarksSeen.
        await markAllCoachMarksSeen();
        break;
      }
      if (action === 'interrupted') {
        // They tapped THROUGH the spotlight — the hole is a window, so pressing "Lock in" while it
        // is lit does exactly what pressing "Lock in" does. That is the tutorial working, not
        // failing, and dragging them back out of it would be the rudest thing here could do. The
        // steps not yet reached stay unseen, so the contextual tips pick them up later.
        how = 'interrupted';
        break;
      }
    }
  } finally {
    // 🔴 IN `finally`, because a throw anywhere above with `tourActive` left true would suppress
    // every contextual tip for the rest of the session AND leave the next Home visit trying to
    // start a second tour on top of the first.
    await markCoachTourDone();
    setCoachTourActive(false);
    track('coach_tour_finished', { how, shown, skipped });
  }

  // Back where they started — except when they left on purpose, in which case the screen they
  // chose is the one they should still be looking at.
  if (how !== 'interrupted') navigate('/');
}

/**
 * Mounted once, at the root, beside CoachMarkHost. Renders nothing.
 *
 * The gates are the same three the contextual tips use, minus the cooldown — the tour is the
 * CONTINUATION of the card tour, not an echo of it, and applying the anti-repetition cooldown to
 * the thing that is supposed to run next is the single mistake that made the last build silent.
 */
export function CoachTourDriver() {
  const router = useRouter();
  const pathname = usePathname();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  // The live route, readable from inside the async loop — so a step whose screen is already on
  // top does not get replaced onto itself, which remounts it and throws away the layout we are
  // about to measure.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const runningRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    // 🔴 ONLY EVER STARTS FROM HOME. The tour's first step is Home's own CTA, and starting from
    // anywhere else means yanking somebody out of a screen they opened on purpose — a deep link, a
    // push notification, a share sheet. Home is also where the card tour lands, so the first run
    // reads as one continuous handoff.
    if (pathname !== '/') return;
    if (runningRef.current || hasCoachTourRunThisSession()) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        // Never during onboarding or the card tour. `isTutorialDone` is stamped on SKIP as well as
        // on finish, so somebody who skipped the cards still gets walked through the app.
        if (!(await isTutorialDone())) return;
        if (await isCoachTourDone()) return;
        // Re-checked after the awaits: two Home focuses a frame apart must not launch two tours.
        if (cancelled || runningRef.current || hasCoachTourRunThisSession()) return;

        runningRef.current = true;
        noteCoachTourRan();
        try {
          await runTour(userId, navigateTo(router, pathnameRef), COACH_TOUR_STEPS.length);
        } catch {
          // runTour already restored every flag in its own `finally`; there is nothing left here
          // worth failing over, and a tooltip must never be the thing that takes the app down.
        } finally {
          runningRef.current = false;
        }
      })();
    }, START_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId, pathname, router]);

  return null;
}

/** expo-router does not export its router type by name, and hard-coding a structural one here
 *  would drift the first time the SDK changes a signature. */
type AppRouter = ReturnType<typeof useRouter>;

/** `replace`, not `push`: seven pushes would leave a seven-deep back stack behind the tour. */
function navigateTo(router: AppRouter, pathnameRef: { current: string }) {
  return (route: string) => {
    if (pathnameRef.current === route) return;
    // Written through immediately rather than waiting for usePathname to catch up — the loop
    // navigates and measures inside a single tick, well before the hook re-renders.
    pathnameRef.current = route;
    router.replace(route as Parameters<AppRouter['replace']>[0]);
  };
}
