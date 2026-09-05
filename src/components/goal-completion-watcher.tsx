import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GoalCompleteRewardScreen } from '@/components/economy/goal-complete-reward-screen';
import { useRevealFloor } from '@/components/economy/reward-reveal';
import { ScreenBackground } from '@/components/ui/screen-background';
import { track } from '@/lib/analytics';
import { fetchUnseenGoalRewards, markGoalRewardSeen } from '@/lib/api/challenges';
import { useAuth } from '@/lib/auth/auth-context';
import { requestInventoryRefresh } from '@/lib/economy/wallet-refresh';
import type { UnseenGoalReward } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 🐛 A FINISHED GOAL PAID AND SAID NOTHING.
//
// A personal goal — a Cindy-scoped feat, an honour goal, a one-time target — pays a box and embers
// through economy_on_challenge_completed the moment `completed_at` is set. That grant has been
// landing correctly and landing SILENTLY: the crate turns up in the inventory later, the ledger
// moves, and nothing on screen ever marks the thing the user actually did.
//
// WHY NONE OF THE THREE MOUNTED WATCHERS COULD DRAW IT. This is structural rather than an
// oversight in any of them, and worth stating because the obvious fix — "extend the goal watcher"
// — does not work:
//
//   · GoalRevealWatcher draws the in-memory goal-reveal-queue, which is fed only by
//     economy_award_goal_day — the DAILY DRIP. A one-time scoped goal does not pay through it.
//   · ChallengeSettlementWatcher draws get_my_unseen_challenge_rewards (0137), which reads
//     `social_challenges`. A personal goal is a row in `challenges`.
//   · RankUpWatcher is rank-ups.
//
// `challenges` carried no grant receipt and no fire-once flag, so there was nothing for a watcher
// to read. 0167 added both, and this is the fourth watcher — same shape as the challenge one,
// because the problem is the same shape: something paid while nobody was looking.
//
// 🔴 IT HAS TO SURVIVE THE APP BEING SHUT, which is why the inbox is a server read and not a
// client memory. Two of the three completion paths resolve with no client present at all: a second
// vouch landing in-window, and settle_expired_vouches() closing a 48h window from pg_cron. The
// reveal for those can only fire on the next foreground, off a row the server stamped.
//
// 🔒 PRESENTATION ONLY. NOTHING HERE GRANTS ANYTHING. get_unseen_goal_rewards is a pure read over
// a receipt written at completion, and mark_goal_reward_seen can only set a timestamp. A watcher
// that awarded on presentation would pay twice for one goal.
//
// FIRE-ONCE IS THE SERVER'S FLAG. `challenges.reward_seen_at` is what the RPC filters on and what
// the dismiss stamps — so a celebrated goal survives a reinstall, cannot re-fire on a second
// device, and a second account signing in on this phone reads its own inbox (auth.uid() scopes it)
// rather than inheriting anything. There is no local queue to clear on sign-out for that reason;
// the only client-side leak left is a fetch still in flight when the session changes, and the queue
// below carries whose it is so that one renders nothing rather than needing a cleanup effect.
// ══════════════════════════════════════════════════════════════════════════════════════════════
export function GoalCompletionWatcher() {
  const { session } = useAuth();
  const router = useRouter();
  // The unseen set, TAGGED WITH WHOSE IT IS. A bare array would need an effect to clear it when the
  // session changes, and a setState in an effect body is what react-hooks/set-state-in-effect
  // rejects; carrying the owner makes "is this mine?" a derived question instead of a synchronised
  // one. See `current` below — a queue belonging to a signed-out account renders nothing.
  const [queue, setQueue] = useState<{ owner: string; rows: UnseenGoalReward[] }>({
    owner: '',
    rows: [],
  });
  // One check at a time. Mount and foreground can land together, and two in-flight reads would both
  // see the same unstamped rows and queue every reveal twice — the same guard the challenge
  // settlement watcher carries, for the same race.
  const checkingRef = useRef(false);
  const userId = session?.user.id ?? null;

  const check = useCallback(async () => {
    if (!userId || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const unseen = await fetchUnseenGoalRewards();
      if (unseen.length === 0) return;
      // Replaced, not appended: the RPC returns the authoritative unseen set every time, and
      // anything already shown has been stamped and is therefore no longer in it. Appending would
      // duplicate a still-open reveal on the next foreground.
      setQueue({ owner: userId, rows: unseen });
      // The grant landed server-side, possibly days ago — whatever balance is on screen predates
      // it. See lib/economy/wallet-refresh.ts.
      requestInventoryRefresh();
    } catch {
      // Ambient, like the rank and challenge checks: a failed read means the celebration waits for
      // the next foreground. The box and the embers are in the ledger either way.
    } finally {
      checkingRef.current = false;
    }
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    check();
  }, [check]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  // 🔒 SIGNED OUT, OR SIGNED IN AS SOMEBODY ELSE, SHOWS NOTHING. The rows are already scoped by
  // auth.uid() server-side, so a second account on this device cannot READ the first's unseen
  // goals — but a response still in flight when the session changed would land in this state and
  // render. Comparing the owner is what closes that window, and it needs no cleanup effect.
  const current = (userId && queue.owner === userId ? queue.rows[0] : null) ?? null;

  /**
   * Stamp it shown and move to the next.
   *
   * The stamp goes out BEFORE the queue advances and is deliberately not awaited: if the app is
   * killed mid-celebration the reveal is still recorded as consumed, which is the trade both other
   * watchers make. The alternative — stamp on success only — replays the whole thing on next launch.
   */
  const dismiss = useCallback((goalId: string) => {
    markGoalRewardSeen(goalId).catch(() => {});
    setQueue((q) => ({ ...q, rows: q.rows.slice(1) }));
  }, []);

  /** Same order challenge-info uses: consume the reveal first, then navigate. Pushing out from
   *  under an open Modal leaves it mounted over the box-open screen. */
  function handleOpenBox(goalId: string, boxId: string, boxKey: string) {
    dismiss(goalId);
    track('goal_reward_box_opened', { goal_id: goalId, box_key: boxKey });
    router.push({ pathname: '/shop/open', params: { boxIds: boxId, boxKey } });
  }

  // Held, not dropped: `queue` keeps the completion while another celebration has the floor, so a
  // goal finished in the same session as a rank-up plays in its own lane rather than being
  // swallowed. 'challenge_solo' is the row this reveal is tuned by, so it is the priority it queues
  // at — under the rank forge, over the daily fire.
  const hasFloor = useRevealFloor('challenge_solo', current !== null);

  if (!current || !hasFloor) return null;

  const boxId = current.payload?.box_id ?? null;
  const boxKey = current.payload?.box ?? null;

  return (
    <Modal visible animationType="fade" onRequestClose={() => dismiss(current.goal_id)} statusBarTranslucent>
      <ScreenBackground>
        <SafeAreaView style={styles.safe}>
          <GoalCompleteRewardScreen
            // Keyed by goal so two queued completions each get a fresh mount — otherwise the second
            // reuses the first's instance and its entrance, its fanfare and its build-in never fire
            // again. The same gotcha RankUpWatcher's presentToken exists for.
            key={current.goal_id}
            goal={current}
            onClose={() => dismiss(current.goal_id)}
            onOpenBox={
              boxId && boxKey ? () => handleOpenBox(current.goal_id, boxId, boxKey) : undefined
            }
          />
        </SafeAreaView>
      </ScreenBackground>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
});
