import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { GradientWordmark } from '@/components/gradient-wordmark';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useElapsedSeconds } from '@/hooks/use-elapsed-seconds';
import { useActiveSession } from '@/lib/active-session-context';
import { formatDurationClock } from '@/lib/format';
import { GOAL_TYPE_META } from '@/lib/goal-types';

export const LOCK_IN_PATHNAME = '/lock-in';

// Standard native-stack header height below the status bar. Only used to drop this pill BELOW a
// header rather than over it (punchlist 5.5) — approximate by design: it just has to clear the
// header, and it's the one number to tune if the pill lands too high or low on-device.
const NATIVE_HEADER_HEIGHT = 56;

// Routes rendering NO native header, where the pill belongs at the top of the safe area.
// Mirrors the `headerShown: false` entries in app/_layout.tsx's Stack, plus the four tab routes
// (the tab group reserves the band via its own sceneStyle). ADD A ROUTE HERE when you add a
// header-less screen, or its pill will sit a header's height too low.
//
// Why a list at all: a NATIVE header is drawn above the screen and cannot be pushed down from JS
// — React Navigation 7's native-stack dropped `headerStatusBarHeight`, so there is nothing to
// reserve space with. The pill has to yield instead, and only this component knows where it is.
const HEADERLESS_ROUTES = [
  '/',
  '/challenges',
  '/leaderboards',
  '/profile',
  '/account-disabled',
  '/activity',
  '/add-friend',
  '/auth',
  '/challenge-change',
  '/connected-apps',
  '/friend-profile',
  '/health-connect-rationale',
  '/join',
  '/lock-in',
  '/lock-in-history',
  '/paywall',
  '/people',
  '/setup-handle',
  '/sign-in',
  '/strava-auth',
];

// The band's own content height (paddingTop + one row of icon/pill) below the safe-area
// inset — the single source of truth for the GLOBAL top inset applied at the root layout
// (see _layout.tsx's contentStyle.paddingTop) and, for the nested tabs navigator that
// contentStyle can't reach, at (tabs)/_layout.tsx's sceneStyle. Exactly ONE of those applies to
// any given screen — the tabs route zeroes the root one (punchlist 4D).
//
// 38, down from 48: the pill is 8px of padding plus a ~26px row, so 48 left a visible dead band
// under it. This lands content ~8px below the pill rather than a half-screen gap.
export const LIVE_SESSION_BAR_HEIGHT = 38;

// The persistent "mini-map" (design-mocks/25, PHILOI_UI_SPEC.md §5/§5b/§13) — a global pill
// pinned top-center whenever a lock-in is running, rendered once in the root layout above
// the tab content. Suppressed on the running-session route itself — the user is already
// there, so the pill would just be a redundant, lingering copy of what's on screen. Carries
// the pill and nothing else: per §4b the home header's one right-side action is Friends (in
// TabHeader), and Profile is reached from the tab bar — this band used to overlay a second
// profile button on top of home, which §4b doesn't allow.
export function LiveSessionBar() {
  const router = useRouter();
  const pathname = usePathname();
  const headerless = HEADERLESS_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  const { session } = useActiveSession();
  const elapsedSeconds = useElapsedSeconds(session?.startedAt ?? null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const pulse = useSharedValue(1);

  const isLockInRoute = pathname === LOCK_IN_PATHNAME;
  const showPill = Boolean(session) && !isLockInRoute;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!showPill || reduceMotion) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(withSequence(withTiming(0.3, { duration: 700 }), withTiming(1, { duration: 700 })), -1, true);
  }, [showPill, reduceMotion, pulse]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  if (!showPill) return null;

  const label = session ? session.goalDetail || GOAL_TYPE_META[session.goalType].label : '';

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, headerless ? null : { paddingTop: NATIVE_HEADER_HEIGHT }]}
      pointerEvents="box-none">
      <View style={styles.row} pointerEvents="box-none">
        <View style={styles.side} pointerEvents="none" />

        <View style={styles.center} pointerEvents="box-none">
          {/* One line: session · timer (#87 / mock 91 surface 3). No PHILOI wordmark and no flame
              here — both belong to the out-of-app Live Activity and the lock-in screen
              respectively, and repeating them on every page would make the pill shout. The session
              name carries the purple gradient; the timer is plain white. */}
          {session && (
            <Pressable style={styles.bar} onPress={() => router.push('/lock-in')} accessibilityLabel="Return to your lock-in">
              <Animated.View style={[styles.dot, dotStyle]} />
              <GradientWordmark size={11}>{label}</GradientWordmark>
              <Text style={styles.sep}>·</Text>
              <Text style={styles.timer}>{formatDurationClock(elapsedSeconds)}</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.side} pointerEvents="none" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 90,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: 8,
  },
  side: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
  },
  // Mock 91's `.pagepill`: a dark translucent capsule with a hairline white border, not the old
  // coral-glowing chip. With the session name now carrying the purple gradient, a coral ring around
  // it put three accent colours in a 200px pill. The pulsing dot is the one live cue left.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(22,16,30,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 12,
    maxWidth: 230,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.coral,
  },
  sep: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: '#5c5470',
  },
  // Pure white and bold, per mock 91 — NOT Colors.ink (#FFF6EC), which is the app's warm
  // off-white. The timer is the one element that has to punch on a glance, and beside a purple
  // wordmark the warm tint reads as slightly dimmed.
  timer: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
});
