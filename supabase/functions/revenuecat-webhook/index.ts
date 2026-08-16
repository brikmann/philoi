// RevenueCat → Philoi. The ONLY thing allowed to turn money into embers or an entitlement (#71).
//
// RevenueCat POSTs an event whenever a purchase changes state and retries until it gets a 2xx. Two
// consequences shape everything below:
//
//   1. IDEMPOTENCE IS MANDATORY. The same event WILL arrive twice. grant_iap_purchase is keyed on
//      RevenueCat's own event id and no-ops on a repeat, so a retry cannot double-grant.
//   2. A 200 MEANS "STOP SENDING THIS". So we answer 200 for events we deliberately ignore
//      (renewals of things we don't sell, cancellations, billing issues) and reserve non-2xx for
//      "we genuinely failed, please retry" — returning 500 for an event type we simply don't handle
//      would have RevenueCat redelivering it forever.
//
// Auth is the shared secret configured on the RevenueCat webhook, compared in constant time against
// REVENUECAT_WEBHOOK_SECRET. Without it this endpoint is a public "give me embers" button.

import { createClient } from 'npm:@supabase/supabase-js@2';

// MONEY-CRITICAL. Must match src/lib/economy/iap.ts and src/lib/economy/forge-pass.ts exactly, and
// both must match App Store Connect. Duplicated rather than imported because an edge function
// cannot reach into the app bundle.
//
// Because nothing in the type system connects these two copies, the pairing is enforced by
// `npm run check:iap` (scripts/check-iap-ids.js), which parses BOTH files and exits non-zero if the
// ids or the amounts disagree. Run it before any store-facing release — a silent drift here is a
// charged card and an empty account.
const FORGE_PASS_PRODUCT_ID = 'app.philoi.forge_pass.season';
const EMBERS_BY_PRODUCT: Record<string, number> = {
  'app.philoi.embers.500': 500,
  'app.philoi.embers.1200': 1_200,
  'app.philoi.embers.2600': 2_600,
  'app.philoi.embers.7000': 7_000,
};

/**
 * Event types that MOVE VALUE TO THE USER. Everything else is acknowledged and dropped.
 *
 * NON_RENEWING_PURCHASE is the Forge Pass (it's a one-time-per-season product) and every ember
 * pack. INITIAL_PURCHASE/RENEWAL are here so that flipping the Pass to an auto-renewing
 * subscription later doesn't need a webhook change. UNCANCELLATION restores an entitlement the user
 * had already paid for.
 *
 * Refunds and expirations are deliberately NOT handled: revoking a cosmetic someone has been
 * wearing, or clawing back embers they have already spent on a box, needs a product decision about
 * what a negative balance even means. Logged and ignored until that decision exists.
 */
const GRANTING_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'NON_RENEWING_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
]);

/** Timing-safe compare, so the secret can't be recovered a byte at a time. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const expected = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  if (!expected) {
    // Refuse to run unauthenticated rather than defaulting open. 500 so RevenueCat retries once the
    // secret is actually configured, instead of silently discarding real purchases.
    console.error('[revenuecat] REVENUECAT_WEBHOOK_SECRET is not set — refusing to process');
    return new Response('Webhook not configured', { status: 500 });
  }
  if (!secretMatches(req.headers.get('Authorization'), expected)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: { event?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    // Malformed JSON will never become valid on retry.
    return new Response('Bad request', { status: 400 });
  }

  const event = body.event;
  if (!event || typeof event.id !== 'string') {
    return new Response('Bad request', { status: 400 });
  }

  const eventId = event.id as string;
  const eventType = String(event.type ?? '');
  const appUserId = String(event.app_user_id ?? '');
  const productId = String(event.product_id ?? '');

  if (!GRANTING_EVENTS.has(eventType)) {
    // Acknowledged on purpose — see the note about 200 meaning "stop sending this".
    console.log(`[revenuecat] ignoring ${eventType} (${eventId})`);
    return new Response(JSON.stringify({ ok: true, ignored: eventType }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const isPass = productId === FORGE_PASS_PRODUCT_ID;
  const embers = EMBERS_BY_PRODUCT[productId] ?? 0;

  if (!isPass && embers === 0) {
    // A product we don't recognise. Loud, because it almost certainly means a product id was
    // created in App Store Connect that doesn't match this file — a purchase that charges real
    // money and grants nothing. Still 200: retrying won't teach us the id.
    console.error(`[revenuecat] UNKNOWN PRODUCT "${productId}" on ${eventType} (${eventId}) — granted nothing`);
    return new Response(JSON.stringify({ ok: true, unknownProduct: productId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: userId, error: lookupError } = await service.rpc('profile_id_for_app_user', {
    p_app_user_id: appUserId,
  });

  if (lookupError) {
    console.error('[revenuecat] user lookup failed', lookupError);
    return new Response('Lookup failed', { status: 500 });
  }

  if (!userId) {
    // An anonymous RevenueCat id, or an account deleted since purchase. Retrying cannot fix either,
    // so acknowledge — but log loudly, because this is somebody who paid and got nothing.
    console.error(`[revenuecat] NO PROFILE for app_user_id "${appUserId}" on ${eventId} — granted nothing`);
    return new Response(JSON.stringify({ ok: true, unmatchedUser: appUserId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data, error } = await service.rpc('grant_iap_purchase', {
    p_event_id: eventId,
    p_user: userId,
    p_event_type: eventType,
    p_product_id: productId,
    p_embers: embers,
    p_is_pass: isPass,
    p_payload: event,
  });

  if (error) {
    // A real failure — the DB was unreachable, or grant_forge_pass refused because the season is
    // closed. 500 so RevenueCat retries; the event id keeps that retry safe.
    console.error(`[revenuecat] grant failed for ${eventId}`, error);
    return new Response('Grant failed', { status: 500 });
  }

  console.log(`[revenuecat] ${eventType} ${productId} → user ${userId}`, data);
  return new Response(JSON.stringify({ ok: true, result: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
