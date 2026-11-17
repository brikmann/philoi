import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MatchAvatar } from '@/components/matchmaking/match-avatar';
import { Colors, Fonts } from '@/constants/theme';
import type { GymBoardRow } from '@/lib/api/gym-spark';

// One row of THE BOARD (mock 402, v2 §3): place (medals for the podium), avatar, name + week streak
// (secondary), and the big XP number on the right ("1,240 XP"). `row.rank` is the server's place —
// unique since 0305 (row_number), so exactly one row wears each medal. A 0-XP row (your own, always
// returned) gets no medal even if it lands in the top three of a near-empty board. Your own row wears
// the ember border/tint wherever it sits.
// The Fitness pill's lift boards reuse it with `value` (the lift, e.g. "225 lb") and `subline`
// ("est 1RM") in place of the XP and the week streak; they pass the lift as `row.xp` so the medal
// rule (podium only for a non-zero value) holds unchanged.
// The same component draws the pinned copy at the bottom of the screen (`pinned`), so the two can
// never drift apart.

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export const GYM_BOARD_ROW_HEIGHT = 72;

/** "1,240" — grouped, whole XP. Shared with the story card so the two print the same number. */
export function formatBoardXp(xp: number): string {
  return Math.max(0, Math.round(xp)).toLocaleString('en-US');
}

export function GymBoardRowView({
  row,
  onPress,
  pinned = false,
  accessory = null,
  value,
  subline,
}: {
  row: GymBoardRow;
  onPress: (row: GymBoardRow) => void;
  pinned?: boolean;
  /** Drawn after the XP — the story-share button on your own row. */
  accessory?: ReactNode;
  /** Replaces the big "1,240 XP" — `unit` is drawn small after `text`, like " XP". */
  value?: { text: string; unit: string; a11y: string };
  /** Replaces the week-streak line. */
  subline?: string;
}) {
  const medal = row.xp > 0 ? MEDALS[row.rank] : undefined;
  const name = row.display_name || (row.handle ? `@${row.handle}` : 'Someone');
  const xpText = formatBoardXp(row.xp);
  const bigText = value ? value.text : xpText;
  const bigUnit = value ? value.unit : ' XP';
  const second = subline ?? (row.week_streak > 0 ? `🔥 ${row.week_streak} wk streak` : 'No streak yet');
  const a11yValue = value ? value.a11y : `${xpText} XP, ${row.week_streak} week streak`;

  return (
    <Pressable
      onPress={() => onPress(row)}
      style={({ pressed }) => [
        styles.row,
        row.is_me && styles.rowMe,
        pinned && styles.rowPinned,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Rank ${row.rank}, ${name}${row.is_me ? ', you' : ''}, ${a11yValue}`}>
      <View style={styles.rankCell}>
        {medal ? (
          <Text style={styles.medal}>{medal}</Text>
        ) : (
          <Text style={[styles.rank, row.is_me && styles.rankMe]}>{row.rank}</Text>
        )}
      </View>

      <MatchAvatar name={name} avatarUrl={row.avatar_url} size={48} />

      <View style={styles.middle}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {row.is_me ? <Text style={styles.youTag}>you</Text> : null}
        </View>
        <Text style={styles.streak} numberOfLines={1}>
          {second}
        </Text>
      </View>

      <View style={styles.countCell}>
        <Text style={styles.count} numberOfLines={1} adjustsFontSizeToFit>
          {bigText}
          {bigUnit ? <Text style={styles.countUnit}>{bigUnit}</Text> : null}
        </Text>
      </View>
      {accessory}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    height: GYM_BOARD_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.spaceLine,
  },
  // Mock 402's highlighted row: a warm tint inside an ember hairline, corners rounded.
  rowMe: {
    backgroundColor: '#2A1726',
    borderWidth: 1,
    borderColor: 'rgba(255,122,47,0.55)',
    // The base row's hairline divider sets borderBottomColor, which outranks borderColor.
    borderBottomColor: 'rgba(255,122,47,0.55)',
    borderRadius: 14,
  },
  // The pinned copy floats over the list's bottom edge, so it needs its own shadow to read as lifted.
  rowPinned: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 10,
  },
  pressed: {
    opacity: 0.7,
  },
  rankCell: {
    width: 30,
    alignItems: 'center',
  },
  medal: {
    fontSize: 22,
  },
  rank: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.muted,
  },
  rankMe: {
    color: Colors.navEmber2,
  },
  middle: {
    flex: 1,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  name: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
  },
  youTag: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.navEmber2,
  },
  streak: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  countCell: {
    alignItems: 'flex-end',
    minWidth: 56,
    maxWidth: 120,
  },
  count: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 22,
    color: Colors.ink,
  },
  countUnit: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.spaceDim,
  },
});
