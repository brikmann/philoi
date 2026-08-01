import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { ActiveCircleLockIn } from '@/lib/api/lock-ins';
import { formatDurationClock } from '@/lib/format';

// "Locked in with you" (PHILOI_UI_SPEC.md §13, design-mocks/51 + 52) — the Focusmate effect,
// compact. Replaces the old stacked BodyDoubleRow list: the redesign gives the fire and timer the
// screen, so the body-doubles shrink to a strip that reads at a glance instead of a block of rows.
//
// One ticker for the whole strip, not one per participant — every avatar's timer is derived from
// the same `now`, so N participants still cost a single 1s re-render.
function useTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [enabled]);
  return now;
}

function elapsedFor(lockIn: ActiveCircleLockIn, now: number): number {
  return Math.max(0, (now - new Date(lockIn.session.started_at).getTime()) / 1000);
}

function Avatar({ lockIn, size }: { lockIn: ActiveCircleLockIn; size: number }) {
  const dimensions = { width: size, height: size, borderRadius: size / 2 };
  if (lockIn.avatar_url) {
    return <Image source={{ uri: lockIn.avatar_url }} style={[styles.avatar, dimensions]} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback, dimensions]}>
      <Text style={[styles.avatarInitial, { fontSize: size * 0.38 }]}>{lockIn.display_name.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

/** Base screen (mock 51): a labelled, horizontally scrolling strip of lit avatars, each with its
 * own live timer underneath. */
export function BodyDoubleStrip({ lockIns }: { lockIns: ActiveCircleLockIn[] }) {
  const now = useTick(lockIns.length > 0);
  if (lockIns.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <View style={styles.liveDot} />
        <Text style={styles.label}>Locked in with you</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {lockIns.map((a) => (
          <View key={a.session.id} style={styles.column}>
            <Avatar lockIn={a} size={34} />
            <Text style={styles.columnTimer}>{formatDurationClock(elapsedFor(a, now))}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** Gym (mock 52): collapsed to a single line — a few avatars and a count. In a gym the log is
 * what you're looking at, so the body-doubles stay as ambient company, not a feature. */
export function BodyDoubleStripCollapsed({ lockIns }: { lockIns: ActiveCircleLockIn[] }) {
  if (lockIns.length === 0) return null;
  const shown = lockIns.slice(0, 3);
  const remaining = lockIns.length - shown.length;

  return (
    <View style={styles.collapsedRow}>
      {shown.map((a) => (
        <Avatar key={a.session.id} lockIn={a} size={26} />
      ))}
      <Text style={styles.collapsedText} numberOfLines={1}>
        {remaining > 0 ? `+${remaining} locked in with you` : `${lockIns.length} locked in with you`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing.two,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 7,
    marginHorizontal: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.green,
  },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
  },
  row: {
    gap: 9,
    paddingHorizontal: 4,
  },
  column: {
    alignItems: 'center',
    gap: 3,
    width: 48,
  },
  avatar: {
    borderWidth: 1.5,
    borderColor: 'rgba(224,97,44,0.5)',
  },
  avatarFallback: {
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: Colors.ember,
    fontFamily: Fonts.bodyBold,
  },
  columnTimer: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.muted,
  },
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: Spacing.twelve,
  },
  collapsedText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textTertiary,
  },
});
