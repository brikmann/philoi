// Client side of the reward economy. Every function here is a thin call onto a security-definer
// RPC — there is deliberately no `.from('ember_wallet').update(...)` anywhere in the app, because
// REWARD_ECONOMY §0.4 makes the server the only thing allowed to compute or move a reward.

import { track } from '@/lib/analytics';
import { boxPoolByRarity, getItem, type CatalogItem, type EquipSlot } from '@/lib/economy/catalog';
import { supabase } from '@/lib/supabase';

export type OwnedCosmetic = {
  id: string;
  cosmetic_key: string;
  slot: string | null;
  source: 'earned' | 'paid' | 'box' | 'forge_pass';
  provenance: string | null;
  equipped: boolean;
  acquired_at: string;
  /** 21j placement grants: overrides the catalog rarity for display AND salvage value. */
  rarity_override: string | null;
  /** "🌍 GLOBAL #1 · S1" — the scope stamp shown beside a placement title. */
  season_stamp: string | null;
};

export type OwnedBadge = {
  id: string;
  badge_key: string;
  source: 'earned' | 'paid' | 'box' | 'forge_pass';
  provenance: string | null;
  equipped: boolean;
  earned_at: string;
};

export type OwnedBox = {
  id: string;
  box_key: string;
  obtained_via: 'challenge' | 'season' | 'forge_pass' | 'purchase' | 'promo';
  provenance: string | null;
};

export type PassState = {
  season_id: string;
  pass_xp: number;
  owns_premium: boolean;
  claims: { tier: number; lane: 'free' | 'premium' }[];
  achievements: { key: string; period_key: string; xp: number }[];
};

export type Inventory = {
  embers: number;
  /**
   * slot -> cosmetic_key, straight off the equipped_loadout table (migration 0070). This is the
   * authority on what's worn; `OwnedCosmetic.equipped` is a legacy field that can't express one
   * item in two slots, which is exactly why this replaced it.
   */
  loadout: Record<string, string>;
  cosmetics: OwnedCosmetic[];
  badges: OwnedBadge[];
  boxes: OwnedBox[];
  pass: PassState;
};

export async function fetchInventory(): Promise<Inventory> {
  const { data, error } = await supabase.rpc('get_inventory');
  if (error) throw error;
  const inv = data as Inventory;
  // A server still on 0067 doesn't send `loadout` at all. Defaulting keeps every downstream `?.`
  // and `Object.entries` honest rather than letting an undefined reach the loadout store.
  return { ...inv, loadout: inv.loadout ?? {} };
}

/** A decided box result. The server rolled this BEFORE any animation runs (§8.5). */
export type OpenResult = {
  cosmetic_key: string;
  rarity: string;
  dupe: boolean;
  /** Ember payout when the pull was a dupe and auto-salvaged. */
  embers: number;
  box_key: string;
  rolled_rarity: string;
  item: CatalogItem | undefined;
};

/**
 * Opening is two server steps that must not be reordered: the roll picks a RARITY, and the pool of
 * candidate item ids at that rarity comes from the catalog. We can't know the rarity before
 * calling, so every rarity's pool is sent KEYED BY RARITY and the server picks from the bucket it
 * rolled — the client never gets to aim the result.
 *
 * The map shape is load-bearing (punchlist 8 §1, migration 0069). This used to send one flat array
 * of every rarity's ids, and the server picked from all of them at random while still labelling the
 * grant with the rolled rarity — so a Mythic roll could hand back a Common, and a dupe would salvage
 * at the rolled tier's price rather than the item's. Keeping the buckets separate is what makes
 * `rolled_rarity` and `item.rarity` the same fact.
 */
export async function openBox(boxId: string): Promise<OpenResult> {
  const pool = Object.fromEntries(
    (['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const).map((r) => [
      r,
      boxPoolByRarity(r).map((i) => i.id),
    ])
  );
  const { data, error } = await supabase.rpc('open_loot_box', { p_box_id: boxId, p_pool: pool });
  if (error) throw error;
  const result = data as Omit<OpenResult, 'item'>;
  track('loot_box_opened', { box: result.box_key, rarity: result.rolled_rarity, dupe: result.dupe });
  return { ...result, item: getItem(result.cosmetic_key) };
}

/** Buy a box with EARNED embers, then open it. Works today — no IAP involved. */
export async function buyBox(boxKey: string): Promise<string> {
  const { data, error } = await supabase.rpc('buy_loot_box', { p_box_key: boxKey });
  if (error) throw error;
  track('loot_box_bought', { box: boxKey });
  return data as string;
}

export async function buyCosmetic(item: CatalogItem): Promise<void> {
  const { error } = await supabase.rpc('buy_cosmetic', {
    p_key: item.id,
    p_slot: item.slot,
    p_rarity: item.rarity,
  });
  if (error) throw error;
  track('cosmetic_bought', { item: item.id, rarity: item.rarity });
}

/**
 * Equip an item into a slot. The slot is now an explicit argument rather than being read off the
 * item: SFX cosmetics have no slot of their own (migration 0070 / PUNCHLIST_13) because the user
 * chooses Start, End, or both. Everything else still passes its catalog slot.
 */
export async function equipCosmetic(item: CatalogItem, slot?: EquipSlot): Promise<void> {
  const target = slot ?? item.slot;
  if (!target) throw new Error('That item has no slot to equip into.');
  const { error } = await supabase.rpc('equip_cosmetic', { p_key: item.id, p_slot: target });
  if (error) throw error;
  track('cosmetic_equipped', { item: item.id, slot: target });
}

/** Empty one slot. Keyed by SLOT, not item — the same sting can sit in both SFX slots, so
 * "unequip this item" wouldn't say which one to clear. */
export async function unequipCosmetic(slot: EquipSlot): Promise<void> {
  const { error } = await supabase.rpc('unequip_cosmetic', { p_slot: slot });
  if (error) throw error;
  track('cosmetic_unequipped', { slot });
}

/** Salvage/sell. Permanent — an earned item only comes back by earning it again (§8.3). */
export async function salvageCosmetic(item: CatalogItem): Promise<number> {
  const { data, error } = await supabase.rpc('salvage_cosmetic', { p_key: item.id, p_rarity: item.rarity });
  if (error) throw error;
  track('cosmetic_salvaged', { item: item.id, rarity: item.rarity });
  return (data as { embers: number }).embers;
}
