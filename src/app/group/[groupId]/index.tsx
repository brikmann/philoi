import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { CampfireHeader, type CampfireTab } from '@/components/campfire-header';
import { CampfireOptionsSheet } from '@/components/campfire-options-sheet';
import { ChallengesTab } from '@/components/challenges-tab';
import { CircleTimeline } from '@/components/circle-timeline';
import { LeaderboardPersonRow } from '@/components/leaderboard-person-row';
import { LockinGoalPicker } from '@/components/lockin-goal-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useCampfireHeat } from '@/hooks/use-campfire-heat';
import { useCampfireRole } from '@/hooks/use-campfire-role';
import { useCampfireStats } from '@/hooks/use-campfire-stats';
import { useGroup } from '@/hooks/use-group';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { useMyGroups } from '@/hooks/use-my-groups';
import { track } from '@/lib/analytics';
import { fetchJoinRequests } from '@/lib/api/groups';
import { useActiveSession } from '@/lib/active-session-context';
import { useAuth } from '@/lib/auth/auth-context';
import type { LeaderboardRow } from '@/types/database';

// THE CAMPFIRE MEMBER VIEW — the container (mocks 110 + 112 §A; CAMPFIRE_REDESIGN_SPEC §Phase 1).
//
// This screen owns the CHROME and nothing else: the header, the Leaderboard/Feed/Challenges tab
// bar, the options entry point, and which tab's content is mounted. The Challenges tab's content
// is <ChallengesTab/>, which belongs to the challenge subsystem — see challenges-tab.tsx for the
// seam.
//
// WHAT THE REDESIGN CHANGED HERE:
//  · The off-brand blue floating gear is gone. It used to be an absolutely-positioned disc drawn
//    over the content, which is why it appeared mid-screen on tabs that scrolled. The one menu
//    control now lives in the header's chrome row with everything else.
//  · Lock-in moved from a big bottom "Lock in with the house" bar to the header's top-right pill,
//    freeing the entire bottom edge for content and the chat composer.
//  · Feed is swipe-up-to-full-screen. A half-visible chat under a tall stat strip was the specific
//    complaint; now Feed opens with a collapsed header and one upward swipe takes the header away
//    entirely.
export default function GroupScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { session } = useAuth();
  const { session: activeSession } = useActiveSession();
  const { group } = useGroup(groupId);
  const { groups: myGroups } = useMyGroups();
  const heatByGroupId = useCampfireHeat();
  const { stats, refetch: refetchStats } = useCampfireStats(groupId);
  const { rows, loading: boardLoading, refetch: refetchBoard } = useLeaderboard(groupId);
  // The roles foundation (migration 0094). isAdmin — not `owner_id === me` — is what gates every
  // manage affordance from here down, so a promoted admin gets the same keys as the founder.
  const { isAdmin } = useCampfireRole(groupId);

  const [tab, setTab] = useState<CampfireTab>('leaderboard');
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [lockInPickerVisible, setLockInPickerVisible] = useState(false);
  const [feedFullScreen, setFeedFullScreen] = useState(false);
  const [chatMutedOverride, setChatMutedOverride] = useState<boolean | null>(null);
  const chatMuted = chatMutedOverride ?? myGroups.find((g) => g.id === groupId)?.chat_muted ?? false;
  const [hasPendingRequests, setHasPendingRequests] = useState(false);

  useEffect(() => {
    track('chat_opened', { group_id: groupId });
  }, [groupId]);

  // Badge dot on the options control (PHILOI_UI_SPEC.md §14) — same admin+gated gate as the
  // options sheet's own row, so a member never sees a dot for a screen they can't open.
  useEffect(() => {
    if (!isAdmin || group?.privacy !== 'gated') {
      setHasPendingRequests(false);
      return;
    }
    fetchJoinRequests(groupId)
      .then((requests) => setHasPendingRequests(requests.length > 0))
      .catch(() => {
        // Flavor indicator only — a failed fetch just hides the dot.
      });
  }, [isAdmin, group?.privacy, groupId]);

  // Leaving Feed always restores the header — otherwise Leaderboard would come back headerless.
  function changeTab(next: CampfireTab) {
    if (next !== 'feed') setFeedFullScreen(false);
    setTab(next);
  }

  const heat = heatByGroupId[groupId] ?? 0;
  const memberCount = stats?.member_count ?? rows.length;

  const header = (
    <CampfireHeader
      group={group}
      variant={tab === 'leaderboard' ? 'full' : 'collapsed'}
      tab={tab}
      onTabChange={changeTab}
      onBack={() => router.back()}
      onLockIn={() => setLockInPickerVisible(true)}
      onOptions={() => setOptionsVisible(true)}
      heat={heat}
      memberCount={memberCount}
      lockedInToday={stats?.locked_in_today ?? 0}
      stats={
        stats
          ? {
              avgStreak: stats.avg_streak,
              avgHoursPerDay: stats.avg_hours_per_day,
              liveChallenges: stats.live_challenges,
            }
          : null
      }
      hasPendingRequests={hasPendingRequests}
      lockInDisabled={Boolean(activeSession)}
    />
  );

  const houseRule = group?.house_rule ? (
    <View style={styles.rule}>
      <Text style={styles.ruleText}>
        <Text style={styles.ruleLead}>🔥 House rule: </Text>
        {group.house_rule}
      </Text>
    </View>
  ) : null;

  // Mock 110 frame 2's "— swipe up for full-screen feed —". A vertical pan over the hint strip
  // (or a tap on it) trades the header for screen: past 20px of upward travel the whole header
  // goes, leaving the feed and its docked composer alone with the screen.
  const swipe = Gesture.Pan().onEnd((e) => {
    if (e.translationY < -20) runOnJS(setFeedFullScreen)(true);
    else if (e.translationY > 20) runOnJS(setFeedFullScreen)(false);
  });

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ headerShown: false }} />

      {tab === 'feed' ? (
        // The one tab that can't scroll under the header: CircleTimeline is its own list with a
        // pinned composer, so the header sits above it rather than being its list header.
        <View style={styles.flex}>
          {!feedFullScreen && (
            <GestureDetector gesture={swipe}>
              <View>
                {header}
                <Pressable
                  style={styles.swipeHint}
                  onPress={() => setFeedFullScreen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Expand the feed to full screen">
                  <View style={styles.swipeGrip} />
                  <Text style={styles.swipeHintLabel}>swipe up for full-screen feed</Text>
                </Pressable>
              </View>
            </GestureDetector>
          )}

          {feedFullScreen && (
            // Full-screen feed keeps ONE affordance: get back out. Everything else is the feed.
            <View style={styles.fullBar}>
              <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
                <Ionicons name="chevron-back" size={18} color={Colors.muted} />
              </Pressable>
              <Text style={styles.fullBarName} numberOfLines={1}>
                {group?.name ?? '…'}
              </Text>
              <Pressable
                onPress={() => setFeedFullScreen(false)}
                hitSlop={10}
                accessibilityLabel="Show the campfire header">
                <Ionicons name="chevron-down" size={18} color={Colors.muted} />
              </Pressable>
              <Pressable onPress={() => setOptionsVisible(true)} hitSlop={10} accessibilityLabel="Campfire options">
                <Ionicons name="menu" size={18} color={Colors.muted} />
              </Pressable>
            </View>
          )}

          {session && <CircleTimeline groupId={groupId} myUserId={session.user.id} groupName={group?.name} />}
        </View>
      ) : tab === 'leaderboard' ? (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.user_id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={boardLoading}
              onRefresh={() => {
                refetchBoard();
                refetchStats();
              }}
              tintColor={Colors.coral}
            />
          }
          ListHeaderComponent={header}
          renderItem={({ item, index }) => (
            <RosterRow row={item} rank={index + 1} isMe={item.user_id === session?.user.id} onPress={goToProfile} />
          )}
          ListEmptyComponent={
            !boardLoading ? (
              <View style={styles.emptyWrap}>
                <EmptyState title="Nobody on the board yet" body="Members show up here once they start earning XP." />
              </View>
            ) : null
          }
          ListFooterComponent={houseRule}
        />
      ) : (
        session && (
          <ChallengesTab
            groupId={groupId}
            myUserId={session.user.id}
            isAdmin={isAdmin}
            ListHeaderComponent={header}
            bottomGap={Spacing.four}
          />
        )
      )}

      <CampfireOptionsSheet
        visible={optionsVisible}
        onClose={() => setOptionsVisible(false)}
        group={group}
        groupId={groupId}
        chatMuted={chatMuted}
        onChatMutedChanged={setChatMutedOverride}
      />

      <LockinGoalPicker
        visible={lockInPickerVisible}
        onClose={() => setLockInPickerVisible(false)}
        lockedCircleId={groupId}
        lockedCircleName={group?.name}
      />
    </Screen>
  );

  function goToProfile(userId: string) {
    if (userId === session?.user.id) router.push('/profile');
    else router.push({ pathname: '/friend-profile', params: { userId } });
  }
}

