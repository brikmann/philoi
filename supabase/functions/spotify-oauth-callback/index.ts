// The redirect relay for the Spotify connect flow — the same relay as gcal-oauth-callback, for the
// same reason. Read that function's header for the full argument; the short version:
//
// Spotify requires redirect URIs to be HTTPS (loopback aside), so `philoi://` cannot be registered
// as one. Spotify sends the system browser here, and this hands straight back to the app:
//
//   Spotify  ──302──>  spotify-oauth-callback  ──302──>  philoi://spotify-auth?code=…&state=…
//
// 🔒 TRUSTED WITH NOTHING. No secret, no database, no authentication (a browser following a
// redirect carries no session). The code it forwards cannot be redeemed without the client secret
// in spotify-oauth-exchange. It MUST be deployed with `verify_jwt = false` (supabase/config.toml),
// or every successful consent dead-ends in a 401 on the last hop.
//
// Register this exact URL as the Redirect URI in the Spotify developer dashboard:
//   https://coaqgcquzywadrghzbfj.supabase.co/functions/v1/spotify-oauth-callback

/** Fixed, never taken from the request — a caller-supplied target would be an open redirect that
 * hands the code to whoever asked. */
const APP_RETURN_URL = 'philoi://spotify-auth';

/** `code` redeems the grant; `state` is checked by the app against the value it generated; `error`
 * carries Spotify's cancel/deny reason (e.g. access_denied). Anything else is dropped. */
const FORWARDED_PARAMS = ['code', 'state', 'error'] as const;

Deno.serve((req) => {
  const incoming = new URL(req.url).searchParams;

  const target = new URL(APP_RETURN_URL);
  for (const key of FORWARDED_PARAMS) {
    const value = incoming.get(key);
    if (value) target.searchParams.set(key, value);
  }

  // The 302 with a custom-scheme Location is the whole mechanism: it closes the auth browser and
  // delivers the URL to the app. No HTML fallback body — gcal-oauth-callback verified the Edge
  // runtime strips a 302's body in prod anyway.
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      // An authorization code in a URL must never sit in a shared cache.
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
});
