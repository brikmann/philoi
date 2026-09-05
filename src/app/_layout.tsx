import { useFonts as useInterFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { PostHogProvider } from 'posthog-react-native';

import { ChallengeSettlementWatcher } from '@/components/challenge-settlement-watcher';
import { GoalCompletionWatcher } from '@/components/goal-completion-watcher';
import { GoalRevealWatcher } from '@/components/goal-reveal-watcher';
import { RewardRevealHost } from '@/components/economy/reward-reveal';
import { EntitlementReconciler } from '@/components/economy/entitlement-reconciler';
import { LoadoutSync } from '@/components/economy/loadout-sync';
import { FocusNudgeSync } from '@/components/focus-nudge-sync';
import { LiveActivitySync } from '@/components/live-activity-sync';
import { NavDrawerProvider } from '@/components/nav/app-drawer';
import { ScreenBackground } from '@/components/ui/screen-background';
import { OfflineBanner } from '@/components/offline-banner';
import { RankUpWatcher } from '@/components/rank-up-watcher';
import { CindyHeaderFlame } from '@/components/cindy/cindy-header-flame';
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
  //
  // Sequenced, not fired side by side: the audio session's interruption mode is the "Duck to my
  // music" preference, so the preload has to know the stored value before it configures the
  // session. Racing them would set the mode from the default and only correct it the next time
  // the user touched the switch.
  useEffect(() => {
    loadRewardPreferences().then((prefs) => preloadRewardSounds(prefs.duck_to_music));
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

  // Register for server-sent pushes as soon as the account is usable — NOT once they have a
  // circle.
  //
  // 🔴 `&& hasCircle` used to be here, and it silently disabled push for a whole class of user.
  // The reasoning behind it was good: hold the OS permission prompt until it has in-context
  // meaning ("notify me about my circle") rather than firing cold before there is anything to be
  // notified about. What it missed is that this gate does not merely delay the PROMPT, it delays
  // the TOKEN — and the token is the whole delivery path. No row in `push_tokens` means
  // notify_push_raw() builds an empty message list, skips its net.http_post to Expo, and sends
  // nothing. Forever, for every event type.
  //
  // So a solo user got the full in-app feed (notify_event writes notification_events regardless)
  // and not one device banner, which reads exactly like "push is broken" rather than like a
  // deliberate gate. And most of what we push at someone is not social at all: rank-ups, relic
  // unlocks, session-complete, streak-at-risk. Those are the reasons a solo user opens the app.
  //
  // The in-context concern is real, and the honest trade is that the prompt now lands earlier than
  // its author wanted. It does not land repeatedly: registerPushToken() returns at the first
  // `granted` check on every later run, and once someone has declined, both platforms stop showing
  // the system prompt (iOS resolves a second request without UI; Android 13+ auto-denies after
  // two). So the cost is one prompt at a less perfect moment. The cost of the gate was every
  // notification, permanently, for anyone without a circle. Token registration must not depend on
  // social state.
  useEffect(() => {
    if (appReady && session && !needsHandle && !needsConsent && !needsAccountDisabled) {
      registerPushToken(session.user.id);
    }
  }, [appReady, session, needsHandle, needsConsent, needsAccountDisabled]);

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

      // THE ROUTE THE EVENT WAS WRITTEN WITH, first (0086's notify_event).
      //
      // Every notify_event push carries `route` + `params` in its data payload, and the in-app
      // bell has honoured them since 0086 — this listener never did, so tapping the PUSH did
      // something different from tapping the same row in the bell, or nothing at all. That is
      // what made the settled-challenge deep-link dead: challenge_won / challenge_lost /
      // campfire_settled all carry '/challenge-info/[challengeId]' and none of them match a
      // branch below, so the tap fell off the end of this function.
      //
      // Ahead of the group_id check because a route is the more specific instruction; the legacy
      // notify_push callers that rely on group_id (join requests, 0003's challenge_completed)
      // send no route key at all, so they still fall through untouched. No per-type switch here
      // for the same reason the bell has none: a new event type gets its destination for free.
      if (typeof data?.route === 'string') {
        router.push({ pathname: data.route as never, params: (data.params ?? {}) as never });
        return;
      }

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
        // 🐛 THE HEADER WAS A DIFFERENT PURPLE FROM THE PAGE UNDER IT (Noah, on Watch and the live
        // challenge views — but it was every headered screen, those are just the two he was on).
        //
        // Colors.cream is #1B1726, twilight-800, and the comment above still called it "a real bar
        // with its own surface". That was true when cream WAS the app background. It stopped being
        // true at punchlist 20.1, when the ground became the ScreenBackground radial: the top of
        // that radial is bgRadialFrom #2C1B36, so the bar sat as a flat, darker, cooler slab on a
        // lighter warm-purple page with a visible seam where they met.
        //
        // Matched to the radial'''s TOP STOP rather than made transparent: headerTransparent lets
        // the scene slide under the bar, and ~20 screens would each need to learn the offset. This
        // is one token, and the header now reads as the top of the page instead of a lid on it.
        headerStyle: { backgroundColor: Colors.bgRadialFrom },
        headerShadowVisible: false,
        headerTintColor: Colors.ink,
        headerTitleStyle: { fontFamily: Fonts.bodyBold },
        // Cindy in the header of every stack screen that HAS a header (CINDY_SPEC mock 117 —
        // reachable from anywhere, and explicitly not a floating button). Set once here rather
        // than per screen; anything with headerShown: false simply never renders it, which is
        // the right answer for the modals and for Cindy's own screens.
        headerRight: () => <CindyHeaderFlame />,
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
        {/* Cindy (CINDY_SPEC). Chat is a normal push — it is a conversation you come back to,
            not a modal task. Voice is a modal because it is a mode you enter and leave. */}
        <Stack.Screen name="cindy" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="cindy-voice" options={{ headerShown: false, presentation: 'modal' }} />
        {/* The "talk to someone" surface APP_BLOCKER_SPEC §C-safety requires (mock 116 frame 3). */}
        <Stack.Screen name="support" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="settings-notifications" options={{ title: 'Notifications' }} />
        {/* Focus Nudge setup — mock 109 frame 1. A real route, not just a settings sub-page: the
            shield's primary button deep-links into the app and the support surface next door is
            reached the same way. */}
        <Stack.Screen name="focus-nudge" options={{ title: 'Focus Nudge' }} />
        <Stack.Screen name="connected-apps" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="campus" options={{ title: 'Campus' }} />
        <Stack.Screen name="health-connect-rationale" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="strava-auth" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="university-leaderboard" options={{ title: '' }} />
        {/* Campfires is a hamburger destination now, not a tab (punchlist 16 §4). */}
        <Stack.Screen name="campfires" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="people" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        {/* The Agora (AGORA_SPEC) — the town square, a Social destination beside Campfires and
            Friends. The composer is a modal so posting reads as an interruption you return from,
            not as somewhere you navigated to. */}
        <Stack.Screen name="agora/index" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="agora/[id]" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
        <Stack.Screen name="agora/compose" options={{ headerShown: false, presentation: 'modal' }} />
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
        {/* 🔴 The header read `challenge-info/[challengeId]`, literally — the raw route string, in
            the title bar, on a screen three different notifications deep-link into. It was the one
            challenge route never registered here, and expo-router's fallback for an unregistered
            screen is its own path. A placeholder title is not the fix on its own either, so the
            screen overrides this with the challenge's real name once it has loaded one; this is
            what shows for the frame before that, and what shows if the fetch fails. */}
        <Stack.Screen name="challenge-info/[challengeId]" options={{ title: 'Challenge' }} />
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
        {/* The Forge (mocks 155/156). Headerless like the rest of the Rewards surface — it draws its
            own top row, and the reveal it hands off to is full-bleed. Deliberately NOT a modal:
            unlike shop/open, this screen is a place you browse before you commit, and the Inventory
            shortcut deep-links into it with a preselection that should be backable-out-of. */}
        <Stack.Screen name="forge" options={{ headerShown: false, contentStyle: headerlessContentStyle }} />
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
          {/* THE one nav (mock 157 option B). Mounted once, above the navigator, so a single
              drawer serves every route — the bottom tab bar is retired and this is what replaces
              it. The drawer renders inside a <Modal>, so its position in this tree decides only
              what it can READ (auth, active session), not what it can cover. */}
          <NavDrawerProvider>
            <RootNavigator />
            {/* Renders nothing until a rank actually climbs. Mounted here, above the navigator, so
                a rank earned from server-side XP (Strava/Whoop webhook, challenge payout) still
                gets the forge no matter which screen the user is on — the done screen can only ever
                celebrate a manual stop (punchlist 5.6). */}
            <RankUpWatcher />
            {/* The same argument, for challenge payouts. Settlement is a pg_cron job, so a duel or
                a placement race closes and pays while the app is shut — and until this was mounted
                the only surface that could announce it was that one challenge's info screen, which
                you had to think to go and open. Renders nothing when there is nothing owed.

                DELIBERATELY AFTER RankUpWatcher. A challenge payout is itself an XP source, so both
                can be pending on the same foreground; the rank forge is a full-screen overlay at
                zIndex 100 and this is a Modal, and ordering them here is what keeps the two
                celebrations from landing on the same frame. */}
            <ChallengeSettlementWatcher />
            {/* The same argument again, for a PERSONAL goal — the one payout that had no watcher at
                all. A Cindy-scoped feat pays its box and embers through
                economy_on_challenge_completed the instant `completed_at` is set, and two of the
                three paths that set it resolve with the app shut: a second vouch landing, and
                pg_cron's settle_expired_vouches closing a 48h window. Neither of the two watchers
                above can see it — one reads the daily drip, the other reads `social_challenges` —
                so until 0167 captured the receipt the grant was simply silent.

                AFTER ChallengeSettlementWatcher, per the spec's ordering note: it draws a different
                source table entirely, so the only thing order decides here is the reveal floor. */}
            <GoalCompletionWatcher />
            {/* And the third payout that could land while the user is looking at something else: a
                personal goal the PHONE finished. Unlike the two above it was never asynchronous —
                the sync that completes a 10k-step goal is the app's own — it was just only ever run
                by the Challenges tab, on focus, so the celebration arrived whenever that tab was
                next opened rather than on the walk. This looks for it from anywhere and draws it
                from anywhere. Takes the same floor, at the lowest priority of the three. */}
            <GoalRevealWatcher />
            {/* The shared reward reveal — one at a time, app-wide, ordered as a crescendo so the
                rank-up lands last. Everything that pays out queues through showRewardReveal()
                rather than presenting itself, which is what stops a session that is simultaneously
                a rank-up, a daily fire and a settled challenge from stacking three modals. */}
            <RewardRevealHost />
            {/* Keeps the equipped-cosmetics store fed for the flame / profile / sound layers.
                Renders nothing; mounted here because the surfaces it feeds are spread across the
                whole app. */}
            <LoadoutSync />
            {/* Drives the iOS Live Activity / Android ongoing notification while a lock-in runs
                (#87). Renders nothing; mounted here because the session outlives the lock-in
                screen — you can minimize it, navigate away, and background the app, and the Lock
                Screen card has to keep counting. No-ops entirely on a build without the native
                module compiled in. */}
            <LiveActivitySync />
            {/* Arms the iOS Screen Time shield for the duration of a lock-in and — the part that
                matters — takes it down when the session ends (APP_BLOCKER_SPEC §B/§D). Renders
                nothing; mounted here for the same reason as LiveActivitySync, since the shield has
                to stay armed while the user is anywhere in the app or out of it entirely. No-ops
                on Android and on any build without the extensions compiled in. */}
            <FocusNudgeSync />
            {/* Catches a Forge Pass the store says was paid for but no webhook ever granted (#71).
                Renders nothing; mounted here because a missed entitlement has to be repaired
                wherever the user happens to reopen the app. */}
            <EntitlementReconciler />
            <OfflineBanner />
          </NavDrawerProvider>
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
      {/* One real SafeAreaProvider at the app root. The only other safe-area context in the tree
          comes from react-navigation's internal SafeAreaProviderCompat, which lives INSIDE the
          navigator — and the nav drawer is mounted as a SIBLING of the navigator in
          NavDrawerProvider, so its <Modal>'s <SafeAreaView> was resolving insets from outside the
          provider it should be using. initialWindowMetrics gives correct first-frame insets and
          avoids a layout flash.

          🔴 CORRECTION, because this block originally claimed otherwise: this is NOT what caused
          the drawer crash-on-open. That crash was a native SIGABRT out of libworklets.so —
          `Value::getObject(): assertion "isObject()" failed` on the mqt_v_js thread — from the
          drawer's close animation calling runOnJS on a state setter serialised into a worklet
          closure while the route was being torn down (see the note in app-drawer.tsx). It was
          fixed there, and verified on-device with this provider absent: a missing provider throws
          a catchable JS error and a red box, never a SIGABRT. Keeping this for correct insets,
          which it does give — but it is hygiene, not the fix. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <StatusBar style="light" />
        {/* No-op wrapper when POSTHOG_API_KEY isn't set — see src/lib/posthog.ts. */}
        {posthog ? <PostHogProvider client={posthog}>{content}</PostHogProvider> : content}
      </SafeAreaProvider>
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
