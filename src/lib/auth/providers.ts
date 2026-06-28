import * as Linking from 'expo-linking';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

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

export function signInWithGoogle() {
  return signInWithOAuthProvider('google');
}

// TODO: enable once Apple Developer sign-in capability is configured for iOS.
export function signInWithApple() {
  return signInWithOAuthProvider('apple');
}