function RosterRow({
  row,
  rank,
  isMe,
  onPress,
}: {
  row: LeaderboardRow;
  rank: number;
  isMe: boolean;
  onPress: (userId: string) => void;
}) {
  return (
    <Pressable style={styles.rosterRow} onPress={() => onPress(row.user_id)}>
      <LeaderboardPersonRow
        rank={rank}
        displayName={row.display_name}
        avatarUrl={row.avatar_url}
        tier={row.tier}
        division={row.division}
        value={`${Math.round(row.score).toLocaleString()} XP`}
        // Streak under XP, kept subtle per the spec — a small flame and a count, not a second stat.
        secondaryValue={`🔥 ${row.check_ins_this_week}× wk`}
        isMe={isMe}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  // Room under the last row. Screen's SafeAreaView already clears the home indicator — this is
  // the gap on top of it, so the board never ends flush against the edge.
  listContent: {
    paddingBottom: Spacing.four,
  },
  rosterRow: {
    paddingHorizontal: Spacing.twelve,
  },
  swipeHint: {
    alignItems: 'center',
    gap: 5,
    paddingTop: 6,
    paddingBottom: 8,
  },
  swipeGrip: {
    width: 34,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.trackAlt,
  },
  swipeHintLabel: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    letterSpacing: 0.3,
    color: Colors.textTertiary,
  },
  fullBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 6,
  },
  fullBarName: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  emptyWrap: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  rule: {
    marginTop: Spacing.twelve,
    marginHorizontal: Spacing.twelve,
    backgroundColor: '#231A2E',
    borderLeftWidth: 3,
    borderLeftColor: Colors.amber,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: Spacing.twelve,
  },
  ruleText: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    lineHeight: 16,
    color: '#E7DDF5',
  },
  ruleLead: {
    fontFamily: Fonts.bodyBold,
    color: Colors.amber,
  },
});
