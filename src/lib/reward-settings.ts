import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { applyAudioInterruptionMode } from '@/lib/sound';

// Device-local preferences for everything the app does to your senses: sound, haptics, and
// whether the screen is allowed to sleep on you mid-session.
//
// This file is the single definition point for the shared keys named in
// META_BUILD_ORCHESTRATION rule 4 — `session_audio_enabled`, `keep_screen_awake`,
// `reward_sfx_enabled`. Settings owns them; the cosmetics layer (`sound.ts`,
// `equipped-audio.ts`, `lock-in/index.tsx`) reads them. Nothing else should invent its own
// storage key for these, or the toggle in Settings and the behaviour on the device drift apart.
//
// Which is exactly what happened while this was six branches, and why lib/session-prefs.ts no
// longer exists. It defined the same two lock-in preferences against the UNPREFIXED key names
// (`session_audio_enabled`, `keep_screen_awake`) while this file wrote the `philoi_`-prefixed
// ones. Both halves were individually correct and the pair was inert: Settings wrote one entry
// and the lock-in screen read another, so every toggle in the Sound & Haptics group did nothing
// at all. Its readers import from here now, and its keep-awake hook is at the bottom of this
// file — a hook over the cache belongs with the cache.
//
// Device-local rather than server-side on purpose. Every one of these is about THIS phone in
// THIS room — whether the speaker should make noise at the gym, whether this display should stay
// lit. Syncing them to the profile would push a gym decision onto a laptop.

const SFX_KEY = 'philoi_reward_sound_enabled';
const HAPTICS_KEY = 'philoi_reward_haptics_enabled';
const SESSION_AUDIO_KEY = 'philoi_session_audio_enabled';
const KEEP_AWAKE_KEY = 'philoi_keep_screen_awake';
const DUCK_TO_MUSIC_KEY = 'philoi_duck_to_music';

export type RewardPreferences = {
  haptics: boolean;
  /** Reward & SFX stings: box opens, rank-ups, lock-in start/stop (mock 164 panel 1). */
  reward_sfx_enabled: boolean;
  /** The equipped ambient loop during a lock-in. Off = Philoi stays silent and you play your own
   * music — the gym case that made this a blocker (COSMETIC_UI_FIXES §6). */
  session_audio_enabled: boolean;
  /** Hold the display on for the duration of a lock-in. A sleeping screen stops the flare
   * animations AND pauses the ambient loop, so this defaults ON (COSMETIC_UI_FIXES §7). */
  keep_screen_awake: boolean;
  /** Duck the ambient under the user's own music instead of talking over it. */
  duck_to_music: boolean;
};

export const DEFAULT_REWARD_PREFERENCES: RewardPreferences = {
  haptics: true,
  reward_sfx_enabled: true,
  session_audio_enabled: true,
  keep_screen_awake: true,
  duck_to_music: true,
};

// In-memory cache, kept in sync with AsyncStorage — RewardBurst.fire() reads this
// synchronously so sound/haptic/animation can start on the same frame instead of gating on
// an AsyncStorage read every time a check-in lands. The lock-in screen reads keep_screen_awake
// the same way, on the frame the session starts.
let cache: RewardPreferences = { ...DEFAULT_REWARD_PREFERENCES };

// A stored value only overrides the default when it is literally 'false'. Anything else —
// missing key, a value written by an older build, a corrupt entry — resolves to the default,
// which is what "on unless you turned it off" means.
function readBool(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw === null || raw === undefined) return fallback;
  return raw !== 'false';
}

export async function loadRewardPreferences(): Promise<RewardPreferences> {
  const entries = await AsyncStorage.multiGet([
    SFX_KEY,
    HAPTICS_KEY,
    SESSION_AUDIO_KEY,
    KEEP_AWAKE_KEY,
    DUCK_TO_MUSIC_KEY,
  ]);
  const stored = Object.fromEntries(entries) as Record<string, string | null>;
  const sfx = readBool(stored[SFX_KEY], DEFAULT_REWARD_PREFERENCES.reward_sfx_enabled);
  cache = {
    reward_sfx_enabled: sfx,
    haptics: readBool(stored[HAPTICS_KEY], DEFAULT_REWARD_PREFERENCES.haptics),
    session_audio_enabled: readBool(stored[SESSION_AUDIO_KEY], DEFAULT_REWARD_PREFERENCES.session_audio_enabled),
    keep_screen_awake: readBool(stored[KEEP_AWAKE_KEY], DEFAULT_REWARD_PREFERENCES.keep_screen_awake),
    duck_to_music: readBool(stored[DUCK_TO_MUSIC_KEY], DEFAULT_REWARD_PREFERENCES.duck_to_music),
  };
  return cache;
}

