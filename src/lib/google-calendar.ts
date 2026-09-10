import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { GOOGLE_CALENDAR_ENABLED } from '@/constants/feature-flags';
import { supabase } from '@/lib/supabase';

// Google Calendar, read-only (GCAL_INTEGRATION_SPEC.md) — the school administrative layer the AI
// coach reasons over. Same shape as Strava and Whoop: an expo-auth-session authorization-code
// flow in the system browser, and the code goes STRAIGHT to an Edge Function that holds the client
// secret. This app never sees a Google access or refresh token, and never reads an event: the
// calendar is fetched server-side at AI-message time (supabase/functions/_shared/gcal.ts).
//
// ⚠️ THIS REPLACED A NATIVE-SDK FLOW, and the reason is worth keeping. The previous version called
// `GoogleSignin.addScopes()` to widen the Google session the member had already signed into Philoi
// with. That is a smoother sheet and it was the wrong flow, because it silently assumed ONE THING
// THAT IS NOT TRUE: that the Google account you sign into Philoi with is the Google account your
// timetable lives on. Plenty of students sign up with a personal Gmail and keep their classes on a
// school account (or the reverse), and a member who signed up with email/password has no Google
// session to widen at all. addScopes() offers no account chooser — it widens whichever account is
// already there — so those members could never attach the calendar they actually wanted, and
// nothing in the UI would explain why.
//
// So the account chooser is not a nicety here, it is the feature: `prompt=select_account` runs the
// full chooser EVERY time, no matter how the member signed up, and the grant is keyed to their
// Philoi user id rather than to a matching email. Connecting a different Google account than the
// one you log in with is a supported, first-class path.

// Completes the in-progress auth session when the browser redirects back into the app — needed
// once, at module load, same as every other expo-auth-session consumer.
WebBrowser.maybeCompleteAuthSession();

/**
 * Read-only, and the narrowest scope Google offers that returns event titles: Philoi can never
 * add, move or delete anything, which is exactly what the consent dialog promises.
 *
 * `openid`/`email` ride along so the server can record WHICH Google account was chosen — see the
 * header. They are non-sensitive and add nothing to Google's verification burden.
 *
 * ⚠️ Must stay in step with GOOGLE_CALENDAR_SCOPE in supabase/functions/_shared/gcal.ts, which
 * verifies what Google actually granted before storing anything.
 */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const OAUTH_SCOPES = ['openid', 'email', GOOGLE_CALENDAR_SCOPE];

const GOOGLE_WEB_CLIENT_ID: string | null = Constants.expoConfig?.extra?.googleWebClientId ?? null;
const SUPABASE_URL: string | null = Constants.expoConfig?.extra?.supabaseUrl ?? null;

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
};

/**
 * Where the app itself is reachable. `philoi` is already registered (app.config.ts `scheme`), so
 * this needs no native change.
 *
 * ⚠️ IT IS ALSO A REAL EXPO-ROUTER ROUTE (src/app/gcal-auth.tsx), and that is not optional. On
 * Android, WebBrowser's own redirect detection RACES expo-router's Linking listener for this
 * exact incoming URL and which one wins is unpredictable — Strava hit this first and
 * src/lib/strava.ts carries the same warning. If the router wins and no route exists, a
 * successful Google consent lands on "Unmatched Route" and the connection is silently lost. So
 * the route exists, and it — not the openAuthSessionAsync result below — is the path this flow
 * actually depends on.
 */
const APP_RETURN_URL = 'philoi://gcal-auth';

/**
 * The PKCE verifier and CSRF state, parked where the redirect route can pick them up.
 *
 * They have to outlive this function's closure: when expo-router wins the race, gcal-auth.tsx
 * mounts fresh with only `code` and `state` from the URL, and a PKCE exchange without its
 * verifier is unredeemable. SecureStore rather than a module variable because the OS can tear the
 * app down while the system browser is foregrounded — on a low-memory Android device, a module
 * variable is exactly the thing that isn't there when the member comes back.
 */
const PENDING_AUTH_KEY = 'philoi_gcal_pending_auth';

type PendingAuth = { state: string; codeVerifier: string };

async function putPendingAuth(pending: PendingAuth): Promise<void> {
  await SecureStore.setItemAsync(PENDING_AUTH_KEY, JSON.stringify(pending));
}

/** Reads and CLEARS the pending handshake — one redirect may consume it, and only one. */
async function takePendingAuth(): Promise<PendingAuth | null> {
  const raw = await SecureStore.getItemAsync(PENDING_AUTH_KEY);
  await SecureStore.deleteItemAsync(PENDING_AUTH_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.state === 'string' && typeof parsed?.codeVerifier === 'string') return parsed;
  } catch {
    // A malformed blob is treated as no pending handshake at all.
  }
  return null;
}

