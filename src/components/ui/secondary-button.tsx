import { Pressable, StyleSheet, Text, type GestureResponderEvent } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

type SecondaryButtonProps = {
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
};

export function SecondaryButton({ label, onPress, disabled }: SecondaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}>
      <Text style={[styles.label, disabled && styles.disabledLabel]}>{label}</Text>
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
  disabledLabel: {
    color: Colors.muted,
  },
});
