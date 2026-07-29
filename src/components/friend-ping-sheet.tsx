import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { friendStatusLine, type Friend } from '@/lib/api/friends';

type FriendPingSheetProps = {
  visible: boolean;
  onClose: () => void;
  friend: Friend | null;
  lockedIn: boolean;
  /** Present only while locked in — the goal they're locked into, for the status line. */
  goalLabel: string | null;
  onPrimary: () => void;
  onChallengeH2H: () => void;
  onChallengeGroup: () => void;
};

// The friend ping sheet (design-mocks/21) — same branded bottom-sheet pattern as the campfire
// options sheet (mock 19): a header for the tapped friend + up to three actions. The primary
// action is state-dependent (join their live session vs. nudge them to start one); the two
// challenge rows deep-link into the challenge creator with this friend pre-selected.
export function FriendPingSheet({ visible, onClose, friend, lockedIn, goalLabel, onPrimary, onChallengeH2H, onChallengeGroup }: FriendPingSheetProps) {
  // Locked-in status uses the live goal; otherwise the shared rank + streak/cold line.
  const status = friend ? friendStatusLine(friend, lockedIn ? (goalLabel ?? 'a session') : null) : '';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={styles.sheet}>
          <View style={styles.grab} />

          <View style={styles.header}>
            <Avatar label={friend?.display_name ?? '?'} size={44} lit={lockedIn} />
            <View>
              <Text style={styles.name}>{friend?.display_name ?? '…'}</Text>
              <Text style={[styles.sub, lockedIn && styles.subOn]}>{status}</Text>
            </View>
          </View>

          {/* Primary — state-dependent: join their live session, or nudge them to start one. */}
          <Pressable style={styles.act} onPress={onPrimary}>
            <View style={[styles.actIcon, styles.iLock]}>
              <Ionicons name={lockedIn ? 'lock-closed' : 'flame'} size={19} color={Colors.coral} />
            </View>
            <View style={styles.actText}>
              <Text style={styles.actTitle}>{lockedIn ? 'Lock in with them' : 'Nudge to lock in'}</Text>
              <Text style={styles.actSub}>
                {lockedIn ? `Join ${friend?.display_name ?? 'their'}'s session right now` : 'Send a 🔥 “lock in?” right now'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </Pressable>

          <Pressable style={styles.act} onPress={onChallengeH2H}>
            <View style={[styles.actIcon, styles.iSword]}>
              <MaterialCommunityIcons name="sword-cross" size={18} color={Colors.ember} />
            </View>
            <View style={styles.actText}>
              <Text style={styles.actTitle}>Challenge — head to head</Text>
              <Text style={styles.actSub}>Race for XP or lock-in time</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </Pressable>

          <Pressable style={styles.act} onPress={onChallengeGroup}>
            <View style={[styles.actIcon, styles.iGroup]}>
              <Ionicons name="people" size={19} color="#7FD0E0" />
            </View>
            <View style={styles.actText}>
              <Text style={styles.actTitle}>Challenge — as a group</Text>
              <Text style={styles.actSub}>Rally a campfire behind a goal</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(8,6,12,0.62)',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: 14,
    paddingBottom: 18,
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.trackAlt,
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 4,
    paddingBottom: 14,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
    marginTop: 2,
  },
  subOn: {
    color: Colors.achieverText,
  },
  act: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    padding: 12,
    borderRadius: Radius.input,
    backgroundColor: Colors.cardDark,
    marginBottom: 9,
  },
  actIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Tile backgrounds per mock 21: lock=warm achiever, sword=selected purple, group=dark teal (one-off).
  iLock: {
    backgroundColor: Colors.achieverBg,
  },
  iSword: {
    backgroundColor: Colors.selectedBg,
  },
  iGroup: {
    backgroundColor: '#20303A',
  },
  actText: {
    flex: 1,
  },
  actTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  actSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
    marginTop: 2,
  },
});