/**
 * Authorization codes are SINGLE-USE at Google — redeem one twice and the second attempt comes
 * back `invalid_grant`. Both completion paths above can fire for the same redirect on Android, so
 * they funnel through here and the loser is a no-op rather than a spurious "couldn't connect".
 *
 * (This is where Google differs from Strava, whose exchange is a harmless repeated upsert. The
 * same double-path shape needs a guard here that it doesn't need there.)
 */
const consumedCodes = new Set<string>();

/**
 * What Google is told to redirect to — an https relay Edge Function that immediately bounces to
 * APP_RETURN_URL. It is NOT the app's own scheme, and cannot be: Google's **Web** OAuth client
 * type accepts only http/https redirect URIs and rejects `philoi://` outright at the authorize
 * step. See supabase/functions/gcal-oauth-callback for the whole story.
 *
 * ⚠️ This exact string must be registered under the Web client's **Authorized redirect URIs** in
 * Google Cloud, and it must match what gcal-oauth-exchange sends at token-exchange time (it
 * derives the same value from SUPABASE_URL server-side). A mismatch surfaces as Google's
 * `redirect_uri_mismatch`, which is loud — deliberately, rather than failing quietly.
 */
function relayRedirectUri(): string {
  return `${(SUPABASE_URL ?? '').replace(/\/$/, '')}/functions/v1/gcal-oauth-callback`;
}

export function isGoogleCalendarSupported(): boolean {
  return GOOGLE_CALENDAR_ENABLED && Boolean(GOOGLE_WEB_CLIENT_ID) && Boolean(SUPABASE_URL);
}

/** Thrown with a message worth showing — the caller surfaces it verbatim. */
export class GoogleCalendarConnectError extends Error {}

export type ConnectResult =
  /** Backed out of the chooser or the consent screen. Not an error, and not worth a dialog. */
  | { status: 'cancelled' }
  | { status: 'connected'; accountEmail: string | null };

/**
 * Runs the Google account chooser + consent screen for read-only calendar access and hands the
 * resulting one-time code to the server.
 *
 * Also the "Switch account" path: `prompt=select_account` means this always offers the chooser, so
 * connecting and switching are the same call. `prompt=consent` rides alongside it because Google
 * mints a refresh token only on a FIRST consent for a client+account pair — without it, a member
 * reconnecting after a disconnect would come back with no refresh token and the server would have
 * nothing durable to store.
 */
export async function connectGoogleCalendar(): Promise<ConnectResult> {
  if (!isGoogleCalendarSupported() || !GOOGLE_WEB_CLIENT_ID) return { status: 'cancelled' };

  const request = new AuthSession.AuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    scopes: OAUTH_SCOPES,
    redirectUri: relayRedirectUri(),
    responseType: AuthSession.ResponseType.Code,
    // PKCE, and the verifier never leaves this device until it goes to our own Edge Function. The
    // code alone is worthless to an interceptor: redeeming it needs both this verifier and the
    // client secret, which lives only in Supabase.
    usePKCE: true,
    extraParams: {
      // Without this Google issues an access token only, and the coach could read the calendar
      // for one hour and never again.
      access_type: 'offline',
      // The two halves of the header's argument: always choose the account, always re-consent.
      // The second is not redundant — Google mints a refresh token only on a FIRST consent for a
      // client+account pair, so without it a member reconnecting after a disconnect comes back
      // with nothing durable to store.
      prompt: 'select_account consent',
      // Don't silently fold in scopes from some earlier grant — what this connect asks for should
      // be all it gets, and the server verifies the granted scope against exactly this list.
      include_granted_scopes: 'false',
    },
  });

  const authUrl = await request.makeAuthUrlAsync(discovery);

  // `state` and `codeVerifier` are final once the URL is built, so park them BEFORE the browser
  // opens: src/app/gcal-auth.tsx runs in a fresh mount when the redirect lands there and has no
  // other way to reach them.
  if (!request.codeVerifier) throw new GoogleCalendarConnectError('Couldn’t start a secure connection. Try again in a moment.');
  await putPendingAuth({ state: request.state, codeVerifier: request.codeVerifier });

  // Built by hand rather than via promptAsync(): promptAsync derives what it waits for from
  // `redirectUri`, which here is the https relay, so it would sit waiting for a URL the app is
  // never handed. The app's own return URL is the second argument.
  const result = await WebBrowser.openAuthSessionAsync(authUrl, APP_RETURN_URL);

  // ⚠️ THIS RETURN VALUE IS NOT AUTHORITATIVE — see APP_RETURN_URL. On Android the redirect is
  // usually consumed by expo-router's navigation to /gcal-auth before this detection sees it, so
  // a real success routinely arrives here as a plain dismiss. Treat a non-success as "nothing to
  // do here", never as "the member cancelled and the connection failed"; the caller re-reads the
  // server afterwards, which is the only thing that actually knows.
  //
  // The parked handshake is deliberately NOT cleared here. Deleting it would race the very path
  // this branch exists for: when expo-router wins, gcal-auth.tsx is mid-`takePendingAuth()` at
  // exactly this moment, and a delete landing first would turn a successful consent into "that
  // sign-in didn't come back the way it went out". A leftover verifier is worthless on its own —
  // it can only ever redeem a single-use code that has already been spent — and the next connect
  // overwrites it.
  if (result.type !== 'success') return { status: 'cancelled' };

  const params = new URL(result.url).searchParams;

  // access_denied is the member pressing "Cancel" on Google's own consent screen.
  const errorParam = params.get('error');
  if (errorParam) {
    await takePendingAuth();
    if (errorParam === 'access_denied') return { status: 'cancelled' };
    throw new GoogleCalendarConnectError('Google couldn’t complete the connection. Try again in a moment.');
  }

  const code = params.get('code');
  if (!code) {
    await takePendingAuth();
    throw new GoogleCalendarConnectError('Google didn’t hand back the code Philoi needs. Try again in a moment.');
  }

  return await completeGoogleCalendarAuth(code, params.get('state') ?? undefined);
}

