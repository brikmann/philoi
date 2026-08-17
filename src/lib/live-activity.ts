// The seam between a running lock-in and the OUT-OF-APP surfaces (#87): the iOS Live Activity
// (Lock Screen + Dynamic Island) and the Android ongoing notification.
//
// NOTHING IS WIRED YET, ON PURPOSE. Both surfaces need native code that does not exist in this repo
// — an iOS Widget Extension target with an ActivityKit attribute set, and @notifee/react-native for
// the Android foreground service — and neither can be added, compiled, or tested without a native
// EAS build. What this file does is fix the CALL SITES now, so when the native side lands the change
// is confined to the three functions below and nothing in the session lifecycle has to move.
//
// Every function is a safe no-op today. That is deliberate and it is the lesson from the RevenueCat
// white screen: a native module imported at module scope takes the whole app down at launch in any
// runtime that doesn't have it compiled in. So this file imports nothing native at the top level,
// and whatever gets added below must be lazily required behind the same `available()` guard.

import type { GoalType } from '@/types/database';

export type LiveActivityState = {
  /** The user's session label — "Study", "Gym", or their own goal detail. */
  sessionName: string;
  goalType: GoalType;
  /** Epoch ms. The OS counts up from this ITSELF — see the note in start(). */
  startedAtMs: number;
  /** 0–1 progress through the current rank division. */
  rankRatio: number;
  /** "Gold III", or "Primordial" at the apex. */
  rankLabel: string;
  /** "~2h", or null when there's no rate to project from. */
  projection: string | null;
};

/**
 * Whether an out-of-app live surface can run right now.
 *
 * False in every current build. When the native side lands this becomes a lazy require + a platform
 * and OS-version check (ActivityKit needs iOS 16.1+; the Android chip needs the foreground-service
 * permission), and it must stay the single gate every function below checks first.
 */
export function liveActivityAvailable(): boolean {
  return false;
}

/**
 * Begin the live surface for a session.
 *
 * THE TIMER MUST NOT BE PUSHED. On iOS the widget renders `Text(timerInterval:)`, and on Android
 * the notification uses a chronometer (`setUsesChronometer(true)` + `setWhen(startedAt)`) — both
 * count up on their own from a single start timestamp, with no updates from us at all. That's why
 * `startedAtMs` is in the state and an elapsed-seconds value is not: sending ticks would burn the
 * ActivityKit update budget within minutes and drain the battery for a number the OS already knows.
 *
 * Updates are pushed only when something the OS CAN'T derive changes — the rank bar, or the end of
 * the session.
 */
export async function startLiveActivity(_state: LiveActivityState): Promise<void> {
  if (!liveActivityAvailable()) return;
}

/** Push a changed rank bar / projection. Rare by design — see the note in start(). */
export async function updateLiveActivity(_state: LiveActivityState): Promise<void> {
  if (!liveActivityAvailable()) return;
}

/**
 * Tear the surface down when the session stops.
 *
 * Must also run on a COLD START that finds no active session: an activity outliving its session is
 * the worst failure this feature has — a lock screen insisting you're still locked in with a timer
 * counting into hours you didn't do. Call this whenever the session resolves to null, not only on
 * an explicit stop.
 */
export async function endLiveActivity(): Promise<void> {
  if (!liveActivityAvailable()) return;
}
