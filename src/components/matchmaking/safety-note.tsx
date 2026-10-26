import { StyleSheet, Text, View } from 'react-native';

import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';

// The promise the whole feature rests on, said once in plain words on the shelf. The 🛡 that led it
// was a UI emoji standing in for an icon, so it's the family's lock glyph now.
export function SafetyNote() {
  return (
    <View style={styles.wrap}>
      <UiGlyph name="lock" size={13} color={Colors.spaceFaint} />
      <Text style={styles.note}>
        No DMs from strangers — a match unlocks cheer/message only after you both add each other. Block & report on every card.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: Spacing.twelve,
  },
  note: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.spaceDim,
  },
});
