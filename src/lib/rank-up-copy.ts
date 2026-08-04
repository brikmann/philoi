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
