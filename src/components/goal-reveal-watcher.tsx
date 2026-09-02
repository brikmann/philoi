import { useCallback, useEffect, useRef } from 'react';
import { AppState, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GoalStreakRewardScreen } from '@/components/economy/goal-streak-reward-screen';
import { useRevealFloor } from '@/components/economy/reward-reveal';
import { ScreenBackground } from '@/components/ui/screen-background';
import { useFitnessConnection } from '@/hooks/use-fitness-connection';
import { useStravaConnection } from '@/hooks/use-strava-connection';
import { useWhoopConnection } from '@/hooks/use-whoop-connection';
import { syncAllDeviceChallenges } from '@/lib/api/fitness-challenge-sync';
import { useActiveSession } from '@/lib/active-session-context';
import { useAuth } from '@/lib/auth/auth-context';
import { shiftGoalReveal, useNextGoalReveal } from '@/lib/goal-reveal-queue';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §A — A GOAL CELEBRATES WHERE IT WAS ACHIEVED, NOT WHERE IT HAPPENS TO BE NOTICED.
//
// Two halves of one problem, and they were both "the Challenges tab":
//
//   · WHEN. The only thing that ever ran a device sync was useMyChallenges, on focus of that one
//     tab. Hitting 10,000 steps on a walk banked the embers server-side whenever the user next
//     opened it — an hour later, a day later — so the payout and the achievement were unrelated
//     events. The dopamine is at the target, and it was being spent on a tab visit.
//
//   · WHERE. lib/goal-reveal-queue.ts already collected payouts nobody had asked for, and the only
//     consumer was challenges.tsx. A goal finished mid-lock-in sat in that queue until the user
//     navigated to the tab it was drawn on.
//
// So this is mounted once, in the root layout, next to RankUpWatcher and ChallengeSettlementWatcher
// — the two celebrations that already learned this lesson. It both LOOKS for completions and DRAWS
// them, from anywhere in the app.
//
// THROUGH THE FLOOR, like everything else. `useRevealFloor` is what stops this stacking on top of a
// rank-up forge or a settled duel; a goal payout is the smallest of the three, so it plays first and
// the crescendo still lands last (REVEAL_TUNING.priority). Holding the floor rather than dropping
// the event means a goal finished during a session that ALSO ranks the user up is still celebrated,
// just second.
//
// 🔒 PRESENTATION ONLY. NOTHING HERE GRANTS ANYTHING. economy_award_goal_day paid when the progress
// was logged; the queue carries a record of that payout, and dropping one loses a flourish, never a
// reward. The sync below writes progress the user actually walked — it is the same
// logChallengeProgress the tab has always called, moved somewhere it can run in time.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * How often to re-read the health store while a lock-in is running.
 *
 * The floor on "immediately". A goal cannot complete in the app's eyes until something asks the
 * device for a number, and asking costs a real query — so this is the trade between "the instant it
 * happens" and reading a health store in a loop for the length of a study session. A minute is
 * close enough that the celebration still belongs to the walk, and cheap enough that an hour-long
 * session costs sixty reads rather than one per frame.
 *
 * Only while a session is ACTIVE. With no session running there is nothing to interrupt and the
 * foreground check below is enough.
 */
const LOCKED_IN_SYNC_MS = 60_000;

export function GoalRevealWatcher() {
  const { session } = useAuth();
  const { session: activeSession } = useActiveSession();
  const { connected: deviceFitnessConnected } = useFitnessConnection();
  const { connected: stravaConnected } = useStravaConnection();
  const { connected: whoopConnected } = useWhoopConnection();

  const pending = useNextGoalReveal();
  const hasFloor = useRevealFloor('daily_fire', pending !== null);

  const userId = session?.user.id ?? null;
  const anySource = deviceFitnessConnected || stravaConnected || whoopConnected;
  // One sweep at a time. A foreground and an interval tick can land together, and two in-flight
  // syncs would both submit the same delta — the same reasoning ChallengeSettlementWatcher's
  // `checkingRef` carries.
  const sweeping = useRef(false);

  const sweep = useCallback(async () => {
    if (!userId || !anySource || sweeping.current) return;
    sweeping.current = true;
    try {
      await syncAllDeviceChallenges(userId);
    } catch {
      // Ambient, like the rank check. §18: a device sync never gates participation, and a failed
      // read just means the next tick tries again. The manual log always works.
    } finally {
      sweeping.current = false;
    }
  }, [userId, anySource]);

  // On mount and on every foreground — the catch-up path, for a goal finished while the app was
  // shut or backgrounded on the walk itself.
  useEffect(() => {
    sweep();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') sweep();
    });
    return () => sub.remove();
  }, [sweep]);

  // And on a slow tick while a lock-in runs, which is the case §A is really about: the user is
  // inside the app, the flame is on screen, and the target gets hit mid-session. Cleared the moment
  // the session ends, so an idle app is never polling a health store.
  useEffect(() => {
    if (!activeSession) return;
    const timer = setInterval(sweep, LOCKED_IN_SYNC_MS);
    return () => clearInterval(timer);
  }, [activeSession, sweep]);

  if (!pending || !hasFloor) return null;

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={shiftGoalReveal}>
      <ScreenBackground>
        {/* The reveal's own rays bleed past this on purpose — see FullscreenRays. Only the content
            is inset. */}
        <SafeAreaView style={styles.safe}>
          <View style={styles.body}>
            <GoalStreakRewardScreen
              // Keyed by the payout, so a second goal finishing behind the first gets a fresh mount
              // rather than reusing this instance — otherwise its one-per-mount entrance, burst and
              // fanfare never fire again. Same gotcha RankUpWatcher's presentToken exists for.
              key={`${pending.goalLabel}-${pending.award.streak}-${pending.award.embers}`}
              award={pending.award}
              goalLabel={pending.goalLabel}
              onClose={shiftGoalReveal}
            />
          </View>
        </SafeAreaView>
      </ScreenBackground>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
});
