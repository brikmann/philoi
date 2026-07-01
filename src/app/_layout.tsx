import { useFonts as useFredokaFonts, Fredoka_500Medium, Fredoka_600SemiBold } from '@expo-google-fonts/fredoka';
import {
  useFonts as useNunitoFonts,
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PostHogProvider } from 'posthog-react-native';

import { OfflineBanner } from '@/components/offline-banner';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useHasAnyCircle } from '@/hooks/use-has-any-circle';
import { AuthProvider, useAuth } from '@/lib/auth/auth-context';
import { registerPushToken } from '@/lib/notifications';
import { isOnboardingDone, markOnboardingDone } from '@/lib/onboarding';
import { posthog } from '@/lib/posthog';
import { loadRewardPreferences } from '@/lib/reward-settings';
import { Sentry } from '@/lib/sentry';
import { preloadRewardSounds } from '@/lib/sound';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { ready, error, session, needsHandle, needsConsent } = useAuth();
  const { hasCircle, refetch: refetchHasCircle } = useHasAnyCircle();
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const [fredokaLoaded] = useFredokaFonts({ Fredoka_500Medium, Fredoka_600SemiBold });
  const [nunitoLoaded] = useNunitoFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  const appReady = ready && fredokaLoaded && nunitoLoaded;
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (appReady) SplashScreen.hideAsync();
  }, [appReady]);

  // Auth restore / font loading has no built-in timeout — if either genuinely hangs (e.g. a
  // stalled fetch on a bad connection), appReady never flips and the app would otherwise
  // show a blank screen forever with no way for the user to recover.
  useEffect(() => {
    if (appReady) {
      setStuck(false);
      return;
    }
    const timer = setTimeout(() => setStuck(true), 15000);
    return () => clearTimeout(timer);
  }, [appReady]);

  useEffect(() => {
    isOnboardingDone().then(setOnboardingDone);
  }, []);

  // Preload RewardBurst audio + settings once at startup so the first check-in has zero
  // playback latency and doesn't wait on an AsyncStorage read.
  useEffect(() => {
    preloadRewardSounds();
    loadRewardPreferences();
  }, []);

  // Re-check membership on every navigation — cheap count query, and it's what keeps the
  // "force onboarding" redirect below from going stale right after creating a circle.
  useEffect(() => {
    refetchHasCircle();
  }, [pathname, refetchHasCircle]);

  useEffect(() => {
    if (hasCircle) markOnboardingDone().then(() => setOnboardingDone(true));
  }, [hasCircle]);

  // Register for server-sent pushes once the user has actually joined/created their first
  // circle — not right after consent, so the OS permission prompt has real in-context
  // meaning ("notify me about my circle") instead of firing cold before there's anything to
  // be notified about.
  useEffect(() => {
    if (appReady && session && !needsHandle && !needsConsent && hasCircle) {
      registerPushToken(session.user.id);
    }
  }, [appReady, session, needsHandle, needsConsent, hasCircle]);

  // Tapping a notification (from background or a cold start) deep-links to the relevant
  // circle — every push we send includes group_id in its data payload (see notify_push()'s
  // callers in schema.sql).
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const groupId = response.notification.request.content.data?.group_id;
      if (typeof groupId === 'string') {
        router.push(`/group/${groupId}`);
      }
    });
    return () => subscription.remove();
  }, [router]);

  // First-run guided path: signed in, handle set, consent done, never had a circle,
  // hasn't finished/skipped onboarding yet — push to create-circle instead of empty Today.
  useEffect(() => {
    if (
      appReady &&
      session &&
      !needsHandle &&
      !needsConsent &&
      hasCircle === false &&
      onboardingDone === false &&
      pathname !== '/group/create'
    ) {
      router.replace('/group/create?onboarding=true');
    }
  }, [appReady, session, needsHandle, needsConsent, hasCircle, onboardingDone, pathname, router]);

  if (!appReady) {
    if (!stuck) return null;
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>This is taking longer than expected</Text>
        <Text style={styles.errorBody}>Philoi is having trouble starting up.</Text>
        <Text style={styles.errorHint}>Check your connection, then close and reopen the app.</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Couldn&apos;t connect to Philoi</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Text style={styles.errorHint}>
          Check SUPABASE_URL / SUPABASE_ANON_KEY in .env, that supabase/schema.sql ran with no
          errors, and your network connection — then reload the app.
        </Text>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: Colors.cream } }}>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={Boolean(session) && needsHandle}>
        <Stack.Screen name="setup-handle" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={Boolean(session) && !needsHandle && needsConsent}>
        <Stack.Screen name="setup-consent" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={Boolean(session) && !needsHandle && !needsConsent}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="group/[groupId]/index" options={{ title: '' }} />
        <Stack.Screen
          name="group/[groupId]/check-in"
          options={{ presentation: 'modal', title: 'Check in' }}
        />
        <Stack.Screen name="group/create" options={{ presentation: 'modal', title: 'Start a circle' }} />
        <Stack.Screen name="university-leaderboard" options={{ title: '' }} />
        <Stack.Screen name="report" options={{ presentation: 'modal', title: 'Report' }} />
        <Stack.Screen name="legal" options={{ title: '' }} />
        <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
      </Stack.Protected>

      {/* Public — reachable via philoi://join?code=ABC123 whether or not the user is signed in. */}
      <Stack.Screen name="join" options={{ headerShown: false }} />

      {/* Public — the Google OAuth redirect lands here mid-sign-in, before session exists. */}
      <Stack.Screen name="auth/callback" options={{ headerShown: false }} />

      {/* Public, voluntary preview of Philoi membership — dormant until pricing ships. */}
      <Stack.Screen name="paywall" options={{ headerShown: false, presentation: 'modal' }} />
    </Stack>
  );
}

function RootLayout() {
  const content = (
    <AuthProvider>
      <RootNavigator />
      <OfflineBanner />
    </AuthProvider>
  );

  // Required for react-native-gesture-handler's Gesture API (drag-to-trash on Today) to work
  // reliably, especially on Android.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* No-op wrapper when POSTHOG_API_KEY isn't set — see src/lib/posthog.ts. */}
      {posthog ? <PostHogProvider client={posthog}>{content}</PostHogProvider> : content}
    </GestureHandlerRootView>
  );
}

// Sentry.wrap adds automatic native crash capture + navigation tracing — no-ops harmlessly
// when SENTRY_DSN isn't set (see src/lib/sentry.ts).
export default Sentry.wrap(RootLayout);

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    backgroundColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  errorTitle: {
    fontFamily: Fonts.display,
    fontSize: 20,
    color: Colors.ink,
    textAlign: 'center',
  },
  errorBody: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.coral,
    textAlign: 'center',
  },
  errorHint: {
    fontFamily: Fonts.body,
    color: Colors.muted,
    textAlign: 'center',
    fontSize: 13,
  },
});
