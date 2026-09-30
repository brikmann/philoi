import { GoogleSignin, isCancelledResponse, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import type { User } from '@supabase/supabase-js';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_WEB_CLIENT_ID: string | null = Constants.expoConfig?.extra?.googleWebClientId ?? null;
const GOOGLE_IOS_CLIENT_ID: string | null = Constants.expoConfig?.extra?.googleIosClientId ?? null;

// iOS signs in through the browser (signInWithGoogleOAuth below — the v16 SDK's nonce-bound iOS
// token can't be verified by Supabase); Android still uses the native SDK (signInWithGoogleNative).
// webClientId MUST match the Client ID configured in Supabase's Google provider.
const BASE_GOOGLE_CONFIG = {
  webClientId: GOOGLE_WEB_CLIENT_ID ?? undefined,
  iosClientId: GOOGLE_IOS_CLIENT_ID ?? undefined,
};

/**
 * GoogleSignin.configure() is process-global — the LAST call wins for every later signIn() and
 * getTokens() anywhere in the app. So it lives in exactly one place, here, and this is the only
 * config the SDK ever sees: SIGN-IN SCOPES ONLY.
 *
 * It used to take an `extra` override so Google Calendar could layer `calendar.readonly` +
 * offlineAccess on top and then restore the base afterwards. That flow is gone — the calendar now
 * runs its own expo-auth-session handshake in the browser (src/lib/google-calendar.ts) precisely
 * so that it can offer an account chooser, since the calendar account is independent of the
 * Philoi login account. Nothing widens this config any more, and nothing should: a feature module
 * reaching in here is how the auth flow ends up silently asking for calendar scopes at sign-in.
 */
export function configureGoogleSignin() {
  GoogleSignin.configure(BASE_GOOGLE_CONFIG);
}

let googleConfigured = false;
function ensureGoogleConfigured() {
  if (googleConfigured) return;
  configureGoogleSignin();
  googleConfigured = true;
}

// Signing out of the app clears the Supabase session but leaves the native Google SDK's
// cached account behind, so the next signIn() resolves straight from cache with no picker
// and the user is silently logged back into the same account. Call this on app sign-out.
// signOut() only drops the LOCAL session (keeps the picker fast) — deliberately NOT
// revokeAccess(), which would force the full consent screen on the next sign-in.
export async function signOutGoogle() {
  try {
    ensureGoogleConfigured();
    await GoogleSignin.signOut();
  } catch {
    // Not signed in via Google / SDK not configured — nothing to clear.
  }
}

// Google sign-in via the OAuth browser-redirect flow. Supabase builds the provider URL, we open
// it in an in-app browser tab (expo-web-browser) and the provider returns to the app through the
// philoi://auth/callback deep link, from which we lift the session.
//
// WHY NOT THE NATIVE PICKER. The classic @react-native-google-signin SDK (v16, the one installed)
// exposes NO nonce parameter, yet Google returns a nonce-bound ID token, and Supabase's
// signInWithIdToken() rejects an id_token grant whose `nonce` claim it cannot verify against a raw
// pre-image it never received ("...nonce in id_token should either both exist or not"). That made
// every native Google sign-in fail on device with "Google returned a nonce-bound ID token this
// sign-in flow cannot verify." The browser-redirect flow sidesteps the native token entirely:
// Supabase runs the OAuth handshake server-side and hands back a session, so there is no
// client-side nonce to reconcile. Apple, whose SDK DOES expose the nonce, keeps its native flow.
//
// ⚠ REQUIRES the app deep link (philoi://auth/callback) to be listed under the Supabase
// project's Auth → URL Configuration → Redirect URLs. Without it Supabase refuses the
// redirectTo and the browser tab never returns a session.
async function signInWithGoogleOAuth() {
  const redirectTo = Linking.createURL('auth/callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      // We drive the browser ourselves (below) rather than letting supabase-js navigate the page.
      skipBrowserRedirect: true,
      // Always show the account chooser instead of silently resuming the last Google account —
      // parity with the old native flow, which cleared the SDK's cached account before every
      // sign-in so switching accounts worked.
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Supabase did not return an authorization URL.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new Error('Sign-in was cancelled.');
  }
  if (result.type !== 'success' || !result.url) {
    throw new Error('Google sign-in did not complete.');
  }

  await completeOAuthSessionFromUrl(result.url);
}

// Turn the redirect URL into a Supabase session. Handles BOTH shapes the provider may return, so a
// project-level flowType change can never silently break sign-in: PKCE (a `code` param exchanged
// for a session — supabase-js's default) and implicit (access_token + refresh_token in the URL).
async function completeOAuthSessionFromUrl(url: string) {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);

  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) throw error;
    return;
  }

  const { access_token, refresh_token } = params;
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return;
  }

  throw new Error('Google sign-in did not return a session.');
}

