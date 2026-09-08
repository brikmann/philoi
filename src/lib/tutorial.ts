import AsyncStorage from '@react-native-async-storage/async-storage';

import { isOnboardingDone } from '@/lib/onboarding';

const FIRST_LOCK_IN_TUTORIAL_DONE_KEY = 'philoi_first_lock_in_tutorial_done';

// Deliberately independent of onboarding.ts's flag — a user who finished circle-creation
// onboarding but skipped locking in ("I'll lock in later") should still see this the first
// time they actually reach the lock-in screen, whichever route got them there. Only flips to
// true once they complete a real lock-in (see lock-in.tsx's handleStop), not merely once
// they've dismissed the tooltip chrome.
export async function isFirstLockInTutorialDone(): Promise<boolean> {
  return (await AsyncStorage.getItem(FIRST_LOCK_IN_TUTORIAL_DONE_KEY)) === 'true';
}

export async function markFirstLockInTutorialDone(): Promise<void> {
  await AsyncStorage.setItem(FIRST_LOCK_IN_TUTORIAL_DONE_KEY, 'true');
}

// ─────────────────────────── The full first-run tour (CODE_PROMPT_tutorial.md) ───────────────────────────
//
// Separate from the lock-in tooltip above and from onboarding.ts's flag, and all three have to
// stay separate: onboarding is the username/university/consent gate, the tooltip is a two-step
// nudge on one screen, and this is the twenty-card tour that runs between them.
//
// 🔴 THE FLAG MEANS "THIS DEVICE HAS BEEN OFFERED THE TOUR", NOT "THIS USER WATCHED IT". Skipping
// sets it too. A flag that only set on completion would re-launch the whole tour on the next cold
// start for everyone who skipped — the most annoying thing a first-run experience can do. The
// funnel difference lives in analytics (`tutorial_finished.how`), not here.
//
// AsyncStorage rather than a server column, deliberately: the tour has to run on a first cold
// launch with no network (the quality bar says so), and the cost of the rare double-show — a
// reinstall, or a second device — is one skippable tour, against a migration and a round trip on
// the most latency-sensitive screen in the app. `Replay tutorial` in Settings covers the other
// direction.
const TUTORIAL_DONE_KEY = 'philoi_tutorial_done';
/** Set the first time this build ever boots, whatever `seedForExistingInstall` decided. */
const TUTORIAL_SEEDED_KEY = 'philoi_tutorial_seeded';

/**
 * 🔴 AN INSTALL THAT PREDATES THE TUTORIAL HAS ALREADY "BEEN OFFERED" IT.
 *
 * THE COLLISION THIS EXISTS TO PREVENT. `philoi_tutorial_done` is a new key, so on the first launch
 * of the build that introduces it, EVERY existing install reads `false` and the root layout's gate
 * does `router.replace('/tutorial')`. That is the same first foreground on which 0176's backfill has
 * deliberately left exactly one relic unseen — the last-24h carve-out — so `RelicUnlockWatcher`
 * raises a full-screen Modal over the tour on the very frame the tour is being replaced in.
 *
 * Nothing arbitrates between them: `useRevealFloor` orders reveals against OTHER reveals, and a
 * route replace is not a floor participant. And the relic side is ONE-SHOT AND NON-REPEATABLE —
 * dismissing stamps `mark_relic_unlock_seen`, there is no second Pheidippides, and the only way
 * back is another live threshold crossing, which is precisely the wait the carve-out existed to
 * avoid. Two one-shot acceptance tests racing on one frame loses at least one of them.
 *
 * ⚠️ WHY THIS IS NOT SIMPLY "SEED WHEN ONBOARDING IS DONE", which is the obvious version and is
 * wrong. `onboardingDone` is ALSO true for a brand-new user moments after they create their first
 * campfire — `markOnboardingDone` fires off `hasCircle` — so keying on it alone would suppress the
 * tour for genuine first runs and quietly delete the launch gate.
 *
 * The signal that actually separates them is TIME, not state: at the instant this build first
 * boots, an install that predates it ALREADY has onboarding complete, whereas a new install has it
 * false and only flips it later in that same session. So this runs exactly once, ever, and reads
 * onboarding as it stood on that first boot.
 *
 * Deliberately folded into the read below rather than exposed as a separate call the root layout
 * has to remember to make first: ordering it wrongly would reintroduce the race, and there is no
 * way to order it wrongly if every read seeds first.
 */
async function seedForExistingInstall(): Promise<void> {
  if ((await AsyncStorage.getItem(TUTORIAL_SEEDED_KEY)) === 'true') return;
  if (await isOnboardingDone()) {
    await AsyncStorage.setItem(TUTORIAL_DONE_KEY, 'true');
  }
  // Stamped whichever way it went, so this can never run a second time — which is also what keeps
  // Settings' "Replay tutorial" working: it clears the done flag, and this does not put it back.
  await AsyncStorage.setItem(TUTORIAL_SEEDED_KEY, 'true');
}

export async function isTutorialDone(): Promise<boolean> {
  await seedForExistingInstall();
  return (await AsyncStorage.getItem(TUTORIAL_DONE_KEY)) === 'true';
}

export async function markTutorialDone(): Promise<void> {
  await AsyncStorage.setItem(TUTORIAL_DONE_KEY, 'true');
}

/** Settings' "Replay tutorial" — clears the flag so the tour can be entered again. */
export async function resetTutorial(): Promise<void> {
  await AsyncStorage.removeItem(TUTORIAL_DONE_KEY);
}
