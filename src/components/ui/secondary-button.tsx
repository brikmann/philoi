import { Pressable, StyleSheet, Text, type GestureResponderEvent } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

type SecondaryButtonProps = {
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  /** Set when this button sits on a plum/dark card or screen — ink text is unreadable there. */
  onDark?: boolean;
};

export function SecondaryButton({ label, onPress, disabled, onDark }: SecondaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        onDark && styles.buttonOnDark,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}>
      <Text style={[styles.label, onDark && styles.labelOnDark, disabled && styles.disabledLabel]}>{label}</Text>
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
  disabledLabel: {
    color: Colors.muted,
  },
});