/**
 * Finishes the handshake: validate `state`, redeem the code with its PKCE verifier server-side.
 *
 * Called from BOTH completion paths — connectGoogleCalendar() above when WebBrowser wins the
 * race, and src/app/gcal-auth.tsx when expo-router wins. Whichever gets there first does the
 * work; the other finds the code already consumed and returns the same answer rather than
 * redeeming it twice (which Google would reject as `invalid_grant`).
 */
export async function completeGoogleCalendarAuth(code: string, state: string | undefined): Promise<ConnectResult> {
  if (consumedCodes.has(code)) return { status: 'cancelled' };
  consumedCodes.add(code);

  const pending = await takePendingAuth();

  // CSRF: a `code` from a redirect this app didn't start is rejected before it reaches the
  // exchange. A missing pending record means the same thing — nothing here initiated this.
  if (!pending || !state || state !== pending.state) {
    throw new GoogleCalendarConnectError('That sign-in didn’t come back the way it went out. Try connecting again.');
  }

  const { data, error } = await supabase.functions.invoke('gcal-oauth-exchange', {
    body: { code, codeVerifier: pending.codeVerifier },
  });
  if (error) throw error;

  if (!data?.connected) throw new GoogleCalendarConnectError(reasonMessage(data?.reason));
  return { status: 'connected', accountEmail: typeof data.accountEmail === 'string' ? data.accountEmail : null };
}

function reasonMessage(reason: unknown): string {
  switch (reason) {
    case 'scope_not_granted':
      // Google's consent screen lets the member untick calendar access while accepting the rest.
      return 'Philoi didn’t get calendar access — the calendar permission needs to stay ticked on the Google screen.';
    case 'no_refresh_token':
      return 'Google didn’t give Philoi lasting access. Remove Philoi under your Google account’s third-party access, then connect again.';
    default:
      return 'Couldn’t connect your calendar. Try again in a moment.';
  }
}

export type GoogleCalendarStatus = {
  connected: boolean;
  /** Which Google account is linked. Load-bearing rather than decorative: it is NOT necessarily
   * the address they log into Philoi with, so "Connected" on its own can't tell them whose
   * calendar is attached. */
  accountEmail: string | null;
  linkedAt: string | null;
};

export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  const { data, error } = await supabase.rpc('get_my_google_calendar_status');
  if (error) throw error;
  const row = (data ?? [])[0];
  return {
    connected: Boolean(row?.connected),
    accountEmail: row?.account_email ?? null,
    linkedAt: row?.linked_at ?? null,
  };
}

/**
 * Disconnects and REVOKES at Google (gcal-disconnect) — the dialog promises this, so it has to be
 * the real thing and not just a local delete.
 *
 * If that call can't be reached at all, falls back to the local-only RPC: a member who taps
 * Disconnect must always end up disconnected in Philoi, and a stored token whose grant we couldn't
 * reach is one the next server-side fetch drops anyway.
 */
export async function disconnectGoogleCalendar(): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('gcal-disconnect');
    if (error) throw error;
    if (data?.disconnected) return;
  } catch {
    // Fall through to the local delete below.
  }
  const { error } = await supabase.rpc('disconnect_my_google_calendar');
  if (error) throw error;
}
