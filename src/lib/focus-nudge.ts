// The seam between a running lock-in and the iOS Screen Time shield (APP_BLOCKER_SPEC, mocks
// 109 + 116). Native side lives in modules/philoi-focus-nudge (the bridge) and three extension
// targets under targets/ (the monitor, the shield, its buttons).
//
// Both invariants from live-activity.ts hold here too, for the same reasons:
//
// 1. NOTHING NATIVE AT MODULE SCOPE. The module is reached through a lazy require() behind
//    `available()`. A native module resolved at import time takes the whole app down at launch in
//    any runtime that did not compile it in — Expo Go, the web, every binary cut before this
//    landed. Every function below degrades to a no-op rather than an error.
// 2. THE SHIELD NEVER FETCHES. iOS asks the ShieldConfiguration extension for its UI
//    synchronously, in a system process; it cannot await a network call. So Cindy's line is
//    fetched HERE, while the app has a connection, and written into the App Group. The shield only
//    reads. That is what makes the nudge work in airplane mode — and it is why `refreshNudgeCopy`
//    is called at session start rather than at the moment of drift.
//
// iOS only. Family Controls has no Android counterpart; the Android implementation (UsageStats +
// a foreground service posting a notification-interstitial) is its own task per
// FOCUS_NUDGE_SETUP.md Part B.5, and nothing here pretends to cover it.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { fetchInterceptLine, type InterceptIntent } from '@/lib/api/coach';
import type {
  FocusNudgeAuthorizationStatus,
  FocusNudgeSelectionCounts,
} from '../../modules/philoi-focus-nudge';

export type { FocusNudgeAuthorizationStatus, FocusNudgeSelectionCounts };

type NativeModule = {
  authorizationStatus: () => FocusNudgeAuthorizationStatus;
  requestAuthorization: () => Promise<FocusNudgeAuthorizationStatus>;
  presentPicker: () => Promise<FocusNudgeSelectionCounts>;
  selectionCounts: () => FocusNudgeSelectionCounts;
  clearSelection: () => void;
  writePayload: (json: string) => void;
  retreatCount: (windowMs: number) => number;
  isArmed: () => boolean;
  arm: (options: { maxMinutes: number; deferMinutes: number }) => Promise<boolean>;
  disarm: () => Promise<void>;
  reconcile: () => Promise<boolean>;
};

// `undefined` = not yet looked up, `null` = looked up and absent. Distinguishing the two keeps the
// require() to once per launch instead of once per call.
let cached: NativeModule | null | undefined;

function native(): NativeModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'ios') {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('../../modules/philoi-focus-nudge').default as NativeModule | null;
  } catch {
    // A build without the module compiled in. Not an error worth reporting — it is the expected
    // state on every binary cut before this landed, and on Android forever.
    cached = null;
  }
  return cached;
}

/** Whether this build can shield anything at all. */
export function focusNudgeSupported(): boolean {
  return native() !== null;
}

// ───────────────────────────── tuning ─────────────────────────────

/**
 * §C-safety's "repeated retreat in a short window". Three drifts inside an hour is the point where
 * the tone stops being a push and becomes a check-in.
 *
 * Deliberately low. The cost of escalating early is a kind message someone did not need; the cost
 * of escalating late is answering avoidance with "grind harder", which the spec calls a real harm.
 */
export const ESCALATE_AFTER = 3;
export const ESCALATE_WINDOW_MS = 60 * 60 * 1000;

/** How long "continue anyway" keeps the shield down. A tap on the shoulder, not nagging (§C). */
export const DEFER_MS = 15 * 60 * 1000;

/**
 * The failsafe ceiling on the DeviceActivity window (§D). Long enough that it never truncates a
 * genuine session — there is no server-side max lock-in, and notify_stale_lock_ins only *nudges*
 * after an hour — but finite, so a force-quit cannot leave someone shielded overnight.
 */
export const FAILSAFE_MAX_MINUTES = 12 * 60;

// ───────────────────────────── the local toggle ─────────────────────────────

// Device-local, like the rest of reward-settings.ts: which apps are shielded on THIS phone is a
// fact about this phone, and Apple's selection tokens are not portable off it anyway.
const ENABLED_KEY = 'philoi_focus_nudge_enabled';

