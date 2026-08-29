// The seam between a running lock-in and the native guard (APP_BLOCKER_SPEC, mocks 109 + 116).
//
// TWO PLATFORMS, ONE SEAM. The native side is modules/philoi-focus-nudge: on iOS the bridge plus
// three Screen Time extension targets under targets/ (the monitor, the shield, its buttons); on
// Android an AccessibilityService and a SYSTEM_ALERT_WINDOW overlay. They share this file, the
// payload format, the 10-minute deferral, the two buttons and the escalation rule — everything
// below is written once and runs on both.
//
// Both invariants from live-activity.ts hold here too, for the same reasons:
//
// 1. NOTHING NATIVE AT MODULE SCOPE. The module is reached through a lazy require() behind
//    `available()`. A native module resolved at import time takes the whole app down at launch in
//    any runtime that did not compile it in — Expo Go, the web, every binary cut before this
//    landed. Every function below degrades to a no-op rather than an error.
// 2. THE NUDGE NEVER FETCHES, on either platform, and for two different reasons that land in the
//    same place. iOS asks the ShieldConfiguration extension for its UI synchronously, in a system
//    process; it cannot await a network call. Android could, in principle — and must not, because
//    the overlay has to be on screen in the same frame the guarded app comes forward, and a
//    request there would reintroduce the exact glimpse of the feed the feature exists to prevent.
//    So Cindy's line is fetched HERE, while the app has a connection, and cached natively; the
//    shield and the overlay only read. That is what makes the nudge work in airplane mode, and it
//    is why `refreshNudgeCopy` runs at session start rather than at the moment of drift.
//
// WHERE THE PLATFORMS DIVERGE, and why (the shared functions below are silent about it; these are
// the only three places it shows):
//
//   · PERMISSION. iOS raises one prompt this app controls. Android has two switches — Accessibility
//     and "display over other apps" — and NEITHER can be granted from inside an app; an
//     AccessibilityService cannot be enabled programmatically by any API, which is the point of the
//     permission. Hence openFocusNudgeAccessibilitySettings/openFocusNudgeOverlaySettings and a
//     setup screen that explains, rather than a requestAuthorization() that cannot exist.
//   · THE PICKER. Apple provides FamilyActivityPicker and hands back opaque tokens. Android
//     provides nothing, and enumerating installed apps needs QUERY_ALL_PACKAGES — a second
//     sensitive-permission declaration on top of the AccessibilityService one. So Android guards a
//     CURATED list of known distracting apps by package name, declared up front in the manifest's
//     <queries> allow-list. See android-guarded-apps.json and plugins/withFocusNudgeAndroid.js.
//   · THE FLAG. Android is gated by FOCUS_NUDGE_ANDROID_ENABLED, which is a build-time fact rather
//     than a JS constant, because the manifest is what Play reviews. See app.config.ts.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { FOCUS_NUDGE_ANDROID_ENABLED } from '@/constants/feature-flags';
import { fetchInterceptLine, type InterceptIntent } from '@/lib/api/coach';
import type {
  FocusNudgeAuthorizationStatus,
  FocusNudgePermissions,
  FocusNudgeSelectionCounts,
  GuardableApp,
} from '../../modules/philoi-focus-nudge';
import GUARDED_APPS from '../../modules/philoi-focus-nudge/android-guarded-apps.json';

export type { FocusNudgeAuthorizationStatus, FocusNudgePermissions, FocusNudgeSelectionCounts, GuardableApp };

