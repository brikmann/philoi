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
import {
  ALL_PRODUCT_IDS,
  FORGE_PASS_ENTITLEMENT,
  emberPackForProduct,
  isForgePassProduct,
} from '@/lib/economy/iap';

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

// ─────────────────────────── Membership · DELETED, not dormant ──────────────────────────
//
// The flat-membership model from the 2026-06-28 decision log (MEMBERSHIP_PRICING / MEMBERSHIP_PITCH
// / purchaseMembership) lived here long after monetization went a different way, kept alive only
// because src/app/paywall.tsx rendered it as a "coming later" preview. That screen is the Flame
// Pass paywall now (mock 200), nothing else imported these, and a price table for a product that
// will never exist is exactly the kind of thing that gets quoted to a user by accident.
//
// What Philoi sells is below: the seasonal Flame Pass (`forge_pass` to the store) and consumable
// ember packs. Nothing else.

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

// ─────────────────────────── Identity · the attribution guarantee ──────────────────────────
//
// Build 4's verified Pass purchase landed in RevenueCat under `$RCAnonymousID:…` and only reached
// the right account because the dashboard's "Transfer to new App User ID" happened to alias it.
// That is luck, not design: the webhook resolves the grant from `app_user_id`, and an anonymous id
// resolves to NO profile — a charged card and nothing granted.
//
// The old shape made that window easy to hit. Identification was fire-and-forget from an effect, a
// failed `logIn` was logged and never retried, and nothing made a purchase wait for it — so
// sign-out's `logOut()` (which leaves the SDK anonymous), a slow network on session restore, or a
// purchase tapped before `configure` resolved could all open the store sheet on an anonymous id.
//
// Now: every identity change runs on ONE serial chain (so a sign-out and the next sign-in can't
// interleave), each step VERIFIES `getAppUserID()` afterwards rather than trusting the call, and the
// purchase path calls ensureIdentified() and refuses to open the store sheet unless the SDK's user
// IS the Supabase user. Attribution no longer depends on timing — an anonymous purchase can't start.

/** The Supabase user RevenueCat SHOULD be identified as. null = signed out. */
let desiredUserId: string | null = null;
/** Serialises configure / logIn / logOut so they can never interleave. */
let identityChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(step: () => Promise<T>): Promise<T> {
  const run = identityChain.then(step, step);
  // The chain must survive a failed step, or one network blip would wedge every later identity call.
  identityChain = run.catch(() => undefined);
  return run;
}

/**
 * Make the SDK's appUserID equal `userId`, and say whether it actually is afterwards. Never throws:
 * a billing failure must make purchases unavailable, not take the app down.
 */
