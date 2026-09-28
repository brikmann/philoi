import { GoogleSignin, isCancelledResponse, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import type { User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_WEB_CLIENT_ID: string | null = Constants.expoConfig?.extra?.googleWebClientId ?? null;
const GOOGLE_IOS_CLIENT_ID: string | null = Constants.expoConfig?.extra?.googleIosClientId ?? null;

// webClientId MUST match the Client ID configured in Supabase's Google provider — that's
// what makes signInWithIdToken() below accept the idToken this SDK returns (punchlist 2, §0:
// "native Google Sign-In... user sees the native Google account picker, no Supabase redirect").
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

// Best-effort decode of a JWT payload's claims. Used only to inspect the Google ID token's
// `nonce` claim before handing the token to Supabase — never for a trust decision (Supabase
// verifies the signature server-side). Returns null on any malformed input or if the JS runtime
// has no atob (guarded so a decode failure can never break sign-in).
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

// The native Google account picker (replaces the old signInWithOAuth browser-redirect flow
// below, which routed through a *.supabase.co page) — Supabase still does the actual auth
// exchange server-side via signInWithIdToken(), only how the client obtains the idToken changed.
async function signInWithGoogleNative() {
  ensureGoogleConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  // Drop any cached account first so the picker always shows and switching accounts works,
  // even if the previous sign-out path (or a crash) left the SDK session behind.
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

  // NONCE — unlike the Apple path above, this Google flow sends NONE, on purpose.
  //
  // Supabase (GoTrue) rejects an id_token grant unless the `nonce` argument and the token's own
  // `nonce` claim are either BOTH present or BOTH absent ("Passed nonce and nonce in id_token
  // should either both exist or not."), and when both ARE present it requires
  // sha256(argNonce) === token.nonce. The classic @react-native-google-signin SDK used here signs
  // in through legacy GoogleSignInOptions and never calls setNonce, so the token it returns
  // carries NO nonce claim — which makes "no nonce on either side" the one arrangement GoTrue
  // accepts. (Passing a nonce anyway is exactly what produced the "should either both exist or
  // not" error that blocked every Google sign-in.)
  //
  // Defensive: if a future SDK/config ever makes the token carry a nonce, we cannot reconstruct
  // the raw pre-image GoTrue's sha256 check needs from this SDK, so the grant would fail its
  // opaque server-side check. Detect that here and throw an actionable error naming the real fix
  // (a controlled-nonce flow: hash into the Google request, send the raw nonce to Supabase)
  // rather than surfacing the cryptic Supabase message.
  const claims = decodeJwtClaims(idToken);
  const tokenNonce = typeof claims?.nonce === 'string' && claims.nonce.length > 0 ? claims.nonce : null;
  if (tokenNonce) {
    throw new Error(
      'Google returned a nonce-bound ID token this sign-in flow cannot verify. Google sign-in ' +
        'needs a controlled-nonce flow (hash the nonce into the Google request, send the raw ' +
        'nonce to Supabase) to support it.',
    );
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) throw error;
}

export async function signInWithGoogle() {
  try {
    await signInWithGoogleNative();
  } catch (e) {
    if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) {
      throw new Error('Sign-in was cancelled.');
    }
    throw e;
  }
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
