// Exchanges the one-time Spotify authorization code for a refresh token — the ONLY place the
// Spotify client secret is ever used, mirroring gcal-oauth-exchange
// (CODE_PROMPT_spotify_backend.md §3).
//
// The client runs an expo-auth-session authorization-code flow in the system browser and hands
// over the `code` (plus its `codeVerifier`, if it used PKCE) — nothing else. The app never sees a
// Spotify access or refresh token: this function stores the refresh token AES-256-GCM-encrypted
// under SPOTIFY_TOKEN_ENC_KEY and hands back only a boolean and a display name.
//
// WHY THE REDIRECT URI IS NOT A REQUEST PARAMETER — same reasoning as gcal-oauth-exchange: Spotify
// requires the exchange's redirect_uri to match the authorize call's byte-for-byte, and a value the
// caller controls is a value the caller can point somewhere else. It comes from project config.
//
// PKCE + SECRET. Spotify documents the server-secret flow (Basic auth) and the PKCE flow (client_id
// + code_verifier) separately. expo-auth-session sends a code_challenge by default, and a code
// issued against a challenge must be redeemed with its verifier — so when the client sends one it
// is forwarded ALONGSIDE the Basic credentials. ⚠️ Confirm on the first real connect; if Spotify
// rejects the combination, set `usePKCE: false` on the client rather than dropping the secret.
//
// Requires these on the Supabase project (not in the app):
//   supabase secrets set SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... \
//                        SPOTIFY_TOKEN_ENC_KEY="$(openssl rand -base64 32)"
//   (optional) SPOTIFY_REDIRECT_URI — defaults to this project's spotify-oauth-callback relay.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are provided by the runtime.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';
import { grantCoversNowPlaying, requireEnv, SPOTIFY_TOKEN_KEY_ENV, spotifyBasicAuth } from '../_shared/spotify.ts';
import { encryptSecret } from '../_shared/token-crypto.ts';

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

    const { code, codeVerifier } = await req.json().catch(() => ({}));
    if (typeof code !== 'string' || !code) return json({ error: 'Missing code.' }, 400);

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    });
    if (typeof codeVerifier === 'string' && codeVerifier) params.set('code_verifier', codeVerifier);

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: spotifyBasicAuth() },
      body: params,
    });

    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      return json({ error: 'Spotify rejected the authorization code.', detail: tokenData?.error ?? null }, 502);
    }

    // AUTHORITATIVE SCOPE CHECK — Spotify's own `scope` on the token response, not what the app
    // claims it asked for.
    const grantedScopes: string = typeof tokenData.scope === 'string' ? tokenData.scope : '';
    if (grantedScopes && !grantCoversNowPlaying(grantedScopes)) {
      return json({ connected: false, reason: 'scope_not_granted' });
    }
    if (typeof tokenData.access_token !== 'string') {
      return json({ error: 'Spotify returned no access token.' }, 502);
    }

    // WHICH Spotify account this is — shown to the owner in Connected Apps, never to anyone else.
    // Also the dev-mode gate: an app in development mode 403s every Web API call for a member not
    // on its allowlist (max 5). Storing that grant would only produce a connection that can never
    // read a track, so refuse it here with a reason the app can explain.
    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (meRes.status === 403) return json({ connected: false, reason: 'spotify_user_not_allowlisted' });
    const me = meRes.ok ? await meRes.json().catch(() => null) : null;
    const spotifyUserId: string | null = typeof me?.id === 'string' ? me.id : null;
    const displayName: string | null = typeof me?.display_name === 'string' && me.display_name ? me.display_name : null;

    const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Spotify returns a refresh token on every code exchange, but if one ever doesn't come back
    // and we already hold a working grant, "you're connected" is the right answer — not
    // overwriting a good token with nothing.
    if (typeof tokenData.refresh_token !== 'string' || !tokenData.refresh_token) {
      const { data: existing } = await serviceClient
        .from('spotify_connections')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (existing) {
        if (spotifyUserId) {
          await serviceClient
            .from('spotify_connections')
            .update({ spotify_user_id: spotifyUserId, display_name: displayName })
            .eq('user_id', user.id);
        }
        return json({ connected: true, reused: true, accountName: displayName ?? spotifyUserId });
      }
      return json({ connected: false, reason: 'no_refresh_token' });
    }

    const nowIso = new Date().toISOString();
    const { error: upsertError } = await serviceClient.from('spotify_connections').upsert({
      user_id: user.id,
      refresh_token_encrypted: await encryptSecret(tokenData.refresh_token, SPOTIFY_TOKEN_KEY_ENV),
      spotify_user_id: spotifyUserId,
      display_name: displayName,
      scopes: grantedScopes,
      connected_at: nowIso,
      // A reconnect starts the member's rate-limit hour over rather than inheriting a half-spent
      // counter from the previous grant.
      last_fetched_at: null,
      fetch_count: 0,
      fetch_window_started_at: nowIso,
    });
    if (upsertError) return json({ error: upsertError.message }, 500);

    return json({ connected: true, accountName: displayName ?? spotifyUserId });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

/** Where Spotify sends the browser back to. Spotify requires HTTPS redirect URIs (loopback aside),
 * so the default is this project's spotify-oauth-callback relay, which 302s on to philoi://.
 * Overridable only by project config, never by a caller. */
function redirectUri(): string {
  const explicit = Deno.env.get('SPOTIFY_REDIRECT_URI');
  if (explicit) return explicit;
  return `${requireEnv('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/spotify-oauth-callback`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
