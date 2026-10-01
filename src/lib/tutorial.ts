import AsyncStorage from '@react-native-async-storage/async-storage';

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
// 🔴 THE FLAG MEANS "THIS ACCOUNT HAS BEEN OFFERED THE TOUR", NOT "THIS USER WATCHED IT". Skipping
// sets it too. A flag that only set on completion would re-launch the whole tour on the next cold
// start for everyone who skipped — the most annoying thing a first-run experience can do. The
// funnel difference lives in analytics (`tutorial_finished.how`), not here.
//
// 🔴 KEYED PER ACCOUNT, NOT PER DEVICE. The old key was a single device-global
// `philoi_tutorial_done`, seeded to `true` whenever onboarding was done. Two things broke from
// that: onboarding now completes EARLY for brand-new users (markOnboardingDone fires off the auth
// gates, before any campfire), so the seed stamped fresh accounts "tour done" and the launch gate
// never fired; and on any device that had ever held an account the one flag persisted across
// sign-outs, so a second account on the same phone never saw the tour either. Keying the flag by
// user id fixes both: a brand-new account's key is unset, so it reads `false` and the tour fires
// once; a second account on the same device has its own unset key and sees it too.
//
// AsyncStorage rather than a server column, deliberately: the tour has to run on a first cold
// launch with no network (the quality bar says so), and the cost of the rare double-show — a
// reinstall, or a second device — is one skippable tour, against a migration and a round trip on
// the most latency-sensitive screen in the app. `Replay tutorial` in Settings covers the other
// direction.
//
// ⚠️ NO onboarding-based seed any more, on purpose. Seeding "done" from `onboardingDone` is exactly
// what suppressed the tour for new users (their onboarding flips true seconds after sign-in). The
// deliberate trade is that a pre-tutorial upgrader — an account that predates this build — now sees
// the tour once on the first launch after upgrade, because their per-user key is also unset. Erring
// toward showing an existing user the tour once is acceptable; erring toward hiding it from a new
// user is not, and that is the failure this replaces.
const TUTORIAL_DONE_KEY_PREFIX = 'philoi_tutorial_done_';

// The per-account storage key. `userId` is the Supabase auth user id; the root-layout gate and every
// other caller reads it from the live session, so in practice it is always present when the tour is
// being decided. A missing id is treated as "done" so an unauthenticated/edge read can never bounce
// someone into the first-run tour — the gate itself also requires a session, so this is belt-and-braces.
function tutorialDoneKey(userId: string): string {
  return `${TUTORIAL_DONE_KEY_PREFIX}${userId}`;
}

// 🔴 IN-MEMORY FIRST. The tour leaves by navigating (to Home or the paywall) in the same tick it
// marks itself done, and the root layout's gate re-evaluates on that navigation. If "done" only
// existed in AsyncStorage, the gate would still be holding `false` and bounce the user straight back
// into the tour ("See the Flame Pass" → card one again). markTutorialDone records the account here
// SYNCHRONOUSLY, before its storage write, so any check made after it — including the gate's
// re-check right before it redirects — already sees true.
const doneThisSession = new Set<string>();

export async function isTutorialDone(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return true;
  if (doneThisSession.has(userId)) return true;
  return (await AsyncStorage.getItem(tutorialDoneKey(userId))) === 'true';
}

export async function markTutorialDone(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  doneThisSession.add(userId);
  await AsyncStorage.setItem(tutorialDoneKey(userId), 'true');
}

/** Settings' "Replay tutorial" — clears this account's flag so the tour can be entered again. */
export async function resetTutorial(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  doneThisSession.delete(userId);
  await AsyncStorage.removeItem(tutorialDoneKey(userId));
}
