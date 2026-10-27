import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconText } from '@/components/ui/icon';
import { Colors, Fonts } from '@/constants/theme';
import { RANK_TIER_LABEL, RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';
import type { ProfileIdentity, RecentWin } from '@/types/social';

// Mock 283's momentum strip — streak · rank + weekly trend · most recent win. Three tiles of proof
// of life, each about this one person and each computed server-side (get_profile_identity), so a
// profile feels alive the second it loads. Earned numbers only: there is no tile for anything a
// crowd hands you (no followers, no likes — CODE_PROMPT_identity_profile.md's one hard rule).
//
// A tile the server didn't send is a tile that isn't drawn — rank is absent when 0217's dial
// hides it, the win when the identity dial does — and the rest share the row.

const TREND_GLYPH = { up: '▲', down: '▼', flat: '–' } as const;

const WIN_HEADLINE: Record<RecentWin['kind'], string> = {
  pr: 'PR',
  challenge: 'Win',
  rank_up: 'Rank up',
  badge: 'Badge',
};

/** "2d", "5h", "now" — the tile has room for a stamp, not the "2d ago" sentence. */
function shortAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

function tierLabel(tier: string): string {
  return RANK_TIER_LABEL[tier as RankTierName] ?? tier.charAt(0).toUpperCase() + tier.slice(1);
}

function tierColor(tier: string): string {
  return RANK_TIER_METAL[tier as RankTierName]?.text ?? Colors.amber;
}

export function MomentumStrip({ identity, onRankPress }: { identity: ProfileIdentity | null; onRankPress?: () => void }) {
  if (!identity) return null;
  const { streak, rank, recent_win: win } = identity;

  return (
    <View style={styles.strip}>
      <View style={styles.tile}>
        <IconText icon="streak" style={[styles.big, { color: Colors.emberForward }]} numberOfLines={1}>
          {streak.current}
        </IconText>
        <Text style={styles.cap} numberOfLines={1}>
          day streak
        </Text>
      </View>

      {rank ? (
        <Pressable
          style={styles.tile}
          onPress={onRankPress}
          disabled={!onRankPress}
          accessibilityRole={onRankPress ? 'button' : undefined}
          accessibilityLabel={`${tierLabel(rank.tier)}, trending ${rank.trend}, ${rank.week_xp} XP this week`}>
          <Text style={[styles.big, { color: tierColor(rank.tier) }]} numberOfLines={1}>
            {tierLabel(rank.tier)} {TREND_GLYPH[rank.trend]}
          </Text>
          <Text style={styles.cap} numberOfLines={1}>
            +{rank.week_xp.toLocaleString()} XP this wk
          </Text>
        </Pressable>
      ) : null}

      {win ? (
        <View style={styles.tile}>
          <Text style={[styles.big, { color: Colors.green }]} numberOfLines={1}>
            {WIN_HEADLINE[win.kind] ?? 'Win'}
          </Text>
          <Text style={styles.cap} numberOfLines={1}>
            {win.label} · {shortAgo(win.at)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 13,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  big: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  cap: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
    marginTop: 3,
  },
});
