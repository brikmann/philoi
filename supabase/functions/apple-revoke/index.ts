// Revoke a Sign in with Apple grant at Apple — called by the app during account deletion, BEFORE
// delete_my_account(), because this authenticates with the user's JWT and that user is about to
// stop existing (Guideline 5.1.1(v): an app offering Sign in with Apple must revoke the user's Apple
// tokens when they delete their account; Supabase's own auth-user delete does not).
//
// The app sends a FRESH authorization code (it re-runs the Apple sheet at deletion time — the one
// from sign-in expired minutes after it was issued). This exchanges it for a refresh token, then
// hands that token to Apple's revoke endpoint.
//
// Best-effort by contract, same as gcal-disconnect: the client carries on to the deletion whatever
// this returns. `revoked` says whether the Apple-side half actually happened.
//
// Secrets (the same Apple credentials the Supabase Apple provider uses):
//   APPLE_TEAM_ID       10-char Team ID
//   APPLE_KEY_ID        Key ID of a key with "Sign in with Apple" enabled
//   APPLE_PRIVATE_KEY   that key's .p8 contents, PEM, newlines intact
//   APPLE_CLIENT_ID     optional; defaults to the bundle id, which is the client_id for native codes
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';

const APPLE = 'https://appleid.apple.com';

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

    const { code } = (await req.json().catch(() => ({}))) as { code?: unknown };
    if (typeof code !== 'string' || !code) return json({ error: 'Missing authorization code.' }, 400);

    // The Apple `sub` this account signed in with. A code for any OTHER Apple account is refused
    // below — the caller may revoke their own grant, never somebody else's.
    const identity = user.identities?.find((i) => i.provider === 'apple');
    const appleSub = (identity?.identity_data?.sub as string | undefined) ?? identity?.id ?? null;
    if (!appleSub) return json({ revoked: false, reason: 'not_an_apple_account' });

    const clientId = Deno.env.get('APPLE_CLIENT_ID') || 'com.philoi.app';
    const clientSecret = await appleClientSecret(clientId);

    const tokenRes = await fetch(`${APPLE}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = (await tokenRes.json().catch(() => ({}))) as {
      refresh_token?: string;
      id_token?: string;
      error?: string;
    };
    if (!tokenRes.ok || !tokens.refresh_token) {
      return json({ revoked: false, reason: tokens.error ?? `token_exchange_${tokenRes.status}` });
    }

    if (jwtSub(tokens.id_token) !== appleSub) {
      return json({ revoked: false, reason: 'code_for_another_apple_account' }, 403);
    }

    const revokeRes = await fetch(`${APPLE}/auth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: tokens.refresh_token,
        token_type_hint: 'refresh_token',
      }),
    });

    return json({ revoked: revokeRes.ok, reason: revokeRes.ok ? null : `revoke_${revokeRes.status}` });
  } catch (e) {
    return json({ revoked: false, error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

/**
 * Apple's client_secret: an ES256 JWT signed with the .p8 key, good for at most six months.
 * Minted per request (five minutes) rather than cached — this runs once per account deletion.
 *
 * Web Crypto's ECDSA signature is already the raw r||s form JWS wants, so no DER unwrapping and no
 * JWT library.
 */
async function appleClientSecret(clientId: string): Promise<string> {
  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const pem = Deno.env.get('APPLE_PRIVATE_KEY');
  if (!teamId || !keyId || !pem) throw new Error('Apple signing secrets are not configured.');

  const der = Uint8Array.from(
    atob(
      pem
        .replace(/\\n/g, '\n')
        .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
        .replace(/\s+/g, '')
    ),
    (c) => c.charCodeAt(0)
  );
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const payload = b64url(
    JSON.stringify({ iss: teamId, iat: now, exp: now + 300, aud: APPLE, sub: clientId })
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

/** The `sub` claim of Apple's id_token. Not signature-checked: it came straight from Apple over TLS. */
function jwtSub(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '='))) as { sub?: string })
      .sub ?? null;
  } catch {
    return null;
  }
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
