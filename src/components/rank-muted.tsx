import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// "RANK MUTED" — what a private user's rank block looks like to someone who isn't their friend.
// (CODE_PROMPT_leaderboard_private.md §4, migration 0170)
//
// THIS IS NOT AN ERROR STATE AND MUST NOT LOOK LIKE ONE. The person is fine, their rank exists,
// they are still climbing — you simply do not get to see the number. So it renders as a deliberate,
// finished-looking block in place of the hexagon and the XP bar, not as a blank space, a spinner,
// or a zeroed-out badge. A blank would read as "this app is broken"; a zeroed badge would be a lie
// (see UserRank's union comment — a spoofed rank is the one outcome the spec rules out).
//
// NAME, HANDLE AND AVATAR ARE UNAFFECTED and stay above this — Private mode hides the COMPETITIVE
// NUMBERS, not the person. It is a visibility wall on the leaderboard, not a block.
//
// NO "add them as a friend to see their rank" SELL. The spec leaves that out on purpose: turning
// someone's privacy setting into a prompt to befriend them makes their boundary into a conversion
// funnel. If Noah wants it later it goes here, once.
export function RankMuted({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <View style={styles.glyph}>
        <Ionicons name="lock-closed" size={16} color={Colors.textTertiary} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>Rank muted</Text>
        <Text style={styles.sub}>They&apos;re climbing privately.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: Spacing.twelve,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.card,
    borderWidth: 1,
    // Dashed, so it reads as "deliberately withheld" rather than as a card that failed to load.
    borderStyle: 'dashed',
    borderColor: Colors.lineStrong,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  wrapCompact: {
    paddingVertical: Spacing.two,
  },
  glyph: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  text: {
    flex: 1,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.muted,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
    marginTop: 2,
  },
});
