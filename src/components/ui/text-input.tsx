import { useState } from 'react';
import { StyleSheet, TextInput as RNTextInput, type TextInputProps } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

export function TextInput({ style, onFocus, onBlur, ...rest }: TextInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <RNTextInput
      style={[styles.input, focused && styles.focused, style]}
      placeholderTextColor={Colors.muted}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.input,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontFamily: Fonts.body,
    fontSize: 16,
    color: Colors.ink,
    // Explicit, not default. iOS drew every PLACEHOLDER spread out ("S e a r c h") while typed
    // text was fine. RN only puts a kern attribute on the input when letterSpacing is set, and
    // the placeholder copies those attributes — so with no value iOS was free to track the
    // placeholder itself. 0 pins it. The raw RN TextInputs elsewhere carry the same line.
    letterSpacing: 0,
  },
  focused: {
    borderColor: Colors.coral,
  },
});
