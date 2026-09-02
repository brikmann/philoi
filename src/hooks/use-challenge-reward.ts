import { useCallback, useEffect, useState } from 'react';

import { BOXES, type BoxKey } from '@/lib/economy/boxes';
import { fetchChallengeReward, markChallengeRewardSeen } from '@/lib/api/social-challenges';
import { isDuel, metricLabel } from '@/lib/challenge-metric';
import { placementTier } from '@/lib/challenge-reward-copy';
import type { ChallengeRewardResult } from '@/components/economy/challenge-reward-screen';
import type { ChallengeReward, SocialChallenge } from '@/types/database';

// The reveal's data half (0116, DECISION_reward_screen_and_goal_drip.md §campfire-3).
//
// grant_reward has always paid silently: embers into the wallet, a box into the inventory, a badge
// minted, and nothing on screen to say so — the most rewarding moment in the app was its quietest.
// 0116 captures what it paid; this is the read, plus the fire-once bookkeeping around it.
//
// FIRE-ONCE IS THE SERVER'S FLAG, NOT LOCAL STATE. `seen_at` lives on challenge_participants, so
// the reveal survives a reinstall, does not re-fire on a second device, and cannot be re-triggered
// by remounting the screen. The optimistic local flip below is only so dismiss feels instant; the
// stamp it mirrors is the durable one.

export type ChallengeRewardState = {
  /** Null while loading, or when there is nothing to reveal (non-participant, unsettled, pre-0111). */
  reward: ChallengeReward | null;
  /** True on the FIRST view of a settled challenge this user raced in. */
  owed: boolean;
  /** Stamps reward_seen_at and closes the reveal. Safe to call twice — the RPC no-ops. */
  dismiss: () => void;
};

export function useChallengeReward(challengeId: string, enabled: boolean): ChallengeRewardState {
  const [reward, setReward] = useState<ChallengeReward | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchChallengeReward(challengeId)
      .then((r) => live && setReward(r))
      // Silent. The reveal is a flourish on top of rewards that have already landed in the ledger;
      // a failed read must never take the standings block down with it.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [challengeId, enabled]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    markChallengeRewardSeen(challengeId).catch(() => {});
  }, [challengeId]);

  // `placement != null` is the real gate, not just `seen_at == null`: a challenge that settled
  // before 0111 wrote standings has nothing to reveal, and an empty reveal is worse than none.
  const owed = Boolean(reward && reward.placement != null && reward.seen_at == null && !dismissed);

  return { reward, owed, dismiss };
}

/**
 * The read → what mock 47's screen renders.
 *
 * Everything monetary comes from the payload and nothing is recomputed here: a screen that derived
 * its own ember figure from the same inputs would eventually disagree with the ledger, and the
 * ledger is what moved. What IS derived is presentation — which copy pool, which medal, how loud
 * the burst — none of which the server has an opinion about.
 */
export function challengeRewardResult(
  reward: ChallengeReward,
  // `created_by_name` is widened to nullable against SocialChallenge's own declaration. The body
  // already treats both names as possibly absent (the `?? null` on opponentName below), and
  // get_my_unseen_challenge_rewards (0137) LEFT JOINs profiles, so a deleted creator genuinely
  // comes back null there. Widening the parameter is honest about what the function accepts rather
  // than making the settlement watcher cast a null into a string it would then have to render.
  challenge: Pick<
    SocialChallenge,
    'shape' | 'mode' | 'race_metric' | 'window_hours' | 'opponent_id' | 'opponent_name'
  > & { created_by_name: string | null },
  myUserId: string | undefined
): ChallengeRewardResult {
  const duel = isDuel(challenge);
  const payload = reward.payload;

  return {
    tier: placementTier({
      absoluteRank: reward.placement,
      // INVERTED on purpose. final_percentile is stored the way the standings read it — 1.0 is the
      // top of the board (0111: `1.0 - (rank - 1) / (n - 1)`) — and placementTier counts the other
      // way, 0 = top. Passing it through unturned would hand a champion the Fraud Watch pool.
      percentile: reward.percentile == null ? null : 1 - reward.percentile,
      boardSize: reward.field_size,
    }),
    // A 1v1 loss must never draw the board set's "Fraud Watch" copy — the whole reason this axis
    // exists (CHALLENGE_REWARD_COPY.md).
    context: duel ? 'duel' : 'board',
    // WHERE THEY CAME, AND OUT OF HOW MANY (#183/#186). These three used to be consumed into
    // `tier` above and thrown away, so the reveal could say "TOP 25%" but never "12th of 48" — and
    // a 3-person campfire race and a 48-person one settled to the identical screen. That is the
    // whole of Noah's point: winning a race with lots of people has to FEEL bigger than winning a
    // race with two, and the only thing that carries that is the size of the field you beat.
    //
    // Passed through raw. `tier` is a bucket and buckets round: 1st of 3 and 1st of 300 are both
    // `rank1`. The screen needs the numbers themselves to say which race this was.
    placement: reward.placement,
    fieldSize: reward.field_size,
    // Kept in placementTier's orientation (0 = top of the board), NOT the stored one, so nothing
    // downstream has to remember which way this particular copy is turned. One flip, here, next to
    // the other one.
    percentile: reward.percentile == null ? null : 1 - reward.percentile,
    // Only on a win, and only in a duel: the sub-line reads "You beat Dee", which is a lie in
    // second place and meaningless in a group race.
    opponentName:
      duel && reward.placement === 1
        ? (myUserId === challenge.opponent_id ? challenge.created_by_name : challenge.opponent_name) ?? null
        : null,
    metricLabel: metricLabel(challenge.race_metric),
    durationLabel: `${challenge.window_hours}h`,
    xp: reward.xp,
    // Null payload is the pre-0114 case (grant_reward raised before it could return) and the
    // completion band (which pays no box and no badge). Both render as placement + XP, which is
    // still a result worth showing.
    embers: payload?.embers ?? 0,
    box: boxRow(payload?.box ?? null, payload?.box_id ?? null),
    badge: badgeRow(payload?.badge ?? null, payload?.band ?? null),
  };
}

function boxRow(key: string | null, id: string | null): ChallengeRewardResult['box'] {
  if (!key) return null;
  const box = BOXES[key as BoxKey];
  // A box key this build's catalog doesn't know (a server-side addition ahead of the app) is
  // dropped rather than rendered as "undefined" — the box is in their inventory either way.
  if (!box) return null;
  // `id` may be null on a challenge settled before 0125 taught grant_reward to report which row it
  // minted. The box still renders; only the Open CTA is withheld, because the alternative is a CTA
  // that opens whichever same-key box happened to sort first.
  return { id, key: box.key, name: box.name, rarity: box.rarity };
}

/**
 * grant_reward stores the badge KEY ('challenge-elite'); the human label it minted alongside is on
 * the badge row, not in the payload. Rebuilt from the band using the function's own rule
 * (`initcap(band) || ' challenge win'`) rather than fetching it — one extra round trip to restate
 * a string this side already has every input for.
 */
function badgeRow(key: string | null, band: string | null): ChallengeRewardResult['badge'] {
  if (!key) return null;
  const label = band ? `${band.charAt(0).toUpperCase()}${band.slice(1)} challenge win` : 'Challenge win';
  return { key, name: label };
}
