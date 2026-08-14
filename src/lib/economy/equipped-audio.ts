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
import { getRewardPreferencesSync } from '@/lib/reward-settings';
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
  if (!getRewardPreferencesSync().sound) return;
  const cue = equippedSfxCue(slot);
  if (cue) playRewardSound(cue, volume);
}

/** The Audio environment the user has equipped, if any. */
export function equippedAudioEnvironment(): CatalogItem | undefined {
  return getLoadout().audio;
}

/**
 * Start the equipped ambient loop for a running lock-in, honouring the user's sound preference.
 * No-ops when nothing is equipped, when the mix hasn't shipped, or when sound is off — so a
 * session never gets quieter or louder than the user asked for.
 */
export function startEquippedAmbient(): void {
  if (!getRewardPreferencesSync().sound) return;
  const audio = equippedAudioEnvironment();
  if (!audio || !hasAmbientLoop(audio.id)) return;
  startAmbientLoop(audio.id);
}

export function stopEquippedAmbient(): void {
  stopAmbientLoop();
}
