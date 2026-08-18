// RevenueCat-backed in-app purchases (#71). Sells exactly two things: the seasonal Forge Pass and
// consumable ember packs — cosmetics and currency, never XP, rank, streaks or standing.
//
// THE CLIENT NEVER GRANTS ANYTHING. Every function here ends at "the store says this purchase
// succeeded"; the actual entitlement and ember credit are written by the RevenueCat webhook hitting
// supabase/functions/revenuecat-webhook, which is the only thing the database trusts. A client that
// could grant its own embers is a client that can print money with a patched binary, and there is no
// amount of obfuscation that fixes that.
//
// GATED, NOT STUBBED. Until the public SDK key is in the environment, `isBillingConfigured()` is
// false and every purchase path refuses cleanly with a message the UI can show. That is what lets
// this whole layer ship and be tested in the same build the keys land in.

import Constants from 'expo-constants';
// TYPE-ONLY import — erased at compile time, so it never causes a runtime require. The actual
// module is loaded lazily by sdk() below; see the note there for why that matters.
import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { Platform } from 'react-native';

import { track } from '@/lib/analytics';
import { FORGE_PASS_ENTITLEMENT, emberPackForProduct, isForgePassProduct } from '@/lib/economy/iap';

const { revenueCatIosKey, revenueCatAndroidKey } = Constants.expoConfig?.extra ?? {};

/**
 * Lazily load the RevenueCat SDK, returning null when its native module isn't in the binary.
 *
 * This file is imported by AuthProvider and by the root-mounted EntitlementReconciler, which puts
 * it squarely on the app's startup path. `react-native-purchases` is a NATIVE module, so a
 * top-level `import Purchases from 'react-native-purchases'` throws during module evaluation in any
 * runtime that doesn't have it compiled in — Expo Go, or any dev build cut before the package was
 * installed. A throw there takes down the entire app with a white screen, before a single pixel
 * renders, and billing is the least important thing in the app to be able to do that.
 *
 * Same lazy-require pattern sound.ts already uses for expo-audio. Cached after the first attempt so
 * a missing module costs one failed require, not one per call.
 */
type PurchasesSdk = typeof import('react-native-purchases');
let sdkCache: PurchasesSdk | null | undefined;

function sdk(): PurchasesSdk | null {
  if (sdkCache !== undefined) return sdkCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases') as PurchasesSdk & { default?: PurchasesSdk['default'] };
    // The default export is the Purchases class; a module with no default means the native side
    // didn't register and there is nothing usable here.
    sdkCache = mod?.default ? mod : null;
  } catch {
    sdkCache = null;
  }
  if (!sdkCache) {
    console.warn('[billing] react-native-purchases is unavailable in this runtime — purchases disabled');
  }
  return sdkCache;
}

// ─────────────────────────── Membership · DORMANT, superseded ───────────────────────────
//
// The flat-membership model from the 2026-06-28 decision log. Monetization went a different way —
// the Flame Pass plus ember packs, both cosmetics-only — and this never shipped. Kept because
// src/app/paywall.tsx still renders it as a dormant preview screen; deleting it is a separate call
// than wiring RevenueCat, so it stays untouched here rather than being quietly removed.
export const MEMBERSHIP_PRICING = {
  monthly: { amount: 2.99, label: '$2.99/mo' },
  yearly: { amount: 19.99, label: '$19.99/yr' },
} as const;

export const MEMBERSHIP_PITCH = [
  'Unlimited Campfires, friends, and check-ins',
  'Streaks, leaderboards, and the full feed',
  'Reminders so you never break a streak by accident',
  "You're in — no ads, no algorithm, just your people",
] as const;

export async function purchaseMembership(_plan: keyof typeof MEMBERSHIP_PRICING): Promise<{ success: boolean }> {
  throw new Error('Membership isn’t the model — the Flame Pass and ember packs are what Philoi sells.');
}

