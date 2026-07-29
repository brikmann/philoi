import { ActivityIndicator, Pressable, StyleSheet, Text, type GestureResponderEvent } from 'react-native';

import { Colors, Fonts, Radius, Shadow, Spacing } from '@/constants/theme';

type PrimaryButtonProps = {
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'cold';
};

export function PrimaryButton({ label, onPress, disabled, loading, variant = 'primary' }: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  const isCold = variant === 'cold';
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        isCold && styles.buttonCold,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={isCold ? Colors.coldButtonText : Colors.ink} />
      ) : (
        <Text style={[styles.label, isCold && styles.labelCold]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: Colors.coral,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.primaryButton,
  },
  buttonCold: {
    backgroundColor: Colors.coldChipBg,
    shadowOpacity: 0,
    elevation: 0,
  },
  disabled: {
    backgroundColor: Colors.disabled,
    shadowOpacity: 0,
    elevation: 0,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 16,
  },
  labelCold: {
    color: Colors.coldButtonText,
  },
});