/** "Nudge me automatically when I lock in" — §A step 3, default ON. */
export async function isFocusNudgeEnabled(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(ENABLED_KEY).catch(() => null);
  return raw === null ? true : raw === '1';
}

export async function setFocusNudgeEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, enabled ? '1' : '0').catch(() => {});
}

// ───────────────────────────── permission + picker ─────────────────────────────

export function focusNudgeAuthorization(): FocusNudgeAuthorizationStatus {
  const module = native();
  if (!module) return 'denied';
  try {
    return module.authorizationStatus();
  } catch {
    return 'denied';
  }
}

export async function requestFocusNudgeAuthorization(): Promise<FocusNudgeAuthorizationStatus> {
  const module = native();
  if (!module) return 'denied';
  try {
    return await module.requestAuthorization();
  } catch {
    // Refusal and failure are indistinguishable at this layer, and both mean the same thing to the
    // caller: the feature stays off. It must never block anyone from locking in (§"Edge cases").
    return 'denied';
  }
}

const NO_SELECTION: FocusNudgeSelectionCounts = { applications: 0, categories: 0, webDomains: 0 };

export function focusNudgeSelectionCounts(): FocusNudgeSelectionCounts {
  const module = native();
  if (!module) return NO_SELECTION;
  try {
    return module.selectionCounts();
  } catch {
    return NO_SELECTION;
  }
}

export function focusNudgeSelectionSize(counts: FocusNudgeSelectionCounts): number {
  return counts.applications + counts.categories + counts.webDomains;
}

/** Apple's own picker. Resolves with the new counts; cancelling resolves with the old ones. */
export async function pickFocusNudgeApps(): Promise<FocusNudgeSelectionCounts> {
  const module = native();
  if (!module) return NO_SELECTION;
  try {
    return await module.presentPicker();
  } catch {
    return focusNudgeSelectionCounts();
  }
}

export function clearFocusNudgeApps(): void {
  try {
    native()?.clearSelection();
  } catch {
    // Nothing to surface — the picker screen re-reads the counts either way.
  }
}

// ───────────────────────────── the payload ─────────────────────────────

/**
 * The buttons, by tone.
 *
 * iOS gives a shield exactly two: a primary and a secondary. Mock 109 shows three ("Back to my
 * session" / "Say hi in your campfire" / "Continue anyway"), so the campfire affordance is the one
 * that folds — it is the only one that is not load-bearing, and the campfire is one tap away once
 * Philoi is open. What survives is the pair the spec makes non-negotiable: a way back in, and a
 * way through with no penalty.
 */
const BUTTONS: Record<InterceptIntent, { primaryLabel: string; primaryURL: string; secondaryLabel: string }> = {
  reinforce: {
    primaryLabel: 'Back to my session',
    primaryURL: 'philoi://lock-in?from=shield',
    secondaryLabel: 'Continue anyway',
  },
  // On the caring tones the primary stops being the session and becomes the person: §C-safety
  // wants the support surface offered, not buried behind a productivity button.
  wellbeing: {
    primaryLabel: 'Talk to someone',
    primaryURL: 'philoi://support?from=shield',
    secondaryLabel: "I'm okay — continue",
  },
  support: {
    primaryLabel: 'Talk to someone',
    primaryURL: 'philoi://support?from=shield',
    secondaryLabel: 'Continue',
  },
};

/** Used when the model's line is a single sentence and there is nothing to promote to a headline. */
const HEADLINES: Record<InterceptIntent, string> = {
  reinforce: "You're still locked in.",
  wellbeing: 'Hey — just checking on you.',
  support: "You don't have to power through it alone.",
};

/**
 * The §C-safety escalation, authored here rather than generated.
 *
 * It has to be cached alongside the AI line so the third retreat in an hour turns caring EVEN WITH
 * NO NETWORK — care must never depend on connectivity — and generating a second line per session
 * would double the cost the spec caps at one. Static, warm, and short: "connection, not the essay."
 */
const ESCALATED_CARD = {
  intent: 'wellbeing' as const,
  title: "Hey — that's a few times now.",
  body: "No judgment, honestly. But the feed won't fix whatever's sitting heavy. Step outside for a sec, or text someone who gets it.",
  ...BUTTONS.wellbeing,
};

