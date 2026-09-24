// Disconnect Spotify — forgets the grant here (CODE_PROMPT_spotify_backend.md §3).
//
// ⚠️ UNLIKE gcal-disconnect THIS CANNOT REVOKE AT THE PROVIDER. Spotify's Web API has no token
// revocation endpoint; the only way to kill the grant on Spotify's side is for the member to remove
// Philoi at spotify.com/account/apps. So this is a local delete — the Strava/Whoop shape — and
// `revoked: false` is returned honestly so the app can say where to finish the job.
//
// The delete wipes everything we hold: there is no history or now-playing cache to purge
// alongside the row (see _shared/spotify.ts forgetConnection). With the encrypted refresh token
// gone, the grant is unusable by Philoi even though Spotify still lists it.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';
import { forgetConnection } from '../_shared/spotify.ts';

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
    await forgetConnection(serviceClient, user.id);

    return json({ disconnected: true, revoked: false });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
