import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

// Avatars for lock-in cheers (mock 298). Photo when there is one, the initials otherwise — the
// same fallback body-double-strip uses, so a friend reads the same on both lock-in surfaces.

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function FriendFace({
  name,
  avatarUrl,
  size,
  live = false,
  ringColor = Colors.card,
}: {
  name: string;
  avatarUrl: string | null;
  size: number;
  /** The pulsing-green "locked in now" dot. */
  live?: boolean;
  ringColor?: string;
}) {
  const dot = Math.max(9, Math.round(size * 0.3));
  return (
    <View style={{ width: size, height: size }}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={[styles.face, { width: size, height: size, borderRadius: size / 2 }]} />
      ) : (
        <View style={[styles.face, styles.initialsFace, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[styles.initials, { fontSize: Math.round(size * 0.34) }]}>{initials(name)}</Text>
        </View>
      )}
      {live && (
        <View
          style={[
            styles.dot,
            { width: dot, height: dot, borderRadius: dot / 2, borderColor: ringColor },
          ]}
        />
      )}
    </View>
  );
}

/** Up to `max` overlapping faces. */
export function FriendFaceStack({
  people,
  size = 26,
  max = 4,
  ringColor = Colors.card,
}: {
  people: { userId: string; name: string; avatarUrl: string | null }[];
  size?: number;
  max?: number;
  ringColor?: string;
}) {
  return (
    <View style={styles.stack}>
      {people.slice(0, max).map((p, i) => (
        <View
          key={p.userId}
          style={[
            styles.stackItem,
            { marginLeft: i === 0 ? 0 : -Math.round(size * 0.3), borderColor: ringColor, borderRadius: size / 2 + 2 },
          ]}>
          <FriendFace name={p.name} avatarUrl={p.avatarUrl} size={size} />
        </View>
      ))}
    </View>
  );
}

/** The unread count bubble on the pill corner. Renders nothing at zero. */
export function UnreadBadge({ count, ringColor = Colors.cream }: { count: number; ringColor?: string }) {
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, { borderColor: ringColor }]} accessibilityLabel={`${count} unread`}>
      <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  face: {
    backgroundColor: Colors.disabled,
  },
  initialsFace: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.plum,
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
  },
  stack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackItem: {
    borderWidth: 2,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 19,
    height: 19,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: Colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.ink,
  },
});
