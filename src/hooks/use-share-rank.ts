import { useMyRanks } from '@/hooks/use-my-ranks';
import type { RankTierName } from '@/types/database';

// The rank stamped into every share card's footer (design-mocks/96: "the sharer's rank in a hex" —
// what turns a share into an install prompt with a status stamp).
//
// Always the UNIVERSAL rank, never a per-domain one: the footer says who you are on this app, and a
// card that stamped your running rank on a study session would be saying something narrower than
// the badge shape implies. Returns undefined until the ranks load, which the frame renders as a
// footer with no hex rather than a placeholder tier.
export function useShareRank(): { tier?: RankTierName; division?: number } {
  const { ranks } = useMyRanks();
  const universal = ranks.find((r) => r.scope === 'universal');
  return { tier: universal?.tier, division: universal?.division };
}
