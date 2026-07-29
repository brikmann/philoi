import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';

import { FITNESS_SYNC_ENABLED } from '@/constants/feature-flags';
import { supabase } from '@/lib/supabase';

// Completes the in-progress auth session when the browser redirects back into the app — needed
// once, at module load, same as every other expo-auth-session consumer.
WebBrowser.maybeCompleteAuthSession();

const STRAVA_CLIENT_ID: string | null = Constants.expoConfig?.extra?.stravaClientId ?? null;

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://www.strava.com/oauth/mobile/authorize',
};

// Strava (PHILOI_UI_SPEC.md §17) — cross-platform, OAuth. The client secret NEVER lives here or
// anywhere client-side: this module only drives the authorize redirect (a system-browser page,
// same trust level as any "Sign in with X" flow) and hands the resulting one-time code straight
// to the strava-oauth-exchange Edge Function, which holds the secret and does the actual token
// exchange (supabase/functions/strava-oauth-exchange). This app never sees a Strava access or
// refresh token — sync results come back from strava-sync as a single already-logged number.
export function isStravaSupported(): boolean {
  return FITNESS_SYNC_ENABLED && Boolean(STRAVA_CLIENT_ID);
}

export async function connectStrava(): Promise<boolean> {
  if (!isStravaSupported() || !STRAVA_CLIENT_ID) return false;

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'philoi', path: 'strava-auth' });
  const request = new AuthSession.AuthRequest({
    clientId: STRAVA_CLIENT_ID,
    // Minimal scope (§17/19c) — read-only activity data, nothing else.
    scopes: ['activity:read'],
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    extraParams: { approval_prompt: 'auto' },
  });

  const result = await request.promptAsync(discovery);
  if (result.type !== 'success' || !result.params.code) return false;

  const { data, error } = await supabase.functions.invoke('strava-oauth-exchange', {
    body: { code: result.params.code, redirectUri },
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
