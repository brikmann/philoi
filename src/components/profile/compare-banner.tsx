import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { winRate } from '@/lib/api/trophy-hall';
import type { TrophyHall } from '@/types/database';

// §4 — the compare banner on someone else's profile (mock Frame 2).
//
// The hall's whole argument is that earned things are comparable in a way cosmetics are not, so the
// banner states the comparison outright instead of leaving the viewer to count tiles.
//
// IT MUST NOT BE A PUT-DOWN. The copy always names what they are ahead on AND what you are, when
// both exist — a banner that only ever said "you're behind" would make visiting a strong profile
// feel like a punishment, which is the opposite of the challenge CTA sitting under it.

type Line = { text: string; mine: boolean };

export function CompareBanner({ mine, theirs, name }: { mine: TrophyHall; theirs: TrophyHall; name: string }) {
  const lines = compareLines(mine, theirs);
  if (lines.length === 0) return null;

  const ahead = lines.filter((l) => !l.mine);
  const yours = lines.filter((l) => l.mine);
  const firstName = name.split(' ')[0] || name;

  return (
    <View style={styles.banner}>
      <Ionicons name="git-compare" size={15} color={Colors.amber} />
      <Text style={styles.text}>
        {ahead.length > 0 ? (
          <>
            <Text style={styles.strong}>{firstName} is ahead: </Text>
            {joinClauses(ahead.map((l) => l.text))}.
          </>
        ) : null}
        {ahead.length > 0 && yours.length > 0 ? ' ' : null}
        {yours.length > 0 ? (
          <>
            {ahead.length > 0 ? 'You lead on ' : <Text style={styles.strong}>You&rsquo;re ahead: </Text>}
            {joinClauses(yours.map((l) => l.text))}
            {ahead.length > 0 ? '.' : '.'}
          </>
        ) : null}
      </Text>
    </View>
  );
}

/**
 * The three axes worth comparing — trophies, streak, win rate. Each is emitted only when there is a
 * real gap: "tied on streak" is noise, and a banner that lists every metric regardless of outcome
 * stops being a summary.
 */
export function compareLines(mine: TrophyHall, theirs: TrophyHall): Line[] {
  const lines: Line[] = [];

  const myTrophies = mine.relics.length;
  const theirTrophies = theirs.relics.length;
  if (myTrophies !== theirTrophies) {
    const diff = Math.abs(myTrophies - theirTrophies);
    lines.push({ text: `${diff} more ${diff === 1 ? 'trophy' : 'trophies'}`, mine: myTrophies > theirTrophies });
  }

  const myStreak = mine.stats.longest_streak;
  const theirStreak = theirs.stats.longest_streak;
  if (myStreak !== theirStreak) {
    const diff = Math.abs(myStreak - theirStreak);
    lines.push({ text: `a ${diff}-day-longer streak`, mine: myStreak > theirStreak });
  }

  // Only comparable when BOTH records are visible and both have decided duels. A hidden record or
  // an undefeated 0-0 would otherwise produce a confident claim from nothing.
  const myRate = mine.record ? winRate(mine.record.won, mine.record.lost) : null;
  const theirRate = theirs.record ? winRate(theirs.record.won, theirs.record.lost) : null;
  if (myRate !== null && theirRate !== null && myRate !== theirRate) {
    lines.push({
      text: `a higher win rate (${Math.max(myRate, theirRate)}% vs ${Math.min(myRate, theirRate)}%)`,
      mine: myRate > theirRate,
    });
  }

  return lines;
}

function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: Spacing.twelve,
    backgroundColor: 'rgba(242,163,60,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.28)',
    borderRadius: Radius.card,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  text: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.ink,
  },
  strong: {
    fontFamily: Fonts.bodyBold,
  },
});
