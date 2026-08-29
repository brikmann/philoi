import { requireOptionalNativeModule } from 'expo-modules-core';

// Typed access to the iOS Screen Time bridge behind Focus Nudge (APP_BLOCKER_SPEC, mocks 109/116).
// iOS only — Family Controls has no Android counterpart, and the Android implementation
// (UsageStats + a foreground service) is a separate task per FOCUS_NUDGE_SETUP.md Part B.5.
//
// `requireOptionalNativeModule`, never `requireNativeModule`: this returns null instead of throwing
// when the native side is not compiled in. Same lesson as philoi-live-activity — a native module
// resolved eagerly at import time takes the whole app down at launch in Expo Go, on the web, and in
// every binary cut before this module existed. Every consumer goes through src/lib/focus-nudge.ts,
// which treats null as "no Focus Nudge" and no-ops.

export type FocusNudgeAuthorizationStatus = 'notDetermined' | 'denied' | 'approved';

/**
 * How many things the user picked — never WHICH. A FamilyActivitySelection holds opaque tokens
 * Apple deliberately makes unresolvable to app identities, and nothing on either side of this
 * bridge tries to resolve one.
 */
export type FocusNudgeSelectionCounts = {
  applications: number;
  categories: number;
  webDomains: number;
};

/** Mirrors FocusNudgeArmOptions in PhiloiFocusNudgeModule.swift. Keys must match those @Field names. */
export type FocusNudgeArmOptions = {
  /** The failsafe ceiling in minutes — the DeviceActivity window ends here no matter what (§D). */
  maxMinutes: number;
  /** How long a "continue anyway" holds the shield down. Keep in step with the payload's deferMs. */
  deferMinutes: number;
};

type PhiloiFocusNudgeModule = {
  authorizationStatus: () => FocusNudgeAuthorizationStatus;
  /** Resolves with the status AFTER the prompt. Denial resolves 'denied' — it is not an error. */
  requestAuthorization: () => Promise<FocusNudgeAuthorizationStatus>;
  /** Apple's FamilyActivityPicker as a sheet. Resolves with the counts; cancelling leaves them as they were. */
  presentPicker: () => Promise<FocusNudgeSelectionCounts>;
  selectionCounts: () => FocusNudgeSelectionCounts;
  clearSelection: () => void;
  /** The JSON the ShieldConfiguration extension reads. See buildPayload in src/lib/focus-nudge.ts. */
  writePayload: (json: string) => void;
  /** Shield presentations inside the window — written by the shield, read here for the coach. */
  retreatCount: (windowMs: number) => number;
  isArmed: () => boolean;
  /** False when there is no authorization or nothing picked — both are "feature off", never an error. */
  arm: (options: FocusNudgeArmOptions) => Promise<boolean>;
  disarm: () => Promise<void>;
  /** Re-applies the shield if a "continue anyway" cooldown lapsed while the app was away. */
  reconcile: () => Promise<boolean>;
};

export default requireOptionalNativeModule<PhiloiFocusNudgeModule>('PhiloiFocusNudge');
