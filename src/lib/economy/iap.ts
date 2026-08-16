// The store-facing half of the economy: product ids, the entitlement name, and the season binding.
//
// Everything here must match App Store Connect and the RevenueCat dashboard EXACTLY. A typo is not
// a compile error — it is a purchase that succeeds and grants nothing, which is the worst failure
// this system has. That is why the ids live in one file rather than inline at each call site.

import { EMBER_PACKS, EMBER_PACK_BY_PRODUCT, type EmberPack } from '@/lib/economy/forge-pass';

/**
 * The RevenueCat entitlement that means "this account owns the current season's Forge Pass".
 *
 * One entitlement, not one per season. The SEASON binding lives on the grant (grant_forge_pass
 * writes forge_pass_state.season_id for whatever season was live at purchase time), not on the
 * entitlement — so a Season 2 purchase re-uses this same name and the server decides which season
 * it paid for.
 */
export const FORGE_PASS_ENTITLEMENT = 'forge_pass';

/**
 * The Forge Pass product. ONE id reused every season, deliberately.
 *
 * The alternative — `philoi.forge_pass.s1`, `...s2` — means creating and re-reviewing a new App
 * Store product every single season, and any season where that slips is a season nobody can buy.
 * A generic id costs nothing because the server already binds the grant to the live season, and
 * `season_phase()` (migration 0074) refuses the grant outside the window regardless.
 *
 * NON-RENEWING, per the Phase 4 decision: you buy a season, it ends, nothing auto-charges. See
 * PASS_FINE_PRINT — the old "auto-renews each season" copy was written against a subscription model
 * and had to change with it.
 */
export const FORGE_PASS_PRODUCT_ID = 'philoi.forge_pass.season';

/** Every product this app can sell. Used to sanity-check an offering against what we expect. */
export const ALL_PRODUCT_IDS: string[] = [FORGE_PASS_PRODUCT_ID, ...EMBER_PACKS.map((p) => p.productId)];

export function emberPackForProduct(productId: string): EmberPack | undefined {
  return EMBER_PACK_BY_PRODUCT[productId];
}

export function isForgePassProduct(productId: string): boolean {
  return productId === FORGE_PASS_PRODUCT_ID;
}
