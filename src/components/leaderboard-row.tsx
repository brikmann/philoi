import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { HexagonBadge } from '@/components/hexagon-badge';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { formatRankTier } from '@/lib/rank-tiers';
import { supabase } from '@/lib/supabase';
import type { LeaderboardRow as LeaderboardRowType } from '@/types/database';

type LeaderboardRowProps = {
  rank: number;
  row: LeaderboardRowType;
  isMe: boolean;
  /** Omit for cross-circle leaderboards (e.g. university-leaderboard.tsx) — report/block needs a single circle context, so it's disabled there. */
  groupId?: string;
  onChanged?: () => void;
};

export function LeaderboardRow({ rank, row, isMe, groupId, onChanged }: LeaderboardRowProps) {
  const router = useRouter();
  const { session } = useAuth();

  // Same long-press report/block pattern as feed-item.tsx and chat-panel.tsx — makes a
  // member's profile reportable/blockable from the leaderboard, not just from a message or
  // check-in. circleId gives the report admin-filtering context (see report.tsx).
  function handleMore() {
    if (isMe || !groupId) return;
    Alert.alert('Report or block', '', [
      { text: 'Report', onPress: () => router.push(`/report?userId=${row.user_id}&circleId=${groupId}`) },
      {
        text: 'Block user',
        style: 'destructive',
        onPress: async () => {
          if (!session) return;
          await supabase.from('blocked_users').insert({ blocker_id: session.user.id, blocked_id: row.user_id });
          onChanged?.();
          Alert.alert('User blocked', "You won't see their posts or messages anymore.");
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <Pressable onLongPress={groupId ? handleMore : undefined} style={[styles.container, isMe && styles.me]}>
      <Text style={styles.rank}>{rank}</Text>
      {row.avatar_url ? (
        <Image source={{ uri: row.avatar_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>{row.display_name.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.nameColumn}>
        <Text style={styles.name}>
          {row.display_name}
          {isMe ? ' (you)' : ''}
        </Text>
        <Text style={styles.handle}>@{row.handle ?? 'newcomer'}</Text>
      </View>
      <View style={styles.tierColumn}>
        <HexagonBadge tier={row.tier} division={row.division} size={32} />
        <Text style={styles.tierText}>{formatRankTier(row.tier, row.division)}</Text>
        <Text style={styles.xpText}>{Math.round(row.score).toLocaleString()} XP</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.input,
  },
  me: {
    backgroundColor: Colors.achieverBg,
  },
  rank: {
    width: 20,
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
    textAlign: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    backgroundColor: Colors.plum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: Colors.cream,
    fontFamily: Fonts.bodyBold,
  },
  nameColumn: {
    flex: 1,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  tierColumn: {
    alignItems: 'center',
    gap: 2,
  },
  tierText: {
    fontFamily: Fonts.bodyExtraBold,
    fontSize: 11,
    color: Colors.muted,
  },
  xpText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
});
