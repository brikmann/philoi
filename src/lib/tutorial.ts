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
