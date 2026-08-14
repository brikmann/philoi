import { RANK_TIER_LABEL, RANK_TIER_ORDER } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

// Rank-up copy (RANKUP_SPEC.md §5; RANK_UP_COPY.md is the source of truth for the exact strings).
//
// MODEL CHANGE (0063 ladder rework): this replaces the old `{personal}, {name}. {social}` system
// outright — the per-tier line pools, the Bronze-by-division split, the no-immediate-repeat
// picker, the {name}/{school}/{mascot}/{rival} interpolation, and composeRankUpHeadline are gone.
// One fixed all-caps two-liner per tier, shown ONLY on a tier crossing.
//
// Why fixed rather than a rotating pool: a rank-up is rare and the line is the payoff. A pool made
// each crossing feel randomly generated, and name/school interpolation read as mail-merge on the
// one screen that should feel authored. Ten lines, each earned once.
//
// Division bumps show NO copy at all (§1) — they get the lighter wash + haptic and nothing else,
// which is exactly what keeps a tier crossing distinct from the two bumps preceding it.
//
// `hero` and `primordial` double as the framing lines for the two band crossings (§1) — one
// source, so the takeover card and the badge screen can never drift apart.
export const RANK_UP_COPY: Record<RankTierName, { head: string; sub: string }> = {
  bronze: { head: 'IGNITION.', sub: 'THE CLIMB HAS BEGUN.' },
  silver: { head: 'FORGED IN STEEL.', sub: 'THE EDGE IS YOURS.' },
  gold: { head: 'THE CROWN IS YOURS.', sub: 'EVERY LOCK-IN TURNS TO GOLD.' },
  platinum: { head: 'INTO RARE AIR.', sub: 'FEW EVER CLIMB THIS HIGH.' },
  diamond: { head: 'FORGED UNDER PRESSURE.', sub: 'THE MORTAL PEAK — ONE STEP FROM LEGEND.' },
  hero: { head: 'MORTAL LIMITS BROKEN.', sub: 'WELCOME TO THE REALM OF LEGEND.' },
  titan: { head: 'THE EARTH TREMBLES.', sub: 'A TITAN WALKS AMONG THEM.' },
  olympian: { head: 'YOU ENTER OLYMPUS.', sub: 'THE GODS MAKE ROOM.' },
  immortal: { head: 'DEATH HAS NO CLAIM.', sub: 'YOU CANNOT FALL.' },
  primordial: { head: 'YOU ARE BEYOND TIME ITSELF.', sub: 'YOU ARE NOW PRIMORDIAL.' },
};

// The share card's tag line (design-mocks/84) — the small all-caps label above the badge that says
// what KIND of moment this was. Lives here rather than in the celebration so the on-screen card
// and the captured story image can never disagree about it.
export function rankUpCardTag(tier: RankTierName, isDivisionBump: boolean): string {
  if (isDivisionBump) return '🔥 DIVISION UP';
  if (tier === 'primordial') return '🔥 PRIMORDIAL';
  if (tier === 'hero') return '⚔ ASCENDED';
  return 'RANK UP';
}

// The DIVISION UP card's light two-liner (RANKUP_SPEC §9's intra-division bump) — deliberately NOT
// from RANK_UP_COPY: the ten all-caps lines above are tier-crossing payoffs, each earned once, and
// spending "THE CROWN IS YOURS." again on Gold III→II would flatten the crossing it belongs to.
// This is the small version — you moved, and the next tier is named so the bump points somewhere.
export function divisionUpCopy(tier: RankTierName): { head: string; sub: string } {
  const next = RANK_TIER_ORDER[RANK_TIER_ORDER.indexOf(tier) + 1];
  return {
    head: 'ONE RANK CLOSER.',
    // Primordial has no divisions, so it can never reach this — but it's also the end of the
    // ladder, so `next` is undefined there and the sub falls back rather than reading "UNDEFINED".
    sub: next ? `${RANK_TIER_LABEL[next].toUpperCase()} IN YOUR SIGHTS.` : 'THE LADDER ENDS WITH YOU.',
  };
}
