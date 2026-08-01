import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { FITNESS_SYNC_ENABLED } from '@/constants/feature-flags';
import { supabase } from '@/lib/supabase';

// Completes the in-progress auth session when the browser redirects back into the app — needed
// once, at module load, same as every other expo-auth-session consumer. Kept even though the
// real completion now happens in app/strava-auth.tsx (below) — harmless, and still lets
// promptAsync's own promise resolve on platforms/timings where it isn't racing expo-router.
WebBrowser.maybeCompleteAuthSession();

const STRAVA_CLIENT_ID: string | null = Constants.expoConfig?.extra?.stravaClientId ?? null;

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://www.strava.com/oauth/mobile/authorize',
};

// Persisted CSRF state (see below) — a real route, not a promise resolution, is what completes
// this flow, so the state generated in connectStrava() has to survive the round trip to Strava's
// site and back for app/strava-auth.tsx to check against.
const OAUTH_STATE_KEY = 'philoi_strava_oauth_state';

// The redirect target is a real expo-router route (app/strava-auth.tsx), not just a bare scheme —
// on Android, expo-auth-session's own redirect detection (WebBrowser.openAuthSessionAsync) races
// expo-router's Linking listener for the SAME incoming philoi://strava-auth?code=... URL, and
// which one "wins" is unpredictable. Making it a real route means the redirect ALWAYS resolves to
// something (no more "Unmatched Route"), and that route — not this function's promptAsync result —
// is the one thing this flow actually depends on to complete.
function stravaRedirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: 'philoi', path: 'strava-auth' });
}

// Strava (PHILOI_UI_SPEC.md §17) — cross-platform, OAuth. The client secret NEVER lives here or
// anywhere client-side: this module only drives the authorize redirect (a system-browser page,
// same trust level as any "Sign in with X" flow) and hands the resulting one-time code straight
// to the strava-oauth-exchange Edge Function, which holds the secret and does the actual token
// exchange (supabase/functions/strava-oauth-exchange). This app never sees a Strava access or
// refresh token — sync results come back from strava-sync as a single already-logged number.
export function isStravaSupported(): boolean {
  return FITNESS_SYNC_ENABLED && Boolean(STRAVA_CLIENT_ID);
}

// Opens Strava's authorize page and returns once the browser session closes. The return value is
// deliberately NOT the source of truth for "did this connect" — on Android the redirect is
// typically consumed by expo-router's navigation to /strava-auth before promptAsync's own success
// detection ever sees it, so this often resolves as a plain dismiss even on a real success.
// useStravaConnection.connect() re-checks the server afterward instead of trusting this value;
// treat this return as "best-effort, sometimes right," not authoritative.
export async function connectStrava(): Promise<boolean> {
  if (!isStravaSupported() || !STRAVA_CLIENT_ID) return false;

  const redirectUri = stravaRedirectUri();
  const request = new AuthSession.AuthRequest({
    clientId: STRAVA_CLIENT_ID,
    // Minimal scope (§17/19c) — read-only activity data, nothing else.
    scopes: ['activity:read'],
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    extraParams: { approval_prompt: 'auto' },
  });

  // request.state is generated in the AuthRequest constructor, so it's already final here —
  // persist it before opening the browser, since app/strava-auth.tsx runs in a fresh mount once
  // the redirect lands and needs this to validate the incoming `state` param against.
  await SecureStore.setItemAsync(OAUTH_STATE_KEY, request.state);

  const result = await request.promptAsync(discovery);
  if (result.type !== 'success' || !result.params.code) return false;

  // Only reached on platforms/timings where promptAsync's own detection wins the race —
  // app/strava-auth.tsx's completeStravaAuth() is the reliable path. Exchanging here too is
  // harmless (the Edge Function just upserts strava_connections either way).
  const { data, error } = await supabase.functions.invoke('strava-oauth-exchange', {
    body: { code: result.params.code, redirectUri },
  });
  if (error) throw error;
  return Boolean(data?.connected);
}

/** Called from app/strava-auth.tsx once the OAuth redirect lands there as a real route —
 * validates `state` against what connectStrava() persisted (CSRF protection: a `code` from a
 * redirect this app didn't actually initiate gets rejected before it ever reaches the exchange),
 * then completes the same exchange connectStrava() would have. */
export async function completeStravaAuth(code: string, state: string | undefined): Promise<boolean> {
  const expectedState = await SecureStore.getItemAsync(OAUTH_STATE_KEY);
  await SecureStore.deleteItemAsync(OAUTH_STATE_KEY);
  if (!expectedState || !state || state !== expectedState) {
    throw new Error('This sign-in link is no longer valid — please try connecting again.');
  }

  const { data, error } = await supabase.functions.invoke('strava-oauth-exchange', {
    body: { code, redirectUri: stravaRedirectUri() },
  });
  if (error) throw error;
  return Boolean(data?.connected);
}

export type StravaConnectionStatus = { connected: boolean; athleteId: number | null };

export async function getStravaConnectionStatus(): Promise<StravaConnectionStatus> {
  const { data, error } = await supabase.rpc('get_my_strava_connection_status');
  if (error) throw error;
  const row = (data ?? [])[0];
  return { connected: Boolean(row?.connected), athleteId: row?.athlete_id ?? null };
}

export async function disconnectStrava(): Promise<void> {
  const { error } = await supabase.rpc('disconnect_my_strava');
  if (error) throw error;
}

/** Syncs one run_distance/ride_distance challenge from the athlete's Strava activities — the
 * actual token refresh + activity fetch + reduction all happen in the strava-sync Edge Function;
 * this just invokes it and reports how many km it logged. */
export async function syncChallengeFromStrava(challengeId: string): Promise<number> {
  const { data, error } = await supabase.functions.invoke('strava-sync', { body: { challengeId } });
  if (error) throw error;
  return typeof data?.synced === 'number' ? data.synced : 0;
}

// Strava brand guideline: "View on Strava" is the exact required link wording (§17b/developers.
// strava.com/guidelines) — the app-scheme deep link first, falling back to the web activity page
// if the Strava app isn't installed (Linking.openURL rejects rather than no-oping in that case).
export async function openStravaActivity(externalId: string): Promise<void> {
  const appUrl = `strava://activities/${externalId}`;
  const webUrl = `https://www.strava.com/activities/${externalId}`;
  try {
    await Linking.openURL(appUrl);
  } catch {
    await Linking.openURL(webUrl);
  }
}

/** Auto lock-in from a synced Strava activity (§17b) — the poll-on-app-open safety net.
 * strava-webhook is the primary, real-time trigger (a run should appear within seconds of
 * finishing it); this just catches anything the webhook missed by walking activities newer than
 * strava_connections.last_synced_at. Best-effort: swallow errors, never surface this to the
 * user — a missed backfill just means the next app-open (or the webhook, next time) catches it. */
export async function backfillStravaActivities(): Promise<number> {
  try {
    const { data, error } = await supabase.functions.invoke('strava-backfill', { body: {} });
    if (error) throw error;
    return typeof data?.processed === 'number' ? data.processed : 0;
  } catch {
    return 0;
  }
}
