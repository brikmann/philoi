import { requireOptionalNativeModule } from 'expo-modules-core';

// Typed access to the native bridge behind Focus Nudge (APP_BLOCKER_SPEC, mocks 109/116).
//
// ONE module name, "PhiloiFocusNudge", two completely different mechanisms underneath:
//
//   · iOS   — Screen Time. Family Controls authorization, Apple's FamilyActivityPicker, a
//             ManagedSettingsStore shield drawn by three app extensions.
//   · Android — an AccessibilityService watching for TYPE_WINDOW_STATE_CHANGED plus a
//             SYSTEM_ALERT_WINDOW overlay. There is no Family Controls counterpart and no
//             system-provided picker, so the app guards a curated list of known distracting apps
//             chosen by package name (which is what keeps this off QUERY_ALL_PACKAGES — see
//             plugins/withFocusNudgeAndroid.js).
//
// The overlap is deliberate and it is most of the surface: writePayload, retreatCount, isArmed,
// arm, disarm, reconcile and selectionCounts mean the same thing on both, so
// src/components/focus-nudge-sync.tsx drives either platform with no branch in it at all. What
// cannot be shared is marked below, because the reason it cannot be shared is never arbitrary.
//
// `requireOptionalNativeModule`, never `requireNativeModule`: this returns null instead of throwing
// when the native side is not compiled in. Same lesson as philoi-live-activity — a native module
// resolved eagerly at import time takes the whole app down at launch in Expo Go, on the web, and in
// every binary cut before this module existed. Every consumer goes through src/lib/focus-nudge.ts,
// which treats null as "no Focus Nudge" and no-ops.

export type FocusNudgeAuthorizationStatus = 'notDetermined' | 'denied' | 'approved';

/**
 * How many things the user picked — never WHICH, on either platform.
 *
 * On iOS that is enforced by Apple: a FamilyActivitySelection holds opaque tokens deliberately made
 * unresolvable to app identities, and nothing on either side of this bridge tries to resolve one.
 *
 * Android has no privacy-preserving picker, so package names genuinely do cross this bridge —
 * `guardedPackages` below hands them up, because JS draws the picker and a picker has to know what
 * is ticked. The standard Apple enforces for us on iOS is therefore kept by hand on Android: the
 * names stay device-local, and this counts-only shape is what every SHARED caller sees, so the
 * analytics surface (`focus_nudge_apps_picked`, count only) is identical on both platforms.
 *
 * `categories` and `webDomains` are structurally zero on Android; it can only guard applications.
 */
export type FocusNudgeSelectionCounts = {
  applications: number;
  categories: number;
  webDomains: number;
};

/** ANDROID ONLY — the two system toggles, neither of which an app may grant itself. */
export type FocusNudgePermissions = {
  /** Settings > Accessibility > Philoi Focus Nudge. The detection half. */
  accessibility: boolean;
  /** "Display over other apps". The drawing half. Revocable independently of the above. */
  overlay: boolean;
};

/** ANDROID ONLY — one row of the curated picker. See modules/philoi-focus-nudge/android-guarded-apps.json. */
export type GuardableApp = {
  id: string;
  label: string;
  /** Usually one; TikTok and friends ship under more than one id across regions. */
  packages: string[];
};

/** Mirrors FocusNudgeArmOptions in PhiloiFocusNudgeModule.swift and its Kotlin twin. */
export type FocusNudgeArmOptions = {
  /** The failsafe ceiling in minutes — the DeviceActivity window ends here no matter what (§D). */
  maxMinutes: number;
  /** How long a "continue anyway" holds the shield down. Keep in step with the payload's deferMs. */
  deferMinutes: number;
};

type PhiloiFocusNudgeModule = {
  // ── both platforms ──
  authorizationStatus: () => FocusNudgeAuthorizationStatus;
  selectionCounts: () => FocusNudgeSelectionCounts;
  clearSelection: () => void;
  /** The JSON the shield / overlay reads. See buildPayload in src/lib/focus-nudge.ts. */
  writePayload: (json: string) => void;
  /** Presentations inside the window — written by the shield/overlay, read here for the coach. */
  retreatCount: (windowMs: number) => number;
  isArmed: () => boolean;
  /** False when there is no authorization or nothing picked — both are "feature off", never an error. */
  arm: (options: FocusNudgeArmOptions) => Promise<boolean>;
  disarm: () => Promise<void>;
  /** Re-applies the shield if a "continue anyway" cooldown lapsed while the app was away. */
  reconcile: () => Promise<boolean>;

  // ── iOS only ──
  /**
   * Resolves with the status AFTER the prompt. Denial resolves 'denied' — it is not an error.
   *
   * Has no Android counterpart, and cannot have one: an AccessibilityService cannot be enabled
   * programmatically by any API, which is the entire point of that permission. Android gets
   * openAccessibilitySettings/openOverlaySettings and a screen that explains why, instead.
   */
  requestAuthorization?: () => Promise<FocusNudgeAuthorizationStatus>;
  /** Apple's FamilyActivityPicker as a sheet. Resolves with the counts; cancelling leaves them as they were. */
  presentPicker?: () => Promise<FocusNudgeSelectionCounts>;

  // ── Android only ──
  permissions?: () => FocusNudgePermissions;
  openAccessibilitySettings?: () => void;
  openOverlaySettings?: () => void;
  /**
   * Which of `candidates` are on this phone. The candidates are always the curated catalog, which
   * is also the manifest's <queries> allow-list — this never enumerates anything, so no
   * QUERY_ALL_PACKAGES and no second sensitive-permission declaration.
   */
  installedPackages?: (candidates: string[]) => string[];
  /** The current selection, by package name. Device-local; never sent anywhere. */
  guardedPackages?: () => string[];
  setGuardedPackages?: (packages: string[]) => void;
};

export default requireOptionalNativeModule<PhiloiFocusNudgeModule>('PhiloiFocusNudge');
