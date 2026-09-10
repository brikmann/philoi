import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { getErrorMessage } from '@/lib/errors';
import { completeGoogleCalendarAuth } from '@/lib/google-calendar';

// The Google Calendar OAuth return target (philoi://gcal-auth?code=...&state=...) — a REAL route,
// not just a bare custom-scheme handler, for exactly the reason app/strava-auth.tsx is one: on
// Android, expo-auth-session's own redirect detection races expo-router's Linking listener for
// this same URL, and letting the router win rather than fighting it is the fix. This route
// existing at all is what stops a successful Google consent from landing on "Unmatched Route".
//
// Two hops got the browser here — Google redirects to the gcal-oauth-callback Edge Function
// (Google's Web OAuth client will not accept a `philoi://` redirect), which bounces straight to
// this URL. See supabase/functions/gcal-oauth-callback.
//
// The exchange itself is shared with the WebBrowser-wins path, and the code is single-use, so
// whichever path arrives second finds it already consumed and quietly does nothing (see
// completeGoogleCalendarAuth). Nothing sensitive lands here: the `code` is unredeemable without
// the client secret held by the Edge Function, and no token ever reaches this app.
export default function GoogleCalendarAuthScreen() {
  const router = useRouter();
  const { code, state, error: googleError } = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const [status, setStatus] = useState<'working' | 'done' | 'error'>('working');
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // The member pressed Cancel on Google's own screen. Not a failure — go back quietly rather
      // than accusing them of an error they didn't hit.
      if (googleError || !code) {
        setStatus('done');
        return;
      }
      try {
        const result = await completeGoogleCalendarAuth(code, state);
        if (cancelled) return;
        setStatus('done');
        if (result.status === 'connected') setAccount(result.accountEmail);
      } catch (e) {
        if (cancelled) return;
        setError(getErrorMessage(e, 'Could not finish connecting your calendar.'));
        setStatus('error');
      } finally {
        // Either way this screen is done — hop back to where the connect started. A short delay
        // so "Connected" is actually readable instead of flashing past.
        setTimeout(() => {
          if (!cancelled) router.replace('/connected-apps');
        }, 900);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for this one redirect
  }, []);

  return (
    <Screen>
      <View style={styles.container}>
        {status === 'working' && (
          <>
            <ActivityIndicator size="large" color={Colors.coral} />
            <Text style={styles.title}>Connecting your calendar…</Text>
          </>
        )}
        {status === 'done' && !error && (
          <>
            <Ionicons name="checkmark-circle" size={40} color={Colors.green} />
            <Text style={styles.title}>Connected</Text>
            {/* Which account, immediately — it is not necessarily their Philoi login, and this is
                the first moment they can catch having picked the wrong one. */}
            {account ? <Text style={styles.body}>{account}</Text> : null}
          </>
        )}
        {error && (
          <>
            <Ionicons name="alert-circle" size={40} color={Colors.coral} />
            <Text style={styles.title}>Couldn’t connect</Text>
            <Text style={styles.body}>{error}</Text>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.five,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 19,
  },
});
