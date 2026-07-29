import type { RankTierName } from '@/types/database';

// Two-tone metal per tier (PHILOI_UI_SPEC.md §11's forge table) — outer/inner render the
// hexagon fill, numeral is the roman-numeral text color for contrast against inner. Infernal
// (renamed from "legend" — migration 0030) isn't metal — it's molten (outer/inner) with a
// shimmer target and no numeral (a flame vector instead, see hexagon-badge.tsx). Platinum
// predates this spec and isn't in its table — kept as a flat color (no visual change) since the
// spec never said to remove the tier, just didn't mention it.
export const RANK_TIER_METAL: Record<RankTierName, { outer: string; inner: string; numeral: string; shimmer?: string }> = {
  bronze: { outer: '#6E4423', inner: '#B87333', numeral: '#3A2410' },
  silver: { outer: '#6B7280', inner: '#C4CBD6', numeral: '#2B3038' },
  gold: { outer: '#9A6A12', inner: '#F5C542', numeral: '#4A3406' },
  platinum: { outer: '#5FA8A0', inner: '#5FA8A0', numeral: '#0B2B28' },
  diamond: { outer: '#2C6E76', inner: '#7FE0E8', numeral: '#06323A' },
  infernal: { outer: '#B0431E', inner: '#F2A33C', shimmer: '#F7B85A', numeral: '#4A1B0C' },
};

// Single representative color per tier — for call sites that just want one color, not the
// full two-tone treatment (e.g. profile.tsx's domain rank chips).
export const RANK_TIER_COLOR: Record<RankTierName, string> = Object.fromEntries(
  Object.entries(RANK_TIER_METAL).map(([tier, metal]) => [tier, metal.outer])
) as Record<RankTierName, string>;

export const RANK_TIER_LABEL: Record<RankTierName, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
  infernal: 'Infernal',
};

// Division 1 is the top sub-tier within a tier (matches rank_tier_for_score in schema.sql).
export const DIVISION_NUMERAL: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III' };

export function formatRankTier(tier: RankTierName, division: number): string {
  // Infernal is singular, no divisions (PHILOI_UI_SPEC.md §11: "don't dilute it into III/II/I").
  if (tier === 'infernal') return RANK_TIER_LABEL.infernal;
  return `${RANK_TIER_LABEL[tier]} ${DIVISION_NUMERAL[division] ?? division}`;
}

const TIER_ORDER: RankTierName[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'infernal'];

// Higher return value = higher rank. Division 1 is the top sub-tier within a tier, so it
// contributes more than division 3 (matches rank_tier_for_score's threshold direction).
export function rankOrdinal(tier: RankTierName, division: number): number {
  return TIER_ORDER.indexOf(tier) * 3 + (3 - division);
}

// xpForNextTier comes back 0 at max rank (Diamond I) — see get_my_ranks() in schema.sql.
export function formatXpProgress(xpIntoTier: number, xpForNextTier: number): string {
  if (xpForNextTier <= 0) return `${Math.round(xpIntoTier).toLocaleString()} XP — max rank`;
  return `${Math.round(xpIntoTier).toLocaleString()} / ${Math.round(xpForNextTier).toLocaleString()} XP`;
}

// Bare "into / forNext" numbers, no " XP" suffix or "max rank" copy — design-mocks/30 option
// B's vertical hero-row bars read tighter than the horizontal ones (formatXpProgress). Reused
// as-is for the fire side's "progress / goal" too (same shape: a running total over a target).
export function formatXpProgressCompact(xpIntoTier: number, xpForNextTier: number): string {
  if (xpForNextTier <= 0) return `${Math.round(xpIntoTier).toLocaleString()}`;
  return `${Math.round(xpIntoTier).toLocaleString()} / ${Math.round(xpForNextTier).toLocaleString()}`;
}

export function xpProgressRatio(xpIntoTier: number, xpForNextTier: number): number {
  if (xpForNextTier <= 0) return 1;
  return Math.max(0, Math.min(1, xpIntoTier / xpForNextTier));
}

export function isRankUp(
  before: { tier: RankTierName; division: number },
  after: { tier: RankTierName; division: number }
): boolean {
  return rankOrdinal(after.tier, after.division) > rankOrdinal(before.tier, before.division);
}

// "Reserve the full forge for crossing a tier... so the big ones stay rare and special"
// (PHILOI_UI_SPEC.md §21) — a same-tier division bump (e.g. Bronze III -> II) is still a rank
// up (isRankUp above) but should NOT trigger the full-screen forge, only a quiet inline pulse.
export function isTierCrossed(
  before: { tier: RankTierName },
  after: { tier: RankTierName }
): boolean {
  return before.tier !== after.tier;
}

// The full-screen tier-crossing flash effect keyed to the NEW tier (§11, design-mocks/31) — no
// entry for bronze (you can't cross INTO bronze, it's the starting tier). Platinum isn't named
// in the spec's effects table, so it falls back to the same plain metallic 'sweep' as Silver,
// tinted with its own RANK_TIER_METAL color — consistent with platinum's existing "kept flat,
// no special mention" treatment elsewhere.
export type TierFlashKind = 'sweep' | 'sparkle' | 'prism' | 'flame';

export const TIER_FLASH_KIND: Partial<Record<RankTierName, TierFlashKind>> = {
  silver: 'sweep',
  platinum: 'sweep',
  gold: 'sparkle',
  diamond: 'prism',
  infernal: 'flame',
};
