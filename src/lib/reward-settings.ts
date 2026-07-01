import AsyncStorage from '@react-native-async-storage/async-storage';

const SOUND_KEY = 'philoi_reward_sound_enabled';
const HAPTICS_KEY = 'philoi_reward_haptics_enabled';

export type RewardPreferences = { sound: boolean; haptics: boolean };

// In-memory cache, kept in sync with AsyncStorage — RewardBurst.fire() reads this
// synchronously so sound/haptic/animation can start on the same frame instead of gating on
// an AsyncStorage read every time a check-in lands.
let cache: RewardPreferences = { sound: true, haptics: true };

export async function loadRewardPreferences(): Promise<RewardPreferences> {
  const [soundRaw, hapticsRaw] = await Promise.all([
    AsyncStorage.getItem(SOUND_KEY),
    AsyncStorage.getItem(HAPTICS_KEY),
  ]);
  cache = {
    sound: soundRaw === null ? true : soundRaw === 'true',
    haptics: hapticsRaw === null ? true : hapticsRaw === 'true',
  };
  return cache;
}

export function getRewardPreferencesSync(): RewardPreferences {
  return cache;
}

export async function setSoundEnabled(enabled: boolean): Promise<void> {
  cache = { ...cache, sound: enabled };
  await AsyncStorage.setItem(SOUND_KEY, String(enabled));
}

export async function setHapticsEnabled(enabled: boolean): Promise<void> {
  cache = { ...cache, haptics: enabled };
  await AsyncStorage.setItem(HAPTICS_KEY, String(enabled));
}
