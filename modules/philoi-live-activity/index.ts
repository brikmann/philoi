import { requireOptionalNativeModule } from 'expo-modules-core';

// Typed access to the native lock-in live surface (#87) — the iOS Live Activity and the Android
// ongoing notification, behind one interface because the three verbs are genuinely the same on both.
//
// `requireOptionalNativeModule`, never `requireNativeModule`: this returns null instead of throwing
// when the native side isn't compiled in. That distinction is the whole lesson of the RevenueCat
// white screen — a native module resolved eagerly at import time takes the entire app down at
// launch in Expo Go, on the web, and in any build cut before this module existed. Every consumer
// goes through src/lib/live-activity.ts, which treats null as "no live surface" and no-ops.

/** Mirrors LiveActivityStateRecord in the iOS/Android modules. Keys must match those @Field names. */
export type NativeLiveActivityState = {
  sessionName: string;
  /** Epoch ms. The OS counts up from this itself — we never send elapsed time. */
  startedAtMs: number;
  rankRatio: number;
  rankLabel: string;
  projection: string | null;
  /** iOS only — the widget draws the bar in the current tier's metal. Ignored on Android, whose
   *  notification progress bar is coloured by the system accent and can't be themed. */
  tierOuterHex: string;
  tierInnerHex: string;
  /** The equipped flare's colour as "#RRGGBB", or null when the slot is empty (the common case).
   *  Tints the FRAME only — the card border / Dynamic Island dot on iOS, the notification accent
   *  on Android. The rank bar stays tier metal and the timer stays white on both. */
  flareHex: string | null;
};

type PhiloiLiveActivityModule = {
  /** False when the user has turned the surface off in system settings (iOS Live Activities
   *  toggle, Android notifications) — checked per call, never cached, since either can change
   *  while the app is running. */
  isAvailable: () => boolean;
  /** Resolves to a platform id (ActivityKit activity id / Android notification id), or null on
   *  iOS when the user has Live Activities disabled. */
  start: (state: NativeLiveActivityState) => Promise<string | null>;
  update: (state: NativeLiveActivityState) => Promise<void>;
  end: () => Promise<void>;
};

export default requireOptionalNativeModule<PhiloiLiveActivityModule>('PhiloiLiveActivity');
