import { useEffect, useState } from 'react';

import { fetchMyRanks } from '@/lib/api/goals';
import { fetchMyXpRate, hoursToNextDivision, type XpRate } from '@/lib/api/xp-rate';
import type { MyRank } from '@/types/database';

export type RankProjection = {
  rank: MyRank;
  rate: XpRate | null;
  /** Hours of locked-in time to the next division; null when there's no rate or at Primordial. */
  hoursToNext: number | null;
};

/**
 * The universal rank plus a projection to the next division (#87).
 *
 * Fetched once per mount rather than polled. Rank only moves when a check-in POSTS, which cannot
 * happen while a session is still running — so during a lock-in this data is genuinely static, and
 * re-fetching it on a timer would be network traffic that can never change the answer.
 *
 * The rank and the rate are fetched together but fail independently: a missing rate only costs the
 * "~2h" projection, and losing that should never also cost the bar itself.
 */
export function useRankProjection(enabled = true): RankProjection | null {
  const [state, setState] = useState<RankProjection | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      const [ranks, rate] = await Promise.all([
        fetchMyRanks().catch(() => null),
        fetchMyXpRate().catch(() => null),
      ]);
      if (cancelled || !ranks) return;

      const universal = ranks.find((r) => r.scope === 'universal');
      if (!universal) return;

      setState({
        rank: universal,
        rate,
        hoursToNext: hoursToNextDivision(universal.xp_into_tier, universal.xp_for_next_tier, rate),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}
