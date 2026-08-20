import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { useNotifications } from '@/hooks/use-notifications';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

// The header bell — design-mocks/106.
//
// A VECTOR, not an Ionicon: the mock draws a specific solid bell in ember amber, and the two paths
// below are lifted from it verbatim so the header glyph is the approved shape rather than a
// near-match from an icon set.
//
// The badge caps at 9+ (the mock shows "empty · 2 · 9+"). Past nine the exact number stops being
// information — "you have a lot" is the whole message — and a three-digit badge would push the
// pill wider than the glyph it sits on.

const BELL_BODY =
  'M12 2.4a1.7 1.7 0 0 0-1.7 1.7v.5C8 5.3 6.4 7.5 6.4 10.1v3.3L5 15.7v.8h14v-.8l-1.4-2.3v-3.3c0-2.6-1.6-4.8-3.9-5.5v-.5A1.7 1.7 0 0 0 12 2.4z';
const BELL_CLAPPER = 'M9.7 17.6a2.3 2.3 0 0 0 4.6 0z';

export function NotificationBell({ size = 23 }: { size?: number }) {
  const router = useRouter();
  const { unread } = useNotifications();
  const reduceMotion = useReduceMotion();
  const tilt = useSharedValue(0);

  const hasUnread = unread > 0;

  useEffect(() => {
    if (!hasUnread || reduceMotion) {
      tilt.value = 0;
      return;
    }
    // Mock 106's `ring` keyframes: still for most of the cycle, then a short damped shake. The
    // long pause is the point — a bell that rings continuously is a spinner, and reads as broken
    // rather than as "something is waiting".
    tilt.value = withRepeat(
      withDelay(
        3900,
        withSequence(
          withTiming(13, { duration: 90, easing: Easing.out(Easing.quad) }),
          withTiming(-10, { duration: 110 }),
          withTiming(6, { duration: 100 }),
          withTiming(-3, { duration: 90 }),
          withTiming(0, { duration: 90 })
        )
      ),
      -1,
      false
    );
  }, [hasUnread, reduceMotion, tilt]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.value}deg` }] }));

  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={hasUnread ? `Notifications, ${unread} unread` : 'Notifications'}>
      <View style={styles.wrap}>
        <Animated.View style={[styles.bell, style]}>
          <Svg width={size} height={size} viewBox="0 0 24 24">
            <Path d={BELL_BODY} fill={Colors.amber} />
            <Path d={BELL_CLAPPER} fill={Colors.amber} />
          </Svg>
        </Animated.View>
        {hasUnread ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  bell: {
    // The mock rotates about the bell's crown, not its centre — pivoting mid-body makes it swing
    // like a pendulum instead of ringing.
    transformOrigin: '50% 3px',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -5,
    backgroundColor: Colors.coral,
    borderRadius: Radius.pill,
    minWidth: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: Colors.twilight900,
  },
  badgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    color: Colors.ink,
  },
});