export function getRewardPreferencesSync(): RewardPreferences {
  return cache;
}

/** Reward & SFX stings: box opens, rank-ups, lock-in start/stop. */
export async function setRewardSfxEnabled(enabled: boolean): Promise<void> {
  cache = { ...cache, reward_sfx_enabled: enabled };
  await AsyncStorage.setItem(SFX_KEY, String(enabled));
}

export async function setHapticsEnabled(enabled: boolean): Promise<void> {
  cache = { ...cache, haptics: enabled };
  await AsyncStorage.setItem(HAPTICS_KEY, String(enabled));
}

export async function setSessionAudioEnabled(enabled: boolean): Promise<void> {
  cache = { ...cache, session_audio_enabled: enabled };
  await AsyncStorage.setItem(SESSION_AUDIO_KEY, String(enabled));
}

export async function setKeepScreenAwake(enabled: boolean): Promise<void> {
  cache = { ...cache, keep_screen_awake: enabled };
  await AsyncStorage.setItem(KEEP_AWAKE_KEY, String(enabled));
}

/**
 * Writing this one also APPLIES it. Every other preference here is read at the moment it matters,
 * but the audio session's interruption mode is set once and then persists until something sets it
 * again — so without this call the switch would be honest only after a cold start, which is the
 * kind of "works, eventually" that reads as broken.
 *
 * sound.ts does not import this module, so this direction adds no cycle.
 */
export async function setDuckToMusic(enabled: boolean): Promise<void> {
  cache = { ...cache, duck_to_music: enabled };
  await AsyncStorage.setItem(DUCK_TO_MUSIC_KEY, String(enabled));
  await applyAudioInterruptionMode(enabled);
}

// ── Synchronous readers for the cosmetics layer ──
//
// Named rather than `getRewardPreferencesSync().whatever` so a grep for the key name finds every
// place the behaviour is actually gated, and so a future move off AsyncStorage touches one file.

/** Gate `startAmbientLoop` on this. False = don't start the loop at all. */
export function isSessionAudioEnabled(): boolean {
  return cache.session_audio_enabled;
}

/** Gate the lock-in screen's keep-awake hold on this. */
export function isKeepScreenAwakeEnabled(): boolean {
  return cache.keep_screen_awake;
}

/** True = lower the ambient under the user's music rather than playing over it. */
export function shouldDuckToMusic(): boolean {
  return cache.duck_to_music;
}

/** Gate reward/SFX one-shots on this. */
export function isRewardSfxEnabled(): boolean {
  return cache.reward_sfx_enabled;
}

/**
 * The keep-awake preference as a hook, re-read whenever the lock-in screen regains focus.
 *
 * Focus is the right invalidation point and not a shortcut: the only way to change this is to walk
 * to Settings and back, so the screen sees the new value the moment the user returns to a session
 * that is still running.
 *
 * Seeds from the cache rather than from `true`. The cache is warmed in _layout on boot and every
 * write goes through it, so by the time any lock-in screen mounts it holds the real value — where
 * the old unprefixed module had to guess, because its own read was async and there was no cache to
 * ask. Guessing ON was the safe guess (the failure that costs a session is the display sleeping,
 * not it staying lit a beat longer) but it also meant a user who had turned this OFF still got one
 * frame of wake lock on every mount.
 */
export function useKeepScreenAwakePref(): boolean {
  const [enabled, setEnabled] = useState(isKeepScreenAwakeEnabled);

  useFocusEffect(
    useCallback(() => {
      setEnabled(isKeepScreenAwakeEnabled());
    }, []),
  );

  return enabled;
}
