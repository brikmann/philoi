import * as SecureStore from 'expo-secure-store';

import { RANK_TIER_ORDER } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

// "Last rank the user has actually been SHOWN" (punchlist 5.6). The rank-up forge used to fire
// only from the lock-in done screen, which means it could only ever celebrate a manual stop — a
// Strava/Whoop check-in is created server-side by the webhook/backfill, so XP (and a rank) could
// climb with no done screen and no celebration at all. Same gap for challenge payouts.
//
// Persisted rather than held in memory because the whole point is to detect a change that
// happened while the app wasn't looking; an in-memory baseline resets on every cold start and
// would either re-fire endlessly or never fire.
const LAST_SEEN_RANK_KEY = 'philoi_last_seen_rank';

export type SeenRank = { tier: RankTierName; division: number };

export async function readLastSeenRank(): Promise<SeenRank | null> {
  try {
    const raw = await SecureStore.getItemAsync(LAST_SEEN_RANK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SeenRank;
    // Guard the shape: a partially-written or older-format value must read as "no baseline"
    // rather than throwing inside the watcher on every check.
    if (typeof parsed?.tier !== 'string' || typeof parsed?.division !== 'number') return null;
    // Guard the VALUE too, not just the type. This baseline outlives app updates on the device,
    // so it can name a tier that no longer exists — the pre-0063 apex, for anyone who reached it
    // before the rework renamed it. rankOrdinal() resolves an unknown tier through indexOf(),
    // which returns -1, giving it an ordinal BELOW Bronze III — so a stale baseline like that
    // would make the very next check read as a huge promotion and fire a spurious full-screen
    // forge. Dropping it re-baselines silently on the next check instead, which is exactly how
    // the watcher already handles a downward move.
    if (!RANK_TIER_ORDER.includes(parsed.tier)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeLastSeenRank(rank: SeenRank): Promise<void> {
  try {
    await SecureStore.setItemAsync(LAST_SEEN_RANK_KEY, JSON.stringify({ tier: rank.tier, division: rank.division }));
  } catch {
    // A failed write only costs a possible repeat celebration later — never worth surfacing.
  }
}

// Lets any code that just moved XP server-side ask the watcher to re-check, without the watcher
// having to know about Strava, Whoop, or challenges. Deliberately a tiny local pub/sub rather
// than a context: the callers (lib/strava.ts, lib/whoop.ts) are plain modules, not components.
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeToRankRecheck(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Call after any server-side XP change (a Strava/Whoop backfill that imported something, a
 * challenge payout) so a rank crossed without a done screen still gets its moment. */
export function requestRankRecheck(): void {
  listeners.forEach((l) => l());
}

/** The full shape the celebration needs, as presented by BOTH the watcher and dev-tools — one
 * entry point, so a dev trigger exercises the real escalation logic rather than a parallel path
 * (RANKUP_SPEC §7b). */
export type RankUpEvent = {
  tier: RankTierName;
  division: number;
  fromTier: RankTierName;
  fromDivision: number;
  isDivisionBump: boolean;
  isBandCrossing: boolean;
};

// The two ascension moments (§1): entering the Realm of Legend, and reaching the apex. Hero only
// counts when arriving FROM the mortal band — Titan I → Hero (impossible today, but a future
// demotion/rework could) shouldn't replay the threshold.
const MORTAL_TIERS: RankTierName[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

/** Derives the escalation level from the delta (§6). Pure, so dev-tools and the watcher agree. */
export function deriveRankUpLevel(
  from: SeenRank,
  to: SeenRank
): { isDivisionBump: boolean; isBandCrossing: boolean } {
  const isDivisionBump = from.tier === to.tier;
  const isBandCrossing =
    !isDivisionBump && (to.tier === 'primordial' || (to.tier === 'hero' && MORTAL_TIERS.includes(from.tier)));
  return { isDivisionBump, isBandCrossing };
}
