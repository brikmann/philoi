import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchInventory, type Inventory } from '@/lib/api/inventory';
import { useAuth } from '@/lib/auth/auth-context';
import { getItem, type CatalogItem, type EquipSlot } from '@/lib/economy/catalog';
import { subscribeToInventoryRefresh } from '@/lib/economy/wallet-refresh';
import { getErrorMessage } from '@/lib/errors';

/**
 * Unopened boxes collapsed to one entry per box_key (punchlist 9 §4). Eleven earned Vessels were
 * eleven separate tiles before this, which buried the rest of the inventory under a wall of
 * identical art and made "how many do I actually have" something you had to count by eye.
 */
export type BoxStack = {
  boxKey: string;
  /** Every unopened id of this type, newest first — the open flow takes a slice off the front. */
  ids: string[];
  count: number;
  /** Where they came from, most common first. A stack can mix earned and bought. */
  sources: { label: string; count: number }[];
  /** False if any of them was bought — provenance is only worth boasting about when it's uniform. */
  allEarned: boolean;
};

export type OwnedItem = CatalogItem & {
  ownedId: string;
  /** True when this item sits in at least one slot. See `slots` for which. */
  equipped: boolean;
  /**
   * Every slot this item currently occupies. An SFX can be in both `sfx_start` and `sfx_stop` at
   * once (migration 0070), which is precisely what the old single `equipped` boolean could not say.
   */
  slots: EquipSlot[];
  source: 'earned' | 'paid' | 'box' | 'forge_pass';
  provenance: string | null;
  /** "🌍 GLOBAL #1 · S1" for placement titles; null for everything else. */
  seasonStamp: string | null;
};

/**
 * The one read the whole shop/inventory surface runs on (§1 "client reads via a single
 * getInventory"). Refetches on focus rather than polling — opening a box, buying, equipping and
 * claiming all navigate, so focus is the natural invalidation point.
 */
export function useInventory() {
  const { session } = useAuth();
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!session) return;
    try {
      setError(null);
      setInventory(await fetchInventory());
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your inventory.'));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  // 🐛 The second invalidation point, and the one focus could never cover: a grant that lands while
  // this screen is already up and staying up. Finishing a goal pays embers server-side without
  // navigating anywhere, so nothing ever remounted the pill and it kept showing the pre-payout
  // figure until a reload — Noah's "balance doesn't refresh" report. See lib/economy/wallet-refresh.
  //
  // NOT useFocusEffect: an unfocused screen still has to be correct when it comes back, and its
  // own focus effect will run then anyway. This is the cheaper, more immediate path for the screen
  // the user is actually looking at.
  useEffect(() => subscribeToInventoryRefresh(() => void refetch()), [refetch]);

  // Ownership rows are joined onto the static catalog here so no screen ever has to do it. An
  // owned row whose key isn't in the catalog is dropped rather than rendered blank — that only
  // happens if the server granted an item this build doesn't know about yet.
  // key -> the slots holding it, inverted from the server's slot -> key map. Built once here so no
  // screen has to scan the loadout per tile, and so "equipped" means the same thing everywhere.
  const slotsByKey = useMemo(() => {
    const map = new Map<string, EquipSlot[]>();
    for (const [slot, key] of Object.entries(inventory?.loadout ?? {})) {
      map.set(key, [...(map.get(key) ?? []), slot as EquipSlot]);
    }
    return map;
  }, [inventory]);

  const owned = useMemo<OwnedItem[]>(() => {
    if (!inventory) return [];
    return inventory.cosmetics.flatMap((c) => {
      const item = getItem(c.cosmetic_key);
      if (!item) return [];
      const slots = slotsByKey.get(c.cosmetic_key) ?? [];
      return [
        {
          ...item,
          // A placement grant's rarity beats the catalog's. This flows into the rarity chip, the
          // aura tint, AND the salvage payout — a Global Top 1% is genuinely worth more than the
          // campus version of the same title, so it must not sell for the same embers.
          rarity: (c.rarity_override as CatalogItem['rarity']) ?? item.rarity,
          ownedId: c.id,
          // Derived from the loadout table, NOT from c.equipped — that legacy field is emitted for
          // pre-0070 clients and collapses "in both SFX slots" down to a single true.
          equipped: slots.length > 0,
          slots,
          source: c.source,
          provenance: c.provenance,
          seasonStamp: c.season_stamp,
        },
      ];
    });
  }, [inventory, slotsByKey]);

  const equippedBySlot = useMemo(() => {
    const map = {} as Record<EquipSlot, OwnedItem | undefined>;
    for (const item of owned) {
      for (const slot of item.slots) map[slot] = item;
    }
    return map;
  }, [owned]);

  const ownedKeys = useMemo(() => new Set(owned.map((o) => o.id)), [owned]);

  const boxes = useMemo(() => inventory?.boxes ?? [], [inventory]);

  // Grouped here rather than in the screen so the stack and its ids stay one fact: the tile shows
  // ×N and the open flow consumes ids off that same list, which is what keeps "Open 5" from ever
  // sending an id that belongs to a different box type.
  const boxStacks = useMemo<BoxStack[]>(() => {
    const byKey = new Map<string, BoxStack>();
    const provenance = new Map<string, Map<string, number>>();

    for (const b of boxes) {
      // Insertion order is get_inventory's created_at desc, so stacks list newest-first too.
      const stack = byKey.get(b.box_key) ?? { boxKey: b.box_key, ids: [], count: 0, sources: [], allEarned: true };
      stack.ids.push(b.id);
      stack.count += 1;
      if (b.obtained_via === 'purchase') stack.allEarned = false;
      byKey.set(b.box_key, stack);

      const label = b.provenance ?? (b.obtained_via === 'purchase' ? 'Bought in the Forge Shop' : 'Earned');
      const counts = provenance.get(b.box_key) ?? new Map<string, number>();
      counts.set(label, (counts.get(label) ?? 0) + 1);
      provenance.set(b.box_key, counts);
    }

    for (const stack of byKey.values()) {
      stack.sources = [...(provenance.get(stack.boxKey) ?? new Map())]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);
    }
    return [...byKey.values()];
  }, [boxes]);

  return {
    inventory,
    embers: inventory?.embers ?? 0,
    owned,
    ownedKeys,
    equippedBySlot,
    boxes,
    boxStacks,
    badges: inventory?.badges ?? [],
    pass: inventory?.pass,
    loading,
    error,
    refetch,
  };
}
