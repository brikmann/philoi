import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

// The two lock-in preferences the COSMETICS layer has to obey (COSMETIC_UI_FIXES §6, §7).
//
// OWNERSHIP NOTE FOR THE INTEGRATOR (META_BUILD_ORCHESTRATION rule 4): the Settings pass defines
// these two keys and writes them; this file only ever READS them. They are named exactly as agreed
// — `session_audio_enabled` and `keep_screen_awake` — so the toggle Settings ships and the
// behaviour here bind to the same storage entry with no coordination beyond the name.
//
// DELIBERATELY UNCACHED, unlike reward-settings' in-memory mirror. That module caches because
// RewardBurst.fire() has to read a preference synchronously on the frame a check-in lands. Neither
// of these is on a frame budget: the ambient loop is consulted once when a session starts, and the
// wake lock once when the lock-in screen mounts. Reading AsyncStorage at those two moments costs
// nothing and buys the one property a second cache could not have — it cannot go stale against
// whatever Settings just wrote, because there is no second copy of the value anywhere.

/** "Play your equipped ambient during lock-ins." Default ON. */
export const SESSION_AUDIO_ENABLED_KEY = 'session_audio_enabled';

/** "Hold the display on during a session." Default ON — a sleeping screen kills the flare AND the
 *  ambient loop at once, which is the bug this preference exists to prevent (§7). */
export const KEEP_SCREEN_AWAKE_KEY = 'keep_screen_awake';

/** Absent means "never set", which is ON for both of these. A storage read that throws is treated
 *  the same way: the default behaviour is the one the app shipped with. */
async function readFlag(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) !== 'false';
  } catch {
    return true;
  }
}

export function isSessionAudioEnabled(): Promise<boolean> {
  return readFlag(SESSION_AUDIO_ENABLED_KEY);
}

export function isKeepScreenAwakeEnabled(): Promise<boolean> {
  return readFlag(KEEP_SCREEN_AWAKE_KEY);
}

/**
 * The keep-awake preference as a hook, re-read whenever the screen regains focus.
 *
 * Focus is the right invalidation point and not a shortcut: the only way to change this is to walk
 * to Settings and back, so the lock-in screen sees the new value the moment the user returns to a
 * session that is still running. Starts `true` so the screen holds itself awake from the first
 * frame and only ever releases the lock if the user has actually turned it off — the failure that
 * costs a session is the one where the display sleeps, not the one where it stays on a beat longer.
 */
export function useKeepScreenAwakePref(): boolean {
  const [enabled, setEnabled] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      isKeepScreenAwakeEnabled().then((value) => {
        if (!cancelled) setEnabled(value);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  return enabled;
}
