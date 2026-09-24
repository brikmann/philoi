// The equipped loadout, as an external store rather than React context.
//
// Two kinds of consumer need this and they can't share a context:
//   • components (the flame, the profile card, the hex badge) — want a hook that re-renders;
//   • plain modules (sound.ts, reward-feedback.ts) — are called from timers and event handlers,
//     have no React tree above them, and must be able to read the current value synchronously.
//
// So the value lives in a module-level store with a subscribe/snapshot pair. One component up in
// _layout fetches and pushes into it; everything else reads. `useSyncExternalStore` gives the
// components correct tearing-free reads without wrapping the app in another provider.

import { useSyncExternalStore } from 'react';

import { getItem, type CatalogItem, type EquipSlot } from '@/lib/economy/catalog';

/**
 * A catalog item plus the two facts that live on the OWNED row rather than in the catalog: a 21j
 * placement grant overrides the item's rarity, and a placement title carries its scope stamp.
 *
 * Structurally identical to `PublicItem` in use-public-loadouts, and that is the point — it is what
 * lets the signed-in user's live loadout be substituted for their server snapshot on every surface
 * that renders a set of people, without the substitution quietly dropping "🌍 GLOBAL #1 · S1" off
 * your own title the moment it came from here instead of from the RPC.
 */
export type LoadoutItem = CatalogItem & { seasonStamp: string | null };

export type Loadout = Partial<Record<EquipSlot, LoadoutItem>>;

/** The owned-row fields this store reads. Structural so loadout.ts doesn't import the API layer. */
type OwnedRow = {
  cosmetic_key: string;
  rarity_override: string | null;
  season_stamp: string | null;
};

const EMPTY: Loadout = {};

let current: Loadout = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/**
 * Called by <LoadoutSync/> whenever get_inventory comes back.
 *
 * Takes the server's slot -> key map (migration 0070) rather than scanning the owned rows for an
 * `equipped` flag. The old shape derived the slot from the ITEM (`item.slot`), which silently made
 * one item equippable in exactly one place — an SFX in both the start and end slots would have
 * overwritten itself down to one entry here no matter what the database said.
 */
export function setLoadoutFromInventory(loadout: Record<string, string>, cosmetics: readonly OwnedRow[] = []): void {
  // Keyed by cosmetic_key because that is what the loadout table stores. An item in two slots
  // (an SFX in both start and end) reads the same row twice, which is correct — the override and
  // the stamp belong to the OWNERSHIP, not to the placement.
  const byKey = new Map(cosmetics.map((c) => [c.cosmetic_key, c]));
  const next: Loadout = {};
  for (const [slot, key] of Object.entries(loadout)) {
    const item = getItem(key);
    // A slot naming an item this build doesn't know (a newer season's cosmetic on an older app)
    // is dropped rather than rendered blank — same rule the owned grid already follows.
    if (!item) continue;
    const row = byKey.get(key);
    next[slot as EquipSlot] = {
      ...item,
      // Same precedence use-inventory applies to the grid: a Global placement title is genuinely
      // rarer than the campus version of the same item, and the rarity drives the title's colour.
      rarity: (row?.rarity_override as CatalogItem['rarity']) ?? item.rarity,
      seasonStamp: row?.season_stamp ?? null,
    };
  }

  // Identity-stable when nothing changed: every equipped-slot read runs through
  // useSyncExternalStore, and handing back a fresh object on an unchanged refetch would re-render
  // the live flame and every leaderboard row for no reason.
  if (sameLoadout(current, next)) return;
  current = next;
  emit();
}

export function clearLoadout(): void {
  if (current === EMPTY) return;
  current = EMPTY;
  emit();
}

function sameLoadout(a: Loadout, b: Loadout): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as EquipSlot[]);
  for (const k of keys) {
    // The id is not enough any more. The same title can be re-granted at a better placement — same
    // key, new rarity and new stamp — and comparing ids alone would call that "nothing changed"
    // and leave the old colourway on every surface until the next cold start.
    if (a[k]?.id !== b[k]?.id) return false;
    if (a[k]?.rarity !== b[k]?.rarity) return false;
    if (a[k]?.seasonStamp !== b[k]?.seasonStamp) return false;
  }
  return true;
}

/** Synchronous read for non-React callers (sound.ts, reward-feedback.ts). */
export function getLoadout(): Loadout {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hook read. Returns `{}` before the first fetch, so every consumer must handle "slot empty". */
export function useLoadout(): Loadout {
  return useSyncExternalStore(subscribe, getLoadout, getLoadout);
}

export function useEquipped(slot: EquipSlot): CatalogItem | undefined {
  return useLoadout()[slot];
}
