// Exchanges the one-time Google server auth code for a refresh token — the ONLY place the Google
// web client secret is ever used, exactly as strava-oauth-exchange does for Strava
// (GCAL_INTEGRATION_SPEC.md: "Store the refresh token encrypted, server-side only").
//
// The client (src/lib/google-calendar.ts) drives the native Google consent sheet itself via
// @react-native-google-signin with offlineAccess, gets back a `serverAuthCode`, and hands it here
// — nothing else. The app never sees a Google access or refresh token, and never could: this
// function stores the refresh token AES-256-GCM-encrypted and hands back only a boolean.
//
// Requires these on the Supabase project (not in the app):
//   supabase secrets set GOOGLE_WEB_CLIENT_ID=... GOOGLE_WEB_CLIENT_SECRET=... \
//                        GCAL_TOKEN_ENC_KEY="$(openssl rand -base64 32)"
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are provided by the runtime.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';
import { GOOGLE_CALENDAR_SCOPE } from '../_shared/gcal.ts';
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

    const { serverAuthCode } = await req.json();
    if (typeof serverAuthCode !== 'string' || !serverAuthCode) return json({ error: 'Missing serverAuthCode.' }, 400);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: requireEnv('GOOGLE_WEB_CLIENT_ID'),
        client_secret: requireEnv('GOOGLE_WEB_CLIENT_SECRET'),
        code: serverAuthCode,
        grant_type: 'authorization_code',
        // Empty, and that is correct for a code minted by the native sign-in SDK rather than by a
        // browser redirect — Google's own offline-access guide: "Specify the same redirect URI
        // that you use with your web app. If you don't have a web version of your app, you can
        // specify an empty string." (developer.android.com/identity/legacy/gsi/offline-access)
        // The env override exists only for a deployment that mints codes some other way.
        redirect_uri: Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI') ?? '',
      }),
    });

    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      return json({ error: 'Google rejected the authorization code.', detail: tokenData?.error ?? null }, 502);
    }

    // AUTHORITATIVE SCOPE CHECK. The client asks for calendar.readonly, but the consent sheet lets
    // the member untick it — and what the SDK reports having asked for is not what Google granted.
    // Google's own `scope` on the token response is, so that is what gets checked and stored.
    const grantedScopes: string = typeof tokenData.scope === 'string' ? tokenData.scope : '';
    if (!grantedScopes.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE)) {
      return json({ connected: false, reason: 'scope_not_granted' });
    }

    const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Google issues a refresh token on the FIRST consent for a client+account and, after that,
    // only when re-consent is forced. The client forces it, but if one still doesn't come back and
    // we already hold a working grant, the right answer is "you're connected" — not to overwrite a
    // good token with nothing.
    if (typeof tokenData.refresh_token !== 'string' || !tokenData.refresh_token) {
      const { data: existing } = await serviceClient
        .from('google_calendar_connections')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (existing) return json({ connected: true, reused: true });
      return json({ connected: false, reason: 'no_refresh_token' });
    }

    const { error: upsertError } = await serviceClient.from('google_calendar_connections').upsert({
      user_id: user.id,
      refresh_token_encrypted: await encryptSecret(tokenData.refresh_token),
      google_email: emailFromIdToken(tokenData.id_token),
      scopes: grantedScopes,
      connected_at: new Date().toISOString(),
      // A reconnect starts the member's rate-limit hour over rather than inheriting a
      // half-spent counter from the previous grant.
      fetch_count: 0,
      fetch_window_started_at: new Date().toISOString(),
    });
    if (upsertError) return json({ error: upsertError.message }, 500);

    // Any window cached against the previous grant is now the wrong account's.
    await serviceClient.from('google_calendar_window_cache').delete().eq('user_id', user.id);

    return json({ connected: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

/** Which Google account this is, for the "Connected as ..." line in Connected Apps. Read straight
 * out of the id_token payload without verifying the signature — deliberately: this token came
 * back over TLS from Google's own token endpoint in response to our own client secret, so there
 * is no untrusted party in the path, and the value is used as a display string, never as an
 * authorization decision. */
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const claims = JSON.parse(atob(padded));
    return typeof claims.email === 'string' ? claims.email : null;
  } catch {
    return null;
  }
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set on this Supabase project.`);
  return value;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
