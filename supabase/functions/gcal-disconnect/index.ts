// Disconnect Google Calendar — REVOKES THE GRANT AT GOOGLE, then forgets it here
// (GCAL_INTEGRATION_SPEC.md: "Revocable in Connected Apps + Google account").
//
// This is the one thing the Strava/Whoop disconnects can't do: those are local deletes with a
// "revoke it in their settings too" caveat. A calendar grant is too sensitive to leave alive on
// Google's side just because the member tapped Disconnect in an app, so the refresh token is
// decrypted here and handed to Google's revoke endpoint before the row goes.
//
// The local delete happens either way. A member who taps Disconnect must ALWAYS end up
// disconnected in Philoi, even if Google is unreachable — `revoked` in the response tells the app
// whether the Google-side half also succeeded.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';
import { forgetConnection, revokeRefreshToken } from '../_shared/gcal.ts';
import { decryptSecret } from '../_shared/token-crypto.ts';

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
      .from('google_calendar_connections')
      .select('refresh_token_encrypted')
      .eq('user_id', user.id)
      .maybeSingle();

    let revoked = false;
    if (connection) {
      try {
        revoked = await revokeRefreshToken(await decryptSecret(connection.refresh_token_encrypted));
      } catch {
        // A token we can no longer decrypt (key rotated) is already useless to us — the delete
        // below is still the right and only remaining action.
        revoked = false;
      }
    }

    await forgetConnection(serviceClient, user.id);

    return json({ disconnected: true, revoked });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
