import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FriendFaceStack } from '@/components/lockin-cheers/friend-faces';
import { Colors, Fonts } from '@/constants/theme';
import { activeNowLine, type PeopleActiveNow } from '@/lib/api/home';

/**
 * PULSE · LOCKED IN RIGHT NOW (mock 334, migration 0290) — the room, felt. Faces + "23 locked in now"
 * + "Maya · Studying · Jordan · Gym +21" across your friends and every club you're in, counted once.
 * Co-presence, not a board: no order beyond "newest first", no numbers attached to anyone.
 *
 * Tapping it opens the live cheers sheet (onPress), the same place the old live row's 💬 went.
 * Nobody live → a quiet invitation instead of a zero. Your own live status hidden → say that, since
 * the read is reciprocal and an empty strip would otherwise read as an empty room.
 */
export function LockedInNowStrip({ active, onPress }: { active: PeopleActiveNow; onPress?: () => void }) {
  if (active.youHidden) {
    return (
      <View style={styles.card}>
        <Text style={styles.quiet}>You’ve hidden your live status, so you won’t see who’s locked in. Turn it on in Settings.</Text>
      </View>
    );
  }
  if (active.count === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.quiet}>Nobody’s locked in this minute — start a session and you’re the first.</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${active.count} of your people locked in now`}
      style={({ pressed }) => [styles.card, styles.row, pressed && styles.pressed]}>
      <FriendFaceStack people={active.sample} size={32} max={5} ringColor={Colors.spacePanel} />
      <View style={styles.text}>
        <Text style={styles.count}>{active.count} locked in now</Text>
        <Text style={styles.line} numberOfLines={1}>
          {activeNowLine(active)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: 'rgba(26,18,48,0.65)',
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
  text: {
    flex: 1,
    marginLeft: 11,
  },
  count: {
    fontFamily: Fonts.black,
    fontSize: 15,
    color: Colors.ink,
  },
  line: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
    marginTop: 1,
  },
  quiet: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
});
