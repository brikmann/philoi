import type { RankTierName } from '@/types/database';

// Two-tone metal per tier (RANK_REWORK_SPEC.md §2, design-mocks/77) — outer is the border,
// inner the fill, `numeral` the roman-numeral color chosen for contrast AGAINST inner, and
// `text` the color the division chevrons and the tier label take on the app's dark background.
// Primordial isn't metal — it's molten, with a shimmer target and no divisions at all (an ember
// sun instead, see rank-badge.tsx); it inherits the molten palette the apex has always used.
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
  // 🔴 ENUM KEY STAYS `olympian`, LABEL IS "Divine" (trademark). The USOPC holds "Olympian" in the
  // US and the IOC holds the family internationally; a paid app with a rank tier called Olympian
  // is the exact use they enforce against. The key is load-bearing — rank_thresholds rows, the
  // last-seen-rank baselines already written to every installed device's SecureStore, the sound
  // and lottie keys, `rankup-olympian.mp3` on disk — so renaming it would be a data migration
  // plus an asset shuffle to fix a string only this table ever shows a human. Nothing but this
  // line, and the emblem in rank-badge.tsx, is user-facing.
  olympian: 'Divine',
  immortal: 'Immortal',
  primordial: 'Primordial',
};

// 🔴 III IS THE TOP OF EACH TIER (Noah's call: "3 = top" is what people already recognise).
//
// The STORED division still runs the other way — `rank_thresholds` gives division 3 to the lowest
// cumulative-XP row in a tier and 1 to the highest, and rank_tier_for_score, rankOrdinal and
// nextRank all depend on that direction. Flipping the data would mean a migration, a re-derive of
// every threshold row, and a stale baseline on every device that has one written (rank-watch.ts).
//
// So only the LABEL inverts, here, once: stored 3 reads "I", stored 1 reads "III". The XP required
// for each rung is untouched, and so is rank-up detection — `rankOrdinal` never sees a numeral.
// Everything that shows a numeral goes through this map or `divisionMarks`; nothing derives one.
export const DIVISION_NUMERAL: Record<number, string> = { 3: 'I', 2: 'II', 1: 'III' };

/**
 * The displayed numeral as a COUNT — 1 for I, 3 for III — which is what the badge needs: chevrons
 * match the numeral and the frame gains detail as it climbs (mock 213). Clamped to 1–3 so a
 * malformed division can't ask for a fourth chevron the geometry has no room for.
 */
export function divisionMarks(division: number): number {
  return Math.max(1, Math.min(3, 4 - division));
}

export function formatRankTier(tier: RankTierName, division: number): string {
  // Primordial is singular, no divisions (PHILOI_UI_SPEC.md §11: "don't dilute it into I/II/III").
  // The threshold row stores division 1 purely so ordinal arithmetic keeps it above Immortal's top.
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

// Higher return value = higher rank. STORED division 1 is the top sub-tier within a tier (it is
// displayed as "III" — see DIVISION_NUMERAL), so it contributes more than stored division 3.
// Matches rank_tier_for_score's threshold direction, which the numeral flip deliberately left
// alone: no numeral appears anywhere in this function, so rank-up detection is unaffected by it.
export function rankOrdinal(tier: RankTierName, division: number): number {
  return RANK_TIER_ORDER.indexOf(tier) * 3 + (3 - division);
}

/**
 * The rung directly above this one, or null at max rank — "75% to **Diamond III**" (mock 92).
 *
 * Stored division 1 is the TOP sub-tier, so climbing counts DOWN through the stored numbers
 * (3 -> 2 -> 1, displayed as I -> II -> III) and then rolls over into the next tier's stored 3,
 * which displays as that tier's I. Derived from RANK_TIER_ORDER rather than hardcoded per screen,
 * since every surface that names the next rung has to agree with rank_tier_for_score's direction.
 */
export function nextRank(tier: RankTierName, division: number): { tier: RankTierName; division: number } | null {
  if (division > 1) return { tier, division: division - 1 };
  const next = RANK_TIER_ORDER[RANK_TIER_ORDER.indexOf(tier) + 1];
  if (!next) return null;
  // Primordial has no divisions at all; its stored division is 1 purely for ordinal arithmetic.
  return { tier: next, division: next === 'primordial' ? 1 : 3 };
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
// (PHILOI_UI_SPEC.md §21) — a same-tier division bump (e.g. Bronze I -> II) is still a rank
// up (isRankUp above) but should NOT trigger the full-screen forge, only a quiet inline pulse.
export function isTierCrossed(
  before: { tier: RankTierName },
  after: { tier: RankTierName }
): boolean {
  return before.tier !== after.tier;
}

// The rank-up's ray fan, per design-mocks/213 — "a slow breathing bloom, not a floodlight". The
// fan is tinted from the new tier's own RANK_TIER_METAL (one REVEAL_TUNING row cannot hold ten
// metals) and runs at this opacity rather than that row's 0.9, which was set when the fan was the
// whole screen and made it brighter than the badge it is supposed to be lighting.
//
// Lives here rather than in rank-up-celebration.tsx so the SHARE CARD can match it without
// importing the entire celebration: the PNG that lands in someone's story has to be lit the same
// way as the screen it was captured from.
export const RANK_UP_RAY_INTENSITY = 0.16;

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
