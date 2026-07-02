import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';

import { ChatPanel } from '@/components/chat-panel';
import { FeedItem } from '@/components/feed-item';
import { LeaderboardRow } from '@/components/leaderboard-row';
import { MyGoalTarget } from '@/components/my-goal-target';
import { RecapStrip } from '@/components/recap-strip';
import { PrimaryButton } from '@/components/ui/primary-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { CHAT_ENABLED } from '@/constants/feature-flags';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useFeed } from '@/hooks/use-feed';
import { useGroup } from '@/hooks/use-group';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { track } from '@/lib/analytics';
import { fetchInviteLink, fetchWeeklyRecap } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';

type Tab = 'feed' | 'leaderboard' | 'chat';

export default function GroupScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { session } = useAuth();
  const { group } = useGroup(groupId);
  const feed = useFeed(groupId);
  const leaderboard = useLeaderboard(groupId);
  const [tab, setTab] = useState<Tab>('feed');
  const [checkInsThisWeek, setCheckInsThisWeek] = useState(0);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!session) return;
    fetchWeeklyRecap(session.user.id).then((rows) => {
      const mine = rows.find((r) => r.group_id === groupId);
      setCheckInsThisWeek(mine?.check_ins_this_week ?? 0);
    });
  }, [session, groupId]);

  async function handleInvite() {
    if (!group) return;
    setSharing(true);
    try {
      const link = await fetchInviteLink(group.id, group.join_code);
      track('invite_sent', { group_id: group.id, source: 'group_screen' });
      await Share.share({
        message: `Join my circle on Philoi 🔥 Code: ${link.code} — or tap: ${link.deepLink}`,
      });
    } finally {
      setSharing(false);
    }
  }

  const refreshing = tab === 'feed' ? feed.loading : tab === 'leaderboard' ? leaderboard.loading : false;
  const onRefresh = tab === 'feed' ? feed.refetch : leaderboard.refetch;
  const activeError = tab === 'feed' ? feed.error : tab === 'leaderboard' ? leaderboard.error : null;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: group ? `${group.emoji} ${group.name}` : '' }} />

      <View style={styles.topBar}>
        <RecapStrip checkInsThisWeek={checkInsThisWeek} />
        <Pressable
          onPress={handleInvite}
          style={styles.inviteButton}
          disabled={sharing}
          accessibilityLabel="Invite a friend">
          <Text style={styles.inviteLabel}>Invite</Text>
        </Pressable>
      </View>

      <View style={styles.tabRow}>
        <Pressable onPress={() => setTab('feed')} style={[styles.tab, tab === 'feed' && styles.tabActive]}>
          <Text style={[styles.tabLabel, tab === 'feed' && styles.tabLabelActive]}>Feed</Text>
        </Pressable>
        <Pressable
          onPress={() => setTab('leaderboard')}
          style={[styles.tab, tab === 'leaderboard' && styles.tabActive]}>
          <Text style={[styles.tabLabel, tab === 'leaderboard' && styles.tabLabelActive]}>Leaderboard</Text>
        </Pressable>
        {CHAT_ENABLED && (
          <Pressable onPress={() => setTab('chat')} style={[styles.tab, tab === 'chat' && styles.tabActive]}>
            <Text style={[styles.tabLabel, tab === 'chat' && styles.tabLabelActive]}>Chat</Text>
          </Pressable>
        )}
      </View>

      {activeError && <Text style={styles.error}>{activeError}</Text>}

      {tab === 'chat' && session ? (
        <ChatPanel groupId={groupId} myUserId={session.user.id} />
      ) : tab === 'feed' ? (
        <FlatList
          data={feed.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.coral} />}
          renderItem={({ item }) => <FeedItem item={item} onReactionChanged={feed.refetch} />}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
          ListEmptyComponent={
            !feed.loading ? (
              <EmptyState
                title="No check-ins yet"
                body="Be the first to show up — your circle's watching 👀"
                action={<PrimaryButton label="Lock in" onPress={() => router.push(`/group/${groupId}/check-in`)} />}
              />
            ) : null
          }
        />
      ) : (
        <FlatList
          data={leaderboard.rows}
          keyExtractor={(item) => item.user_id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.coral} />}
          ListHeaderComponent={
            group?.goal_type === 'study' && session ? (
              <MyGoalTarget
                groupId={groupId}
                current={leaderboard.rows.find((r) => r.user_id === session.user.id)?.goal_target ?? null}
                onSaved={leaderboard.refetch}
              />
            ) : null
          }
          renderItem={({ item, index }) => (
            <LeaderboardRow rank={index + 1} row={item} isMe={item.user_id === session?.user.id} />
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  inviteButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  inviteLabel: {
    fontFamily: Fonts.bodyBold,
    color: Colors.plum,
    fontSize: 13,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    marginTop: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  tab: {
    paddingBottom: Spacing.two,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: Colors.coral,
  },
  tabLabel: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.muted,
  },
  tabLabelActive: {
    color: Colors.coral,
  },
  listContent: {
    padding: Spacing.four,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
});
