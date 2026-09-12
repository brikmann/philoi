import { Colors } from '@/constants/theme';
import { BOX_KEYS, type BoxKey } from '@/lib/economy/boxes';
import type { DifficultyTier } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HOW A SCOPED TIER LOOKS AND READS — in ONE place.
//
// These three lived inside challenge/verdict.tsx while that screen was the only thing that drew a
// tier. It is not any more: the batch verdict (0183 · §A), the goal card's reward line and the Goal
// info sheet all name the same six tiers, and four copies of a colour ramp is four places for
// `epic` to drift to a different violet.
//
// 🔒 NOTHING HERE PRICES ANYTHING. This is presentation only — the crate, the embers and the band
// all come from preview_challenge_reward, because a local tier→payout table would be a second
// source of truth and the first economy retune would have the verdict promise one thing and the
// reveal deliver another. What lives here is what a tier is CALLED and what colour it is.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The one-line "reads as" column from DIFFICULTY_SCOPING.md's grid, used when Cindy supplied no
 *  rationale of her own. Hers is always preferred — it is the thing that makes a tier feel judged
 *  rather than rolled. */
export const TIER_LINE: Record<DifficultyTier, string> = {
  common: 'A daily habit.',
  uncommon: 'A solid push this week.',
  rare: 'A real training block.',
  epic: 'Most people never do this.',
  legendary: 'A genuine life feat.',
  mythic: 'Bragging rights for life.',
};

export const TIER_COLOR: Record<DifficultyTier, string> = {
  common: Colors.muted,
  uncommon: Colors.green,
  rare: Colors.sky,
  epic: '#A06CD5',
  legendary: Colors.amber,
  mythic: Colors.coral,
};

/** Narrow a box key that arrived as a string from the server.
 *
 *  `preview_challenge_reward` returns null for a tier that pays embers only, and a key the client's
 *  catalog has never heard of is possible the moment economy_config learns a new band — so this
 *  answers "can BoxArt draw this" rather than asserting the server sent something valid. */
export function asBoxKey(key: string | null | undefined): BoxKey | null {
  return key != null && (BOX_KEYS as readonly string[]).includes(key) ? (key as BoxKey) : null;
}

/** True for one of the six names every scoping RPC accepts. Mirrors isScopedTier in lib/api/coach,
 *  which answers the same question about a value that came from the MODEL rather than the server. */
export function isDifficultyTier(value: unknown): value is DifficultyTier {
  return typeof value === 'string' && value in TIER_COLOR;
}
