import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ShareCardFrame, fitFontSize } from '@/components/share-card-frame';
import { IconText } from '@/components/ui/icon';
import { Colors, Fonts } from '@/constants/theme';
import type { GymBoardRow, GymBoardWindow } from '@/lib/api/gym-spark';

// THE GYM SPARK · the Board's story card (CODE_PROMPT §6, mock 402). Not a new card system: it is
// ShareCardFrame — the same ground, ray fan and "@handle · philoi.app" footer every share card wears
// — with the Board's three numbers as the hero. Only the stat content differs.
//
// The numbers are exactly the row the Board drew (get_gym_board): rank, sessions, week streak.
// Nothing derived, nothing rounded up.

const GOLD = '#FFD166';

export function boardStoryKick(window: GymBoardWindow): string {
  return window === 'week' ? 'THIS WEEK’S BOARD' : 'ALL-TIME BOARD';
}

export const BoardStoryCard = forwardRef<View, { row: GymBoardRow; window: GymBoardWindow }>(function BoardStoryCard(
  { row, window },
  ref
) {
  const rankText = `#${row.rank}`;
  const sessions = `${row.sessions} lock-in${row.sessions === 1 ? '' : 's'}`;
  return (
    <ShareCardFrame ref={ref} kick={boardStoryKick(window)} kickColor={GOLD} kickIcon="trophy" handle={row.handle}>
      <Text style={[styles.rank, { fontSize: fitFontSize(rankText, 132, 84, 3) }]}>{rankText}</Text>
      <Text style={styles.window}>{window === 'week' ? 'this week' : 'all-time'}</Text>
      <View style={styles.statRow}>
        <Text style={styles.stat}>{sessions}</Text>
        {row.week_streak > 0 ? (
          <>
            <Text style={styles.dot}>·</Text>
            <IconText icon="streak" iconColor={Colors.amber} style={styles.stat}>
              {`${row.week_streak} wk streak`}
            </IconText>
          </>
        ) : null}
      </View>
      {/* Printed, not linked — same rule as the lift sticker: nothing on a shared Story is tappable. */}
      <Text style={styles.back}>think you can match it? · philoi.app</Text>
    </ShareCardFrame>
  );
});

const styles = StyleSheet.create({
  rank: {
    fontFamily: Fonts.black,
    color: Colors.ink,
    letterSpacing: -2,
    textAlign: 'center',
  },
  window: {
    marginTop: -6,
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    letterSpacing: 2,
    color: GOLD,
    textTransform: 'uppercase',
  },
  statRow: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  stat: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ink,
  },
  dot: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.muted,
  },
  back: {
    marginTop: 26,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
  },
});
