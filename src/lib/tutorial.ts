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

export async function isTutorialDone(): Promise<boolean> {
  return (await AsyncStorage.getItem(TUTORIAL_DONE_KEY)) === 'true';
}

export async function markTutorialDone(): Promise<void> {
  await AsyncStorage.setItem(TUTORIAL_DONE_KEY, 'true');
}

/** Settings' "Replay tutorial" — clears the flag so the tour can be entered again. */
export async function resetTutorial(): Promise<void> {
  await AsyncStorage.removeItem(TUTORIAL_DONE_KEY);
}
