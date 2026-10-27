import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
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
  /** A glyph after the label, in the label's colour (the ✓ on "Locked in today"). */
  icon?: IconName;
};

export function SecondaryButton({ label, onPress, disabled, onDark, solid, icon }: SecondaryButtonProps) {
  // Mirrors the label style stack below, so the icon is always the colour of the words beside it.
  const labelColor = disabled ? Colors.muted : onDark ? (solid ? Colors.plum : Colors.cream) : Colors.ink;
  const text = (
    <Text
      style={[
        styles.label,
        onDark && styles.labelOnDark,
        onDark && solid && styles.labelSolidOnDark,
        disabled && styles.disabledLabel,
      ]}>
      {label}
    </Text>
  );
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
      {icon ? (
        <View style={styles.labelRow}>
          {text}
          <Icon name={icon} size={18} color={labelColor} />
        </View>
      ) : (
        text
      )}
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
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
