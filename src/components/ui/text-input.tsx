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
  },
  focused: {
    borderColor: Colors.coral,
  },
});
