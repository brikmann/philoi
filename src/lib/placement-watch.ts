import * as SecureStore from 'expo-secure-store';

// "Last global-board placement the user has actually been SHOWN" (mock 204) — the placement
// sibling of rank-watch.ts's tier baseline. Tier rank is the Primordial ladder; placement is the
// user's row on get_global_leaderboard, and it moves for reasons that are not this session: other
// people earn too. So the done screen's movement line is "since the last time we showed you", not
// "this session earned you N spots" — the baseline is only written when the number is displayed.
//
// Persisted and PER USER for the same reasons as rank-watch (punchlist A1): the delta has to span
// app restarts, and a baseline that outlived its account would compare one person's placement to
// another's. SecureStore keys allow alphanumerics, '.', '-' and '_', so a UUID appends cleanly.
const LAST_SEEN_PLACEMENT_PREFIX = 'philoi_last_seen_placement_';

const placementKey = (userId: string) => `${LAST_SEEN_PLACEMENT_PREFIX}${userId}`;

export async function getSeenPlacement(userId: string): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(placementKey(userId));
    if (!raw) return null;
    const rank = Number(raw);
    // A garbled value reads as "no baseline" — the card then shows the standing alone, which is
    // the honest fallback, rather than a movement computed from junk.
    return Number.isInteger(rank) && rank > 0 ? rank : null;
  } catch {
    return null;
  }
}

export async function setSeenPlacement(userId: string, rank: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(placementKey(userId), String(rank));
  } catch {
    // A failed write only means the next done screen measures from an older baseline.
  }
}

/** Drop a user's baseline on sign-out — mirrors clearLastSeenRank. */
export async function clearSeenPlacement(userId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(placementKey(userId));
  } catch {
    // Best effort — a surviving key is only ever read by this same user id.
  }
}
