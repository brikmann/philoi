// Strava's push-subscription callback (PHILOI_UI_SPEC.md §17b) — the real-time, primary trigger
// for "auto lock-in from a synced Strava activity." Two request shapes hit this one endpoint,
// exactly per Strava's webhook spec:
//   GET  — the one-time subscription handshake (hub.mode/hub.challenge/hub.verify_token)
//   POST — an activity create/update event, must 200 within a couple seconds or Strava retries
import { createClient } from 'npm:@supabase/supabase-js@2';
import { processStravaActivity } from '../_shared/strava-activity.ts';

Deno.serve(async (req) => {
  const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const challenge = url.searchParams.get('hub.challenge');
    const verifyToken = url.searchParams.get('hub.verify_token');

    const { data: subscription } = await serviceClient
      .from('strava_webhook_subscription')
      .select('verify_token')
      .limit(1)
      .maybeSingle();

    if (mode !== 'subscribe' || !challenge || !subscription || verifyToken !== subscription.verify_token) {
      return new Response('Verification failed.', { status: 403 });
    }
    return new Response(JSON.stringify({ 'hub.challenge': challenge }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'POST') {
    try {
      const event = await req.json();
      // Only activity create/update ever turns into a lock-in — deauthorization events and
      // deletes are out of scope for this pass (a deleted-on-Strava activity keeps its lock-in;
      // reconciling that is a separate, later concern, not part of the locked scope here).
      if (event.object_type !== 'activity' || !['create', 'update'].includes(event.aspect_type)) {
        return new Response('ok', { status: 200 });
      }

      const { data: connection } = await serviceClient
        .from('strava_connections')
        .select('user_id, access_token, refresh_token, expires_at')
        .eq('athlete_id', event.owner_id)
        .maybeSingle();
      // No matching connection (athlete disconnected, or this webhook somehow fired for a
      // non-Philoi athlete) — still 200 so Strava doesn't retry a request we'll never be able
      // to act on.
      if (!connection) return new Response('ok', { status: 200 });

      await processStravaActivity(serviceClient, connection, event.object_id);
      return new Response('ok', { status: 200 });
    } catch (e) {
      // Still 200: Strava's retry/backoff schedule for non-2xx responses can end up disabling
      // the subscription entirely after enough failures. A single failed activity is better
      // recovered by the strava-backfill safety net on next app-open than by risking that.
      console.error('[strava-webhook] processing error:', e instanceof Error ? e.message : e);
      return new Response('ok', { status: 200 });
    }
  }

  return new Response('Method not allowed.', { status: 405 });
});
