import { useEffect, useMemo, useState } from 'react';

import { getItem, type CatalogItem, type EquipSlot } from '@/lib/economy/catalog';
import type { Rarity } from '@/lib/economy/rarity';
import { supabase } from '@/lib/supabase';

// "How others see you" only means something if other people's screens actually render it. This is
// the read that makes that true — feeds, leaderboard rows and challenge headers all show a set of
// OTHER users, so they batch their ids through one call rather than one per row.
//
// get_public_loadouts exposes equipped keys and nothing else: no balances, no unopened boxes, no
// ownership you could sell. Deliberately separate from get_inventory, which stays own-rows-only.

export type PublicItem = CatalogItem & { seasonStamp: string | null };
export type PublicLoadout = Partial<Record<EquipSlot, PublicItem>>;

// Module-level cache keyed by user id. Feed rows mount and unmount constantly while scrolling, and
// without this every recycle would refire the query for someone already resolved.
const cache = new Map<string, PublicLoadout>();

export function usePublicLoadouts(userIds: (string | null | undefined)[]): Record<string, PublicLoadout> {
  // Stable key so the effect doesn't refire on a new array with identical contents.
  const key = useMemo(() => Array.from(new Set(userIds.filter(Boolean) as string[])).sort().join(','), [userIds]);
  const [, bump] = useState(0);

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const missing = ids.filter((id) => !cache.has(id));
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_public_loadouts', { p_user_ids: missing });
      if (error || cancelled) return;

      // Seed every requested id, including ones with nothing equipped — otherwise they stay
      // "missing" forever and refetch on every scroll.
      for (const id of missing) if (!cache.has(id)) cache.set(id, {});
      for (const row of data ?? []) {
        const item = getItem(row.cosmetic_key);
        const slot = row.slot as EquipSlot;
        if (!item || !slot) continue;
        const existing = cache.get(row.user_id) ?? {};
        existing[slot] = {
          ...item,
          rarity: (row.rarity_override as Rarity) ?? item.rarity,
          seasonStamp: row.season_stamp,
        };
        cache.set(row.user_id, existing);
      }
      bump((n) => n + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return useMemo(() => {
    const out: Record<string, PublicLoadout> = {};
    for (const id of key ? key.split(',') : []) out[id] = cache.get(id) ?? {};
    return out;
    // `cache` is mutable module state; `bump` is what re-runs this after a fetch lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bump]);
}

/** Single-user convenience for headers (1v1, challenge, profile-of-someone-else). */
export function usePublicLoadout(userId: string | null | undefined): PublicLoadout {
  const map = usePublicLoadouts([userId]);
  return userId ? (map[userId] ?? {}) : {};
}