/** The public SDK key for this platform, or null when it hasn't been provisioned yet. */
function apiKey(): string | null {
  const key = Platform.OS === 'ios' ? revenueCatIosKey : revenueCatAndroidKey;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/**
 * Whether real purchases can run at all. Every paywall checks this BEFORE showing a price, so a
 * build without keys shows "coming soon" rather than a live button that throws on tap.
 *
 * Requires BOTH a key and the native module. A JS-only runtime with a key configured still can't
 * charge anyone, and offering to would be worse than saying nothing.
 */
export function isBillingConfigured(): boolean {
  return apiKey() !== null && sdk() !== null;
}

let configured = false;

/**
 * Called once the user is known (see AuthProvider). The Supabase user id is passed as RevenueCat's
 * appUserID, which is what ties an entitlement to an ACCOUNT rather than to a device — without it,
 * reinstalling or switching phones would look like a different customer and the pass would appear
 * to vanish.
 *
 * Safe to call repeatedly: re-calling with the same id is a no-op, and a CHANGED id (a sign-out
 * then sign-in as someone else) logs the previous user out of RevenueCat first so entitlements
 * never bleed across accounts on a shared device.
 */
export async function configureBilling(userId: string | null): Promise<void> {
  const key = apiKey();
  const rc = sdk();
  if (!key || !userId || !rc) return;
  const Purchases = rc.default;

  try {
    if (configured) {
      const current = await Purchases.getAppUserID();
      if (current === userId) return;
      await Purchases.logIn(userId);
      return;
    }
    if (__DEV__) await Purchases.setLogLevel(rc.LOG_LEVEL.DEBUG);
    await Purchases.configure({ apiKey: key, appUserID: userId });
    configured = true;
  } catch (e) {
    // Billing failing to configure must never take the app down — it makes purchases unavailable,
    // which every call site below already handles.
    console.warn('[billing] configure failed', e);
  }
}

/** Sign the user out of RevenueCat on app sign-out, so the next account starts clean. */
export async function resetBilling(): Promise<void> {
  const rc = sdk();
  if (!configured || !rc) return;
  try {
    await rc.default.logOut();
  } catch {
    // logOut throws for an anonymous user, which is a no-op condition, not an error.
  }
}

export type PurchaseOutcome =
  | { status: 'granted'; productId: string }
  | { status: 'cancelled' }
  | { status: 'already-owned' }
  | { status: 'pending' }
  | { status: 'unavailable'; message: string };

/** The current offering's packages, or null when billing isn't configured / nothing is published. */
export async function fetchOffering(): Promise<PurchasesOffering | null> {
  const rc = sdk();
  if (!isBillingConfigured() || !rc) return null;
  try {
    const offerings = await rc.default.getOfferings();
    return offerings.current ?? null;
  } catch (e) {
    console.warn('[billing] fetchOffering failed', e);
    return null;
  }
}

/**
 * productId → the store's own localized price string ("$4.99", "4,99 €", "¥800").
 *
 * The ONLY source of a price anywhere in the app. Hardcoded price strings were removed precisely
 * because they can disagree with what the card is actually charged — the store knows the user's
 * storefront, currency, and any regional pricing, and this app does not. An id missing from the
 * result simply has no price yet; callers render a placeholder rather than inventing one.
 */
export async function fetchProductPrices(): Promise<Record<string, string>> {
  const offering = await fetchOffering();
  if (!offering) return {};
  const out: Record<string, string> = {};
  for (const pkg of offering.availablePackages) {
    out[pkg.product.identifier] = pkg.product.priceString;
  }
  return out;
}

/** Find a package by its store product id within the current offering. */
export async function findPackage(productId: string): Promise<PurchasesPackage | null> {
  const offering = await fetchOffering();
  if (!offering) return null;
  return offering.availablePackages.find((p) => p.product.identifier === productId) ?? null;
}

/**
 * Buy one package and classify the result.
 *
 * Note what this does NOT return: a balance, an entitlement, or anything the caller could act on as
 * proof of a grant. 'granted' here means "the store charged them" — the reward lands when the
 * webhook fires. The UI treats it as optimistic and reconciles on focus (see reconcileEntitlements).
 */
export async function purchaseProduct(productId: string): Promise<PurchaseOutcome> {
  if (!isBillingConfigured()) {
    return { status: 'unavailable', message: 'Purchases aren’t available in this build yet.' };
  }

  const rc = sdk();
  const pkg = await findPackage(productId);
  if (!pkg || !rc) {
    return { status: 'unavailable', message: 'That item isn’t available from the store right now.' };
  }

  try {
    const { customerInfo } = await rc.default.purchasePackage(pkg);
    track('iap_purchase_completed', { product: productId });

    if (isForgePassProduct(productId) && !hasForgePass(customerInfo)) {
      // Charged, but the entitlement hasn't propagated yet. Not an error — the webhook is the
      // source of truth and may simply be a beat behind.
      return { status: 'pending' };
    }
    return { status: 'granted', productId };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === rc.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      track('iap_purchase_cancelled', { product: productId });
      return { status: 'cancelled' };
    }
    if (code === rc.PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR) {
      return { status: 'already-owned' };
    }
    if (code === rc.PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
      // Ask-to-Buy / SCA. The purchase may complete later; grant nothing now.
      return { status: 'pending' };
    }
    track('iap_purchase_failed', { product: productId, code: code ?? 'unknown' });
    return {
      status: 'unavailable',
      message: (e as { message?: string }).message ?? 'The purchase couldn’t be completed.',
    };
  }
}

export function hasForgePass(info: CustomerInfo): boolean {
  return info.entitlements.active[FORGE_PASS_ENTITLEMENT] !== undefined;
}

/**
 * Restore Purchases. Apple REQUIRES this to be reachable in the UI for any app selling
 * non-consumables — it ships in Settings and on the paywall.
 *
 * Ember packs are consumables and are deliberately NOT restorable: they were spent into a balance
 * the moment they were granted, and "restoring" them would mint the embers a second time. Only the
 * Pass entitlement comes back.
 */
export async function restorePurchases(): Promise<{ restoredPass: boolean }> {
  const rc = sdk();
  if (!isBillingConfigured() || !rc) {
    throw new Error('Purchases aren’t available in this build yet.');
  }
  const info = await rc.default.restorePurchases();
  const restoredPass = hasForgePass(info);
  track('iap_restore', { restored_pass: restoredPass });
  return { restoredPass };
}

/**
 * Does the store think this account owns the Pass? Used on app focus to catch the case where the
 * webhook is slow or was missed entirely — if the store says yes and our own state says no, the
 * caller asks the server to reconcile rather than granting anything locally.
 */
export async function storeSaysPassOwned(): Promise<boolean> {
  const rc = sdk();
  if (!isBillingConfigured() || !rc) return false;
  try {
    return hasForgePass(await rc.default.getCustomerInfo());
  } catch {
    return false;
  }
}

export { emberPackForProduct };
