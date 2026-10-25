import { StyleSheet, Text } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';

// The promise the whole feature rests on, said once in plain words on the shelf.
export function SafetyNote() {
  return (
    <Text style={styles.note}>
      🛡 No DMs from strangers — a match unlocks cheer/message only after you both add each other. Block & report on every card.
    </Text>
  );
}

const styles = StyleSheet.create({
  note: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textTertiary,
    marginTop: Spacing.twelve,
    paddingHorizontal: Spacing.one,
  },
});
