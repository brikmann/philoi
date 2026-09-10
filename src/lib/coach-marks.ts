import AsyncStorage from '@react-native-async-storage/async-storage';

import { isTutorialDone } from '@/lib/tutorial';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CONTEXTUAL COACH-MARKS + THE GUIDED TOUR — the second half of the first-run tutorial
// (CODE_PROMPT_coach_marks.md, CODE_PROMPT_tutorial_lands.md).
//
// The card tour (design-mocks/187) is the launch gate and it shipped. This is the part that makes
// it STICK: Cindy points at the real control on the real screen. A slideshow is forgotten by the
// time you reach the screen it described; a tooltip on the screen itself is not.
//
// ─────────────────────────── 🔴 WHY THIS WAS REWRITTEN: IT NEVER FIRED ───────────────────────────
//
// The original build was PURELY reactive — each surface offered its own tip on first visit, and
// every gate below had to pass on the frame that visit happened. On a fresh device it could not
// pass. Straight out of the card tour the user lands on Home, `noteTourClosed()` has just stamped
// a SIXTY-SECOND cooldown, and the anchor hook makes exactly ONE attempt per focus, 700ms in. So
// the first tip was refused, and nothing ever asked again for as long as the user stayed on Home.
// The feature was not broken so much as unreachable: it needed the user to leave Home and come
// back a minute later before it would say anything at all.
//
// The fix is to stop waiting to be visited. A DRIVER (components/coach-tour.tsx) now walks the
// seven surfaces in order, navigating to each one itself, and the per-surface tips are demoted to
// the fallback for whatever the driver could not reach — an empty Forge, a user with no campfire.
// Both drivers raise the same overlay and burn the same seen-keys, so a surface is taught once
// whichever half got there first.
//
// 🔴 LOCAL STATE ONLY, NO SERVER, NO MIGRATION — this ships as a JS OTA. Same argument tutorial.ts
// makes for its own flag and for the same reasons: a first visit to a surface has to be decidable
// with no network, and the cost of the rare double-show (a reinstall, a second device) is seven
// one-line tooltips, against a migration and a round trip on every screen mount.
//
// Deliberately NOT folded into `philoi_tutorial_done`: that flag is one bit for the whole tour,
// and these are seven independent first-visits that can happen days apart. One key each is what
// lets somebody who has never opened the Forge still get the Forge line in week three.
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
 *
 * ⚠️ AND IT NAMES THE TWO-TAP TAXONOMY (CODE_PROMPT_lockin_taxonomy_two_tap.md), because the line
 * that introduces the lock-in button is the one place in the app that sets the expectation for what
 * happens after it. The picker is now exactly two taps — Studying → a course, or Fitness → Cardio /
 * Strength — and Deep Work and Meditate are gone. A tip promising a longer list, or one of the dead
 * types, would be teaching a screen that no longer exists.
 */
export const COACH_MARKS: Record<CoachMarkKey, CoachMarkCopy> = {
  home_lockin: {
    line: 'This is your flame. Tap Lock in — Studying → your course, or Fitness → Cardio or Strength. 🔥',
  },
  campfire_fab: { line: 'Tap ＋ to post, challenge, or ping your crew.', round: true },
  challenge_create: { line: "Describe any goal — I'll scope it and stake a fair reward." },
  shop: { line: 'Crates hold cosmetics to flex — tap one to open a batch.' },
  inventory: { line: 'Tap an item to equip it on your flame.' },
  forge: { line: 'Two spares? Forge them into something rarer.' },
  settings: { line: 'Turn on notifications + connect your apps here.' },
};

export const COACH_MARK_KEYS = Object.keys(COACH_MARKS) as CoachMarkKey[];

// ─────────────────────────── the guided tour's running order ───────────────────────────
//
// 🔴 THE ORDER IS A ROUTE PLAN, not a ranking. Every step names the screen it lives on, because
// the driver NAVIGATES — the spec's "if a step's target lives on another tab, the tour goes there
// rather than pointing at nothing". Home first because that is where the tour starts and where it
// returns to; Settings last because it is the one surface nobody reaches by accident.
//
// `campfire_fab` carries no literal route: the ＋ lives inside a specific campfire, and which one
// depends on the account. The driver resolves the user's first circle at run time and skips the
// step outright if they somehow have none.

export type CoachTourStep = {
  key: CoachMarkKey;
  /** An expo-router path, or the marker telling the driver to resolve a campfire first. */
  route: string | { dynamic: 'first_campfire' };
};

export const COACH_TOUR_STEPS: CoachTourStep[] = [
  { key: 'home_lockin', route: '/' },
  { key: 'campfire_fab', route: { dynamic: 'first_campfire' } },
  { key: 'challenge_create', route: '/challenge/create' },
  { key: 'shop', route: '/shop' },
  { key: 'inventory', route: '/inventory' },
  { key: 'forge', route: '/forge' },
  { key: 'settings', route: '/settings' },
];

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

