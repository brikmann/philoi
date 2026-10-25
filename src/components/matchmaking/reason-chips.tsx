import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { MatchReason } from '@/types/social';

// The reasons lead, the number follows (CODE_PROMPT_matchmaking.md) — so these get the warm chip
// and the score gets nothing. Capped at four: past that a card stops reading as "why" and starts
// reading as a list of tags.
export function ReasonChips({ reasons, max = 4 }: { reasons: MatchReason[]; max?: number }) {
  if (reasons.length === 0) return null;
  return (
    <View style={styles.row}>
      {reasons.slice(0, max).map((r, i) => (
        <View key={`${r.key}-${i}`} style={[styles.chip, i === 0 && styles.chipHot]}>
          <Text style={[styles.text, i === 0 && styles.textHot]} numberOfLines={1}>
            {r.emoji ? `${r.emoji} ` : ''}
            {r.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: Spacing.twelve,
  },
  chip: {
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  // The strongest shared trait gets the ember wash, the way mock 299 lights the first chip.
  chipHot: {
    backgroundColor: 'rgba(224,97,44,0.09)',
    borderColor: 'rgba(242,163,60,0.28)',
  },
  text: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.muted,
  },
  textHot: {
    color: Colors.warmSubtext,
  },
});
