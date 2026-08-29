import { useSyncExternalStore } from 'react';

import type { GoalDayAward } from '@/lib/api/challenges';

// Goal payouts that landed WITHOUT anybody asking, waiting to be celebrated.
//
// 🐛 WHY THIS IS A STORE AND NOT SCREEN STATE. A personal goal can be completed by two very
// different things. One is a tap: ChallengeCard logs progress and hands the server's payout back up
// through `onLogged`, which the Challenges tab turns into mock 103's reward screen. The other is a
// device sync — Health Connect filling the last of a 10k-step goal on focus, or the immediate sync
// challenge/create.tsx fires right after you connect — and that path has no card, no callback and
// (in create.tsx's case) no screen left mounted by the time it resolves. It ran through the exact
// same `logChallengeProgress`, banked exactly the same embers, and showed nothing. That is Noah's
// "completing a goal awards embers but no animation plays".
//
// Putting the queue here rather than inside useMyChallenges is what makes the two callers of
// `syncChallengeFromDevice` equivalent: neither has to be watching, or even mounted, for the payout
// to survive until something can draw it. Same shape as lib/economy/wallet-refresh.ts and
// lib/rank-watch.ts's recheck channel — a plain module, because the producers are plain async
// functions that cannot reach a context.
//
// A QUEUE. Two goals can finish on one sync (a week away, a daily and a weekly both filling), and a
// single slot would have the second overwrite the first before either was seen.
//
// 🔒 PRESENTATION ONLY. What is queued is a record of a payout the server already made. Nothing
// here grants, and nothing re-derives an ember figure — dropping an entry loses a celebration, never
// a reward.

export type PendingGoalReveal = {
  /** Exactly what economy_award_goal_day said it paid. */
  award: GoalDayAward;
  /** "10,000 steps" — the goal in its own words, for the reveal's sub-line. */
  goalLabel: string;
};

// In-memory only, and deliberately so: this is "something just happened", not a durable inbox. A
// payout that never got its animation because the app was killed mid-flight is a lost flourish; the
// embers are in the ledger and the Challenges tab shows the goal as done either way. Persisting it
// would mean a celebration firing days later with no context, which is worse than none.
let queue: PendingGoalReveal[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** Called by any sync that completed a goal and got a real payout back. */
export function pushGoalReveal(reveal: PendingGoalReveal): void {
  queue = [...queue, reveal];
  emit();
}

/** Retire the head — call once its reveal has been dismissed. */
export function shiftGoalReveal(): void {
  if (queue.length === 0) return;
  queue = queue.slice(1);
  emit();
}

/** Sign-out cleanup, so the next account on this device cannot inherit a celebration. */
export function clearGoalReveals(): void {
  if (queue.length === 0) return;
  queue = [];
  emit();
}

// useSyncExternalStore rather than a subscribe-and-setState effect: the queue IS an external store,
// this is the API React provides for exactly that, and it keeps the reveal out of the
// cascading-render territory a mirroring effect would put it in.
//
// The snapshot is the array itself, and every mutation above replaces it wholesale — returning a
// freshly-built value here instead would hand React a new identity on every render and spin.
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => queue;

/** The next goal payout owed a reveal, or null. */
export function useNextGoalReveal(): PendingGoalReveal | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)[0] ?? null;
}
