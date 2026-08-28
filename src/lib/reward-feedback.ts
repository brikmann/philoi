import * as Haptics from 'expo-haptics';

import { playEquippedSfx } from '@/lib/economy/equipped-audio';
import { getRewardPreferencesSync } from '@/lib/reward-settings';
import {
  fadeOutRewardSound,
  getRewardSoundDurationMs,
  hasRewardSound,
  playRewardSound,
  stopRewardSound,
  stopRewardSounds,
  type RewardCue,
} from '@/lib/sound';
import type { Rarity } from '@/lib/economy/rarity';
import type { RankTierName } from '@/types/database';

// The full-length anthems, reserved for the two band crossings (RANKUP_SPEC §9). Only the tiers a
// band crossing can land on appear here — Hero (entering the Realm of Legend) and Primordial (the
// apex). If a mix is ever pulled these resolve to a cue with no player, so the celebration falls
// back to the tier's normal hit rather than going silent (see startAscensionAnthem).
const ASCENSION_CUE_BY_TIER: Partial<Record<RankTierName, RewardCue>> = {
  hero: 'ascension-hero',
  primordial: 'ascension-primordial',
};

// Every tier now has its own recording — nothing falls back to the generic 'rankup' hit any more,
// and Olympian has stopped borrowing Diamond's sparkle. Still Partial rather than a full Record
// because the fallback in fireRankUp is the safety net for any tier added to the ladder later.
//
// These are the HITS: they land on the flare and are allowed to ring out under the settling share
// card (RANKUP_SPEC §9 — "do NOT clip the tier hits"). Nothing here is trimmed; the only thing
// that stops one is dismissing the celebration (stopRankUpAudio).
const RANKUP_CUE_BY_TIER: Partial<Record<RankTierName, RewardCue>> = {
  bronze: 'rankup-bronze',
  silver: 'rankup-silver',
  gold: 'rankup-gold',
  platinum: 'rankup-platinum',
  diamond: 'rankup-diamond',
  hero: 'rankup-hero',
  titan: 'rankup-titan',
  olympian: 'rankup-olympian',
  immortal: 'rankup-immortal',
  primordial: 'rankup-primordial',
};

// PROMINENT, not background (RANKUP_SPEC §9). The old mix had this at 0.45, which left the souls
// inaudible under the chime — the whole point is that you hear the dead laughing at you.
const IMMORTAL_SOULS_VOLUME = 0.85;

// expo-haptics itself already degrades gracefully when its native module is missing (it
// resolves via requireOptionalNativeModule and throws a plain UnavailabilityError only when
// actually called, never at import time) — but that throw is inside a Promise these
// fire-and-forget call sites don't await, so an unhandled-rejection warning would still slip
// through without this. Haptics are flavor, not core — never let a missing native module
// surface as a console error.
function safeHaptic(fn: () => Promise<void>): void {
  fn().catch(() => {});
}

// PHILOI_UI_SPEC.md §22 — extends the existing RewardBurst system (ignite/whoosh/settle/
// rankup + reward-settings' sound/haptics toggles) with the specific named moments the spec
// calls out. RewardBurst itself already covers the sound+haptic+Lottie combo for the "settle"
// beat (check-in landed, challenge won) — these are the smaller, more surgical cues for
// moments RewardBurst doesn't fit: starting a session, a progress-bar fill, a lightweight
// confirmation tap, a bare light tap. All of them read the same preferences RewardBurst does,
// so the Settings sound toggle silences everything uniformly.

// Lock in (Start) — "a satisfying ignite cue + a firm haptic." One of the two moments in the
// app that must feel great, so it gets its own firm (not light) impact rather than reusing a
// notification-style haptic, and plays at full volume — it should feel decisive.
export function fireIgnite(): void {
  const prefs = getRewardPreferencesSync();
  if (prefs.reward_sfx_enabled) playRewardSound('ignite');
  if (prefs.haptics) safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  // The equipped START sting (PUNCHLIST_13), LAYERED over the stock ignite rather than replacing
  // it. Lives here rather than at the call site because fireIgnite is already the single "a new
  // session just began" moment — it fires only for a genuinely new session, never on resume, which
  // is exactly the rule the sting needs too. No-ops when the slot is empty, the mix hasn't shipped,
  // or sound is off.
  playEquippedSfx('sfx_start', 0.9);
}

