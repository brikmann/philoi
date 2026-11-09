import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

/**
 * A circular person (ss0 §9: avatars are circular): their photo when they have one, their initial
 * on the plum panel when they don't. `lit` rings it in ember — you, or the opponent you've picked.
 */
export function PersonDisc({
  name,
  avatarUrl,
  size = 36,
  lit = false,
}: {
  name: string;
  avatarUrl: string | null | undefined;
  size?: number;
  lit?: boolean;
}) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <View
      style={[
        styles.disc,
        { width: size, height: size, borderRadius: size / 2 },
        lit && styles.lit,
      ]}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />
      ) : (
        <Text style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}>{initial}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1.5,
    borderColor: Colors.spaceLine,
    overflow: 'hidden',
  },
  lit: {
    borderColor: Colors.navEmber,
  },
  initial: {
    fontFamily: Fonts.black,
    color: Colors.ink,
  },
});
