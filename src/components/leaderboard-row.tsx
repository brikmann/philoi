import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { LeaderboardRow as LeaderboardRowType } from '@/types/database';

type LeaderboardRowProps = {
  rank: number;
  row: LeaderboardRowType;
  isMe: boolean;
};

export function LeaderboardRow({ rank, row, isMe }: LeaderboardRowProps) {
  return (
    <View style={[styles.container, isMe && styles.me]}>
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
      <View style={styles.badges}>
        {rank === 1 && <Chip label="achiever" tone="achiever" />}
        {row.is_pro && <Chip label="PRO" tone="pro" />}
      </View>
      <Text style={styles.streak}>🔥 {row.current_streak}</Text>
    </View>
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
  badges: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  streak: {
    fontFamily: Fonts.bodyExtraBold,
    color: Colors.coral,
    minWidth: 44,
    textAlign: 'right',
  },
});
