// The store-facing half of the economy: product ids, the entitlement name, and the season binding.
//
// Everything here must match App Store Connect and the RevenueCat dashboard EXACTLY. A typo is not
// a compile error — it is a purchase that succeeds and grants nothing, which is the worst failure
// this system has. That is why the ids live in one file rather than inline at each call site.

import { Platform } from 'react-native';

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
 * The alternative — `app.philoi.forge_pass.s1`, `...s2` — means creating and re-reviewing a new App
 * Store product every single season, and any season where that slips is a season nobody can buy.
 * A generic id costs nothing because the server already binds the grant to the live season, and
 * `season_phase()` (migration 0074) refuses the grant outside the window regardless.
 *
 * NON-RENEWING, per the Phase 4 decision: you buy a season, it ends, nothing auto-charges. See
 * PASS_FINE_PRINT — the old "auto-renews each season" copy was written against a subscription model
 * and had to change with it.
 */
export const FORGE_PASS_PRODUCT_ID = 'app.philoi.forge_pass.season';

/**
 * The id to ASK THE RUNNING STORE for — the forward direction, and the only one a purchase or a
 * price lookup may use.
 *
 * Vault is the same pack sold under two ids: `app.philoi.embers.vault` on the App Store, and
 * `app.philoi.embers.vault2` on Play, because the original Play id is stuck as a soft-deleted
 * RevenueCat ghost that Import skips and "+ New" rejects. RevenueCat's offering only ever carries
 * the id for the store the app is running against, so reading `pack.productId` on Android asks for
 * a product Play does not sell: `findPackage` returns null and the tile renders "—" and refuses to
 * buy. That is a silent loss of the highest-value pack, so this resolution belongs in one place
 * rather than at each call site.
 *
 * The reverse direction — a store id coming BACK, e.g. on the purchase-success screen — goes
 * through EMBER_PACK_BY_PRODUCT, which knows both ids regardless of platform.
 */
export function storeProductId(pack: EmberPack): string {
  return Platform.OS === 'android' && pack.productIdAndroid ? pack.productIdAndroid : pack.productId;
}

/** Every product this app can sell ON THIS PLATFORM. Used to sanity-check an offering against what
 *  we expect — so it must carry the same ids the store will actually list (see storeProductId). */
export const ALL_PRODUCT_IDS: string[] = [FORGE_PASS_PRODUCT_ID, ...EMBER_PACKS.map(storeProductId)];

export function emberPackForProduct(productId: string): EmberPack | undefined {
  return EMBER_PACK_BY_PRODUCT[productId];
}

export function isForgePassProduct(productId: string): boolean {
  return productId === FORGE_PASS_PRODUCT_ID;
}