// ANDROID STAYS ON THE NATIVE PICKER. The nonce problem above is iOS's: the Android SDK signs in
// through legacy GoogleSignInOptions and returns a token with NO nonce claim, which is the one shape
// signInWithIdToken() accepts. It also needs nothing registered beyond the app's SHA-1, whereas the
// browser flow needs the Supabase callback
// (https://<project>.supabase.co/auth/v1/callback) listed as an Authorized redirect URI on the Google
// web client — without it Google answers "Access blocked: Error 400: redirect_uri_mismatch".
function decodeJwtClaims(idToken: string): Record<string, unknown> | null {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return null;
    let b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    b64 += '='.repeat((4 - (b64.length % 4)) % 4);
    const atobFn = (globalThis as { atob?: (s: string) => string }).atob;
    if (typeof atobFn !== 'function') return null;
    return JSON.parse(atobFn(b64)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function signInWithGoogleNative() {
  ensureGoogleConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  // Drop any cached account first so the picker always shows and switching accounts works.
  try {
    await GoogleSignin.signOut();
  } catch {
    // Nothing cached to clear.
  }

  const response = await GoogleSignin.signIn();
  if (isCancelledResponse(response)) {
    throw new Error('Sign-in was cancelled.');
  }
  if (!isSuccessResponse(response) || !response.data.idToken) {
    throw new Error('Google did not return a sign-in token.');
  }
  const idToken = response.data.idToken;

  // No nonce on either side is the only arrangement GoTrue accepts from this SDK. If a token ever
  // does carry one, fail with the real cause rather than Supabase's opaque nonce error.
  const claims = decodeJwtClaims(idToken);
  if (typeof claims?.nonce === 'string' && claims.nonce.length > 0) {
    throw new Error('Google returned a nonce-bound ID token this sign-in flow cannot verify.');
  }

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw error;
}

export async function signInWithGoogle() {
  if (Platform.OS === 'android') {
    try {
      await signInWithGoogleNative();
    } catch (e) {
      if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) {
        throw new Error('Sign-in was cancelled.');
      }
      throw e;
    }
    return;
  }
  await signInWithGoogleOAuth();
}

/**
 * Sign in with Apple is iOS-only here, and only where the OS offers it (iOS 13+, not every
 * simulator). The sign-in screen renders the button only when this resolves true — Apple's own
 * button on a device that can't complete the flow is worse than no button.
 */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Native Sign in with Apple (Guideline 4.8), the same shape as the Google path above: the OS sheet
 * hands back an identity token, and supabase.auth.signInWithIdToken() does the exchange.
 *
 * THE NONCE IS SENT TWICE, IN TWO FORMS, on purpose. Apple gets the SHA-256 of a random string and
 * bakes that hash into the token's `nonce` claim; Supabase gets the raw string, hashes it itself,
 * and refuses the token unless the two match. That binds this token to this one request — a
 * token lifted from somewhere else can't be replayed here. Hashing on both sides, or neither,
 * fails with "Nonces mismatch".
 */
export async function signInWithApple() {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (e) {
    if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') {
      throw new Error('Sign-in was cancelled.');
    }
    throw e;
  }
  if (!credential.identityToken) {
    throw new Error('Apple did not return a sign-in token.');
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;

  // Apple gives the name ONCE — on the first authorization only, and never inside the token — so
  // it has to be caught here or it's gone. Without it, ensureProfile (auth-context) names the new
  // profile after the email's local part, which under "Hide My Email" is a random relay string.
  // Best-effort on purpose: setup-handle asks for a display name anyway, this only makes its
  // prefill right, and a failure here must never fail a sign-in that already succeeded.
  const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const userId = data.user?.id;
  if (fullName && userId) {
    try {
      await supabase.auth.updateUser({ data: { full_name: fullName } });
      // `handle is null` = still in onboarding, so this can only ever touch a brand-new profile,
      // never overwrite a name somebody chose (Apple re-sends the name after a revoke + re-auth).
      await supabase.from('profiles').update({ display_name: fullName }).eq('id', userId).is('handle', null);
    } catch {
      // Name stays the fallback; setup-handle lets them type it.
    }
  }
}

/**
 * A FRESH Apple authorization code for this user, for revocation at account deletion. The code from
 * sign-in expired minutes after it was issued, so this re-runs the Apple sheet (Face ID, no new
 * consent). Null when there's nothing to revoke or no way to get the code: not an Apple account, or
 * not on iOS (the native sheet is the only source).
 */
export async function getAppleRevocationCode(user: User | null | undefined): Promise<string | null> {
  const isApple = user?.app_metadata?.provider === 'apple' || user?.identities?.some((i) => i.provider === 'apple');
  if (!isApple || !(await isAppleSignInAvailable())) return null;
  const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
  return credential.authorizationCode ?? null;
}

/**
 * Guideline 5.1.1(v): deleting an account that signed in with Apple must revoke the Apple grant.
 * Call BEFORE delete_my_account() — the apple-revoke function authenticates with this user's JWT.
 *
 * NEVER THROWS. An Apple outage, a cancelled sheet or a missing server secret must not trap someone
 * in an account they asked to delete; the deletion goes ahead whatever happens here.
 */
export async function revokeAppleSignInBestEffort(user: User | null | undefined): Promise<void> {
  try {
    const code = await getAppleRevocationCode(user);
    if (!code) return;
    const { data, error } = await supabase.functions.invoke('apple-revoke', { body: { code } });
    if (error || !data?.revoked) console.warn('[apple-revoke] not revoked:', error?.message ?? data?.reason);
  } catch (e) {
    console.warn('[apple-revoke] skipped:', e);
  }
}
