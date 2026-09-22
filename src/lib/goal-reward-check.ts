// "A goal just completed while the app is open — look for its crate now."
//
// GoalCompletionWatcher reads get_unseen_goal_rewards on mount and on every app foreground, which is
// the right trigger for grants that land with no client present (a vouch settling from pg_cron, a
// 48h window closing). It was the WRONG trigger for the commonest case: finishing a goal with the
// app open. The crate's receipt was written the same instant, and it then sat unrevealed until the
// user happened to background and reopen the app — sometimes hours after the moment.
//
// Same shape as wallet-refresh and rank-watch, for the same reason: the caller that knows a goal
// completed is a plain async module (lib/api/challenges.ts), not a component, so it cannot reach a
// context. It only asks for a READ. The inbox stays the server's; nothing here is granted or shown
// on its own.

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeToGoalRewardCheck(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Call once a goal has completed server-side. Safe to over-call — it is one read of the inbox. */
export function requestGoalRewardCheck(): void {
  listeners.forEach((listener) => listener());
}
