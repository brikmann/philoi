import { useFonts as useInterFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PostHogProvider } from 'posthog-react-native';

import { EntitlementReconciler } from '@/components/economy/entitlement-reconciler';
import { LoadoutSync } from '@/components/economy/loadout-sync';
import { LiveActivitySync } from '@/components/live-activity-sync';
import { ScreenBackground } from '@/components/ui/screen-background';
import { OfflineBanner } from '@/components/offline-banner';
import { RankUpWatcher } from '@/components/rank-up-watcher';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useHasAnyCircle } from '@/hooks/use-has-any-circle';
import { ActiveSessionProvider } from '@/lib/active-session-context';
import { AuthProvider, useAuth } from '@/lib/auth/auth-context';
import { fetchMyActiveLockInSession } from '@/lib/api/lock-ins';
import { registerPushToken } from '@/lib/notifications';
import { isOnboardingDone, markOnboardingDone } from '@/lib/onboarding';
import { posthog } from '@/lib/posthog';
import { loadRewardPreferences } from '@/lib/reward-settings';
import { Sentry } from '@/lib/sentry';
import { preloadRewardSounds } from '@/lib/sound';
import { checkForAppUpdate } from '@/lib/updates';

SplashScreen.preventAutoHideAsync();


function RootNavigator() {
  const { ready, error, session, needsHandle, needsConsent, needsAccountDisabled } = useAuth();
  const { hasCircle, refetch: refetchHasCircle } = useHasAnyCircle();
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const [interLoaded] = useInterFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });

  // The floating live-session pill is RETIRED (Ember pass §3): a running session is now shown by
  // the Live Activity / ongoing notification out of app, and by the lock-in screen in app — not by
  // a header that follows you onto every page. With no pill there is nothing to reserve space for,
  // so the global inset is gone too; leaving it would have left a session-shaped dead band at the
  // top of every screen.

  // Transparent, so the root <ScreenBackground> shows through. Explicitly 'transparent' rather
  // than omitted — react-navigation falls back to WHITE only when the value is unset.
  const headerlessContentStyle = { backgroundColor: 'transparent' };

  const appReady = ready && interLoaded;
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

  // OTA update check, once per cold start — see lib/updates.ts.
  useEffect(() => {
    checkForAppUpdate();
  }, []);

  // Re-check membership on every navigation — cheap count query, and it's what keeps the
  // "force onboarding" redirect below from going stale right after creating a circle.
  // Also re-read the persisted onboarding flag here so "Skip for now" (which writes the flag
  // then navigates) actually takes effect — otherwise the in-memory state stays false and the
  // redirect below immediately bounces the user back to /group/create.
  useEffect(() => {
    refetchHasCircle();
    isOnboardingDone().then(setOnboardingDone);
  }, [pathname, refetchHasCircle]);

  useEffect(() => {
    if (hasCircle) markOnboardingDone().then(() => setOnboardingDone(true));
  }, [hasCircle]);

  // Register for server-sent pushes once the user has actually joined/created their first
  // circle — not right after consent, so the OS permission prompt has real in-context
  // meaning ("notify me about my circle") instead of firing cold before there's anything to
  // be notified about.
  useEffect(() => {
    if (appReady && session && !needsHandle && !needsConsent && !needsAccountDisabled && hasCircle) {
      registerPushToken(session.user.id);
    }
  }, [appReady, session, needsHandle, needsConsent, needsAccountDisabled, hasCircle]);

  // Tapping a notification (from background or a cold start) deep-links to the relevant
  // circle — every push we send includes group_id in its data payload (see notify_push()'s
  // callers in schema.sql). The "still here?" lock-in reminder is keyed by session_id
  // instead (it's a personal session, not circle-scoped) — the lock-in screen itself takes
  // a goalId route param, so this looks up which goal the caller's one allowed active
  // session belongs to (see lock_in_sessions_one_active_per_user) and routes there; the
  // screen resumes that session automatically and shows the "still here?" banner once the
  // elapsed time crosses the same threshold the server-side reminder used.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const data = response.notification.request.content.data;
      const groupId = data?.group_id;
      if (typeof groupId === 'string') {
        router.push(`/group/${groupId}`);
        return;
      }
      if (data?.type === 'lockin_still_here' && session) {
        try {
          const active = await fetchMyActiveLockInSession(session.user.id);
          if (active) router.push('/lock-in');
        } catch (e) {
          console.error('[notifications] failed to resolve active lock-in session:', e);
        }
        return;
      }
      // A friend's "lock in?" nudge (design-mocks/21) — open the lock-in goal picker (Step 4).
      // The home screen reads ?lockin=1 and pops the picker; no setup, straight to starting.
      if (data?.type === 'lock_in_nudge') {
        router.push('/?lockin=1');
        return;
      }
      // Someone wants to change or end a shared challenge (design-mocks/71, migration 0058).
      // This push is the ONLY way that request reaches the other side, so it has to land on the
      // consent screen itself rather than the challenge list.
      if (data?.type === 'challenge_change_request' && typeof data?.request_id === 'string') {
        router.push({ pathname: '/challenge-change/[requestId]', params: { requestId: data.request_id } });
        return;
      }
      // Their answer, or a forfeit — both just mean "go look at the challenge".
      if (
        (data?.type === 'challenge_change_answered' ||
          data?.type === 'challenge_forfeited' ||
          data?.type === 'challenge_terms_updated') &&
        typeof data?.challenge_id === 'string'
      ) {
        router.push('/(tabs)/challenges');
      }
    });
    return () => subscription.remove();
  }, [router, session]);

  // First-run guided path: signed in, handle set, consent done, never had a circle,
  // hasn't finished/skipped onboarding yet — push to create-circle instead of empty Today.
  useEffect(() => {
    if (
      appReady &&
      session &&
      !needsHandle &&
      !needsConsent &&
      !needsAccountDisabled &&
      hasCircle === false &&
      onboardingDone === false &&
      pathname !== '/group/create' &&
      pathname !== '/join'
    ) {
      router.replace('/group/create?onboarding=true');
    }
  }, [appReady, session, needsHandle, needsConsent, needsAccountDisabled, hasCircle, onboardingDone, pathname, router]);

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
    <Stack
      screenOptions={{
        // No paddingTop here on purpose — see headerlessContentStyle above. A headered screen
        // can't take the offset in its content (that would push the body down while leaving the
        // header itself under the pill), so the PILL moves instead — see LiveSessionBar's
        // topOffset below.
        // Transparent, like every other scene background in the app: the root <ScreenBackground>
        // sits behind this navigator and an opaque fill here paints the near-black straight over
        // it (punchlist 20.1). The HEADER stays cream — that's a real bar with its own surface,
        // not the page ground.
        contentStyle: headerlessContentStyle,
        headerStyle: { backgroundColor: Colors.cream },
        headerShadowVisible: false,
        headerTintColor: Colors.ink,
        headerTitleStyle: { fontFamily: Fonts.bodyBold },
      }}>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
      </Stack.Protected>

      <Stack.Protected guard={Boolean(session) && (needsHandle || needsConsent)}>
        <Stack.Screen name="setup-handle" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
      </Stack.Protected>

      <Stack.Protected guard={Boolean(session) && !needsHandle && !needsConsent && needsAccountDisabled}>
        <Stack.Screen name="account-disabled" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
      </Stack.Protected>

      <Stack.Protected guard={Boolean(session) && !needsHandle && !needsConsent && !needsAccountDisabled}>
        {/* contentStyle.paddingTop is explicitly zeroed here: the screenOptions default above
            reserves the live-session band for screens pushed onto THIS Stack, but the tabs group
            reserves it again itself via the Tabs navigator's `sceneStyle` (see (tabs)/_layout.tsx —
            it has to, because contentStyle doesn't reach a nested navigator's scenes). Both were
            applying to the tabs route, stacking two full bar heights of padding and leaving the
            half-screen gap between the pill and each tab's title (punchlist 4D). */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false, contentStyle: { backgroundColor: 'transparent', paddingTop: 0 } }} />
        <Stack.Screen name="group/[groupId]/index" options={{ title: '' }} />
        <Stack.Screen name="group/[groupId]/edit" options={{ presentation: 'modal', title: 'Edit Campfire' }} />
        <Stack.Screen name="group/[groupId]/invite" options={{ presentation: 'modal', title: '', headerShown: false }} />
        <Stack.Screen name="group/[groupId]/join-requests" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="group/[groupId]/leaderboard" options={{ title: '' }} />
        <Stack.Screen
          name="lock-in/index"
          options={{ presentation: 'modal', title: 'Lock in', headerShown: false }}
        />
        <Stack.Screen name="lock-in/[checkInId]" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="goal/create" options={{ presentation: 'modal', title: 'New goal' }} />
        <Stack.Screen name="group/create" options={{ presentation: 'modal', title: 'Start a Campfire' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="settings-notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="connected-apps" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="campus" options={{ title: 'Campus' }} />
        <Stack.Screen name="health-connect-rationale" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="strava-auth" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="university-leaderboard" options={{ title: '' }} />
        {/* Campfires is a hamburger destination now, not a tab (punchlist 16 §4). */}
        <Stack.Screen name="campfires" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="people" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="add-friend" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="friend-profile" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="activity/[checkInId]" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="lock-in-history" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        {/* §4/§7 — the two profile showcase surfaces. Both draw their own back row and both take a
            ?userId, because both render for someone else as readily as for you. */}
        <Stack.Screen name="trophy-hall" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="collection" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        {/* §8 — the composer is a modal (it's a compose flow you back out of, not a destination);
            the milestone itself is a pushed permalink, since a cheer notification navigates to it. */}
        <Stack.Screen name="milestone/new" options={{ presentation: 'modal', headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="milestone/[id]" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="watch/[challengeId]" options={{ title: 'Watch' }} />
        <Stack.Screen name="challenge-change/[requestId]" options={{ headerShown: false, presentation: 'modal' }} />
        {/* Headerless: the screen draws its own top row (mock 98) — the native header was adding a
            trailing glyph at the right edge of "New challenge" that leads nowhere. */}
        <Stack.Screen name="challenge/create" options={{ presentation: 'modal', headerShown: false, contentStyle: headerlessContentStyle }} />
        {/* Forge Shop + reward economy (Step 21). All header-less — each screen draws its own
            top row with the ember balance pinned right, which a native header can't carry. The
            box-open sequence is a modal because it's a fullscreen animation you shouldn't be able
            to swipe away mid-roll. */}
        <Stack.Screen name="shop/index" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="shop/box/[boxKey]" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="shop/item/[itemId]" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="shop/open" options={{ headerShown: false, presentation: 'modal', gestureEnabled: false }} />
        <Stack.Screen name="inventory/index" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="inventory/[itemId]" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="forge-pass" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        {/* Post-purchase (#71). Not swipe-dismissable: it's the only confirmation the user gets
            that a real charge produced something, and losing it to a stray gesture reads as a
            purchase that vanished. */}
        <Stack.Screen
          name="purchase-success"
          options={{ headerShown: false, presentation: 'modal', gestureEnabled: false }}
        />
        <Stack.Screen name="report" options={{ presentation: 'modal', title: 'Report' }} />
        <Stack.Screen name="legal" options={{ title: '' }} />
        <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
      </Stack.Protected>

      {/* Public — reachable via philoi://join?code=ABC123 whether or not the user is signed in. */}
      <Stack.Screen name="join" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />

      {/* Public — the Google OAuth redirect lands here mid-sign-in, before session exists. */}
      <Stack.Screen name="auth/callback" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />

      {/* Public, voluntary preview of Philoi membership — dormant until pricing ships. */}
      <Stack.Screen name="paywall" options={{ headerShown: false, presentation: 'modal' }} />
    </Stack>
  );
}

function RootLayout() {
  const content = (
    <AuthProvider>
      <ActiveSessionProvider>
        {/* THE background, mounted once behind the navigator (Ember reskin sweep). <Screen> paints
            it too, but ~9 routes roll their own root wrapper and never go through <Screen> —
            add-friend, people, friend-profile, lock-in-history, the two create forms, campfires.
            Wrapping each of those individually is seven chances to get a layout subtly wrong; one
            layer here covers them and every route added later. The navigators above it are
            transparent so it shows through. */}
        <ScreenBackground>
          <RootNavigator />
        {/* Renders nothing until a rank actually climbs. Mounted here, above the navigator, so a
            rank earned from server-side XP (Strava/Whoop webhook, challenge payout) still gets
            the forge no matter which screen the user is on — the done screen can only ever
            celebrate a manual stop (punchlist 5.6). */}
        <RankUpWatcher />
        {/* Keeps the equipped-cosmetics store fed for the flame / profile / sound layers. Renders
            nothing; mounted here because the surfaces it feeds are spread across the whole app. */}
        <LoadoutSync />
        {/* Drives the iOS Live Activity / Android ongoing notification while a lock-in runs (#87).
            Renders nothing; mounted here because the session outlives the lock-in screen — you can
            minimize it, navigate away, and background the app, and the Lock Screen card has to keep
            counting. No-ops entirely on a build without the native module compiled in. */}
        <LiveActivitySync />
        {/* Catches a Forge Pass the store says was paid for but no webhook ever granted (#71).
            Renders nothing; mounted here because a missed entitlement has to be repaired wherever
            the user happens to reopen the app. */}
        <EntitlementReconciler />
        <OfflineBanner />
        </ScreenBackground>
      </ActiveSessionProvider>
    </AuthProvider>
  );

  // Punchlist 3: every screen in the app is dark twilight (Colors.cream is the near-black
  // #1B1726, not literally cream) — nothing anywhere set the OS status bar's own style, so it
  // was sitting at its platform default (dark icons on a light/transparent strip on Android,
  // `default` — i.e. dark — content on iOS). That reads as a stray light/white bar pinned to the
  // very top of every screen, most jarring on the fully immersive lock-in session (mock 51),
  // which was reported as "a white bar pushes everything down" / a leftover top bar — same root
  // cause on both counts, not two separate bugs.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
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