async function identify(userId: string): Promise<boolean> {
  const key = apiKey();
  const rc = sdk();
  if (!key || !rc) return false;
  const Purchases = rc.default;
  try {
    if (!configured) {
      if (__DEV__) await Purchases.setLogLevel(rc.LOG_LEVEL.DEBUG);
      // appUserID at configure time means the SDK never mints an anonymous id for this session.
      await Purchases.configure({ apiKey: key, appUserID: userId });
      configured = true;
    } else if ((await Purchases.getAppUserID()) !== userId) {
      await Purchases.logIn(userId);
    }
    const current = await Purchases.getAppUserID();
    if (current !== userId) {
      console.warn(`[billing] identify: SDK is "${current}", not the Supabase user — purchases blocked`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[billing] identify failed', e);
    return false;
  }
}

/**
 * Called once the user is known (see AuthProvider) — on sign-in AND on session restore, since both
 * change the session's user id. The Supabase user id is RevenueCat's appUserID, which is what ties
 * an entitlement to an ACCOUNT rather than a device: without it a reinstall or a new phone reads as
 * a different customer and the Pass appears to vanish.
 *
 * Safe to call repeatedly; a CHANGED id (sign-out then sign-in as someone else) switches the SDK
 * over, so entitlements never bleed across accounts on a shared device.
 */
export async function configureBilling(userId: string | null): Promise<void> {
  if (!userId) return;
  desiredUserId = userId;
  await enqueue(() => identify(userId));
}

/**
 * Resolve to true only when the SDK is identified as the signed-in Supabase user. Waits out any
 * in-flight configure/logIn, and retries if the last attempt failed — the common failure is a
 * `logIn` that died on a flaky connection at sign-in and was never tried again.
 */
export async function ensureIdentified(): Promise<boolean> {
  const userId = desiredUserId;
  if (!userId || !isBillingConfigured()) return false;
  return enqueue(() => identify(userId));
}

/** Sign the user out of RevenueCat on app sign-out, so the next account starts clean. */
export async function resetBilling(): Promise<void> {
  desiredUserId = null;
  const rc = sdk();
  if (!rc) return;
  await enqueue(async () => {
    if (!configured) return;
    try {
      await rc.default.logOut();
    } catch {
      // logOut throws for an already-anonymous user, which is a no-op condition, not an error.
    }
  });
}

/** Shown when a purchase is refused because the account link couldn't be confirmed. */
const IDENTITY_MESSAGE =
  'We couldn’t link this purchase to your account. Check your connection and try again — you haven’t been charged.';

export type PurchaseOutcome =
  | { status: 'granted'; productId: string }
  | { status: 'cancelled' }
  | { status: 'already-owned' }
  | { status: 'pending' }
  | { status: 'unavailable'; message: string };

/**
 * Say OUT LOUD why an offering came back unusable.
 *
 * Every store-configuration mistake reaches the user as the same thing: a price that renders as
 * "—" (see paywall.tsx and shop/index.tsx, which are right to show a placeholder rather than invent
 * a number). One symptom, four unrelated causes — no offering marked Current in the RevenueCat
 * dashboard, a product created in RevenueCat but never added to the offering, a product still
 * unapproved in the store, or an id spelled differently there than in iap.ts. Nothing on screen
 * distinguishes them, which during sandbox bring-up is hours of guessing at a paywall that just
 * "looks broken".
 *
 * ALL_PRODUCT_IDS is the expected set, and iap.ts has always documented it as existing for exactly
 * this comparison — it just had no caller until now.
 *
 * Deduped on the message rather than latched to a single run: fetchOffering is called by both
 * fetchProductPrices and findPackage, so warning per call would bury itself, but latching once
 * would permanently pin a complaint from a call that raced app start. A changed diagnosis — the
 * offering filling in a moment later — still gets said.
 */
let lastDiagnosis: string | null = null;

function diagnoseOffering(offering: PurchasesOffering | null): void {
  const problems: string[] = [];

  if (!offering) {
    problems.push(
      'getOfferings() returned no CURRENT offering. In the RevenueCat dashboard, either no offering ' +
        'is marked Current, or the one that is has no products the store will serve yet.'
    );
  } else {
    const live = new Set(offering.availablePackages.map((pkg) => pkg.product.identifier));
    const missing = ALL_PRODUCT_IDS.filter((id) => !live.has(id));
    const unknown = [...live].filter((id) => !ALL_PRODUCT_IDS.includes(id));

    if (missing.length > 0) {
      problems.push(
        `offering "${offering.identifier}" is missing ${missing.length} product(s) this app sells: ` +
          `${missing.join(', ')}. Each renders with no price. It is absent from the offering, not yet ` +
          'approved in the store, or spelled differently there than in iap.ts.'
      );
    }
    if (unknown.length > 0) {
      problems.push(
        `offering "${offering.identifier}" carries product(s) this app has no id for: ${unknown.join(', ')}. ` +
          'Almost always a typo: the store id and iap.ts disagree, so buying it would charge the card ' +
          'and grant nothing — the webhook drops unrecognised product ids.'
      );
    }
  }

  const message =
    problems.length > 0
      ? `[billing] ${problems.join(' ')}`
      : `[billing] offering "${offering?.identifier}" matches all ${ALL_PRODUCT_IDS.length} product ids`;

  if (message === lastDiagnosis) return;
  lastDiagnosis = message;
  if (problems.length > 0) console.warn(message);
  else console.log(message);
}

/** The current offering's packages, or null when billing isn't configured / nothing is published. */
export async function fetchOffering(): Promise<PurchasesOffering | null> {
  const rc = sdk();
  if (!isBillingConfigured() || !rc) return null;
  // Wait out configure before asking for offerings: on a cold start the paywall can mount before the
  // auth effect's configure resolves, and getOfferings() on an unconfigured SDK throws — which used
  // to surface as a paywall full of "—" prices. Not gated on the result: prices are safe to show
  // unidentified; only the PURCHASE must be identified, and purchaseProduct checks that itself.
  await ensureIdentified();
  if (!configured) return null;
  try {
    const offerings = await rc.default.getOfferings();
    const current = offerings.current ?? null;
    diagnoseOffering(current);
    return current;
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

  // THE ATTRIBUTION GATE. The store sheet only opens when RevenueCat is identified as this Supabase
  // user — otherwise the purchase lands on an anonymous id the webhook can't resolve to anyone.
  if (!(await ensureIdentified())) {
    track('iap_purchase_blocked_unidentified', { product: productId });
    return { status: 'unavailable', message: IDENTITY_MESSAGE };
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
  // Same gate as a purchase: a restore run while anonymous would attach the Pass to the anonymous
  // id, and "Transfer to new App User ID" is not something to lean on twice.
  if (!(await ensureIdentified())) {
    throw new Error('We couldn’t link to your account. Check your connection and try again.');
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
  // An anonymous SDK answers for the anonymous customer, not this account — asking it would either
  // miss a Pass the account owns or report one it doesn't.
  if (!(await ensureIdentified())) return false;
  try {
    return hasForgePass(await rc.default.getCustomerInfo());
  } catch {
    return false;
  }
}

export { emberPackForProduct };
