import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { ActiveCircleLockIn } from '@/lib/api/lock-ins';
import { GOAL_TYPE_META } from '@/lib/goal-types';

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type BodyDoubleRowProps = {
  activeLockIn: ActiveCircleLockIn;
};

// "Locked in with you" (PHILOI_UI_SPEC.md §13, design-mocks/09's `.dbl` row) — the Focusmate
// effect: everyone else locked in right now, each with their own goal + a live timer ticking
// locally between the parent's 20s resync polls, so it doesn't visibly stutter/freeze between
// fetches.
export function BodyDoubleRow({ activeLockIn }: BodyDoubleRowProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const { session, display_name, avatar_url } = activeLockIn;
  const startedAt = new Date(session.started_at).getTime();
  const elapsedSeconds = Math.max(0, (now - startedAt) / 1000);
  const goalLabel = GOAL_TYPE_META[session.goal_type]?.label ?? session.goal_type;

  return (
    <View style={styles.row}>
      {avatar_url ? (
        <Image source={{ uri: avatar_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>{display_name.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <Text style={styles.name} numberOfLines={1}>
        {display_name} <Text style={styles.goalSuffix}>· {goalLabel}</Text>
      </Text>
      <Text style={styles.timer}>{formatDuration(elapsedSeconds)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 4,
    paddingHorizontal: Spacing.three,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.coral,
  },
  avatarFallback: {
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: Colors.achieverText,
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
  },
  name: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.ink,
  },
  goalSuffix: {
    color: Colors.muted,
    fontSize: 11,
  },
  timer: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.achieverText,
  },
});
