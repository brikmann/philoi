import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';

import { FITNESS_SYNC_ENABLED } from '@/constants/feature-flags';
import { supabase } from '@/lib/supabase';
import type { ChallengeType } from '@/types/database';

// Completes the in-progress auth session when the browser redirects back into the app — needed
// once, at module load, same as every other expo-auth-session consumer.
WebBrowser.maybeCompleteAuthSession();

const WHOOP_CLIENT_ID: string | null = Constants.expoConfig?.extra?.whoopClientId ?? null;

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://api.prod.whoop.com/oauth/oauth2/auth',
};

// `offline` is what makes Whoop issue a refresh token at all — without it the connection would
// silently stop working at the first token expiry (whoop-oauth-exchange refuses a grant that
// comes back without one).
const OFFLINE_SCOPE = 'offline';

// METRIC FIT (§17) — Whoop has NO step count. It measures strain, heart rate, workouts, sleep and
// recovery, so these three challenge types are the only ones it can verify, and each needs
// exactly ONE read scope. Nothing wider is ever requested: a member who connects for a workout
// challenge grants read:workout and nothing else. read:profile is deliberately absent — Philoi
// has no use for a Whoop member's name or email.
export const WHOOP_SCOPE_BY_CHALLENGE_TYPE: Partial<Record<ChallengeType, string>> = {
  workout_minutes: 'read:workout',
  strain: 'read:cycles',
  sleep_hours: 'read:sleep',
};

/** The scopes a context-free connect (Settings → Connected apps) asks for — there's no challenge
 * to narrow to, so it covers the three metrics Philoi can actually use and no more. A connect
 * made from a challenge's own sync sheet asks for just that challenge's one scope. */
export const WHOOP_ALL_METRIC_SCOPES = Object.values(WHOOP_SCOPE_BY_CHALLENGE_TYPE) as string[];

// Whoop (PHILOI_UI_SPEC.md §17, CODE_BUILD_PROMPTS.md 19d) — cross-platform, OAuth 2.0. The client
// secret NEVER lives here or anywhere client-side: this module only drives the authorize redirect
// (a system-browser page, same trust level as any "Sign in with X" flow) and hands the resulting
// one-time code straight to the whoop-oauth-exchange Edge Function, which holds the secret and
// does the actual token exchange (supabase/functions/whoop-oauth-exchange). This app never sees a
// Whoop access or refresh token — sync results come back from whoop-sync as a single
// already-logged number.
export function isWhoopSupported(): boolean {
  return FITNESS_SYNC_ENABLED && Boolean(WHOOP_CLIENT_ID);
}

export async function connectWhoop(scopes: string[]): Promise<boolean> {
  if (!isWhoopSupported() || !WHOOP_CLIENT_ID) return false;

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'philoi', path: 'whoop-auth' });
  const request = new AuthSession.AuthRequest({
    clientId: WHOOP_CLIENT_ID,
    scopes: [...new Set([...scopes, OFFLINE_SCOPE])],
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    // Whoop is a confidential client and the code is exchanged server-side, where the PKCE
    // verifier doesn't exist — sending a challenge here would make Whoop demand a verifier the
    // exchange can't supply. AuthRequest still generates and checks the `state` param (Whoop
    // requires one of at least eight characters).
    usePKCE: false,
  });

  const result = await request.promptAsync(discovery);
  if (result.type !== 'success' || !result.params.code) return false;

  const { data, error } = await supabase.functions.invoke('whoop-oauth-exchange', {
    body: { code: result.params.code, redirectUri },
  });
  if (error) throw error;
  return Boolean(data?.connected);
}

export type WhoopConnectionStatus = { connected: boolean; grantedScopes: string[] };

export async function getWhoopConnectionStatus(): Promise<WhoopConnectionStatus> {
  const { data, error } = await supabase.rpc('get_my_whoop_connection_status');
  if (error) throw error;
  const row = (data ?? [])[0];
  return {
    connected: Boolean(row?.connected),
    grantedScopes: (row?.granted_scopes ?? '').split(/\s+/).filter(Boolean),
  };
}

export async function disconnectWhoop(): Promise<void> {
  const { error } = await supabase.rpc('disconnect_my_whoop');
  if (error) throw error;
}

/** Syncs one workout_minutes/strain/sleep_hours challenge from the member's Whoop records — the
 * token refresh, record fetch and reduction all happen in the whoop-sync Edge Function; this just
 * invokes it and reports how much it logged. `needsScope` comes back when the connection was made
 * for a different metric and doesn't cover this one, so the caller can offer a re-connect instead
 * of failing silently. */
export async function syncChallengeFromWhoop(challengeId: string): Promise<{ synced: number; needsScope: string | null }> {
  const { data, error } = await supabase.functions.invoke('whoop-sync', { body: { challengeId } });
  if (error) throw error;
  return {
    synced: typeof data?.synced === 'number' ? data.synced : 0,
    needsScope: typeof data?.needsScope === 'string' ? data.needsScope : null,
  };
}
