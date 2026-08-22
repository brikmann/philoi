import { GoogleSignin, isCancelledResponse, isSuccessResponse } from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';

import { GOOGLE_CALENDAR_ENABLED } from '@/constants/feature-flags';
import { configureGoogleSignin } from '@/lib/auth/providers';
import { supabase } from '@/lib/supabase';

// Google Calendar, read-only (GCAL_INTEGRATION_SPEC.md) — the school administrative layer the AI
// coach reasons over. Unlike Strava and Whoop, this does NOT ride expo-auth-session through a
// browser: the app already ships the native Google SDK for sign-in, so the spec's "reuse the
// app's existing Google sign-in consent flow where possible" means the member sees the same
// native Google sheet they already know, with one extra line on it about calendar access.
//
// The client secret NEVER lives here or anywhere client-side. This module only drives the consent
// sheet and hands the resulting one-time `serverAuthCode` straight to the gcal-oauth-exchange Edge
// Function, which holds the secret, does the token exchange, and stores the refresh token
// encrypted. This app never sees a Google access or refresh token, and never reads an event: the
// calendar is fetched server-side at AI-message time (supabase/functions/_shared/gcal.ts).

/** Read-only. Philoi can never write to, move, or delete anything in someone's calendar. */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

const GOOGLE_WEB_CLIENT_ID: string | null = Constants.expoConfig?.extra?.googleWebClientId ?? null;

/** offlineAccess is what makes Google mint a serverAuthCode at all — without it the sheet grants
 * the phone access and the server gets nothing, so the coach could never read the calendar at the
 * moment it writes a message. forceCodeForRefreshToken (Android) makes Google issue a FRESH code
 * on a reconnect instead of replaying a cached grant that yields no refresh token. */
const CONNECT_CONFIG = {
  scopes: [GOOGLE_CALENDAR_SCOPE],
  offlineAccess: true,
  forceCodeForRefreshToken: true,
};

export function isGoogleCalendarSupported(): boolean {
  return GOOGLE_CALENDAR_ENABLED && Boolean(GOOGLE_WEB_CLIENT_ID);
}

/** Thrown with a message worth showing — the caller surfaces it verbatim. */
export class GoogleCalendarConnectError extends Error {}

/**
 * Runs the Google consent sheet for calendar.readonly and hands the resulting one-time code to
 * the server. Resolves false when the member backs out; throws with a readable message when
 * something went wrong they can act on.
 */
export async function connectGoogleCalendar(): Promise<boolean> {
  if (!isGoogleCalendarSupported()) return false;

  configureGoogleSignin(CONNECT_CONFIG);
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    // addScopes() widens an existing native Google session — the common case, since most members
    // signed into Philoi with Google, and it keeps the sheet to "Philoi wants to see your
    // calendar" instead of a full account re-pick. It resolves null when there's no session at
    // all (an email/password member), which is the signIn() path.
    let response = await GoogleSignin.addScopes({ scopes: [GOOGLE_CALENDAR_SCOPE] }).catch(() => null);
    if (!response) response = await GoogleSignin.signIn();

    if (isCancelledResponse(response)) return false;
    if (!isSuccessResponse(response)) return false;

    let serverAuthCode = response.data.serverAuthCode;
    if (!serverAuthCode) {
      // addScopes can come back without a code on a session that was established before
      // offlineAccess was configured. A full signIn() re-establishes it and always carries one.
      const retry = await GoogleSignin.signIn();
      if (isCancelledResponse(retry)) return false;
      serverAuthCode = isSuccessResponse(retry) ? retry.data.serverAuthCode : null;
    }
    if (!serverAuthCode) {
      throw new GoogleCalendarConnectError(
        'Google didn’t hand back the code Philoi needs to read your calendar from the server. Try again, or check Philoi’s access in your Google account.'
      );
    }

    const { data, error } = await supabase.functions.invoke('gcal-oauth-exchange', { body: { serverAuthCode } });
    if (error) throw error;

    if (!data?.connected) throw new GoogleCalendarConnectError(reasonMessage(data?.reason));
    return true;
  } finally {
    // Put the SDK back on the base config no matter how this ended — leaving calendar scopes and
    // offlineAccess armed would change what the next plain sign-in asks for (see
    // configureGoogleSignin's note).
    configureGoogleSignin();
  }
}

function reasonMessage(reason: unknown): string {
  switch (reason) {
    case 'scope_not_granted':
      // The consent sheet lets the member untick calendar access while accepting the rest.
      return 'Philoi didn’t get calendar access — the calendar permission needs to stay ticked on the Google screen.';
    case 'no_refresh_token':
      return 'Google didn’t give Philoi lasting access. Remove Philoi under your Google account’s third-party access, then connect again.';
    default:
      return 'Couldn’t connect your calendar. Try again in a moment.';
  }
}

export type GoogleCalendarStatus = {
  connected: boolean;
  /** Which Google account is linked — a member may hold several, and "Connected" alone doesn't
   * tell them whether it's the one their timetable lives on. */
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
 * Disconnects and REVOKES at Google (gcal-disconnect). If that call can't be reached, falls back
 * to the local-only RPC — a member who taps Disconnect must always end up disconnected in Philoi,
 * and a stored token whose grant we couldn't reach is one the next server-side fetch drops anyway.
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
