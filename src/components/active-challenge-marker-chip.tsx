import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMotionActive } from '@/hooks/use-motion-active';
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

  const motionActive = useMotionActive();
  useEffect(() => {
    if (reduceMotion || !motionActive) return;
    pulse.value = withRepeat(withSequence(withTiming(0.3, { duration: 700 }), withTiming(1, { duration: 700 })), -1, true);
    return () => {
      cancelAnimation(pulse);
      // Parked lit. The dot's resting state is opacity 1 and the pulse only dims it, so freezing
      // mid-cycle would leave a half-faded "live" marker on the way back.
      pulse.value = 1;
    };
  }, [reduceMotion, motionActive, pulse]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: reduceMotion ? 1 : pulse.value }));

  // 🔴 WAS `Group · ${marker.target_count ?? '?'}×`, which rendered the literal "Group · ?×" on
  // Your fire. target_count is null BY CONSTRAINT on a placement race (0126) and null on a
  // measured collective goal (0169), so the two shapes most likely to be running were exactly the
  // two the pill could not name — and the fallback advertised the app's own missing data.
  //
  // participant_count (0204) is who is actually in the race, from challenge_field — the same field
  // settlement pays across. It is null only on a duel, which takes the other branch anyway; the
  // fallback below is for a marker read by a build older than 0204's deploy, which reads "Group"
  // and says nothing untrue rather than showing a question mark.
  const label =
    marker.mode === 'h2h'
      ? `vs ${marker.opponent_name ?? 'them'}`
      : marker.participant_count != null
        ? `${marker.participant_count} in`
        : 'Group';
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
