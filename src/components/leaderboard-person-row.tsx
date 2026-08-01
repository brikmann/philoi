import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { HexagonBadge } from '@/components/hexagon-badge';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { formatRankTier } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

// The compact leaderboard row shared by the Leaderboard tab (design-mocks/11) and the
// intra-campfire board (PHILOI_UI_SPEC.md §15 — "same row style"). Position · avatar · name +
// tier label · mini rank-hexagon (tier color, badge only — never the sort key, that's always
// raw XP) · value. Your row is always highlighted with the coral border/tint.

export function LeaderboardPersonRow({
  rank,
  displayName,
  avatarUrl,
  tier,
  division,
  value,
  isMe,
}: {
  rank: number;
  displayName: string;
  avatarUrl?: string | null;
  tier: RankTierName;
  division: number;
  value: string;
  isMe: boolean;
}) {
  return (
    <View style={[styles.row, isMe && styles.rowMe]}>
      <Text style={styles.pos}>{rank}</Text>
      <View style={styles.avatar}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Text style={styles.avatarInitial}>{displayName.charAt(0).toUpperCase()}</Text>
        )}
      </View>
      <View style={styles.who}>
        <Text style={styles.name} numberOfLines={1}>
          {displayName}
          {isMe ? ' · you' : ''}
        </Text>
        <Text style={styles.sub}>{formatRankTier(tier, division)}</Text>
      </View>
      <HexagonBadge tier={tier} division={division} size={24} />
      <Text style={styles.val}>{value}</Text>
    </View>
  );
}

// The "···" gap the My-university scope drops between the top 10 and your pinned row
// (PHILOI_UI_SPEC.md §417) — you stay findable even at #142.
export function LeaderboardGap() {
  return <Text style={styles.gap}>···</Text>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.card,
  },
  rowMe: {
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.coral,
  },
  pos: {
    width: 18,
    textAlign: 'center',
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarInitial: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.achieverText,
  },
  who: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
  },
  val: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  gap: {
    textAlign: 'center',
    color: Colors.textTertiary,
    fontSize: 14,
    letterSpacing: 2,
    paddingVertical: 2,
  },
});