// The done screen's XP bar fill (§13) — "a subtle rising tick/whoosh," timed to the same
// moment the bar starts animating. whoosh.wav is purpose-built for exactly this beat, so it
// plays close to full volume rather than a scaled-down stand-in.
export function fireXpTick(): void {
  const prefs = getRewardPreferencesSync();
  if (prefs.reward_sfx_enabled) playRewardSound('whoosh', 0.85);
  if (prefs.haptics) safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

// A confirming cue on Post (§22's "Done / Post... a confirming cue on Post") — separate from
// the warm settle cue that already fires when the recap first appears. No 5th "confirm" asset
// exists, so per the "reassign the nearest new cue at low volume" guidance this re-uses
// settle, quieter than the arrival cue so the two don't sound identical back to back.
export function fireConfirm(): void {
  const prefs = getRewardPreferencesSync();
  if (prefs.reward_sfx_enabled) playRewardSound('settle', 0.5);
  if (prefs.haptics) safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Whether a band crossing at this tier will actually get its anthem. The celebration asks before
 * committing to the anthem arrangement: if the mix is missing, it falls back to firing the tier's
 * ordinary hit at the crest rather than playing the biggest moment in the app silent. */
export function hasAscensionAnthem(tier: RankTierName): boolean {
  const cue = ASCENSION_CUE_BY_TIER[tier];
  return Boolean(cue && hasRewardSound(cue));
}

/**
 * Start a band crossing's anthem (RANKUP_SPEC §9). Called at the START of the crossing's pre-beat,
 * not at the crest: the track IS the build — it opens with the diamond shatter (Hero) or the void
 * collapse (Primordial) and climaxes on the crest slam, which is exactly why the moment carries no
 * riser under it any more.
 *
 * Plays in full, once. Nothing trims it; stopRankUpAudio (on dismiss/unmount) is the only thing
 * that cuts it short.
 */
export function startAscensionAnthem(tier: RankTierName): void {
  if (!getRewardPreferencesSync().reward_sfx_enabled) return;
  const cue = ASCENSION_CUE_BY_TIER[tier];
  if (!cue || !hasRewardSound(cue)) return;
  // Idempotent: rewind anything already playing so a re-mount can't leave two anthems overlapping
  // (they share one preloaded player, and these run for minutes).
  stopRewardSound(cue);
  playRewardSound(cue, 1);
}

// Everything the moment can have in flight when it's dismissed. The hits ring out on purpose and
// the anthems run for minutes (§9), so leaving the screen has to silence them explicitly.
const RANK_UP_CUES: RewardCue[] = [
  ...(Object.values(RANKUP_CUE_BY_TIER) as RewardCue[]),
  ...(Object.values(ASCENSION_CUE_BY_TIER) as RewardCue[]),
  'rankup',
  'rankup-titan-boom',
  'rankup-immortal-souls',
];

/** Cut every rank-up layer — the tier hit still ringing out, the souls, the anthem. Called when the
 * celebration is dismissed or unmounts. */
export function stopRankUpAudio(): void {
  stopRewardSounds(RANK_UP_CUES);
}

// Rank-up (§9) — the tier HIT, fired on the flare (not at mount) and deliberately left to ring out
// under the settling share card. There is NO riser: the hit is the punch.
//
// isDivisionBump gets the SAME per-tier cue at near-full volume — the incineration's payoff beat is
// "the tier's own rank-up hit lands as the new division locks" (§9), so a Gold II→I plays the Gold
// hit, just a touch under a true crossing.
export function fireRankUp(tier: RankTierName, isDivisionBump = false, isBandCrossing = false): void {
  const prefs = getRewardPreferencesSync();

  // A band crossing's audio is the anthem, and it started back in the pre-beat
  // (startAscensionAnthem) — firing a tier hit on top of its climax would just muddy the crest.
  // If the anthem is missing, fall through and let the tier's own hit carry the moment.
  const anthemCarriesIt = isBandCrossing && hasAscensionAnthem(tier);

  if (prefs.reward_sfx_enabled && !anthemCarriesIt) {
    // NO cosmetic override here, by design (PUNCHLIST_12). This used to play the equipped SFX
    // instead of the tier's own hit, which meant buying a 2-second anvil quietly downgraded
    // Immortal's chime-plus-souls arrangement — the rarest moment in the app made to sound like
    // the most ordinary one. The per-tier layering is the product; the cosmetic stings moved to
    // the start and end of a lock-in, where there was previously no sound to displace.
    playRewardSound(RANKUP_CUE_BY_TIER[tier] ?? 'rankup', isDivisionBump ? 0.9 : 1);

    // Titan's recording is a sub-heavy rumble that a phone speaker simply cannot reproduce (§9) —
    // without an audible transient on top, its crossing reads as SILENT on the exact device
    // everyone will see it on. The boom rides the same frame as the rumble so they read as one
    // colossal slam rather than two sounds.
    if (tier === 'titan') {
      playRewardSound('rankup-titan-boom', isDivisionBump ? 0.8 : 0.95);
    }

    // Immortal's spectral layer (§9) — the "laughter of the damned" sits UNDER the chime but
    // PROMINENT (0.85), not buried, then fades slowly so the voices die away on the same beat the
    // chime does instead of being cut off mid-laugh. Crossings only: on a division bump it would
    // be the loudest thing in an intentionally quiet moment. Slight delay so the hit lands first
    // and the voices bloom behind it rather than competing on the same transient.
    if (tier === 'immortal' && !isDivisionBump) {
      setTimeout(() => {
        playRewardSound('rankup-immortal-souls', IMMORTAL_SOULS_VOLUME);
        // Fade across the clip's own tail. Its length is only known once expo-audio has read the
        // asset's metadata, so fall back to the mixed length (~3.7s) if it isn't loaded yet.
        const soulsMs = getRewardSoundDurationMs('rankup-immortal-souls') ?? 3700;
        const fadeMs = Math.min(1800, soulsMs * 0.55);
        setTimeout(() => fadeOutRewardSound('rankup-immortal-souls', fadeMs), Math.max(0, soulsMs - fadeMs));
      }, 180);
    }
  }

  if (prefs.haptics) {
    // §4's three levels: light / medium+success / heavy → pause → success.
    if (isBandCrossing) {
      safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
      setTimeout(() => safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)), 260);
      return;
    }
    if (isDivisionBump) {
      safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
      return;
    }
    safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
    setTimeout(() => safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)), 120);
  }
}

