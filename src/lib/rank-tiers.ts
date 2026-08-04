import type { RankTierName } from '@/types/database';

// Two-tone metal per tier (RANK_REWORK_SPEC.md §2, design-mocks/77) — outer is the border,
// inner the fill, `numeral` the roman-numeral color chosen for contrast AGAINST inner, and
// `text` the label color for use on the app's dark background. Primordial isn't metal — it's
// molten, with a shimmer target and no numeral at all (a flame vector instead, see
// hexagon-badge.tsx); it inherits the molten palette the apex has always used.
export const RANK_TIER_METAL: Record<
  RankTierName,
  { outer: string; inner: string; numeral: string; text: string; shimmer?: string }
> = {
  // ── the mortal climb ──
  bronze: { outer: '#6E4423', inner: '#B87333', numeral: '#3A2410', text: '#B87333' },
  silver: { outer: '#6B7280', inner: '#C4CBD6', numeral: '#2B3038', text: '#C4CBD6' },
  gold: { outer: '#9A6A12', inner: '#F5C542', numeral: '#4A3406', text: '#F5C542' },
  // Recolored from a flat teal to a cool silver so it stops blurring into Diamond and the gems.
  platinum: { outer: '#6E8B98', inner: '#A7C7D4', numeral: '#22333B', text: '#C4DAE3' },
  diamond: { outer: '#2C6E76', inner: '#7FE0E8', numeral: '#06323A', text: '#7FE0E8' },
  // ── the realm of legend ──
  // Numerals aren't in the spec's table (it lists border/fill/label); each is a darkened cast of
  // its own `inner` so the roman numeral stays legible on the fill rather than vanishing into it.
  hero: { outer: '#8F2E28', inner: '#E0574C', numeral: '#4A1310', text: '#F0897E' },
  titan: { outer: '#1E5E4A', inner: '#4FA88C', numeral: '#0C2E24', text: '#7FD4B8' },
  olympian: { outer: '#C0A24E', inner: '#F7E9C0', numeral: '#4A3A12', text: '#FBF1D4' },
  immortal: { outer: '#8E6BC8', inner: '#EAE2FA', numeral: '#33245C', text: '#E4D6FF' },
  // ── the apex ──
  primordial: { outer: '#B0431E', inner: '#F2A33C', shimmer: '#F7B85A', numeral: '#4A1B0C', text: '#F7B85A' },
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
  hero: 'Hero',
  titan: 'Titan',
  olympian: 'Olympian',
  immortal: 'Immortal',
  primordial: 'Primordial',
};

// Division 1 is the top sub-tier within a tier (matches rank_tier_for_score in schema.sql).
export const DIVISION_NUMERAL: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III' };

export function formatRankTier(tier: RankTierName, division: number): string {
  // Primordial is singular, no divisions (PHILOI_UI_SPEC.md §11: "don't dilute it into III/II/I").
  // The threshold row stores division 1 purely so ordinal arithmetic keeps it above Immortal I.
  if (tier === 'primordial') return RANK_TIER_LABEL.primordial;
  return `${RANK_TIER_LABEL[tier]} ${DIVISION_NUMERAL[division] ?? division}`;
}

// Exported so anything that needs to walk the whole ladder (the dev rank previewer, any future
// "rank ladder" screen) derives it from here rather than keeping its own copy that drifts.
export const RANK_TIER_ORDER: RankTierName[] = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'hero',
  'titan',
  'olympian',
  'immortal',
  'primordial',
];

// Higher return value = higher rank. Division 1 is the top sub-tier within a tier, so it
// contributes more than division 3 (matches rank_tier_for_score's threshold direction).
export function rankOrdinal(tier: RankTierName, division: number): number {
  return RANK_TIER_ORDER.indexOf(tier) * 3 + (3 - division);
}

// xpForNextTier comes back 0 at max rank (Primordial) — see get_my_ranks() in schema.sql.
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
// entry for bronze (you can't cross INTO bronze, it's the starting tier). Each flash is tinted
// from the tier's own RANK_TIER_METAL color, so 'sweep' at Hero doesn't look like 'sweep' at
// Silver. Per RANK_REWORK_SPEC.md §2: the gem-like tiers get the iridescent 'prism', the
// gold-toned ones 'sparkle', the metals a plain 'sweep', and only the apex keeps 'flame'.
export type TierFlashKind = 'sweep' | 'sparkle' | 'prism' | 'flame';

export const TIER_FLASH_KIND: Partial<Record<RankTierName, TierFlashKind>> = {
  silver: 'sweep',
  gold: 'sparkle',
  platinum: 'sweep',
  diamond: 'prism',
  hero: 'sweep',
  titan: 'prism',
  olympian: 'sparkle',
  immortal: 'prism',
  primordial: 'flame',
};
