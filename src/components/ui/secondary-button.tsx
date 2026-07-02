import { Pressable, StyleSheet, Text, type GestureResponderEvent } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

type SecondaryButtonProps = {
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  /** Set when this button sits on a plum/dark card or screen — ink text is unreadable there. */
  onDark?: boolean;
  /**
   * Filled cream background instead of just an outline — an outline-only button on a dark
   * card reads as disabled/ghost even with correct text contrast, since it has so little
   * visual weight next to a solid PrimaryButton. Use for anything that needs to look
   * obviously tappable on a dark card (only meaningful combined with onDark).
   */
  solid?: boolean;
};

export function SecondaryButton({ label, onPress, disabled, onDark, solid }: SecondaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        onDark && styles.buttonOnDark,
        onDark && solid && styles.buttonSolidOnDark,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}>
      <Text
        style={[
          styles.label,
          onDark && styles.labelOnDark,
          onDark && solid && styles.labelSolidOnDark,
          disabled && styles.disabledLabel,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonOnDark: {
    borderColor: Colors.cream,
  },
  buttonSolidOnDark: {
    backgroundColor: Colors.cream,
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    borderColor: Colors.disabled,
  },
  label: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 16,
  },
  labelOnDark: {
    color: Colors.cream,
  },
  labelSolidOnDark: {
    color: Colors.plum,
  },
  disabledLabel: {
    color: Colors.muted,
  },
});
