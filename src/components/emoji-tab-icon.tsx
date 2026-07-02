import { StyleSheet, Text, View } from 'react-native';

import { Colors, Radius } from '@/constants/theme';

type EmojiTabIconProps = {
  emoji: string;
  focused: boolean;
  size?: number;
};

// Emoji are full-color glyphs — unlike FlameIcon's monochrome SVG, they ignore the tab bar's
// tint-color prop entirely, so focus state needs its own signal. Mirrors FlameIcon's
// background-square treatment for a consistent focused/unfocused language across all tab icons.
export function EmojiTabIcon({ emoji, focused, size = 26 }: EmojiTabIconProps) {
  return (
    <View style={[styles.square, { width: size + 10, height: size + 10 }, focused && styles.squareFocused]}>
      <Text style={{ fontSize: size * 0.8 }}>{emoji}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  square: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.input,
  },
  squareFocused: {
    backgroundColor: Colors.achieverBg,
  },
});
