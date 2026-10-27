import { StyleSheet, Text, View } from 'react-native';

import { IconText, type IconName } from '@/components/ui/icon';
import { Colors, Fonts } from '@/constants/theme';
import { formatDeltaChip, weekHeadline, type MyWeek } from '@/lib/api/home';
import { formatSessionDuration } from '@/lib/format';
import { formatRankTier, RANK_TIER_COLOR } from '@/lib/rank-tiers';

/**
 * Home §1 — YOUR WEEK (mock 318). Ipsative: you against your own last week, never against anyone
 * else. Three tiles (locked in · streak · rank), and one bar whose fill is this week and whose
 * dashed marker is where last week finished, so "ahead / not yet" reads at a glance.
 *
 * Only good news gets a chip. A slower week shows the number with no "▼" beside it — the headline
 * stays encouraging (weekHeadline), and there's no deficit to stare at.
 */
export function YourWeekCard({ week }: { week: MyWeek }) {
  const headline = weekHeadline(week);
  const timeChip = headline.ahead ? formatDeltaChip(week.thisWeekSeconds - week.lastWeekToDateSeconds) : null;
  const streakBest = week.currentStreak > 0 && week.currentStreak >= week.longestStreak;

  // Headroom past the larger of the two so neither the fill nor the marker pins to the edge.
  const scale = Math.max(week.thisWeekSeconds, week.lastWeekSeconds) * 1.2;
  const fill = scale > 0 ? week.thisWeekSeconds / scale : 0;
  const marker = scale > 0 && week.lastWeekSeconds > 0 ? week.lastWeekSeconds / scale : null;

  return (
    <View style={styles.card}>
      {headline.ahead ? (
        <IconText icon="flame" trailing style={styles.big} iconColor={Colors.navEmber}>
          {headline.title}
        </IconText>
      ) : (
        <Text style={styles.big}>{headline.title}</Text>
      )}
      <Text style={[styles.sub, headline.ahead && styles.subAhead]}>{headline.sub}</Text>

      <View style={styles.tiles}>
        <Tile value={formatSessionDuration(week.thisWeekSeconds)} chip={timeChip} label="LOCKED IN" />
        <Tile value={String(week.currentStreak)} icon="streak" chip={streakBest ? '▲ best' : null} label="STREAK" />
        <Tile
          value={formatRankTier(week.tier, week.division)}
          valueColor={RANK_TIER_COLOR[week.tier]}
          chip={week.climbedThisWeek ? '▲ climbed' : null}
          quiet={week.climbedThisWeek ? null : 'holding'}
          label="RANK"
        />
      </View>

      <View
        style={styles.cmp}
        accessible
        accessibilityLabel={`This week ${formatSessionDuration(week.thisWeekSeconds)}${
          week.lastWeekSeconds > 0 ? `, last week ${formatSessionDuration(week.lastWeekSeconds)}` : ''
        }`}>
        <Text style={styles.cmpLabel}>vs last</Text>
        <View style={styles.bar}>
          <View style={[styles.fill, { width: `${Math.round(fill * 100)}%` }]} />
          {marker !== null ? <View style={[styles.last, { left: `${Math.round(marker * 100)}%` }]} /> : null}
        </View>
        <Text style={styles.cmpEnd}>{headline.ahead ? '↑' : ''}</Text>
      </View>
    </View>
  );
}

function Tile({
  value,
  icon,
  valueColor,
  chip,
  quiet,
  label,
}: {
  value: string;
  /** A glyph beside the value (the streak's flame). */
  icon?: IconName;
  valueColor?: string;
  chip: string | null;
  /** A neutral word in the chip's slot when there's no good news to show. */
  quiet?: string | null;
  label: string;
}) {
  return (
    <View style={styles.tile}>
      {icon ? (
        <IconText icon={icon} style={[styles.tileValue, valueColor ? { color: valueColor } : null]} iconColor={Colors.amber} numberOfLines={1}>
          {value}
        </IconText>
      ) : (
        <Text style={[styles.tileValue, valueColor ? { color: valueColor } : null]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
      )}
      <Text style={[styles.tileChip, !chip && styles.tileQuiet]}>{chip ?? quiet ?? ' '}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 16,
    padding: 14,
    overflow: 'hidden',
  },
  big: {
    fontFamily: Fonts.black,
    fontSize: 16,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.muted,
    marginTop: 3,
  },
  subAhead: {
    color: Colors.green,
  },
  tiles: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'rgba(10,7,22,0.5)',
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 6,
  },
  tileValue: {
    fontFamily: Fonts.black,
    fontSize: 15,
    color: Colors.ink,
  },
  tileChip: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.green,
    marginTop: 1,
  },
  tileQuiet: {
    color: Colors.spaceDim,
  },
  tileLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.3,
    color: Colors.muted,
    marginTop: 1,
  },
  cmp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 11,
  },
  cmpLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.spaceFaint,
    width: 40,
  },
  bar: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.spacePanel2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: Colors.navEmber,
  },
  // Last week's final value. A dashed left border, as in the mock's `.bar .last`.
  last: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 0,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.ink,
    opacity: 0.6,
  },
  cmpEnd: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.navEmber2,
    width: 10,
    textAlign: 'center',
  },
});
