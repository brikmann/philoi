import AsyncStorage from '@react-native-async-storage/async-storage';

import { isTutorialDone } from '@/lib/tutorial';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CONTEXTUAL COACH-MARKS — the second half of the first-run tutorial (CODE_PROMPT_coach_marks.md).
//
// The card tour (design-mocks/187) is the launch gate and it shipped. This is the part that makes
// it STICK: the first time somebody lands on a real surface, Cindy says one line pointing at the
// real control. A slideshow is forgotten by the time you reach the screen it described; a tooltip
// on the screen itself is not.
//
// 🔴 LOCAL STATE ONLY, NO SERVER, NO MIGRATION — this ships as a JS OTA. Same argument tutorial.ts
// makes for its own flag and for the same reasons: a first visit to a surface has to be decidable
// with no network, and the cost of the rare double-show (a reinstall, a second device) is seven
// one-line tooltips, against a migration and a round trip on every screen mount.
//
// Deliberately NOT folded into `philoi_tutorial_done`: that flag is one bit for the whole tour,
// and these are seven independent first-visits that happen days apart. One key each is what lets
// somebody who has never opened the Forge still get the Forge line in week three.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type CoachMarkKey =
  | 'home_lockin'
  | 'campfire_fab'
  | 'challenge_create'
  | 'shop'
  | 'inventory'
  | 'forge'
  | 'settings';

type CoachMarkCopy = {
  /** ONE line, in Cindy's voice, naming the control it points at. */
  line: string;
  /** Anchor is a circle (the campfire ＋), so the spotlight has to be one too. */
  round?: boolean;
};

/**
 * 🔴 EVERY LINE LIVES HERE, nowhere else.
 *
 * Seven tooltips spread across seven screens is seven places for the voice to drift, and Cindy's
 * voice is the thing being sold (CINDY_SPEC "warm channel"). Tone matched to the tour's own `cindy`
 * lines in tutorial-cards.tsx — first person, one sentence, names the control by the word printed
 * on it so the sentence and the screen agree.
 *
 * ⚠️ `home_lockin` reads "tap Lock in", NOT the prompt's "tap your flame to lock in". On Home the
 * flame is CINDY — tapping it opens the chat (CINDY_SPEC: "the flame IS Cindy, tap = chat"), and
 * the control that actually starts a session is the orange CTA under it. A coach-mark whose whole
 * job is to point at the real control cannot be the one thing on screen that lies about it.
 */
export const COACH_MARKS: Record<CoachMarkKey, CoachMarkCopy> = {
  home_lockin: { line: "This is your flame — tap Lock in and it starts growing. 🔥" },
  campfire_fab: { line: 'Tap ＋ to post, challenge, or ping your crew.', round: true },
  challenge_create: { line: "Describe any goal — I'll scope it and stake a fair reward." },
  shop: { line: 'Crates hold cosmetics to flex — tap one to open a batch.' },
  inventory: { line: 'Tap an item to equip it on your flame.' },
  forge: { line: 'Two spares? Forge them into something rarer.' },
  settings: { line: 'Turn on notifications + connect your apps here.' },
};

export const COACH_MARK_KEYS = Object.keys(COACH_MARKS) as CoachMarkKey[];

/** `coachmark_<key>_seen` — the spec's key shape, kept literal so it is greppable from a bug report. */
const seenStorageKey = (key: CoachMarkKey) => `coachmark_${key}_seen`;

export async function isCoachMarkSeen(key: CoachMarkKey): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(seenStorageKey(key))) === 'true';
  } catch {
    // A storage read that throws must not become a tooltip that can never be dismissed. Treating
    // the failure as "already seen" is the quiet direction to fail in.
    return true;
  }
}

export async function markCoachMarkSeen(key: CoachMarkKey): Promise<void> {
  try {
    await AsyncStorage.setItem(seenStorageKey(key), 'true');
  } catch {
    // Worst case they see the line once more. Never worth an error path on a tooltip.
  }
}

/** Settings' "Replay tutorial & tips" — puts every surface back to first-visit so Noah can re-demo. */
export async function resetCoachMarks(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(COACH_MARK_KEYS.map(seenStorageKey));
  } catch {
    // Same reasoning as above: the reset is a convenience, not a correctness path.
  }
}

// ─────────────────────────── the cooldown after the card tour ───────────────────────────
//
// 🔴 THE TOUR ALREADY COVERED ALL SEVEN OF THESE SURFACES. Landing on Home straight out of the
// twenty-card tour and immediately being told what the Lock in button does reads as the app
// repeating itself, which is exactly the impression the tour exists to avoid.
//
// IN MEMORY, NOT ASYNCSTORAGE, on purpose: the guardrail is "not back-to-back in the SAME session".
// A persisted timestamp would also suppress the marks for someone who finished the tour, closed the
// app and came back tomorrow — and tomorrow is precisely when a reminder is worth having.
let tourClosedAtMs = 0;

const TOUR_COOLDOWN_MS = 60_000;

/** Called by the tutorial screen on finish/skip — see tutorial.tsx. */
export function noteTourClosed(): void {
  tourClosedAtMs = Date.now();
}

/**
 * Everything that has to be true before a mark may be drawn, in one place.
 *
 * The tutorial flag is the "after onboarding + the card tour, never during" gate, and it is the
 * right one for BOTH halves of that sentence: the root layout only lets the tour run once
 * onboarding is complete, and `markTutorialDone` is stamped on skip as well as on finish — so
 * somebody who skipped the tour still gets these, which the spec asks for explicitly.
 */
export async function shouldShowCoachMark(key: CoachMarkKey): Promise<boolean> {
  if (Date.now() - tourClosedAtMs < TOUR_COOLDOWN_MS) return false;
  if (!(await isTutorialDone())) return false;
  return !(await isCoachMarkSeen(key));
}
