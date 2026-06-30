import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_DONE_KEY = 'philoi_onboarding_done';

// Once true, stays true forever for this device — even if the user later deletes/leaves
// every circle, they're a returning user, not a first-timer, and shouldn't be forced
// back into the guided flow.
export async function isOnboardingDone(): Promise<boolean> {
  return (await AsyncStorage.getItem(ONBOARDING_DONE_KEY)) === 'true';
}

export async function markOnboardingDone(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_DONE_KEY, 'true');
}
