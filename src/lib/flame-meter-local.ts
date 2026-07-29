import AsyncStorage from '@react-native-async-storage/async-storage';

const CELEBRATED_KEY_PREFIX = 'philoi_flame_meter_celebrated_';

// Guards the once-a-day meter-fill cue (sound/haptic) against firing twice. The fire-complete
// celebration screen (lock-in/index.tsx) fires it right at the campfire-pop beat when a Stop
// crosses the daily goal; the home flame-meter widget (flame-meter.tsx) also notices the same
// `just_completed` flag on its next focus and would otherwise replay the cue a second time.
export async function hasCelebratedFlameMeterToday(day: string): Promise<boolean> {
  return (await AsyncStorage.getItem(CELEBRATED_KEY_PREFIX + day)) === 'true';
}

export async function markFlameMeterCelebrated(day: string): Promise<void> {
  await AsyncStorage.setItem(CELEBRATED_KEY_PREFIX + day, 'true');
}
