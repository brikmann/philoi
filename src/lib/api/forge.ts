// Client side of the Forge (migration 0138). One call, onto one security-definer RPC.
//
// Same rule as the rest of lib/api/inventory.ts: there is no `.from('cosmetics_owned').delete(...)`
// here and there never will be. REWARD_ECONOMY §0.4 makes the server the only thing allowed to
// decide or move a reward, and forge_combine is where the ladder, the eligibility gate and the roll
// all live. This file sends two arguments and renders what comes back.

import { track } from '@/lib/analytics';
import { getItem, type CatalogItem } from '@/lib/economy/catalog';
import { supabase } from '@/lib/supabase';

/**
 * A decided combine. Like OpenResult, this is finished before any animation runs (§8.5) — the items
 * are already gone and the new one is already granted by the time this resolves, so the hammer
 * strike is a flourish over a settled outcome and a crash mid-animation cannot cost anyone the pull.
 */
export type ForgeResult = {
  /** The item the Forge made. */
  cosmetic_key: string;
  /** Its rarity — the next rung up from what was fed in. Guaranteed, never rolled. */
  rarity: string;
  /** True when the roll landed on something already owned; it auto-salvaged instead. */
  dupe: boolean;
  /** Ember payout on that dupe path, 0 otherwise. */
  embers: number;
  /** The rarity that was consumed, echoed back so the reveal can say "from 3 Rare". */
  input_rarity: string;
  consumed: number;
  consumed_keys: string[];
  item: CatalogItem | undefined;
};

/**
 * Feed N owned cosmetics of one rarity into the Forge and get one of the next rarity up.
 *
 * `ownedIds` are cosmetics_owned row ids (OwnedItem.ownedId), not catalog keys — the row is the
 * thing being destroyed, so it is what gets named. Nothing else is sent: not the pool, not the
 * ratio, not the target rarity. Unlike openBox, which has to hand the server a candidate pool
 * because the catalog lives in the bundle, the Forge's pool is box_droppable_items and the server
 * already has it. There is nothing here for a patched client to aim.
 */
export async function forgeCombine(rarity: string, ownedIds: string[]): Promise<ForgeResult> {
  const { data, error } = await supabase.rpc('forge_combine', {
    p_rarity: rarity,
    p_item_ids: ownedIds,
  });
  if (error) throw error;
  const result = data as Omit<ForgeResult, 'item'>;
  track('forge_combined', {
    from: result.input_rarity,
    into: result.rarity,
    consumed: result.consumed,
    dupe: result.dupe,
  });
  return { ...result, item: getItem(result.cosmetic_key) };
}
