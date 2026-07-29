import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { ActiveCircleLockIn } from '@/lib/api/lock-ins';
import { formatDurationClock } from '@/lib/format';
import { GOAL_TYPE_META } from '@/lib/goal-types';

function formatStartedAgo(minutes: number): string {
  if (minutes < 1) return 'just now';
  return `started ${minutes} min ago`;
}

type LiveLockInCardProps = {
  activeLockIn: ActiveCircleLockIn;
};

// The campfire chain's "someone's locked in right now" card (design-mocks/06's `.livecard`) —
// distinct from the top presence strip (a compact avatar summary); this is a full row in the
// chain itself with a live running timer, which is what actually makes the room feel alive
// rather than just noting a count of who's active.
export function LiveLockInCard({ activeLockIn }: LiveLockInCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const pulse = useSharedValue(1);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    pulse.value = withRepeat(withSequence(withTiming(0.35, { duration: 700 }), withTiming(1, { duration: 700 })), -1, true);
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const { session, display_name } = activeLockIn;
  const startedAt = new Date(session.started_at).getTime();
  const elapsedSeconds = Math.max(0, (now - startedAt) / 1000);
  const goalLabel = GOAL_TYPE_META[session.goal_type]?.label ?? session.goal_type;

  return (
    <View style={styles.card}>
      <Animated.View style={pulseStyle}>
        <Ionicons name="lock-closed" size={17} color={Colors.amber} />
      </Animated.View>
      <View style={styles.textCol}>
        <Text style={styles.name}>{display_name} is locked in</Text>
        <Text style={styles.detail}>
          {goalLabel} · {formatStartedAgo(Math.floor(elapsedSeconds / 60))}
        </Text>
      </View>
      <Text style={styles.timer}>{formatDurationClock(elapsedSeconds)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: Colors.achieverBg,
    borderWidth: 1,
    borderColor: Colors.coral,
    borderRadius: Radius.card,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  detail: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.warmSubtext,
    marginTop: 1,
  },
  timer: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.achieverText,
    marginLeft: Spacing.two,
  },
});