type NativeModule = {
  authorizationStatus: () => FocusNudgeAuthorizationStatus;
  selectionCounts: () => FocusNudgeSelectionCounts;
  clearSelection: () => void;
  writePayload: (json: string) => void;
  retreatCount: (windowMs: number) => number;
  isArmed: () => boolean;
  arm: (options: { maxMinutes: number; deferMinutes: number }) => Promise<boolean>;
  disarm: () => Promise<void>;
  reconcile: () => Promise<boolean>;
  // Optional because they exist on exactly one platform each — see "WHERE THE PLATFORMS DIVERGE"
  // above. Every call site below checks rather than assuming, so a build that somehow has the
  // module without one of these degrades to "feature off" instead of throwing.
  requestAuthorization?: () => Promise<FocusNudgeAuthorizationStatus>;
  presentPicker?: () => Promise<FocusNudgeSelectionCounts>;
  permissions?: () => FocusNudgePermissions;
  openAccessibilitySettings?: () => void;
  openOverlaySettings?: () => void;
  installedPackages?: (candidates: string[]) => string[];
  guardedPackages?: () => string[];
  setGuardedPackages?: (packages: string[]) => void;
};

// `undefined` = not yet looked up, `null` = looked up and absent. Distinguishing the two keeps the
// require() to once per launch instead of once per call.
let cached: NativeModule | null | undefined;

