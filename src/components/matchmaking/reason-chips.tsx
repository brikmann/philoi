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
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  // The strongest shared trait gets the ember wash, the way mock 299 lights the first chip.
  chipHot: {
    backgroundColor: 'rgba(255,122,47,0.12)',
    borderColor: Colors.navEmber,
  },
  text: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.spaceDim,
  },
  textHot: {
    color: Colors.navEmber2,
  },
});
