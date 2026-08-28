import AsyncStorage from '@react-native-async-storage/async-storage';

// Device-local preferences for everything the app does to your senses: sound, haptics, and
// whether the screen is allowed to sleep on you mid-session.
//
// This file is the single definition point for the shared keys named in
// META_BUILD_ORCHESTRATION rule 4 — `session_audio_enabled`, `keep_screen_awake`,
// `reward_sfx_enabled`. Settings owns them; the cosmetics layer (`sound.ts`,
// `equipped-audio.ts`, `lock-in/index.tsx`) reads them. Nothing else should invent its own
// storage key for these, or the toggle in Settings and the behaviour on the device drift apart.
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
  /**
   * @deprecated Read `reward_sfx_enabled` instead — this is the same value under its old name.
   *
   * Kept, and kept in lockstep, because eight call sites across reward-feedback, reward-burst,
   * equipped-audio and use-audio-preview already read `.sound`. Renaming it in place would be a
   * cross-agent edit for zero behaviour change; the integrator can collapse the alias once the
   * parallel branches have landed.
   */
  sound: boolean;
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
  sound: true,
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
    sound: sfx,
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

/** Reward & SFX stings. `sound` moves with it — see the deprecation note on the type. */
export async function setRewardSfxEnabled(enabled: boolean): Promise<void> {
  cache = { ...cache, sound: enabled, reward_sfx_enabled: enabled };
  await AsyncStorage.setItem(SFX_KEY, String(enabled));
}

/** @deprecated Call `setRewardSfxEnabled`. Same key, same effect. */
export const setSoundEnabled = setRewardSfxEnabled;

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

export async function setDuckToMusic(enabled: boolean): Promise<void> {
  cache = { ...cache, duck_to_music: enabled };
  await AsyncStorage.setItem(DUCK_TO_MUSIC_KEY, String(enabled));
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
