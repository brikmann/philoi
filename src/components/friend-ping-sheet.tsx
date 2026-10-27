import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { SocialGlyph } from '@/components/ui/glyphs-social';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { friendStatusLine, type Friend } from '@/lib/api/friends';
import type { PingResult } from '@/types/database';

type FriendPingSheetProps = {
  visible: boolean;
  onClose: () => void;
  friend: Friend | null;
  lockedIn: boolean;
  /** Present only while locked in — the goal they're locked into, for the status line. */
  goalLabel: string | null;
  onPrimary: () => void;
  /** What the last send on this sheet actually did, or null before anything has been sent. The
   *  sheet SHOWS it — a nudge that was rate-limited or reached no device must not read the same as
   *  one that buzzed a phone (0172/0207). */
  lastPing: PingResult | null;
  /** An accepted/active H2H already exists with this friend (punchlist 2, §5) — the H2H row
   * becomes "View challenge" instead of offering to start a second one. */
  activeH2H: boolean;
  onChallengeH2H: () => void;
  onViewChallenge: () => void;
  onChallengeGroup: () => void;
};

/**
 * What each send outcome says on the row (0207 returns PingResult instead of void).
 *
 * 'sent_no_push' is the one that matters: roughly 6 in 10 profiles have no registered device, so
 * "nudged ✓" was routinely a claim about a banner that never appeared. The bell row IS there, and
 * saying so is both true and more useful than a tick.
 */
const PING_RESULT_COPY: Record<string, string> = {
  idle: 'Send a “lock in?” right now',
  sent: 'Nudged — it buzzed their phone ✓',
  sent_no_push: "Nudged — it's in their bell, but nothing buzzed",
  rate_limited: 'Already nudged them in the last 10 minutes',
};

// The friend ping sheet (design-mocks/21) — same branded bottom-sheet pattern as the campfire
// options sheet (mock 19): a header for the tapped friend + up to three actions. The primary
// action is state-dependent (join their live session vs. nudge them to start one); the two
// challenge rows deep-link into the challenge creator with this friend pre-selected.
export function FriendPingSheet({
  visible,
  onClose,
  friend,
  lockedIn,
  goalLabel,
  onPrimary,
  lastPing,
  activeH2H,
  onChallengeH2H,
  onViewChallenge,
  onChallengeGroup,
}: FriendPingSheetProps) {
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
              {lockedIn ? (
                <UiGlyph name="lock" size={19} color={Colors.navEmber} />
              ) : (
                <NavGlyph name="flame" size={19} color={Colors.navEmber} />
              )}
            </View>
            <View style={styles.actText}>
              <Text style={styles.actTitle}>{lockedIn ? 'Lock in with them' : 'Nudge to lock in'}</Text>
              <Text style={[styles.actSub, lastPing === 'rate_limited' && styles.actSubWarn]}>
                {lockedIn
                  ? `Join ${friend?.display_name ?? 'their'}'s session right now`
                  : (PING_RESULT_COPY[lastPing ?? 'idle'] ?? 'Send a “lock in?” right now')}
              </Text>
            </View>
            <UiGlyph name="forward" size={14} color={Colors.spaceFaint} />
          </Pressable>

          <Pressable style={styles.act} onPress={activeH2H ? onViewChallenge : onChallengeH2H}>
            <View style={[styles.actIcon, styles.iSword]}>
              <SocialGlyph name="swords" size={18} color={Colors.gold} />
            </View>
            <View style={styles.actText}>
              <Text style={styles.actTitle}>{activeH2H ? 'View challenge' : 'Challenge — head to head'}</Text>
              <Text style={styles.actSub}>{activeH2H ? "You're already racing them — see live standings" : 'Race for XP or lock-in time'}</Text>
            </View>
            <UiGlyph name="forward" size={14} color={Colors.spaceFaint} />
          </Pressable>

          <Pressable style={styles.act} onPress={onChallengeGroup}>
            <View style={[styles.actIcon, styles.iGroup]}>
              <SocialGlyph name="people" size={19} color={Colors.legend} />
            </View>
            <View style={styles.actText}>
              <Text style={styles.actTitle}>Challenge — as a group</Text>
              <Text style={styles.actSub}>Rally a campfire behind a goal</Text>
            </View>
            <UiGlyph name="forward" size={14} color={Colors.spaceFaint} />
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
    backgroundColor: Colors.spacePanel,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.spaceLine,
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spaceLine,
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
  actSubWarn: {
    color: Colors.navEmber2,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
    marginTop: 2,
  },
  subOn: {
    color: Colors.navEmber2,
  },
  act: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    padding: 12,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    marginBottom: 8,
  },
  actIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Space-kit tile tones (SpaceTile): ember for the one action, gold for the race, legend for the
  // group — replacing mock 21's warm-achiever / selected-purple / one-off teal tiles.
  iLock: {
    backgroundColor: 'rgba(255,122,47,0.14)',
  },
  iSword: {
    backgroundColor: 'rgba(255,209,102,0.12)',
  },
  iGroup: {
    backgroundColor: 'rgba(185,139,255,0.14)',
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
    fontSize: 11.5,
    color: Colors.spaceDim,
    marginTop: 2,
  },
});
