// The redirect relay for the Google Calendar connect flow (GCAL_INTEGRATION_SPEC.md).
//
// WHY THIS FUNCTION EXISTS AT ALL. Google's **Web** OAuth client type accepts only http/https
// redirect URIs — a custom scheme like `philoi://` is rejected outright at the authorize step. But
// the thing that has to receive the code is a phone app, which is reachable only by custom scheme.
// So Google redirects the system browser here, and this hands straight back to the app:
//
//   Google  ──302──>  gcal-oauth-callback  ──302──>  philoi://gcal-auth?code=…&state=…
//
// The alternative was a per-platform iOS/Android OAuth client with its own custom scheme, which
// would mean registering two new URL schemes, plumbing a third client id through app.config.ts,
// and a native rebuild. This costs one public function and one authorized redirect URI on the Web
// client that Supabase Auth already uses.
//
// 🔒 WHAT THIS FUNCTION IS TRUSTED WITH: nothing. It holds no secret, reads no database, and
// authenticates nobody — it cannot, since the browser arrives here with no Supabase session. The
// authorization code it forwards is useless on its own: redeeming it needs the client secret (in
// gcal-oauth-exchange) AND the PKCE verifier (which never left the app that started the flow).
// That is precisely why the relay can be public. It MUST be deployed with `verify_jwt = false`
// (supabase/config.toml) — a browser following a Google redirect carries no Authorization header,
// so the default JWT gate would turn every successful consent into an opaque 401.
//
// The redirect target is a FIXED constant, never taken from the request. A relay that forwarded
// to a caller-supplied URL would be an open redirect wearing Philoi's domain, and the one thing
// worth forwarding — the code — would be handed to whoever asked.

/** The app. Registered in app.config.ts (`scheme: 'philoi'`), which is why this needs no native
 * change: the scheme already resolves to Philoi on both platforms. */
const APP_RETURN_URL = 'philoi://gcal-auth';

/** Only what the app needs to finish the handshake. `code` redeems the grant; `state` is checked
 * against the value the app generated, so a code injected by anything that didn't start this flow
 * is discarded. `error` carries Google's own cancel/deny reason. Everything else Google may append
 * is dropped rather than forwarded. */
const FORWARDED_PARAMS = ['code', 'state', 'error'] as const;

Deno.serve((req) => {
  const incoming = new URL(req.url).searchParams;

  const target = new URL(APP_RETURN_URL);
  for (const key of FORWARDED_PARAMS) {
    const value = incoming.get(key);
    if (value) target.searchParams.set(key, value);
  }

  // A 302 with a custom-scheme Location is what closes ASWebAuthenticationSession (iOS) and the
  // Chrome Custom Tab (Android) and delivers the URL to the app. That header is the entire
  // mechanism.
  //
  // The HTML body is a belt-and-braces fallback for a browser that lands here and does not follow
  // the scheme (app uninstalled mid-flow, or this URL opened on a desktop). ⚠️ VERIFIED NOT TO
  // RENDER IN PROD: the Edge runtime returns this response with Content-Length: 0, so the body is
  // stripped on a 302 and a stranded browser gets a blank page, not the retry link. It is kept
  // because it costs nothing and may survive on other clients — but do not count on it, and do
  // not "fix" the blank page by downgrading this to a 200, which would break the redirect
  // detection that actually closes the browser.
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta http-equiv="refresh" content="0;url=${escapeHtml(target.toString())}">` +
      `<title>Returning to Philoi</title>` +
      `<style>body{background:#1B1726;color:#FFF6EC;font:15px/1.5 -apple-system,system-ui,sans-serif;` +
      `margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}` +
      `a{color:#FFD27A}</style></head><body><div><p>Returning to Philoi…</p>` +
      `<p><a href="${escapeHtml(target.toString())}">Tap here if nothing happens.</a></p></div></body></html>`,
    {
      status: 302,
      headers: {
        Location: target.toString(),
        'Content-Type': 'text/html; charset=utf-8',
        // An authorization code in a URL must never sit in a shared cache.
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    }
  );
});

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
