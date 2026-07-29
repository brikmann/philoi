import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useElapsedSeconds } from '@/hooks/use-elapsed-seconds';
import { useActiveSession } from '@/lib/active-session-context';
import { formatDurationClock } from '@/lib/format';
import { GOAL_TYPE_ICON, GOAL_TYPE_META } from '@/lib/goal-types';

export const LOCK_IN_PATHNAME = '/lock-in';

// The band's own content height (paddingTop + one row of icon/pill) below the safe-area
// inset — the single source of truth for the GLOBAL top inset applied at the root layout
// (see _layout.tsx's contentStyle.paddingTop), so every screen sits below this floating
// overlay instead of colliding with it, without any per-screen spacing code.
export const LIVE_SESSION_BAR_HEIGHT = 48;

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
    <SafeAreaView edges={['top']} style={styles.safeArea} pointerEvents="box-none">
      <View style={styles.row} pointerEvents="box-none">
        <View style={styles.side} pointerEvents="none" />

        <View style={styles.center} pointerEvents="box-none">
          {session && (
            <Pressable style={styles.bar} onPress={() => router.push('/lock-in')} accessibilityLabel="Return to your lock-in">
              <Animated.View style={[styles.dot, dotStyle]} />
              <Ionicons name={GOAL_TYPE_ICON[session.goalType]} size={14} color={Colors.amber} />
              <Text style={styles.label} numberOfLines={1}>
                {label}
              </Text>
              <Text style={styles.sep}>·</Text>
              <Text style={styles.timer}>{formatDurationClock(elapsedSeconds)}</Text>
              <Ionicons name="expand-outline" size={14} color={Colors.muted} style={styles.maximize} />
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
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.coral,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 11,
    maxWidth: 220,
    shadowColor: Colors.coral,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.coral,
  },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.achieverText,
    flexShrink: 1,
  },
  sep: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  timer: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
    fontVariant: ['tabular-nums'],
  },
  maximize: {
    marginLeft: 1,
  },
});
