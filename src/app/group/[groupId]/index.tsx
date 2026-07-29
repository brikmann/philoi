import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { CampfireOptionsSheet } from '@/components/campfire-options-sheet';
import { CircleTimeline } from '@/components/circle-timeline';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useActiveCircleLockIns } from '@/hooks/use-active-circle-lockins';
import { useGroup } from '@/hooks/use-group';
import { useMyGroups } from '@/hooks/use-my-groups';
import { track } from '@/lib/analytics';
import { fetchJoinRequests } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';

// The "locked in now" live strip's pulsing dot (design-mocks/06: `@keyframes pulse`).
function PulsingDot() {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(withSequence(withTiming(0.35, { duration: 700 }), withTiming(1, { duration: 700 })), -1, true);
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View style={[styles.liveDot, style]} />;
}

// The campfire interior — a lean chat header + live-presence strip + the merged chain
// (design-mocks/06). This screen is chat-first, not a stats dashboard: the people icon opens
// this campfire's own intra-campfire leaderboard (PHILOI_UI_SPEC.md §420-421,
// group/[groupId]/leaderboard.tsx). The broader cross-circle board lives on the app-wide
// Leaderboard tab (design-mocks/11, (tabs)/leaderboards.tsx).
export default function GroupScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { session } = useAuth();
  const { group } = useGroup(groupId);
  const activeLockIns = useActiveCircleLockIns(groupId);
  const { groups: myGroups } = useMyGroups();
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [chatMutedOverride, setChatMutedOverride] = useState<boolean | null>(null);
  const chatMuted = chatMutedOverride ?? myGroups.find((g) => g.id === groupId)?.chat_muted ?? false;
  const [hasPendingRequests, setHasPendingRequests] = useState(false);
  const isOwner = Boolean(group && session && group.owner_id === session.user.id);

  useEffect(() => {
    track('chat_opened', { group_id: groupId });
  }, [groupId]);

  // Badge dot on the flame-tile options trigger (PHILOI_UI_SPEC.md §14: "a badge dot also
  // appears on the interior header") — same owner+gated gate as the options sheet's row.
  useEffect(() => {
    if (!isOwner || group?.privacy !== 'gated') {
      setHasPendingRequests(false);
      return;
    }
    fetchJoinRequests(groupId)
      .then((requests) => setHasPendingRequests(requests.length > 0))
      .catch(() => {
        // Flavor indicator only — a failed fetch just hides the dot.
      });
  }, [isOwner, group?.privacy, groupId]);

  return (
    // Explicit rather than relying on Screen's implicit default — this screen's background
    // must be the standard app surface (Colors.cream, #1B1726), never twilight900 (the
    // deeper tone reserved for the field/valley's own twilight-valley look); only the bottom
    // tab bar stays the lighter Colors.card surface.
    <Screen padded={false} backgroundColor={Colors.cream}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="chevron-down" size={20} color={Colors.muted} />
        </Pressable>
        <Pressable
          style={styles.flameTile}
          onPress={() => setOptionsVisible(true)}
          hitSlop={4}
          accessibilityLabel="Campfire options">
          <Ionicons name="flame" size={15} color={Colors.amber} />
          {hasPendingRequests && <View style={styles.optionsBadge} />}
        </Pressable>
        <Pressable style={styles.headerCenter} onPress={() => setOptionsVisible(true)}>
          <Text style={styles.name} numberOfLines={1}>
            {group?.name ?? '…'}
          </Text>
          {activeLockIns.length > 0 && (
            <Text style={styles.presence}>{activeLockIns.length} locked in now</Text>
          )}
        </Pressable>
        <Pressable onPress={() => router.push(`/group/${groupId}/leaderboard`)} hitSlop={8} accessibilityLabel="Leaderboard">
          <Ionicons name="people-outline" size={19} color={Colors.muted} />
        </Pressable>
      </View>

      <CampfireOptionsSheet
        visible={optionsVisible}
        onClose={() => setOptionsVisible(false)}
        group={group}
        groupId={groupId}
        chatMuted={chatMuted}
        onChatMutedChanged={setChatMutedOverride}
      />

      {activeLockIns.length > 0 && (
        <View style={styles.liveStrip}>
          <PulsingDot />
          <Text style={styles.liveText}>locked in now</Text>
          <View style={styles.liveAvatars}>
            {activeLockIns.slice(0, 4).map((a) => (
              <View key={a.session.id} style={styles.liveAvatar}>
                <Text style={styles.liveAvatarInitial}>{a.display_name.charAt(0).toUpperCase()}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {session && <CircleTimeline groupId={groupId} myUserId={session.user.id} groupName={group?.name} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    paddingTop: 13,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  flameTile: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsBadge: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.coral,
    borderWidth: 1.5,
    borderColor: Colors.cream,
  },
  headerCenter: {
    flex: 1,
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: 15,
    lineHeight: 17,
    color: Colors.ink,
  },
  presence: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.achieverText,
  },
  liveStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    backgroundColor: Colors.card,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.coral,
  },
  liveText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.achieverText,
  },
  liveAvatars: {
    flexDirection: 'row',
    marginLeft: Spacing.one,
  },
  liveAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.achieverBg,
    borderWidth: 1.5,
    borderColor: Colors.coral,
    marginLeft: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveAvatarInitial: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.achieverText,
  },
});