function native(): NativeModule | null {
  if (cached !== undefined) return cached;
  // Android is additionally gated on the build flag: a binary compiled without
  // FOCUS_NUDGE_ANDROID=1 has the Kotlin classes but no <service> registering them, so the feature
  // could never work and the setup screen must not offer it.
  const platformSupported =
    Platform.OS === 'ios' || (Platform.OS === 'android' && FOCUS_NUDGE_ANDROID_ENABLED);
  if (!platformSupported) {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('../../modules/philoi-focus-nudge').default as NativeModule | null;
  } catch {
    // A build without the module compiled in. Not an error worth reporting — it is the expected
    // state on every binary cut before this landed.
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
export const DEFER_MS = 10 * 60 * 1000;

/**
 * The failsafe ceiling on the DeviceActivity window (§D). Long enough that it never truncates a
 * genuine session — there is no server-side max lock-in, and notify_stale_lock_ins only *nudges*
 * after an hour — but finite, so a force-quit cannot leave someone shielded overnight.
 *
 * iOS only in effect. Android accepts it in arm() and ignores it, because the failure it guards
 * against cannot happen there: nothing is applied to the system, so there is no shield a dead
 * process could leave standing.
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

/**
 * iOS's one prompt.
 *
 * On Android there is nothing to request — both switches live in system Settings and no API can
 * flip them — so this reports the status as it stands and the setup screen sends people to
 * openFocusNudgeAccessibilitySettings/openFocusNudgeOverlaySettings instead.
 */
export async function requestFocusNudgeAuthorization(): Promise<FocusNudgeAuthorizationStatus> {
  const module = native();
  if (!module) return 'denied';
  if (!module.requestAuthorization) return focusNudgeAuthorization();
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
  if (!module?.presentPicker) return focusNudgeSelectionCounts();
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

// ───────────────────────────── Android: the two switches ─────────────────────────────

const NO_PERMISSIONS: FocusNudgePermissions = { accessibility: false, overlay: false };

/**
 * Which of Android's two toggles are on. Both false on iOS, where the concept does not exist and
 * `focusNudgeAuthorization()` is the whole story.
 *
 * Read fresh on every screen focus rather than cached: either one can be revoked in system Settings
 * while Philoi is backgrounded, and a setup screen that still claims "On" for a switch someone just
 * turned off is how you end up debugging a nudge that was never going to appear.
 */
export function focusNudgePermissions(): FocusNudgePermissions {
  const module = native();
  if (!module?.permissions) return NO_PERMISSIONS;
  try {
    return module.permissions();
  } catch {
    return NO_PERMISSIONS;
  }
}

/** Settings > Accessibility. The list, not Philoi's row — see the note in the Kotlin module. */
export function openFocusNudgeAccessibilitySettings(): void {
  try {
    native()?.openAccessibilitySettings?.();
  } catch {
    // The screen re-reads permissions on focus regardless, so a failed launch self-corrects.
  }
}

/** Settings > "Display over other apps", scoped to Philoi. */
export function openFocusNudgeOverlaySettings(): void {
  try {
    native()?.openOverlaySettings?.();
  } catch {
    // As above.
  }
}

// ───────────────────────────── Android: the curated picker ─────────────────────────────

/**
 * The whole catalog of apps Focus Nudge can guard on Android, in the order the picker shows them.
 *
 * This list is not a UI convenience — it is a Play-permission decision. Offering "any installed
 * app" would need QUERY_ALL_PACKAGES, which is its own sensitive-permission declaration reviewed
 * separately from the AccessibilityService one, i.e. two extended reviews instead of one. A fixed
 * allow-list needs only <queries>, and the same JSON file feeds both this and the manifest so the
 * two can never disagree.
 */
const CATALOG: GuardableApp[] = GUARDED_APPS.apps;

/** Whether this platform picks apps from our own curated list rather than a system picker. */
export function focusNudgeUsesCuratedPicker(): boolean {
  return Platform.OS === 'android';
}

/**
 * The catalog, narrowed to what is actually on this phone.
 *
 * An app counts as present if ANY of its package ids resolve — TikTok and a few others ship under
 * more than one id across regions, and someone with the `trill` build should still be offered it.
 */
export function installedGuardableApps(): GuardableApp[] {
  const module = native();
  if (!module?.installedPackages) return [];
  try {
    const present = new Set(module.installedPackages(CATALOG.flatMap((app) => app.packages)));
    return CATALOG.filter((app) => app.packages.some((packageName) => present.has(packageName)));
  } catch {
    return [];
  }
}

/** Which catalog entries are currently guarded, by id. Device-local; never sent anywhere. */
export function guardedAppIds(): string[] {
  const module = native();
  if (!module?.guardedPackages) return [];
  try {
    const guarded = new Set(module.guardedPackages());
    return CATALOG.filter((app) => app.packages.some((p) => guarded.has(p))).map((app) => app.id);
  } catch {
    return [];
  }
}

/**
 * Replace the guarded set.
 *
 * All of an app's package ids go in, not only the installed one: the cost of guarding an id that is
 * not on the phone is zero (no window ever fires for it), and it means installing the regional
 * build of something you already chose does not silently leave it unguarded.
 */
export function setGuardedAppIds(ids: string[]): void {
  const module = native();
  if (!module?.setGuardedPackages) return;
  const chosen = new Set(ids);
  try {
    module.setGuardedPackages(
      CATALOG.filter((app) => chosen.has(app.id)).flatMap((app) => app.packages)
    );
  } catch {
    // The screen re-reads the selection on focus, so a failed write shows up as the row simply not
    // ticking rather than as a lie.
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
 *
 * Android's overlay could have fitted the third; it keeps two anyway. The constraint that cut it
 * was Apple's, but the reasoning was not, and a nudge offering different choices depending on which
 * phone you own is a worse nudge than either version of itself.
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
 * Fetch Cindy's line and hand it to the shield / overlay.
 *
 * Best-effort by design. A failure here means it falls back to the copy baked into the native side
 * — FocusNudgePayload.fallback, word-for-word identical in FocusNudgeShared.swift and
 * FocusNudgeShared.kt, warm and generic and biased to care. That is a fine nudge and a much better
 * outcome than either a blank one or none at all, so this never throws and never blocks arming.
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
 * Swallows everything. This is the call that must not fail quietly-and-then-give-up: a guard still
 * up after its lock-in ended is the only genuinely harmful failure this feature has. On iOS the
 * DeviceActivity window in the monitor extension sweeps up behind a throw here. Android needs no
 * equivalent, and that is worth knowing rather than assuming: "armed" there is a timestamp in
 * SharedPreferences rather than state applied to the system, so a throw leaves a stale flag that
 * the next cold start's unconditional disarm clears — there is nothing that could outlive the app.
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
    // Reconciliation is opportunistic. On iOS the monitor extension's threshold event covers the
    // same ground from the other side; on Android the deferral expires on its own clock, so a
    // missed reconcile costs nothing at all.
  }
}