// The incineration's two lead-in cues (§9's intra-division bump): the white-ray fuse-in, then the
// hellfire that burns the numeral stroke off. Both are existing one-shots — no new assets — and
// both are sound-only, since the bump's single light haptic lands with the tier hit at the end.
export function fireIncinerationFuse(): void {
  if (!getRewardPreferencesSync().reward_sfx_enabled) return;
  playRewardSound('whoosh', 0.8);
}

export function fireIncinerationBurn(): void {
  if (!getRewardPreferencesSync().reward_sfx_enabled) return;
  playRewardSound('ignite', 0.85);
}

// Daily flame meter completion (§5/§22, design-mocks/26) — "reuse the rising whoosh building
// into a short flourish." Full volume, distinct from the done-screen's quieter XP-tick use of
// the same asset, since this is the meter's own once-a-day payoff moment, not a background
// fill sound. Heavy haptic — a genuine daily milestone, not a light confirm.
export function fireFlameMeterComplete(): void {
  const prefs = getRewardPreferencesSync();
  if (prefs.reward_sfx_enabled) playRewardSound('whoosh');
  if (prefs.haptics) safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
}

// Small tiered cue for reactions & pings — "light taps." Haptic-only (a sound on every single
// reaction tap would get noisy fast); routed through here mainly so it respects the same
// haptics-off preference RewardBurst does, which a bare Haptics.impactAsync() call doesn't.
export function fireLightTap(): void {
  if (getRewardPreferencesSync().haptics) safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

// Ember-collection landing tick (§22, design-mocks/27) — a subtle sparkle per ember as it lands
// in the counter, staggered with the particles. Quiet (0.4) since up to 5 of these fire in a
// single burst under 1s apart; a light tap reads as a "tick," not a repeated heavy thud.
export function fireEmberLand(): void {
  const prefs = getRewardPreferencesSync();
  if (prefs.reward_sfx_enabled) playRewardSound('spark', 0.4);
  if (prefs.haptics) safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

// ─────────────────────────── Loot-box opening (PUNCHLIST_14 §2) ───────────────────────────

/**
 * One box cracking in the deal cascade. Quiet, and quiet on purpose: on a ×10 this fires ten
 * times inside about two seconds, so it has to read as a run of cracks rather than a wall of
 * them. Sound-only — ten haptics in two seconds is a buzzing phone, not feedback; the single
 * reveal haptic below is where the hands get involved.
 */
export function fireBoxOpen(): void {
  if (!getRewardPreferencesSync().reward_sfx_enabled) return;
  playRewardSound('box-open', 0.5);
}

const REVEAL_CUE: Record<Rarity, RewardCue> = {
  common: 'reveal-common',
  uncommon: 'reveal-uncommon',
  rare: 'reveal-rare',
  epic: 'reveal-epic',
  legendary: 'reveal-legendary',
  mythic: 'reveal-mythic',
};

/**
 * The per-tier haptic pattern from PUNCHLIST_14 §2's framework: common a light tap, mythic a
 * prolonged shockwave. Written as an explicit sequence per tier rather than "impact of escalating
 * style" because the framework's escalation is in the RHYTHM as much as the strength — rare's
 * "sharp tap + fading buzz" and legendary's "double-thud + decay pulse" are patterns, and a single
 * heavier impact doesn't read as either.
 */
function revealHaptic(rarity: Rarity): void {
  const tap = (style: Haptics.ImpactFeedbackStyle) => safeHaptic(() => Haptics.impactAsync(style));
  const { Light, Medium, Heavy } = Haptics.ImpactFeedbackStyle;
  // Offsets are milliseconds into the sting. They intentionally sit inside each cue's decay so the
  // pulse feels like part of the sound rather than an echo arriving after it.
  const pattern: Record<Rarity, [number, Haptics.ImpactFeedbackStyle][]> = {
    common: [[0, Light]],
    uncommon: [
      [0, Light],
      [90, Light],
    ],
    rare: [
      [0, Medium],
      [140, Light],
      [260, Light],
    ],
    epic: [
      [0, Heavy],
      [180, Medium],
      [320, Light],
    ],
    legendary: [
      [0, Heavy],
      [110, Heavy],
      [400, Medium],
      [700, Light],
    ],
    // The heartbeat: two thuds, a rest, two thuds, trailing off across the 5s aura tail.
    mythic: [
      [0, Heavy],
      [130, Heavy],
      [520, Heavy],
      [650, Heavy],
      [1100, Medium],
      [1600, Light],
    ],
  };
  for (const [delay, style] of pattern[rarity]) {
    if (delay === 0) tap(style);
    else setTimeout(() => tap(style), delay);
  }
}

/**
 * The reveal sting for a haul's BEST pull — once per open, never once per item (§2: "on ×10 the
 * reveal sting plays once for the best pull; the per-box open cue covers the rest").
 *
 * A dupe is played at reduced volume. That rule is doing real work: a dupe auto-salvages to embers
 * rather than granting the item, so letting a duplicate Mythic fire the full war-horn would sell
 * the user a jackpot they did not actually receive. The haptic drops with it for the same reason.
 */
export function fireReveal(rarity: Rarity, dupe = false): void {
  const prefs = getRewardPreferencesSync();
  if (prefs.reward_sfx_enabled) playRewardSound(REVEAL_CUE[rarity], dupe ? 0.4 : 1);
  if (prefs.haptics && !dupe) revealHaptic(rarity);
  else if (prefs.haptics) safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}
