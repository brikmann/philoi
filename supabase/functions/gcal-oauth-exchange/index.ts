// Exchanges the one-time Google authorization code for a refresh token — the ONLY place the Google
// web client secret is ever used, exactly as strava-oauth-exchange does for Strava
// (GCAL_INTEGRATION_SPEC.md: "Store the refresh token encrypted, server-side only").
//
// The client (src/lib/google-calendar.ts) runs an expo-auth-session PKCE authorization-code flow in
// the system browser and hands over the `code` plus its `codeVerifier` — nothing else. The app
// never sees a Google access or refresh token, and never could: this function stores the refresh
// token AES-256-GCM-encrypted and hands back only a boolean and a display email.
//
// WHY THE REDIRECT URI IS NOT A REQUEST PARAMETER. Google requires the token exchange's
// redirect_uri to be byte-identical to the authorize call's. It would be natural to let the client
// pass the value it used — and wrong: a redirect_uri the caller controls is a value the caller can
// point somewhere else. The server derives it from its OWN environment instead (the same
// gcal-oauth-callback relay Google is configured to redirect to), so a client that disagrees gets
// a loud redirect_uri_mismatch from Google rather than a quiet substitution.
//
// The PKCE verifier is a different kind of value and IS passed: it is a one-time nonce the client
// generated, it is worthless without this function's client secret, and Google's whole point in
// asking for it is to prove the exchanging party is the one that started the flow.
//
// Requires these on the Supabase project (not in the app):
//   supabase secrets set GOOGLE_WEB_CLIENT_ID=... GOOGLE_WEB_CLIENT_SECRET=... \
//                        GCAL_TOKEN_ENC_KEY="$(openssl rand -base64 32)"
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are provided by the runtime.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';
import { grantCoversCalendar } from '../_shared/gcal.ts';
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

    const { code, codeVerifier } = await req.json();
    if (typeof code !== 'string' || !code) return json({ error: 'Missing code.' }, 400);
    if (typeof codeVerifier !== 'string' || !codeVerifier) return json({ error: 'Missing codeVerifier.' }, 400);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: requireEnv('GOOGLE_WEB_CLIENT_ID'),
        client_secret: requireEnv('GOOGLE_WEB_CLIENT_SECRET'),
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: relayRedirectUri(),
      }),
    });

    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      return json({ error: 'Google rejected the authorization code.', detail: tokenData?.error ?? null }, 502);
    }

    // AUTHORITATIVE SCOPE CHECK. The client asks for calendar.events.readonly, but Google's consent
    // screen lets the member untick it — and what the app reports having asked for is not what
    // Google granted. Google's own `scope` on the token response is, so that is what gets checked.
    const grantedScopes: string = typeof tokenData.scope === 'string' ? tokenData.scope : '';
    if (!grantCoversCalendar(grantedScopes)) {
      return json({ connected: false, reason: 'scope_not_granted' });
    }

    // WHICH Google account this is. The member picks it from Google's account chooser and it is
    // NOT necessarily their Philoi login — someone can sign up with one address and connect a
    // different account's calendar — so Connected Apps has to be able to say which one is attached.
    // This is why the authorize call asks for `openid email` alongside the calendar scope.
    const email = emailFromIdToken(tokenData.id_token);

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
      if (existing) {
        // Keep the row, but correct the display email — a member switching accounts without a new
        // refresh token would otherwise keep seeing the account they just moved off.
        if (email) await serviceClient.from('google_calendar_connections').update({ google_email: email }).eq('user_id', user.id);
        return json({ connected: true, reused: true, accountEmail: email });
      }
      return json({ connected: false, reason: 'no_refresh_token' });
    }

    const { error: upsertError } = await serviceClient.from('google_calendar_connections').upsert({
      user_id: user.id,
      refresh_token_encrypted: await encryptSecret(tokenData.refresh_token),
      google_email: email,
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

    return json({ connected: true, accountEmail: email });
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

/** Where Google is configured to send the browser back to — see the header. Overridable only by
 * project config, never by a caller. */
function relayRedirectUri(): string {
  const explicit = Deno.env.get('GCAL_OAUTH_REDIRECT_URI');
  if (explicit) return explicit;
  return `${requireEnv('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/gcal-oauth-callback`;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set on this Supabase project.`);
  return value;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