/**
 * Skip means skip.
 *
 * Someone who ends the guided tour at step two has told us they do not want tips, and honouring
 * that by burning the remaining five is the difference between a Skip button and a Snooze button.
 * The original per-surface design deliberately survived a skipped CARD tour — that argument does
 * not transfer here, because this tour's Skip is aimed at these exact seven tooltips.
 */
export async function markAllCoachMarksSeen(): Promise<void> {
  try {
    await AsyncStorage.multiSet(COACH_MARK_KEYS.map((key) => [seenStorageKey(key), 'true']));
  } catch {
    // Same reasoning as above.
  }
}

// ─────────────────────────── the guided tour's own flag ───────────────────────────
//
// Separate from `philoi_tutorial_done` (the card tour) and from the seven seen-keys, and it has to
// be all three: the card tour is a different screen, the seen-keys are per-surface and survive a
// skipped step, and this one bit answers only "has the driver already had its go on this device".
//
// 🔴 IT IS SET ON SKIP AS WELL AS ON FINISH, for the reason tutorial.ts spells out at length: a
// flag that only sets on completion re-launches the whole thing on the next cold start for
// everyone who skipped, which is the most annoying thing a first-run experience can do.

const COACH_TOUR_DONE_KEY = 'philoi_coach_tour_done';

export async function isCoachTourDone(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(COACH_TOUR_DONE_KEY)) === 'true';
  } catch {
    // Fail closed: a storage fault must not put a seven-screen auto-navigating tour in front of
    // somebody on every single launch.
    return true;
  }
}

export async function markCoachTourDone(): Promise<void> {
  try {
    await AsyncStorage.setItem(COACH_TOUR_DONE_KEY, 'true');
  } catch {
    // See above — worst case it runs once more.
  }
}

/** Settings' "Replay tutorial & tips" — puts every surface back to first-visit so Noah can re-demo. */
export async function resetCoachMarks(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([...COACH_MARK_KEYS.map(seenStorageKey), COACH_TOUR_DONE_KEY]);
  } catch {
    // Same reasoning as above: the reset is a convenience, not a correctness path.
  }
  // 🔴 AND THE IN-MEMORY HALF, which is what would otherwise make Replay a no-op the first time
  // somebody pressed it. Clearing storage while `tourRanThisSession` is still true from the run
  // being replayed leaves the driver refusing to start until the app is killed — a reset whose
  // effect you can only see after a cold start is not a reset. See `noteCoachTourRan`.
  tourRanThisSession = false;
}

// ─────────────────────────── the cooldown after the card tour ───────────────────────────
//
// 🔴 THE CARD TOUR ALREADY COVERED ALL SEVEN OF THESE SURFACES. Landing on Home straight out of it
// and immediately being told what the Lock in button does reads as the app repeating itself, which
// is exactly the impression the tour exists to avoid.
//
// ⚠️ THIS APPLIES TO THE CONTEXTUAL TIPS ONLY, NEVER TO THE GUIDED TOUR — and getting that
// backwards is precisely what stopped anything appearing on the last device build. The driver is
// SUPPOSED to run straight out of the card tour; it is the continuation of it, not an echo of it.
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

// ─────────────────────────── is the driver on screen right now ───────────────────────────
//
// While the guided tour is walking the app, the surfaces it walks THROUGH must not each try to
// raise their own tip as they gain focus — that is two drivers fighting over one overlay slot, and
// the loser silently burns a step. One flag, read by `shouldShowCoachMark`, settles it.

let tourActive = false;
/** Set once the driver has had its go, so a mid-session Replay is the only way to see it twice. */
let tourRanThisSession = false;

export function setCoachTourActive(active: boolean): void {
  tourActive = active;
}

export function isCoachTourActive(): boolean {
  return tourActive;
}

export function noteCoachTourRan(): void {
  tourRanThisSession = true;
}

export function hasCoachTourRunThisSession(): boolean {
  return tourRanThisSession;
}

/**
 * Everything that has to be true before a CONTEXTUAL tip may be drawn, in one place.
 *
 * The tutorial flag is the "after onboarding + the card tour, never during" gate, and it is the
 * right one for BOTH halves of that sentence: the root layout only lets the tour run once
 * onboarding is complete, and `markTutorialDone` is stamped on skip as well as on finish.
 *
 * 🔴 AND THE GUIDED TOUR GETS FIRST REFUSAL. Until the driver has run (or been skipped), nothing
 * fires on its own — otherwise the Home tip would go off 700ms after the card tour ends, the
 * driver would find its overlay slot already taken, and the seven-step tour would be replaced by
 * one orphaned tooltip. Afterwards the contextual path is exactly what it was designed to be: the
 * catch-up for surfaces the driver could not reach, so an empty Forge on day one still gets its
 * line the week the user actually has two spares.
 */
export async function shouldShowCoachMark(key: CoachMarkKey): Promise<boolean> {
  if (tourActive) return false;
  if (Date.now() - tourClosedAtMs < TOUR_COOLDOWN_MS) return false;
  if (!(await isTutorialDone())) return false;
  if (!(await isCoachTourDone())) return false;
  return !(await isCoachMarkSeen(key));
}
