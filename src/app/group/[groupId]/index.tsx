import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { CampfireBannerHero } from '@/components/campfire-banner-hero';
import { CampfireOptionsSheet } from '@/components/campfire-options-sheet';
import { CircleTimeline } from '@/components/circle-timeline';
import { LeaderboardPersonRow } from '@/components/leaderboard-person-row';
import { LockinGoalPicker } from '@/components/lockin-goal-picker';
import { SocialChallengeCard } from '@/components/social-challenge-card';
import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useCampfireHeat } from '@/hooks/use-campfire-heat';
import { useCampfireStats } from '@/hooks/use-campfire-stats';
import { useGroup } from '@/hooks/use-group';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { useMyGroups } from '@/hooks/use-my-groups';
import { useSocialChallenges } from '@/hooks/use-social-challenges';
import { track } from '@/lib/analytics';
import { fetchJoinRequests } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
import type { LeaderboardRow, SocialChallenge } from '@/types/database';

type Tab = 'leaderboard' | 'feed' | 'challenges';

const TABS: { key: Tab; label: string }[] = [
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'feed', label: 'Feed' },
  { key: 'challenges', label: 'Challenges' },
];

// THE CAMPFIRE MEMBER VIEW — design-mocks/94, punchlist 17 P6. What you land on the moment you open
// a campfire you're in, and the member-side twin of the join preview (mock 62).
//
// The old version of this screen opened straight into chat with a one-line header. That made a
// campfire feel like a group DM. Mock 94 makes it a clan page: the banner hero with the group's live
// heat flame and its join gate, the serious stats, and — the point of the rework — the LEADERBOARD
// as the landing tab, visible the second you're in, with Feed and Challenges as siblings beside it
// rather than the thing you land on.
//
// Chat/feed is unchanged underneath: the Feed tab is the same CircleTimeline this screen used to
// render on its own, composer and all.
export default function GroupScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { session } = useAuth();
  const { group } = useGroup(groupId);
  const { groups: myGroups } = useMyGroups();
  const heatByGroupId = useCampfireHeat();
  const { stats, refetch: refetchStats } = useCampfireStats(groupId);
  const { rows, loading: boardLoading, refetch: refetchBoard } = useLeaderboard(groupId);
  const { challenges, refetch: refetchChallenges } = useSocialChallenges();

  const [tab, setTab] = useState<Tab>('leaderboard');
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [lockInPickerVisible, setLockInPickerVisible] = useState(false);
  const [chatMutedOverride, setChatMutedOverride] = useState<boolean | null>(null);
  const chatMuted = chatMutedOverride ?? myGroups.find((g) => g.id === groupId)?.chat_muted ?? false;
  const [hasPendingRequests, setHasPendingRequests] = useState(false);
  const isOwner = Boolean(group && session && group.owner_id === session.user.id);

  useEffect(() => {
    track('chat_opened', { group_id: groupId });
  }, [groupId]);

  // Badge dot on the options gear (PHILOI_UI_SPEC.md §14: "a badge dot also appears on the interior
  // header") — same owner+gated gate as the options sheet's row.
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

  // This campfire's own live challenges. useSocialChallenges is the whole cross-campfire feed, so
  // the tab is a filter on it rather than a second fetch of the same table.
  const groupChallenges = useMemo(
    () => challenges.filter((c) => c.circle_id === groupId && (c.status === 'active' || c.status === 'pending')),
    [challenges, groupId]
  );

  const heat = heatByGroupId[groupId] ?? 0;
  const memberCount = stats?.member_count ?? rows.length;

  const header = (
    <View>
      {group && (
        <CampfireBannerHero
          name={group.name}
          privacy={group.privacy}
          memberCount={memberCount}
          createdAt={group.created_at}
          heat={heat}
          lockedInToday={stats?.locked_in_today ?? 0}
          minJoinTier={group.min_join_tier}
        />
      )}

      {/* The serious stat strip. Only renders with real numbers behind it — three zeroed tiles say
          less than no strip at all. */}
      {stats && (
        <View style={styles.stats}>
          <StatTile value={`${Math.round(stats.avg_streak)}`} unit="d" label="Avg streak" color={Colors.amber} />
          <StatTile value={`${stats.avg_hours_per_day}`} unit="h" label="Locked / day" />
          <StatTile
            value={`${stats.live_challenges}`}
            label="Live challenges"
            color={stats.live_challenges > 0 ? Colors.danger : undefined}
          />
        </View>
      )}

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, on && styles.tabOn]}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}>
              <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const houseRule = group?.house_rule ? (
    <View style={styles.rule}>
      <Text style={styles.ruleText}>
        <Text style={styles.ruleLead}>🔥 House rule: </Text>
        {group.house_rule}
      </Text>
    </View>
  ) : null;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ headerShown: false }} />

      {tab === 'feed' ? (
        // The one tab that can't scroll under the hero: CircleTimeline is its own inverted list with
        // a pinned composer, so the hero stays put above it instead of being its list header.
        <View style={styles.flex}>
          {header}
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
        <FlatList
          data={groupChallenges}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetchChallenges} tintColor={Colors.coral} />}
          ListHeaderComponent={header}
          renderItem={({ item }: { item: SocialChallenge }) =>
            session ? (
              <View style={styles.challengeWrap}>
                <SocialChallengeCard challenge={item} myUserId={session.user.id} onChanged={refetchChallenges} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <EmptyState title="No live challenges" body="Nobody in this campfire has anything running right now." />
              <Pressable
                style={styles.emptyCta}
                onPress={() => router.push({ pathname: '/challenge/create', params: { mode: 'group', circleId: groupId } })}>
                <Text style={styles.emptyCtaLabel}>Start a challenge</Text>
              </Pressable>
            </View>
          }
          ListFooterComponent={houseRule}
        />
      )}

      {/* Chrome over the banner (mock 94's `.back` / `.gear`) — dark discs, so they read on top of
          whatever the banner art is doing behind them. */}
      <Pressable style={[styles.disc, styles.discBack]} onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={16} color={Colors.ink} />
      </Pressable>
      <Pressable
        style={[styles.disc, styles.discGear]}
        onPress={() => setOptionsVisible(true)}
        hitSlop={8}
        accessibilityLabel="Campfire options">
        <Ionicons name="settings-outline" size={15} color={Colors.ink} />
        {hasPendingRequests && <View style={styles.optionsBadge} />}
      </Pressable>

      {/* The footer action. Not on Feed — the composer already owns that bottom edge. */}
      {tab !== 'feed' && (
        <View style={styles.foot}>
          <View style={styles.flex}>
            <PrimaryButton label="Lock in with the house" onPress={() => setLockInPickerVisible(true)} />
          </View>
          <Pressable style={styles.footGhost} onPress={() => setTab('feed')} accessibilityLabel="Open the feed">
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={Colors.muted} />
          </Pressable>
        </View>
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

function StatTile({ value, unit, label, color }: { value: string; unit?: string; label: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color ? { color } : null]}>
        {value}
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
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
  listContent: {
    paddingBottom: Spacing.four,
  },
  rosterRow: {
    paddingHorizontal: Spacing.twelve,
  },
  disc: {
    position: 'absolute',
    top: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  discBack: {
    left: 12,
  },
  discGear: {
    right: 12,
  },
  optionsBadge: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.coral,
    borderWidth: 1.5,
    borderColor: Colors.twilight900,
  },
  stats: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: 14,
    paddingTop: Spacing.twelve,
  },
  stat: {
    flex: 1,
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    paddingVertical: 9,
    paddingHorizontal: Spacing.one,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  statUnit: {
    fontSize: 9,
  },
  statLabel: {
    fontFamily: Fonts.body,
    fontSize: 8.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
    marginTop: 2,
  },
  tabs: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: Spacing.twelve,
    paddingBottom: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: 10,
    backgroundColor: Colors.cream,
  },
  tabOn: {
    backgroundColor: Colors.coral,
  },
  tabLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.muted,
  },
  tabLabelOn: {
    color: Colors.ink,
  },
  emptyWrap: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  emptyCta: {
    alignSelf: 'center',
    marginTop: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    backgroundColor: Colors.selectedBg,
  },
  emptyCtaLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.achieverText,
  },
  challengeWrap: {
    paddingHorizontal: Spacing.twelve,
    paddingTop: Spacing.two,
  },
  rule: {
    marginTop: Spacing.twelve,
    marginHorizontal: Spacing.twelve,
    backgroundColor: '#231A2E',
    borderLeftWidth: 3,
    borderLeftColor: Colors.coral,
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
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.twelve,
  },
  footGhost: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
