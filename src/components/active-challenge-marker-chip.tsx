import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { formatTimeLeft } from '@/lib/format';
import type { ActiveChallengeMarker } from '@/types/database';

// The pulsing active-challenge marker (PHILOI_UI_SPEC.md §16, mock 37) — visible on your own
// fire, a campfire co-member's row, or a friend's row/profile (get_active_challenge_marker
// already gates who gets a marker back at all). Type icon is by challenge mode (⚡ lightning =
// H2H, 👥 people = group); a separate Watch pill only renders when marker.can_watch AND the
// caller passed onWatch (self markers pass neither — you can't watch yourself).
export function ActiveChallengeMarkerChip({ marker, onWatch, compact }: { marker: ActiveChallengeMarker; onWatch?: () => void; compact?: boolean }) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const pulse = useSharedValue(1);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withSequence(withTiming(0.3, { duration: 700 }), withTiming(1, { duration: 700 })), -1, true);
  }, [reduceMotion, pulse]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: reduceMotion ? 1 : pulse.value }));

  const label = marker.mode === 'h2h' ? `vs ${marker.opponent_name ?? 'them'}` : `Group · ${marker.target_count ?? '?'}×`;
  const timeLeft = formatTimeLeft(marker.ends_at);

  return (
    <View style={styles.row}>
      <View style={[styles.chip, compact && styles.chipCompact]}>
        <Animated.View style={[styles.dot, dotStyle]} />
        <Ionicons name={marker.mode === 'h2h' ? 'flash' : 'people'} size={compact ? 11 : 13} color={Colors.ember} />
        <Text style={[styles.label, compact && styles.labelCompact]} numberOfLines={1}>
          {label}
        </Text>
        {timeLeft ? <Text style={styles.time}>· {timeLeft}</Text> : null}
      </View>
      {marker.can_watch && onWatch && (
        <Pressable style={styles.watchBtn} onPress={onWatch} hitSlop={6}>
          <Ionicons name="eye" size={12} color={Colors.ember} />
          <Text style={styles.watchText}>Watch</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.coral,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 11,
    flexShrink: 1,
  },
  chipCompact: {
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.coral,
  },
  label: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.ember,
    flexShrink: 1,
  },
  labelCompact: {
    fontSize: 10.5,
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  watchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  watchText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ember,
  },
});
