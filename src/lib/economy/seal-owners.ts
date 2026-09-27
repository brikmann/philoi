import { useSyncExternalStore } from 'react';

import type { OwnedCosmetic } from '@/lib/api/inventory';

// ── WHO OWNS THE EMBERFALL SEAL, for the seal badge (LORE_EMBERFALL, mock 223's `.seal`) ──
//
// The burning name's permanent twin. The name burns while the pass ENTITLEMENT is live and goes out
// when it lapses (pass-holders.ts); the Seal is forged at L100 and pins beside the name forever, so
// it gates on OWNING the cosmetic — a row in cosmetics_owned — never on the entitlement.
//
// ── SELF ONLY, FOR NOW ──
//
// Nobody can reach L100 for weeks, so the only answer anyone needs yet is their own, and that
// comes free off the inventory read useInventory and <LoadoutSync/> already make. Everyone else
// reads `false`.
//
// Before the first finisher, add the batched lookup for other people: a `0221 seal_owners(uuid[])`
// with the same shape and guards as 0220's get_pass_holders (querying
// `cosmetics_owned.cosmetic_key = SEAL_COSMETIC_KEY`), and the same pending/flush/TTL cache
// pass-holders.ts runs. The hook's signature doesn't change, so no call site has to.

/** The Seal's owned-row key. The display name is "The Emberfall Seal"; the key stays the crown's. */
export const SEAL_COSMETIC_KEY = 'medal-emberfall-crown';

/** Whether an inventory's owned rows include the Seal. */
export function ownsSeal(cosmetics: readonly Pick<OwnedCosmetic, 'cosmetic_key'>[]): boolean {
  return cosmetics.some((c) => c.cosmetic_key === SEAL_COSMETIC_KEY);
}

let self: { userId: string; owner: boolean } | null = null;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readSelf() {
  return self;
}

/** Fed by every inventory read (useInventory, LoadoutSync), beside setOwnPassHolder. */
export function setOwnSealOwner(userId: string, owner: boolean): void {
  if (self?.userId === userId && self.owner === owner) return;
  self = { userId, owner };
  for (const l of listeners) l();
}

/** Sign-out. Without it the next account on this device would inherit the last one's Seal. */
export function clearSealOwners(): void {
  if (!self) return;
  self = null;
  for (const l of listeners) l();
}

/** Whether `userId` owns the Seal. `false` until known — and, until 0221, for anyone but you. */
export function useSealOwner(userId: string | null | undefined): boolean {
  const s = useSyncExternalStore(subscribe, readSelf, readSelf);
  return Boolean(userId && s?.userId === userId && s.owner);
}
