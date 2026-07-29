import type { RankTierName } from '@/types/database';

// Rank-up headline copy (PHILOI_UI_SPEC.md §11, RANK_UP_COPY.md is the source of truth for the
// exact strings below — keep this file in sync with that doc, not the other way around).
// Every rank-up composes `{personal}, {name}. {social}`: personal is a name-ready stem (Bronze
// varies by division reached; every other tier is tier-level), social is a standalone sentence
// with no name. Applies to every rank-up (division bump or tier crossing) — only the flash/sound
// intensity differs by whether the tier *type* changed (see rank-up-celebration.tsx).

type BronzePersonal = Record<1 | 2 | 3, string[]>;

type TierLines = {
  personal: string[] | BronzePersonal;
  social: string[];
};

// {school}/{mascot}/{rival} are campus placeholders templated from the profile (RANK_UP_COPY.md)
// — this project has no per-user mascot/rival fields yet, only profiles.university, so those
// two always fall back to the beta defaults for now.
const DEFAULT_SCHOOL = 'Laurier';
const DEFAULT_MASCOT = 'Golden Hawks';
const DEFAULT_RIVAL = 'Waterloo';

export const RANK_UP_LINES: Record<RankTierName, TierLines> = {
  bronze: {
    personal: {
      3: ['Spark lit', 'First ember', 'Off the bench', 'Out of the ash', 'Ignition', 'Smoke rising', 'Zero to one', 'Engine started'],
      2: ['Gaining heat', 'Bronze-bound', 'Fanning the flame', 'Building traction', 'Moving weight', 'Stoking the fire', 'In motion', 'Laying groundwork'],
      1: ['Iron-hard', 'Solid foundation', 'Hammer & anvil', 'Forged in bronze', 'Silver in sight', 'Heavy momentum', 'Locked and loaded', 'Unshakable base'],
    },
    social: [
      'The tribe sees you.',
      "They know you're locked in.",
      'Setting the pace for your squad.',
      'Your Campfire is feeling the heat.',
      'Putting your group on the board.',
      'Word is spreading.',
    ],
  },
  silver: {
    personal: [
      'Stunning',
      "You're shining",
      'Silver-forged',
      'Sterling focus',
      'Razor sharp',
      'Pure reflection',
      'Silver streak',
      'Cut from steel',
      'Clean execution',
      'High frequency',
      'Mirror finish',
    ],
    social: [
      "They're watching your streak.",
      'Your group chat is taking notes.',
      "Dragging your squad's average up.",
      'Making your Campfire look good.',
      'Setting the bar on campus.',
      "They can't call fraud on this.",
    ],
  },
  gold: {
    personal: ['Struck gold', 'Make that money', 'Golden', 'Midas touch', 'Pure gold', 'Crown achieved', 'Heavy metal', 'Standard set', 'Pacesetter'],
    social: [
      'Your squad rides on your back.',
      'Puts the whole leaderboard on watch.',
      'The standard for your Campfire.',
      'Making {school} look dialed.',
      "They're trying to catch your flame.",
      'Leading from the front.',
    ],
  },
  // Not in RANK_UP_COPY.md (platinum sits between Gold and Diamond in the real progression but
  // isn't named in the spec's copy/effects tables) — synthesized to match the surrounding
  // tiers' tone, same "kept for continuity, no special mention" treatment as elsewhere.
  platinum: {
    personal: ['Platinum poise', 'Ahead of the pack', 'Rare air', 'Elevated form'],
    social: ['Your Campfire is taking notice.', 'Not many reach this air.', 'Setting a new bar.'],
  },
  diamond: {
    personal: ['Shiny', 'Unbreakable', 'Crystal clear', 'Pressured into perfection', 'Flawless cut', 'Prism power', 'Hardened core', 'Shatterproof'],
    social: [
      'Your entire Campfire is in your shadow.',
      'Top of the campus radar.',
      'Making the rest of the group look idle.',
      'They talk about this tier.',
      'Carrying the {mascot}.',
      'The whole library knows.',
    ],
  },
  infernal: {
    personal: ['Your fire is eternal', "You're infernal", 'The blaze never dies', 'Unquenchable', 'Inferno locked', 'Scorched earth', 'Pure plasma'],
    social: [
      'The entire campus feels your heat.',
      'Your Campfire bows to the blaze.',
      "There's no one left to challenge you.",
      "They'll be trying to match this for semesters.",
      'You just put {rival} on Fraud Watch.',
      'The arena belongs to you.',
      'Your squad is living in your orbit.',
    ],
  },
};

function resolvePersonalPool(tier: RankTierName, division: number): string[] {
  const entry = RANK_UP_LINES[tier].personal;
  if (Array.isArray(entry)) return entry;
  const d = division === 1 || division === 2 ? division : 3;
  return entry[d as 1 | 2 | 3];
}

// Per-user, per-pool "last picked" index — module-scoped in-memory state (not AsyncStorage: a
// rank-up is rare enough that "no immediate repeat within this app session" satisfies
// RANK_UP_COPY.md's "no immediate repeat" without needing cross-restart persistence). Keyed
// separately for personal (bronze keys by division, e.g. "bronze:2") and social (keyed by tier).
const lastPersonalIndex: Partial<Record<string, number>> = {};
const lastSocialIndex: Partial<Record<RankTierName, number>> = {};

function pickNoRepeat<K extends string>(pool: string[], key: K, history: Partial<Record<K, number>>): string {
  if (pool.length <= 1) return pool[0] ?? '';
  let index = Math.floor(Math.random() * pool.length);
  if (index === history[key]) index = (index + 1) % pool.length;
  history[key] = index;
  return pool[index];
}

function interpolatePlaceholders(line: string, school: string): string {
  return line.replace('{school}', school).replace('{mascot}', DEFAULT_MASCOT).replace('{rival}', DEFAULT_RIVAL);
}

// Composes the full rank-up headline: `{personal}, {name}. {social}` (RANK_UP_COPY.md). Picks
// one personal stem + one social sentence, each with its own no-immediate-repeat history.
// `university` is the profile's own school (falls back to the beta default when unset).
export function composeRankUpHeadline(
  tier: RankTierName,
  division: number,
  firstName: string,
  university?: string | null
): string {
  const personalKey = tier === 'bronze' ? `bronze:${division === 1 || division === 2 ? division : 3}` : tier;
  const personal = pickNoRepeat(resolvePersonalPool(tier, division), personalKey, lastPersonalIndex);
  const socialRaw = pickNoRepeat(RANK_UP_LINES[tier].social, tier, lastSocialIndex);
  const social = interpolatePlaceholders(socialRaw, university || DEFAULT_SCHOOL);
  return `${personal}, ${firstName}. ${social}`;
}
