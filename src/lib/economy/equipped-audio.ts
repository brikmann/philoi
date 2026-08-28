// The equipped Audio / SFX slots, resolved to playable cues.
//
// All 10 cosmetic audio files are in assets/audio/cosmetic/, named by catalog id — 6 looping
// ambient environments for the Audio slot and 4 one-shot stings shared by the two SFX slots
// (start and end). Both are live.
//
// The `hasRewardSound` / `hasAmbientLoop` guards stay anyway. They aren't scaffolding for missing
// files; they're what keeps an equipped-but-unshipped item (a future season's SFX, an item granted
// by a newer server build than the installed app) falling back to the stock cue instead of
// producing silence where something loud was expected.

import type { CatalogItem, SfxSlot } from '@/lib/economy/catalog';
import { getLoadout } from '@/lib/economy/loadout';
import { getRewardPreferencesSync, isSessionAudioEnabled } from '@/lib/reward-settings';
import {
  hasAmbientLoop,
  hasRewardSound,
  playRewardSound,
  startAmbientLoop,
  stopAmbientLoop,
  type RewardCue,
} from '@/lib/sound';

/**
 * The sting equipped to one of the two lock-in SFX slots, or undefined when that slot is empty.
 *
 * Rescoped by PUNCHLIST_12: this used to be `equippedRankUpCue()` and the rank-up path played it
 * INSTEAD of the stock per-tier hit. That was the wrong trade — the layered per-tier arrangement
 * (RANKUP_SPEC) is the most deliberate audio in the app, and a 2-second anvil replacing Immortal's
 * chime-plus-souls made the rarest moment sound cheaper than an ordinary one. Rank-up is now never
 * overridden; these fire on session START and END instead, which is a beat that had no sound at all.
 *
 * No mapping table: each SFX cosmetic's cue name IS its catalog id (see the sfx-* entries in
 * sound.ts's RewardCue union), so a new SFX item needs only its file. The `hasRewardSound` guard
 * stays regardless — an item whose asset hasn't shipped stays silent rather than throwing.
 */
export function equippedSfxCue(slot: SfxSlot): RewardCue | undefined {
  const sfx = getLoadout()[slot];
  if (!sfx) return undefined;
  const cue = sfx.id as RewardCue;
  return hasRewardSound(cue) ? cue : undefined;
}

/**
 * Play the start-of-lock-in sting, layered over the stock `ignite` tap rather than replacing it.
 *
 * Layered on purpose: `ignite` is half of what makes the start beat feel decisive (§22), and a
 * cosmetic that silenced it would make equipping one feel like a downgrade on every device where
 * the sting is quiet.
 */
export function playEquippedSfx(slot: SfxSlot, volume = 1): void {
  if (!getRewardPreferencesSync().reward_sfx_enabled) return;
  const cue = equippedSfxCue(slot);
  if (cue) playRewardSound(cue, volume);
}

/** The Audio environment the user has equipped, if any. */
export function equippedAudioEnvironment(): CatalogItem | undefined {
  return getLoadout().audio;
}

// ───────────────────────── this session's audio (COSMETIC_UI_FIXES §6.2) ─────────────────────
//
// The equipped Audio item is the DEFAULT, not the decree. "Change between sessions" is a real ask:
// the environment you want for a 6am study block is not the one you want mid-workout, and equipping
// is a trip to the inventory screen you are not going to take while standing at a squat rack. So
// the lock-in start sheet writes a choice here and the loop honours it for that session only.
//
// Module state rather than storage, deliberately — it is scoped to ONE session by definition, and a
// persisted "this session" that outlived its session would be the equipped slot with extra steps.
// `startAmbientLoop` is already idempotent per id, so this is purely which id it is handed.

/** The sentinel for "None — my own music": explicitly silent, which is NOT the same as "unset" and
 *  must not fall through to the equipped item. That distinction is the whole feature. */
export const SESSION_AUDIO_NONE = 'none';

/** `undefined` = no choice made, use whatever is equipped. */
let sessionAudioChoice: string | undefined;

/** Called by the start sheet on every lock-in, so a choice can never leak into the next session by
 *  simply not being overwritten. */
export function setSessionAudioChoice(choice: string | undefined): void {
  sessionAudioChoice = choice;
}

export function getSessionAudioChoice(): string | undefined {
  return sessionAudioChoice;
}

/** Cleared when a session actually ends — NOT inside stopEquippedAmbient(), which also runs as the
 *  cleanup of LoadoutSync's effect on the very render that STARTS a session. Clearing there would
 *  wipe the choice the start sheet had just made, milliseconds before it was read. */
export function clearSessionAudioChoice(): void {
  sessionAudioChoice = undefined;
}

/** The id this session should loop, or null for silence. Exported so the lock-in UI can say which
 *  environment is running without duplicating the precedence rules. */
export function sessionAmbientId(): string | null {
  if (sessionAudioChoice === SESSION_AUDIO_NONE) return null;
  const id = sessionAudioChoice ?? equippedAudioEnvironment()?.id;
  return id && hasAmbientLoop(id) ? id : null;
}

/**
 * Start this session's ambient loop, honouring — in order — the reward sound preference, the
 * "Session audio" setting, and this session's own choice.
 *
 * Synchronous: both gates read reward-settings' in-memory cache, which _layout warms on boot. It
 * was briefly async, back when `session_audio_enabled` was its own uncached AsyncStorage read in
 * lib/session-prefs.ts — that module turned out to be reading a different key than Settings wrote,
 * and folding it into the cache took the await with it.
 *
 * The `session_audio_enabled` check is the one that matters most. People lock in at the gym with
 * their own music on, and until now the only way to stop Philoi adding a bonfire crackle over the
 * top of it was to unequip the cosmetic entirely.
 */
export function startEquippedAmbient(): void {
  if (!getRewardPreferencesSync().reward_sfx_enabled) return;
  if (!isSessionAudioEnabled()) return;
  const id = sessionAmbientId();
  if (!id) return;
  startAmbientLoop(id);
}

export function stopEquippedAmbient(): void {
  stopAmbientLoop();
}
