import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChallengeRewardScreen } from '@/components/economy/challenge-reward-screen';
import { ChallengeWinShareCard } from '@/components/economy/challenge-win-share-card';
import { useRevealFloor } from '@/components/economy/reward-reveal';
import { ScreenBackground } from '@/components/ui/screen-background';
import { challengeRewardResult } from '@/hooks/use-challenge-reward';
import { useShareRank } from '@/hooks/use-share-rank';
import { track } from '@/lib/analytics';
import { fetchUnseenChallengeRewards, markChallengeRewardSeen } from '@/lib/api/social-challenges';
import { useAuth } from '@/lib/auth/auth-context';
import { metricLabel } from '@/lib/challenge-metric';
import { challengeRevealKind } from '@/lib/challenge-outcome';
import { requestInventoryRefresh } from '@/lib/economy/wallet-refresh';
import { shareCardImage } from '@/lib/share-card';
import type { UnseenChallengeReward } from '@/types/database';

// 🐛 CHALLENGE REWARDS LANDED BUT NEVER CELEBRATED. Confirmed with Noah: a settled H2H, group or
// placement race genuinely pays — embers in the wallet, a box in the inventory, a row in the feed —
// and no reveal or animation ever plays.
//
// The reveal itself was built (0118, ChallengeRewardScreen against mock 47). What was missing is a
// WATCHER. Settlement is asynchronous and server-side: pg_cron's finalize_social_challenges flips
// the status and the economy trigger pays, almost always while the app is shut. The only client
// that could notice was `useChallengeReward` inside challenge-info/[challengeId].tsx — so the
// reveal fired if, and only if, the user happened to navigate to that one challenge's info screen.
// challenges.tsx covers goal-STREAK payouts and nothing else. Rank-ups have had a global watcher
// for exactly this reason since punchlist 5.6; challenges did not.
//
// Modelled on RankUpWatcher: mount once in the root layout, check on mount and on foreground,
// present what landed while nobody was looking.
//
// 🔒 REVEAL ONLY. NOTHING HERE GRANTS ANYTHING. grant_reward already moved the embers, minted the
// box and wrote the badge at settlement; every figure on screen comes back from
// get_my_unseen_challenge_rewards, which is a pure read over what was written then. A watcher that
// awarded on presentation would pay twice for one race.
//
// FIRE-ONCE IS THE SERVER'S FLAG, not an AsyncStorage set. `challenge_participants.reward_seen_at`
// (0118) is what the RPC filters on and what `markChallengeRewardSeen` stamps — so a celebrated
// challenge survives a reinstall, cannot re-fire on a second device, and shares one budget with the
// challenge-info reveal: seeing it in either place consumes it in both. A local "already
// celebrated" set could promise none of those three.
export function ChallengeSettlementWatcher() {
  const { session, profile } = useAuth();
  const router = useRouter();
  const shareRank = useShareRank();
  const [queue, setQueue] = useState<UnseenChallengeReward[]>([]);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef<View>(null);
  // One check at a time. Mount and foreground can land together, and two in-flight reads would both
  // see the same unstamped rows and queue every reveal twice.
  const checkingRef = useRef(false);
  const userId = session?.user.id ?? null;

  const check = useCallback(async () => {
    if (!userId || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const unseen = await fetchUnseenChallengeRewards();
      if (unseen.length === 0) return;
      // Replaced, not appended: the RPC returns the authoritative unseen set every time, and
      // anything already shown has been stamped and is therefore no longer in it. Appending would
      // duplicate a still-open reveal on the next foreground.
      setQueue(unseen);
      // The payout landed server-side, possibly days ago — whatever balance is on screen predates
      // it. See lib/economy/wallet-refresh.ts.
      requestInventoryRefresh();
    } catch {
      // Ambient, like the rank check: a failed read just means the celebration waits for the next
      // foreground. The rewards are in the ledger either way.
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

  const current = queue[0] ?? null;
  // `challengeRewardResult` takes the challenge shape the info screen passes it. The row carries
  // exactly those columns (0137), so this is a rename, not a second derivation of anything.
  const result =
    current && current.placement != null
      ? challengeRewardResult(
          {
            placement: current.placement,
            percentile: current.percentile,
            field_size: current.field_size,
            xp: current.xp,
            seen_at: null,
            payload: current.payload,
          },
          current,
          session?.user.id
        )
      : null;

  /**
   * Stamp it shown and move to the next.
   *
   * The stamp goes out BEFORE the queue advances and is deliberately not awaited: if the app is
   * killed mid-celebration the reveal is still recorded as consumed, which is the same trade
   * RankUpWatcher makes by writing the rank before showing the forge. The alternative — stamp on
   * success only — replays the whole celebration on next launch.
   */
  const dismiss = useCallback((challengeId: string) => {
    markChallengeRewardSeen(challengeId).catch(() => {});
    setQueue((rest) => rest.slice(1));
  }, []);

  async function handleShare() {
    setSharing(true);
    try {
      await shareCardImage(cardRef, 'Share your result');
    } finally {
      setSharing(false);
    }
  }

  /** Same order challenge-info uses: consume the reveal first, then navigate. Pushing out from
   *  under an open Modal leaves it mounted over the box-open screen. */
  function handleOpenBox(challengeId: string, boxId: string, boxKey: string) {
    dismiss(challengeId);
    track('challenge_reward_box_opened', { challenge_id: challengeId, box_key: boxKey });
    router.push({ pathname: '/shop/open', params: { boxIds: boxId, boxKey } });
  }

  // Which of the three challenge reveals this is, so it queues at its own priority. Shared with
  // challenge-info, which presents the SAME reveal through the other door and has to agree with
  // this about what kind it is — see challengeRevealKind.
  const revealKind = challengeRevealKind(current ?? {});
  // Held, not dropped: `queue` keeps the settlement while another celebration has the floor, so a
  // rank-up landing in the same moment delays this reveal rather than swallowing it.
  const hasFloor = useRevealFloor(revealKind, Boolean(current && result));

  if (!current || !result || !hasFloor) return null;

  return (
    <Modal visible animationType="fade" onRequestClose={() => dismiss(current.challenge_id)} statusBarTranslucent>
      <ScreenBackground>
        <SafeAreaView style={styles.safe}>
          <ChallengeRewardScreen
            // Keyed by challenge so two queued settlements each get a fresh mount — otherwise the
            // second reuses the first's instance, its one-per-mount headline never rerolls and its
            // entrance animation never restarts. The same reason RankUpWatcher keys on a token.
            key={current.challenge_id}
            result={result}
            displayName={profile?.display_name ?? 'you'}
            // The same kind this watcher took the floor with, so the rays are tinted by the row
            // that ordered the queue rather than by a second guess at the shape.
            revealKind={revealKind}
            onShare={handleShare}
            sharing={sharing}
            onClose={() => dismiss(current.challenge_id)}
            onOpenBox={
              result.box?.id
                ? () => handleOpenBox(current.challenge_id, result.box!.id!, result.box!.key)
                : undefined
            }
          />
          {/* Off-screen, so captureRef has a laid-out card the instant Share is tapped. */}
          <View style={styles.offscreenCard} pointerEvents="none">
            <ChallengeWinShareCard
              ref={cardRef}
              tier={result.tier}
              contextLine={current.public_name?.trim() || metricLabel(current.race_metric)}
              metricLabel={metricLabel(current.race_metric)}
              handle={profile?.handle ?? null}
              rankTier={shareRank.tier}
              division={shareRank.division}
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
  offscreenCard: {
    position: 'absolute',
    top: -10000,
    left: 0,
  },
});
