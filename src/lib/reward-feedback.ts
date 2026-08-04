import * as Haptics from 'expo-haptics';

import { getRewardPreferencesSync } from '@/lib/reward-settings';
import { playRewardSound, stopRewardSound, type RewardCue } from '@/lib/sound';
import type { RankTierName } from '@/types/database';

// Per-tier cue (PHILOI_UI_SPEC.md §11/§22, design-mocks/31) — selected by the tier reached.
// Bronze has an entry because a division bump *within* bronze (e.g. III->II) still needs its
// own soft cue, even though there's no "crossing INTO bronze" full-forge scenario (it's the
// starting tier).
//
// Deliberately Partial: an unmapped tier falls back to the generic 'rankup' hit in fireRankUp
// below, which is what platinum has always done. Only five bespoke recordings exist, so of the
// four legend tiers added in the 0063 rework only Olympian gets its own (a bright celestial
// sparkle that was already in assets/ but never wired) — hero/titan/immortal share the generic
// cue until dedicated audio is commissioned. They're visually distinct via TIER_FLASH_KIND;
// it's only the sound that doubles up.
const RANKUP_CUE_BY_TIER: Partial<Record<RankTierName, RewardCue>> = {
  bronze: 'rankup-bronze',
  silver: 'rankup-silver',
  gold: 'rankup-gold',
  diamond: 'rankup-diamond',
  olympian: 'rankup-olympian',
  primordial: 'rankup-primordial',
};

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
  if (prefs.sound) playRewardSound('ignite');
  if (prefs.haptics) safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

// The done screen's XP bar fill (§13) — "a subtle rising tick/whoosh," timed to the same
// moment the bar starts animating. whoosh.wav is purpose-built for exactly this beat, so it
// plays close to full volume rather than a scaled-down stand-in.
export function fireXpTick(): void {
  const prefs = getRewardPreferencesSync();
  if (prefs.sound) playRewardSound('whoosh', 0.85);
  if (prefs.haptics) safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

// A confirming cue on Post (§22's "Done / Post... a confirming cue on Post") — separate from
// the warm settle cue that already fires when the recap first appears. No 5th "confirm" asset
// exists, so per the "reassign the nearest new cue at low volume" guidance this re-uses
// settle, quieter than the arrival cue so the two don't sound identical back to back.
export function fireConfirm(): void {
  const prefs = getRewardPreferencesSync();
  if (prefs.sound) playRewardSound('settle', 0.5);
  if (prefs.haptics) safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

// Rank-up (§11/§21/§22) — the loudest cue, timed to the forge's solidify flare rather than
// the moment the screen mounts (the ~5s sequence's flare beat, not its opening frame).
// Primordial is "the biggest" — an extra follow-up thump on top of the normal heavy impact.
//
// isDivisionBump gets the SAME per-tier cue, just scaled down (§22: "every rank-up is rewarded,
// scaled down") — a within-tier bump (e.g. Bronze III->II) still deserves its own tier's sound,
// just softer and without Primordial's extra thump (Primordial has no divisions, so that path is
// only ever reached by Bronze-Immortal).
export function fireRankUp(tier: RankTierName, isDivisionBump = false): void {
  const prefs = getRewardPreferencesSync();
  const cue = RANKUP_CUE_BY_TIER[tier] ?? 'rankup';
  if (prefs.sound) playRewardSound(cue, isDivisionBump ? 0.55 : 1);
  if (prefs.haptics) {
    safeHaptic(() => Haptics.impactAsync(isDivisionBump ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Heavy));
    if (tier === 'primordial' && !isDivisionBump) {
      setTimeout(() => safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)), 150);
    }
  }
}

// The rank-up riser (§11/§22) — a long build that runs the length of the forge and is cut at the
// flare (rank-up-celebration.tsx) so it resolves into the per-tier cue instead of overlapping it.
// Split start/stop because the celebration decides exactly when to cut. Start obeys the same sound
// toggle as every other cue; the celebration skips it entirely under reduced motion (a 3.7s build
// with no forge animation is worse than silence). Sound-only — the riser carries no haptic; the
// haptic lands with the tier hit at the flare (fireRankUp).
export function startRankUpRiser(): void {
  if (!getRewardPreferencesSync().sound) return;
  // Idempotent — cut any riser already playing before starting, so a re-mount / StrictMode's
  // mount→cleanup→mount can never leave two overlapping (they share one preloaded player).
  stopRewardSound('rankup-riser');
  playRewardSound('rankup-riser');
}

export function stopRankUpRiser(): void {
  stopRewardSound('rankup-riser');
}

// Daily flame meter completion (§5/§22, design-mocks/26) — "reuse the rising whoosh building
// into a short flourish." Full volume, distinct from the done-screen's quieter XP-tick use of
// the same asset, since this is the meter's own once-a-day payoff moment, not a background
// fill sound. Heavy haptic — a genuine daily milestone, not a light confirm.
export function fireFlameMeterComplete(): void {
  const prefs = getRewardPreferencesSync();
  if (prefs.sound) playRewardSound('whoosh');
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
  if (prefs.sound) playRewardSound('spark', 0.4);
  if (prefs.haptics) safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}
