// Pulls the caller's Strava activities for a run_distance/ride_distance challenge's window,
// reduces to the one number that challenge cares about (total km of the matching activity
// type), and logs ONLY that number via the existing log_challenge_progress() RPC — never a
// health/activity export, never another user's data (Strava's terms: a member only ever sees
// their OWN Strava-derived numbers).
//
// Token refresh (needs the client secret) happens here, server-side, same as the initial
// exchange in strava-oauth-exchange — the client never sees a Strava access or refresh token.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SYNC_NOTE = 'Auto-synced from Strava';
const ACTIVITY_TYPE_BY_CHALLENGE_TYPE: Record<string, string[]> = {
  run_distance: ['Run', 'TrailRun'],
  ride_distance: ['Ride', 'VirtualRide', 'GravelRide'],
};

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

    const { challengeId } = await req.json();
    if (typeof challengeId !== 'string' || !challengeId) return json({ error: 'Missing challengeId.' }, 400);

    // RLS-scoped to the caller's own token, so this can only ever return a challenge they own —
    // no separate ownership check needed beyond that.
    const { data: challenge, error: challengeError } = await userClient
      .from('challenges')
      .select('id, type, period_start, completed_at')
      .eq('id', challengeId)
      .single();
    if (challengeError || !challenge) return json({ error: 'Challenge not found.' }, 404);

    const activityTypes = ACTIVITY_TYPE_BY_CHALLENGE_TYPE[challenge.type];
    if (!activityTypes || challenge.completed_at) return json({ synced: 0 });

    const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: connection } = await serviceClient
      .from('strava_connections')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!connection) return json({ synced: 0, error: 'Not connected to Strava.' });

    let accessToken = connection.access_token;
    if (new Date(connection.expires_at).getTime() < Date.now() + 60_000) {
      const refreshRes = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: Deno.env.get('STRAVA_CLIENT_ID'),
          client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
          grant_type: 'refresh_token',
          refresh_token: connection.refresh_token,
        }),
      });
      if (!refreshRes.ok) return json({ error: 'Could not refresh Strava token — reconnect required.' }, 502);
      const refreshData = await refreshRes.json();
      accessToken = refreshData.access_token;
      await serviceClient
        .from('strava_connections')
        .update({
          access_token: refreshData.access_token,
          refresh_token: refreshData.refresh_token,
          expires_at: new Date(refreshData.expires_at * 1000).toISOString(),
        })
        .eq('user_id', user.id);
    }

    // Strava paginates at up to 200/page; two pages comfortably covers a day/week challenge
    // window without needing full pagination handling for this pass.
    const after = Math.floor(new Date(challenge.period_start).getTime() / 1000);
    const before = Math.floor(Date.now() / 1000);
    let totalMeters = 0;
    for (const page of [1, 2]) {
      const activitiesRes = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${after}&before=${before}&page=${page}&per_page=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!activitiesRes.ok) break;
      const activities = await activitiesRes.json();
      if (!Array.isArray(activities) || activities.length === 0) break;
      for (const activity of activities) {
        if (activityTypes.includes(activity.type)) totalMeters += activity.distance ?? 0;
      }
      if (activities.length < 100) break;
    }
    const totalKm = totalMeters / 1000;

    const { data: logs } = await userClient.from('challenge_logs').select('amount').eq('challenge_id', challengeId).eq('note', SYNC_NOTE);
    const alreadySynced = (logs ?? []).reduce((sum: number, row: { amount: number }) => sum + Number(row.amount), 0);
    const delta = Math.round((totalKm - alreadySynced) * 100) / 100;
    if (delta <= 0) return json({ synced: 0 });

    const { error: logError } = await userClient.rpc('log_challenge_progress', {
      p_challenge_id: challengeId,
      p_amount: delta,
      p_note: SYNC_NOTE,
    });
    if (logError) return json({ error: logError.message }, 500);

    return json({ synced: delta });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
