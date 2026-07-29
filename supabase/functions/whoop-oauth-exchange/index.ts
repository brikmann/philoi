// Exchanges a Whoop OAuth authorization code for tokens — the ONLY place the Whoop client secret
// is ever used (PHILOI_UI_SPEC.md §17: "secret stays server-side — NEVER ship it in the app").
// The client (src/lib/whoop.ts) does the authorize-page redirect itself via expo-auth-session,
// gets back a one-time `code`, and hands it to this function — nothing else.
//
// Requires these to be set on the Supabase project (not in the app):
//   supabase secrets set WHOOP_CLIENT_ID=... WHOOP_CLIENT_SECRET=...
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are provided automatically by the
// Edge Functions runtime.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

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

    const { code, redirectUri } = await req.json();
    if (typeof code !== 'string' || !code) return json({ error: 'Missing code.' }, 400);
    if (typeof redirectUri !== 'string' || !redirectUri) return json({ error: 'Missing redirectUri.' }, 400);

    // Whoop's token endpoint is an Ory Hydra one — form-encoded, not JSON.
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: Deno.env.get('WHOOP_CLIENT_ID')!,
        client_secret: Deno.env.get('WHOOP_CLIENT_SECRET')!,
      }),
    });
    if (!tokenRes.ok) {
      const detail = await tokenRes.text();
      return json({ error: 'Whoop rejected the authorization code.', detail }, 502);
    }
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token || !tokenData.refresh_token) {
      // No refresh token means the `offline` scope wasn't granted — the connection would die at
      // the first token expiry, so refuse it now rather than storing a connection that silently
      // stops working in an hour.
      return json({ error: 'Whoop did not return a refresh token — reconnect and allow offline access.' }, 502);
    }

    // Store what Whoop ACTUALLY granted, not what we asked for — whoop-sync checks this before
    // firing a request that would 403 (§17 minimal scopes: a connection made for a workout
    // challenge legitimately has no read:sleep).
    const grantedScopes = typeof tokenData.scope === 'string' ? tokenData.scope : '';

    // Service role — whoop_connections has no client-facing RLS policy at all, this is the only
    // path that ever writes to it.
    const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error: upsertError } = await serviceClient.from('whoop_connections').upsert({
      user_id: user.id,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: new Date(Date.now() + Number(tokenData.expires_in ?? 3600) * 1000).toISOString(),
      scopes: grantedScopes,
    });
    if (upsertError) return json({ error: upsertError.message }, 500);

    return json({ connected: true, scopes: grantedScopes });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
