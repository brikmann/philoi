// One-time (or re-run-when-rotating) admin action: creates Strava's push-subscription pointed at
// strava-webhook, and records it in strava_webhook_subscription so strava-webhook can validate
// the handshake's verify_token. Strava allows exactly ONE subscription per API application — if
// one already exists, this deletes it first so re-running is idempotent rather than erroring on
// Strava's "subscription already exists" response.
//
// Not client-facing: no CORS — this is meant to be curl'd once by whoever holds the Supabase
// service-role key, the same trust level as running a migration by hand.
//
// That trust level is enforced IN THIS FUNCTION (see the service-role check below) rather than
// left to the platform's verify_jwt flag. Deploying with --no-verify-jwt would otherwise leave
// an unauthenticated endpoint that lets anyone repoint our Strava push-subscription at their own
// callback URL (hijacking every user's activity events) or delete it outright (silently killing
// the real-time trigger) — and the flag is sticky per function, so it is not something to rely
// on being set correctly. Same self-authenticating pattern as strava-sync/strava-backfill.
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed.', { status: 405 });

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const presented = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!serviceRoleKey || !presented || !timingSafeEquals(presented, serviceRoleKey)) {
    return new Response(JSON.stringify({ error: 'Service-role authorization required.' }), { status: 401 });
  }

  try {
    const { callbackUrl } = await req.json();
    if (typeof callbackUrl !== 'string' || !callbackUrl) {
      return new Response(JSON.stringify({ error: 'Missing callbackUrl (the deployed strava-webhook URL).' }), { status: 400 });
    }

    const clientId = Deno.env.get('STRAVA_CLIENT_ID');
    const clientSecret = Deno.env.get('STRAVA_CLIENT_SECRET');
    const verifyToken = crypto.randomUUID();
    const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Clear out any existing subscription first — Strava rejects a second create while one is
    // still active, and re-running this (e.g. after redeploying strava-webhook to a new URL)
    // should just work rather than requiring a manual delete first.
    const listRes = await fetch(`https://www.strava.com/api/v3/push_subscriptions?client_id=${clientId}&client_secret=${clientSecret}`);
    if (listRes.ok) {
      const existing = await listRes.json();
      for (const sub of Array.isArray(existing) ? existing : []) {
        await fetch(`https://www.strava.com/api/v3/push_subscriptions/${sub.id}?client_id=${clientId}&client_secret=${clientSecret}`, {
          method: 'DELETE',
        });
      }
    }
    await serviceClient.from('strava_webhook_subscription').delete().neq('id', -1);

    // Insert the pending verify_token row BEFORE asking Strava to create the subscription —
    // Strava validates the callback URL SYNCHRONOUSLY as part of this create call (it GETs
    // strava-webhook with the handshake params right away), so that row has to already exist
    // for strava-webhook to have anything to check the incoming verify_token against.
    const { data: pending, error: pendingError } = await serviceClient
      .from('strava_webhook_subscription')
      .insert({ callback_url: callbackUrl, verify_token: verifyToken })
      .select('id')
      .single();
    if (pendingError || !pending) {
      return new Response(JSON.stringify({ error: 'Could not record the pending subscription.' }), { status: 500 });
    }

    const createRes = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        callback_url: callbackUrl,
        verify_token: verifyToken,
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      // Handshake or Strava-side failure — remove the now-dangling pending row rather than
      // leaving a verify_token around for a subscription that doesn't actually exist.
      await serviceClient.from('strava_webhook_subscription').delete().eq('id', pending.id);
      return new Response(JSON.stringify({ error: 'Strava rejected the subscription request.', detail: createData }), { status: 502 });
    }

    await serviceClient.from('strava_webhook_subscription').update({ strava_subscription_id: createData.id }).eq('id', pending.id);

    return new Response(JSON.stringify({ subscriptionId: createData.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error.' }), { status: 500 });
  }
});

/** Constant-time string compare — a plain `===` on a secret leaks its prefix length through
 * response timing. Compares full length regardless of where the first mismatch is. */
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
