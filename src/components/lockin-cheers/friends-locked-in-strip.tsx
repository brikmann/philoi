import { Pressable, StyleSheet, Text } from 'react-native';

import { FriendFaceStack, UnreadBadge } from '@/components/lockin-cheers/friend-faces';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { FriendLockedIn } from '@/lib/api/lockin-cheers';

/**
 * Home's "{N} friends locked in now" strip (mock 298, panel 0) — directly above the Lock In
 * button, so a member who isn't locked in can still cheer a friend who is. Renders nothing when
 * nobody is live: an empty strip would only advertise that.
 */
export function FriendsLockedInStrip({
  friends,
  unread,
  onPress,
}: {
  friends: FriendLockedIn[];
  unread: number;
  onPress: () => void;
}) {
  if (friends.length === 0) return null;
  const label = friends.length === 1 ? `${friends[0].name} is locked in now` : `${friends.length} friends locked in now`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.strip, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Cheer them on.`}>
      <FriendFaceStack people={friends} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.cta}>Cheer →</Text>
      <UnreadBadge count={unread} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.button,
    paddingVertical: 10,
    paddingHorizontal: 13,
    marginBottom: 11,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
    marginLeft: Spacing.one,
  },
  cta: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.amber,
  },
});

