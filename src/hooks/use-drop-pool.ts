import { useEffect, useMemo, useState } from 'react';

import { useBoxOdds } from '@/hooks/use-box-odds';
import { fetchDroppableItems, type DroppableItem } from '@/lib/api/economy-config';
import type { BoxKey } from '@/lib/economy/boxes';
import { boxPoolByRarity, type CatalogItem } from '@/lib/economy/catalog';
import type { OddsRow } from '@/lib/economy/odds';

// WHAT A BOX CAN ACTUALLY ROLL — mock 217's "what's in the box" grid.
//
// There is no per-box item list anywhere, and that is not a gap: every box draws from ONE pool, and
// the box only changes the rarity WEIGHTS (economy_config.box_odds). open_loot_box (0069 + 0090)
// grants an item only when BOTH hold:
//
//   1. it is in the bucket the client sends for the rolled rarity — boxPoolByRarity(), see openBox;
//   2. it is in box_droppable_items AT THAT RARITY — the server's own allowlist.
//
// So the honest pool for one box is that intersection, restricted to the rarities this box's live
// odds give a non-zero chance. Promising anything outside it is promising an item the roll can't
// produce, which is worse than showing no pool at all.

// One read per session, like use-box-odds: the allowlist only moves on a catalog deploy.
let inFlight: Promise<DroppableItem[]> | null = null;

function loadDroppable(): Promise<DroppableItem[]> {
  inFlight ??= fetchDroppableItems().catch((e: unknown) => {
    inFlight = null;
    throw e;
  });
  return inFlight;
}

export type DropPool = {
  /** Every item this box can roll, in rarity order (common → mythic). Empty until loaded. */
  items: CatalogItem[];
  /** The box's live odds, non-zero tiers only — the same rows the drop-rates sheet discloses. */
  odds: OddsRow[];
  /** True once the server's allowlist has answered. A failed read stays false: no pool is drawn. */
  ready: boolean;
};

export function useDropPool(boxKey: BoxKey | null): DropPool {
  const { rows: odds } = useBoxOdds(boxKey);
  const [allowed, setAllowed] = useState<DroppableItem[] | null>(null);

  useEffect(() => {
    if (!boxKey) return;
    let cancelled = false;
    loadDroppable()
      .then((rows) => {
        if (!cancelled) setAllowed(rows);
      })
      // Nothing to say to the user — the panel simply doesn't draw a pool it can't vouch for.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [boxKey]);

  const items = useMemo(() => {
    if (!allowed) return [];
    const serverSays = new Set(allowed.map((r) => `${r.rarity}:${r.item_key}`));
    return odds.flatMap((row) =>
      boxPoolByRarity(row.rarity).filter((item) => serverSays.has(`${row.rarity}:${item.id}`))
    );
  }, [allowed, odds]);

  return { items, odds, ready: allowed != null };
}
