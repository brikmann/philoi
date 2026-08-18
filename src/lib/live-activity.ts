// The seam between a running lock-in and the OUT-OF-APP surfaces (#87): the iOS Live Activity
// (Lock Screen + Dynamic Island) and the Android ongoing notification.
//
// Native side lives in modules/philoi-live-activity (the bridge) and targets/lockin (the iOS widget
// extension). Both need a real EAS build — nothing here does anything over OTA or in Expo Go, and
// that's fine, because every function below degrades to a no-op rather than an error.
//
// TWO INVARIANTS, and they're the reason this file exists rather than the screens calling native
// directly:
//
// 1. NOTHING NATIVE AT MODULE SCOPE. The native module is reached through a lazy require() behind
//    `available()`, matching the convention in feature-flags.ts. This is the lesson from the
//    RevenueCat white screen: a native module resolved at import time takes the whole app down at
//    launch in any runtime that didn't compile it in.
// 2. THE TIMER IS NEVER SENT. `startedAtMs` goes over once and the OS counts up from it by itself —
//    Text(timerInterval:) on iOS, a chronometer notification on Android. There is deliberately no
//    "elapsed seconds" field anywhere in this file. Pushing ticks would burn ActivityKit's update
//    budget within minutes to display a number both platforms already know.

import { Platform } from 'react-native';

import { requestNotificationPermissions } from '@/lib/notifications';
import { RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';
import type { NativeLiveActivityState } from '../../modules/philoi-live-activity';

export type LiveActivityState = {
  /** The user's session label — "Study", "Gym", or their own goal detail. Empty string omits it. */
  sessionName: string;
  /** Epoch ms. The OS counts up from this ITSELF — see invariant 2 above. */
  startedAtMs: number;
  /** Drives the bar's fill colour: the CURRENT tier's metal, never a fixed gold. */
  tier: RankTierName;
  /** 0–1 progress through the current rank division. */
  rankRatio: number;
  /** "Gold III", or "Primordial" at the apex. Produced by formatRankTier. */
  rankLabel: string;
  /** "~2h", or null when there's no rate to project from — which hides the cue entirely. */
  projection: string | null;
  /**
   * The equipped flare's colour, or null for no flare (most users — there is no free flare).
   *
   * The flare became a LOCK-IN cosmetic in punchlist 15.2 rather than an app-wide one, so these
   * surfaces are how the flex still leaves the app: it is the same session, so it carries the same
   * colour. Frame only — border and accent. The rank bar keeps its tier metal and the timer stays
   * white, because those two carry meaning and the flare doesn't.
   */
  flareHex: string | null;
};

type NativeModule = {
  isAvailable: () => boolean;
  start: (state: NativeLiveActivityState) => Promise<string | null>;
  update: (state: NativeLiveActivityState) => Promise<void>;
  end: () => Promise<void>;
};

// `undefined` = not yet looked up, `null` = looked up and absent. Distinguishing them keeps the
// require() to once per launch instead of once per call.
let cached: NativeModule | null | undefined;

function native(): NativeModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('../../modules/philoi-live-activity').default as NativeModule | null;
  } catch {
    // A build without the module compiled in. Not an error worth reporting — it's the expected
    // state on every binary cut before this landed.
    cached = null;
  }
  return cached;
}

/**
 * Whether an out-of-app live surface can run right now.
 *
 * Three things have to hold: a platform that has one, a build that compiled the module in, and the
 * user not having switched it off (iOS Live Activities toggle, Android notification permission).
 * The last one is why this is a function call and not a constant — it can change mid-session.
 */
export function liveActivityAvailable(): boolean {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  const module = native();
  if (!module) return false;
  try {
    return module.isAvailable();
  } catch {
    return false;
  }
}

function toNative(state: LiveActivityState): NativeLiveActivityState {
  const metal = RANK_TIER_METAL[state.tier];
  return {
    sessionName: state.sessionName,
    startedAtMs: state.startedAtMs,
    // Clamped here rather than trusted: a ratio outside 0–1 would render as a bar overflowing its
    // own track on iOS, and Android's setProgress would silently peg it.
    rankRatio: Math.max(0, Math.min(1, state.rankRatio)),
    rankLabel: state.rankLabel,
    projection: state.projection,
    tierOuterHex: metal.outer,
    tierInnerHex: metal.inner,
    flareHex: state.flareHex,
  };
}

/**
 * Begin the live surface for a session.
 *
 * Android needs POST_NOTIFICATIONS granted at runtime before anything can show; iOS Live Activities
 * need no permission at all (the user-facing toggle is checked by `isAvailable`). A denied Android
 * prompt just means no notification — it must never block the lock-in itself, which is why the
 * result is ignored rather than thrown.
 */
export async function startLiveActivity(state: LiveActivityState): Promise<void> {
  if (!liveActivityAvailable()) return;
  try {
    if (Platform.OS === 'android') {
      const granted = await requestNotificationPermissions();
      if (!granted) return;
    }
    await native()?.start(toNative(state));
  } catch {
    // A cosmetic surface must never take a session down with it.
  }
}

/** Push a changed rank bar / projection. Rare by design — see invariant 2. */
export async function updateLiveActivity(state: LiveActivityState): Promise<void> {
  if (!liveActivityAvailable()) return;
  try {
    await native()?.update(toNative(state));
  } catch {
    // Ignored: a stale rank bar is a far smaller problem than a thrown error mid-session.
  }
}

/**
 * Tear the surface down when the session stops.
 *
 * Must also run on a COLD START that finds no active session: an activity outliving its session is
 * the worst failure this feature has — a lock screen insisting you're still locked in with a timer
 * counting into hours you didn't do. So this is called whenever the session resolves to null, not
 * only on an explicit stop (see active-session-context.tsx), and it deliberately does NOT check
 * `liveActivityAvailable()` first: if the user revoked the permission mid-session, `isAvailable`
 * goes false while the card is still on screen, and gating teardown on it would strand exactly the
 * notification we're trying to clear.
 */
export async function endLiveActivity(): Promise<void> {
  const module = native();
  if (!module) return;
  try {
    await module.end();
  } catch {
    // Nothing useful to do — the surface either cleared or was never there.
  }
}
