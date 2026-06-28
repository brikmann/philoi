import { ActivityIndicator, Pressable, StyleSheet, Text, type GestureResponderEvent } from 'react-native';

import { Colors, Fonts, Radius, Shadow, Spacing } from '@/constants/theme';

type PrimaryButtonProps = {
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
};

export function PrimaryButton({ label, onPress, disabled, loading }: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}>
      {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.label}>{label}</Text>}
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
  disabled: {
    backgroundColor: Colors.disabled,
    shadowOpacity: 0,
    elevation: 0,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    color: '#FFFFFF',
    fontFamily: Fonts.display,
    fontSize: 16,
  },
});
