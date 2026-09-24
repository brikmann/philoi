import * as SecureStore from 'expo-secure-store';

import type { PlacementScope } from '@/types/database';

// "Last board placements the user has actually been SHOWN" (mock 204) — Friends, uni and
// Global — the placement sibling of rank-watch.ts's tier baseline. Tier rank is the Primordial
// ladder; placement is the user's row on each board (get_my_placements, 0214), and it moves for
// reasons that are not this session: other people earn too. So the done screen's movement line is
// "since the last time we showed you", not "this session earned you N spots" — the baseline is
// only written when the number is displayed.
//
// Persisted and PER USER for the same reasons as rank-watch (punchlist A1): the delta has to span
// app restarts, and a baseline that outlived its account would compare one person's placement to
// another's. SecureStore keys allow alphanumerics, '.', '-' and '_', so a UUID appends cleanly.
const LAST_SEEN_PLACEMENT_PREFIX = 'philoi_last_seen_placement_';

const placementKey = (userId: string) => `${LAST_SEEN_PLACEMENT_PREFIX}${userId}`;

/** Last-shown rank per scope (Friends / uni / Global). A scope with no entry has never been shown. */
export type SeenPlacements = Partial<Record<PlacementScope, number>>;

const SCOPES: PlacementScope[] = ['friends', 'uni', 'global'];

export async function getSeenPlacements(userId: string): Promise<SeenPlacements> {
  try {
    const raw = await SecureStore.getItemAsync(placementKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Keep only well-formed ranks. A garbled scope reads as "no baseline", so that row shows the
    // standing alone rather than a move computed from junk.
    const seen: SeenPlacements = {};
    for (const scope of SCOPES) {
      const rank = parsed?.[scope];
      if (typeof rank === 'number' && Number.isInteger(rank) && rank > 0) seen[scope] = rank;
    }
    return seen;
  } catch {
    return {};
  }
}

export async function setSeenPlacements(userId: string, seen: SeenPlacements): Promise<void> {
  try {
    await SecureStore.setItemAsync(placementKey(userId), JSON.stringify(seen));
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
