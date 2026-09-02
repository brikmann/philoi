import { BOXES, type BoxKey } from '@/lib/economy/boxes';
import type { ChallengeRewardPayload } from '@/types/database';

/**
 * WHAT A SETTLED CHALLENGE PAID, as a durable line — not as a one-shot animation.
 *
 * 🔴 Noah: "After you win, the reward reveal is the ONLY place the rewards appear." The reveal
 * fires once, `reward_seen_at` is stamped, and from then on the History row said "You won +200 XP"
 * and the standings screen printed an XP column — neither able to mention the embers or the box,
 * because neither was reading the payload that names them. A win became less legible the day after
 * it happened.
 *
 * The figures are grant_reward's own, stored at settlement (0118/0125) and selected by 0154.
 * NOTHING HERE IS DERIVED FROM THE CHALLENGE. A screen that recomputed an ember figure from the
 * band and the field size would eventually disagree with the wallet, and the wallet is what moved
 * — the same rule get_challenge_results was written under.
 *
 * Returns an EMPTY ARRAY rather than a placeholder when nothing was paid. A challenge that settled
 * on the completion band genuinely pays no box, an expired group race pays nothing at all, and
 * "+0 XP · 0 embers" reads like a bug rather than like a result.
 */
export type RewardChip = {
  /** 'xp' | 'embers' | 'box' | 'badge' — the caller picks the icon and tint. */
  kind: 'xp' | 'embers' | 'box' | 'badge';
  text: string;
};

export function rewardChips(
  awardedXp: number | null | undefined,
  payload: ChallengeRewardPayload | null | undefined
): RewardChip[] {
  const chips: RewardChip[] = [];

  if (awardedXp && awardedXp > 0) {
    chips.push({ kind: 'xp', text: `+${awardedXp.toLocaleString('en-US')} XP` });
  }
  if (payload?.embers && payload.embers > 0) {
    chips.push({ kind: 'embers', text: `+${payload.embers.toLocaleString('en-US')} embers` });
  }
  if (payload?.box) {
    // Named from the local catalog rather than printed raw: the payload stores the KEY
    // ('hephaestus'), and "hephaestus" on a result row is a database value leaking onto a screen.
    // An unknown key falls back to the key itself rather than being dropped — a box that was
    // genuinely won must still show up if the catalog and the server ever disagree.
    const box = BOXES[payload.box as BoxKey];
    chips.push({ kind: 'box', text: box ? box.name : payload.box });
  }
  if (payload?.badge && payload.band) {
    // The label is rebuilt from `band`, exactly as the reveal does it — the payload stores the key
    // ('challenge-elite') and the human name lives nowhere on the row.
    chips.push({ kind: 'badge', text: `${payload.band[0].toUpperCase()}${payload.band.slice(1)} badge` });
  }

  return chips;
}

/** The same thing as one line, for a card that has room for a sentence and not a chip row. */
export function rewardSummaryLine(
  awardedXp: number | null | undefined,
  payload: ChallengeRewardPayload | null | undefined
): string | null {
  const chips = rewardChips(awardedXp, payload);
  return chips.length === 0 ? null : chips.map((c) => c.text).join(' · ');
}
