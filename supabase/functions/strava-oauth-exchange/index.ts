// Exchanges a Strava OAuth authorization code for tokens — the ONLY place the Strava client
// secret is ever used (PHILOI_UI_SPEC.md §17: "secret stays server-side — NEVER ship it in the
// app"). The client (src/lib/strava.ts) does the authorize-page redirect itself via
// expo-auth-session, gets back a one-time `code`, and hands it to this function — nothing else.
//
// Requires these to be set on the Supabase project (not in the app):
//   supabase secrets set STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=...
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are provided automatically by the
// Edge Functions runtime.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

    // Verify the caller via THEIR OWN token — we only ever act on behalf of whoever this JWT
    // belongs to, never an id passed in the request body.
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Not authenticated.' }, 401);

    const { code } = await req.json();
    if (typeof code !== 'string' || !code) return json({ error: 'Missing code.' }, 400);

    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('STRAVA_CLIENT_ID'),
        client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
        code,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      const detail = await tokenRes.text();
      return json({ error: 'Strava rejected the authorization code.', detail }, 502);
    }
    const tokenData = await tokenRes.json();

    // Service role — strava_connections has no client-facing RLS policy at all, this is the
    // only path that ever writes to it.
    const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error: upsertError } = await serviceClient.from('strava_connections').upsert({
      user_id: user.id,
      athlete_id: tokenData.athlete.id,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: new Date(tokenData.expires_at * 1000).toISOString(),
    });
    if (upsertError) return json({ error: upsertError.message }, 500);

    return json({ connected: true, athlete_id: tokenData.athlete.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
