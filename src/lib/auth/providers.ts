import { GoogleSignin, isCancelledResponse, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_WEB_CLIENT_ID: string | null = Constants.expoConfig?.extra?.googleWebClientId ?? null;
const GOOGLE_IOS_CLIENT_ID: string | null = Constants.expoConfig?.extra?.googleIosClientId ?? null;

let googleConfigured = false;
function ensureGoogleConfigured() {
  if (googleConfigured) return;
  // webClientId MUST match the Client ID configured in Supabase's Google provider — that's
  // what makes signInWithIdToken() below accept the idToken this SDK returns (punchlist 2, §0:
  // "native Google Sign-In... user sees the native Google account picker, no Supabase redirect").
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID ?? undefined, iosClientId: GOOGLE_IOS_CLIENT_ID ?? undefined });
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

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: response.data.idToken,
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

// Abstracted so a second provider (Apple) can be dropped in later without
// touching the call sites in the sign-in screen.
export type OAuthProviderId = 'google' | 'apple';

async function signInWithOAuthProvider(provider: OAuthProviderId) {
  const redirectTo = Linking.createURL('auth/callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Supabase did not return an authorization URL.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success' || !result.url) {
    throw new Error('Sign-in was cancelled.');
  }

  const { params, errorCode } = QueryParams.getQueryParams(result.url);
  if (errorCode) throw new Error(errorCode);

  const { access_token, refresh_token } = params;
  if (!access_token || !refresh_token) {
    throw new Error('Sign-in did not return a session.');
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  if (sessionError) throw sessionError;
}

// TODO: enable once Apple Developer sign-in capability is configured for iOS.
export function signInWithApple() {
  return signInWithOAuthProvider('apple');
}
