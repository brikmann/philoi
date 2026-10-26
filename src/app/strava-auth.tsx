import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { refreshFitnessTracking } from '@/hooks/use-fitness-tracking';
import { getErrorMessage } from '@/lib/errors';
import { completeStravaAuth } from '@/lib/strava';

// The Strava OAuth redirect target (philoi://strava-auth?code=...&state=...) — a REAL route, not
// just a bare custom-scheme handler. On Android, expo-auth-session's own redirect detection
// races expo-router's Linking listener for this exact URL, and letting the router win (rather
// than fighting it) is the fix: this route existing at all means the redirect resolves instead
// of 404ing as "Unmatched Route," and this screen — not connectStrava()'s promptAsync result —
// is what actually completes the connection (see completeStravaAuth in lib/strava.ts).
export default function StravaAuthScreen() {
  const router = useRouter();
  const { code, state } = useLocalSearchParams<{ code?: string; state?: string }>();
  const [status, setStatus] = useState<'working' | 'done' | 'error'>('working');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!code) {
        setError('Strava didn’t send back an authorization code.');
        setStatus('error');
        return;
      }
      try {
        const connected = await completeStravaAuth(code, state);
        if (cancelled) return;
        setStatus('done');
        // Clears every "connect a tracker" prompt app-wide (mock 314) — this route, not the
        // screen that started the flow, is what usually finishes it on Android.
        if (connected) void refreshFitnessTracking();
        if (!connected) setError('Strava connected, but the app couldn’t confirm it — check Settings → Integrations.');
      } catch (e) {
        if (cancelled) return;
        setError(getErrorMessage(e, 'Could not finish connecting to Strava.'));
        setStatus('error');
      } finally {
        // Either way, this screen has nothing more to do — hop back to where the connect flow
        // started (Home's card, the trackers screen, Integrations — the redirect lands on top of
        // it). A cold start from the link has nothing under it, so that falls to the trackers
        // screen. A short delay so "Connected!" is actually readable instead of flashing by.
        setTimeout(() => {
          if (cancelled) return;
          if (router.canGoBack()) router.back();
          else router.replace('/fitness-trackers');
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
            <Text style={styles.title}>Connecting to Strava…</Text>
          </>
        )}
        {status === 'done' && !error && (
          <>
            <Ionicons name="checkmark-circle" size={40} color={Colors.green} />
            <Text style={styles.title}>Connected</Text>
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
