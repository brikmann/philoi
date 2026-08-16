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
import Purchases, {
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';
import { Platform } from 'react-native';

import { track } from '@/lib/analytics';
import { FORGE_PASS_ENTITLEMENT, emberPackForProduct, isForgePassProduct } from '@/lib/economy/iap';

const { revenueCatIosKey, revenueCatAndroidKey } = Constants.expoConfig?.extra ?? {};

// ─────────────────────────── Membership · DORMANT, superseded ───────────────────────────
//
// The flat-membership model from the 2026-06-28 decision log. Monetization went a different way —
// the Forge Pass plus ember packs, both cosmetics-only — and this never shipped. Kept because
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
  throw new Error('Membership isn’t the model — the Forge Pass and ember packs are what Philoi sells.');
}

/** The public SDK key for this platform, or null when it hasn't been provisioned yet. */
function apiKey(): string | null {
  const key = Platform.OS === 'ios' ? revenueCatIosKey : revenueCatAndroidKey;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/**
 * Whether real purchases can run at all. Every paywall checks this BEFORE showing a price, so a
 * build without keys shows "coming soon" rather than a live button that throws on tap.
 */
export function isBillingConfigured(): boolean {
  return apiKey() !== null;
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
  if (!key || !userId) return;

  try {
    if (configured) {
      const current = await Purchases.getAppUserID();
      if (current === userId) return;
      await Purchases.logIn(userId);
      return;
    }
    if (__DEV__) await Purchases.setLogLevel(LOG_LEVEL.DEBUG);
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
  if (!configured) return;
  try {
    await Purchases.logOut();
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
  if (!isBillingConfigured()) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? null;
  } catch (e) {
    console.warn('[billing] fetchOffering failed', e);
    return null;
  }
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

  const pkg = await findPackage(productId);
  if (!pkg) {
    return { status: 'unavailable', message: 'That item isn’t available from the store right now.' };
  }

  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    track('iap_purchase_completed', { product: productId });

    if (isForgePassProduct(productId) && !hasForgePass(customerInfo)) {
      // Charged, but the entitlement hasn't propagated yet. Not an error — the webhook is the
      // source of truth and may simply be a beat behind.
      return { status: 'pending' };
    }
    return { status: 'granted', productId };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      track('iap_purchase_cancelled', { product: productId });
      return { status: 'cancelled' };
    }
    if (code === PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR) {
      return { status: 'already-owned' };
    }
    if (code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
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
  if (!isBillingConfigured()) {
    throw new Error('Purchases aren’t available in this build yet.');
  }
  const info = await Purchases.restorePurchases();
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
  if (!isBillingConfigured()) return false;
  try {
    return hasForgePass(await Purchases.getCustomerInfo());
  } catch {
    return false;
  }
}

export { emberPackForProduct };
