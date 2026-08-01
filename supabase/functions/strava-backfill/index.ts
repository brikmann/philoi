// Poll-on-app-open safety net (PHILOI_UI_SPEC.md §17b) — webhook is the primary trigger (a run
// should appear within seconds), this just catches anything the webhook missed (a dropped
// delivery, the subscription not existing yet, etc.) by walking activities newer than the
// connection's own cursor. Client-facing: called with the user's own session, same as strava-sync.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { accessTokenFor, processStravaActivity } from '../_shared/strava-activity.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Not authenticated.' }, 401);

    const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: connection } = await serviceClient
      .from('strava_connections')
      .select('user_id, access_token, refresh_token, expires_at, last_synced_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!connection) return json({ processed: 0 });

    const accessToken = await accessTokenFor(serviceClient, connection);

    const after = Math.floor(new Date(connection.last_synced_at).getTime() / 1000);
    let processed = 0;
    let latestSeen = new Date(connection.last_synced_at);

    // Two pages (up to 200 activities) is plenty for a "since I last opened the app" catch-up —
    // this isn't meant to walk someone's entire multi-year Strava history.
    for (const page of [1, 2]) {
      const activitiesRes = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${after}&page=${page}&per_page=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!activitiesRes.ok) break;
      const activities = await activitiesRes.json();
      if (!Array.isArray(activities) || activities.length === 0) break;

      for (const summary of activities) {
        const result = await processStravaActivity(serviceClient, connection, summary.id);
        if (result?.created) processed++;
        const activityDate = new Date(summary.start_date);
        if (activityDate > latestSeen) latestSeen = activityDate;
      }
      if (activities.length < 100) break;
    }

    await serviceClient.from('strava_connections').update({ last_synced_at: new Date().toISOString() }).eq('user_id', user.id);

    return json({ processed });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
