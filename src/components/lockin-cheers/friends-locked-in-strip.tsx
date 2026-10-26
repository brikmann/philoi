import { Pressable, StyleSheet, Text } from 'react-native';

import { FriendFaceStack, UnreadBadge } from '@/components/lockin-cheers/friend-faces';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { FriendLockedIn } from '@/lib/api/lockin-cheers';

/**
 * Home's "{N} friends locked in now" strip (mock 298, panel 0) — directly above the Lock In
 * button, so a member who isn't locked in can still cheer or message a friend who is — and read
 * their replies, since a friend you wrote to is live and so is listed here. Renders nothing when
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
  const live = friends.filter((f) => f.live);
  if (friends.length === 0) return null;
  const label =
    live.length === 0
      ? `Reply to ${friends[0].name}`
      : live.length === 1
        ? `${live[0].name} is locked in now`
        : `${live.length} friends locked in now`;

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
      <Text style={styles.cta}>Cheer</Text>
      <UiGlyph name="forward" size={12} color={Colors.navEmber2} />
      <UnreadBadge count={unread} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
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
    fontSize: 11.5,
    color: Colors.navEmber2,
  },
});


