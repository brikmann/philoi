import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RankBadge } from '@/components/rank-badge';
import { RankProjectionBar } from '@/components/rank-projection-bar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMyRanks } from '@/hooks/use-my-ranks';
import { formatRankTier } from '@/lib/rank-tiers';

// PRIVATE CLIMB — what the Leaderboard tab is for someone whose season rank is on Private (0217).
//
// Not an empty state, and not a locked door. Private is a choice to measure yourself against
// yourself, so the tab shows exactly that: your own tier on the Bronze → Primordial ladder and how
// far it is to the next division. No position, no board size, nobody else's name. The server
// agrees — every board this user reads comes back as just them — so there is nothing to hide here,
// only nothing to show.
//
// One quiet way out, to Settings, because someone who lands here by accident should not have to
// hunt for it. No "see what you're missing" sell: that would turn their choice into a funnel.
export function PrivateClimb() {
  const router = useRouter();
  const { ranks, loading } = useMyRanks();
  const universal = ranks.find((r) => r.scope === 'universal');

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.kick}>Your climb</Text>
        {universal ? (
          <>
            <View style={styles.tierRow}>
              <RankBadge tier={universal.tier} division={universal.division} size={56} />
              <Text style={styles.tier}>{formatRankTier(universal.tier, universal.division)}</Text>
            </View>
            <RankProjectionBar
              tier={universal.tier}
              division={universal.division}
              xpIntoTier={universal.xp_into_tier}
              xpForNextTier={universal.xp_for_next_tier}
              hoursToNext={null}
            />
          </>
        ) : (
          !loading && <Text style={styles.body}>Lock in once and your rank starts here.</Text>
        )}
      </View>

      <View style={styles.note}>
        <Ionicons name="lock-closed" size={14} color={Colors.muted} />
        <Text style={styles.noteText}>
          Your season rank is Private: no boards, no comparisons. Nobody else sees your rank, and your rewards
          don&apos;t change.
        </Text>
      </View>
      <Pressable onPress={() => router.push('/settings')} hitSlop={8} accessibilityRole="button">
        <Text style={styles.link}>Change in Settings</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.twelve,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.twelve,
  },
  kick: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.muted,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
  },
  tier: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 22,
    color: Colors.ink,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  noteText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.muted,
  },
  link: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.coral,
    paddingHorizontal: Spacing.one,
  },
});