/**
 * Split one AI line into the headline + blurb the shield draws (mock 109 frame 2).
 *
 * The coach returns one to two sentences and no structure, so the first sentence is promoted to
 * the title when it is short enough to read as a headline and something is left over for the body.
 * Otherwise the whole line becomes the body under a static headline — never a title with an empty
 * subtitle, and never a truncated one.
 */
export function splitNudgeCopy(message: string, intent: InterceptIntent): { title: string; body: string } {
  const trimmed = message.trim();
  const match = trimmed.match(/^(.{1,60}?[.!?])\s+(\S.*)$/s);
  if (match) return { title: match[1], body: match[2] };
  return { title: HEADLINES[intent], body: trimmed };
}

/** Exactly the JSON FocusNudgePayload.load() parses in FocusNudgeShared.swift. */
export function buildNudgePayload(line: { message: string; intent: InterceptIntent }): string {
  const { title, body } = splitNudgeCopy(line.message, line.intent);
  return JSON.stringify({
    base: { intent: line.intent, title, body, ...BUTTONS[line.intent] },
    escalated: ESCALATED_CARD,
    escalateAfter: ESCALATE_AFTER,
    escalateWindowMs: ESCALATE_WINDOW_MS,
    deferMs: DEFER_MS,
  });
}

/** How many times the shield has fired inside the escalation window. Written by the extension. */
export function focusNudgeRetreats(): number {
  const module = native();
  if (!module) return 0;
  try {
    return module.retreatCount(ESCALATE_WINDOW_MS);
  } catch {
    return 0;
  }
}

/**
 * Fetch Cindy's line and hand it to the shield.
 *
 * Best-effort by design. A failure here means the shield falls back to the copy baked into
 * FocusNudgeShared.swift — warm, generic, and biased to care — which is a fine nudge and a much
 * better outcome than either a blank shield or no shield at all. So this never throws and never
 * blocks arming.
 */
export async function refreshNudgeCopy(input: {
  sessionLabel: string | null;
  minutesIntoSession: number;
}): Promise<boolean> {
  const module = native();
  if (!module) return false;
  try {
    const line = await fetchInterceptLine({
      retreats: focusNudgeRetreats(),
      minutesIntoSession: input.minutesIntoSession,
      sessionLabel: input.sessionLabel,
    });
    if (!line) return false;
    module.writePayload(buildNudgePayload(line));
    return true;
  } catch (e) {
    // Consent withdrawn, rate limit, offline — all of them land here and all of them mean the same
    // thing: the shield uses its built-in copy this session.
    console.warn('[focus-nudge] copy refresh failed:', e);
    return false;
  }
}

// ───────────────────────────── arm / disarm ─────────────────────────────

export function focusNudgeArmed(): boolean {
  const module = native();
  if (!module) return false;
  try {
    return module.isArmed();
  } catch {
    return false;
  }
}

/** Resolves false when the feature is simply off — no permission, nothing picked, wrong platform. */
export async function armFocusNudge(): Promise<boolean> {
  const module = native();
  if (!module) return false;
  try {
    return await module.arm({ maxMinutes: FAILSAFE_MAX_MINUTES, deferMinutes: DEFER_MS / 60_000 });
  } catch (e) {
    console.warn('[focus-nudge] arm failed:', e);
    return false;
  }
}

/**
 * Take it down.
 *
 * Swallows everything. This is the call that must not fail quietly-and-then-give-up: an app still
 * shielded after its lock-in ended is the only genuinely harmful failure this feature has, so the
 * DeviceActivity window in the monitor extension is there to sweep up behind a throw here.
 */
export async function disarmFocusNudge(): Promise<void> {
  const module = native();
  if (!module) return;
  try {
    await module.disarm();
  } catch (e) {
    console.warn('[focus-nudge] disarm failed:', e);
  }
}

/** Cheap enough to call on every foreground — puts the shield back if a cooldown lapsed. */
export async function reconcileFocusNudge(): Promise<void> {
  const module = native();
  if (!module) return;
  try {
    await module.reconcile();
  } catch {
    // Reconciliation is opportunistic; the monitor extension's threshold event covers the same
    // ground from the other side.
  }
}
