import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

type MatchAvatarProps = {
  name: string;
  avatarUrl: string | null;
  size?: number;
  live?: boolean;
};

// Photo when they have one, initials when they don't — and a plain green dot for "locked in now".
// No halo, no rank ring: a match card is a person, not a placement.
export function MatchAvatar({ name, avatarUrl, size = 46, live = false }: MatchAvatarProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
  const dot = Math.max(10, Math.round(size * 0.24));

  return (
    <View style={{ width: size, height: size }}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={[styles.round, { width: size, height: size, borderRadius: size / 2 }]} />
      ) : (
        <View style={[styles.round, styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[styles.initials, { fontSize: size * 0.33 }]}>{initials || '?'}</Text>
        </View>
      )}
      {live ? (
        <View style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2 }]} accessibilityLabel="Locked in now" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  round: {
    backgroundColor: Colors.disabled,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  dot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    backgroundColor: Colors.green,
    borderWidth: 2,
    borderColor: Colors.card,
  },
});
