import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

type AvatarProps = {
  label: string;
  size?: number;
  lit?: boolean;
  off?: boolean;
  overlap?: boolean;
  textColor?: string;
};

const SIZE = 32;

export function Avatar({ label, size = SIZE, lit = false, off = false, overlap = false, textColor }: AvatarProps) {
  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: lit ? Colors.achieverBg : Colors.disabled,
          borderColor: lit ? Colors.coral : Colors.twilight900,
        },
        overlap && { marginLeft: -8 },
        off && styles.off,
      ]}
    >
      <Text style={[styles.initial, { color: textColor ?? (lit ? Colors.achieverText : Colors.ink), fontSize: size * 0.375 }]}>
        {label.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  off: {
    opacity: 0.45,
  },
  initial: {
    fontFamily: Fonts.bodySemiBold,
  },
});
