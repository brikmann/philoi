import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { SocialChallenge } from '@/types/database';

// THE ACCEPT / DECLINE / YOU'RE-IN ROW, in ONE place.
//
// This is lifted verbatim out of challenges-tab.tsx rather than reimplemented, because the
// campfire-as-chat pass (mock 101 §7) surfaces challenges as FEED EMBEDS as well as in the tab
// list, and "apply the R5 accept-flow fixes here too" is only true if it is the same code. Two
// copies of an accept button is how one of them ends up still painting the old colours.
//
// 🐛 THE THREE R5 FAULTS THIS ENCODES, kept here so they cannot be reintroduced by someone
// rebuilding the embed from the mock's HTML:
//
//  1. THE BUTTONS WERE OFF-BRAND. Accept was `Colors.ember` (#FFD27A) — the pale gold used for
//     ember TEXT and hairlines, never as a fill — carrying a near-white `Colors.ink` label. That
//     is the "muted weird yellow" from the recording, and it fails contrast outright. Decline was
//     the warm chip brown, which read olive-tan beside it. They are the app's primary/ghost pair
//     now, the same pair sell-flow and challenge-sent-sheet use.
//
//  2. THE GATE WAS THE CHALLENGE'S STATUS, NOT THE VIEWER'S INVITE. `status === 'pending'` is a
//     property of the RACE ("somebody was invited and hasn't answered"), not of this viewer, so
//     the buttons were shown to people who had already accepted and to the creator, who had no
//     participant row at all. Pressing Accept then hit respond_to_challenge_invite's
//     `where state = 'invited'`, matched nothing, and raised "No open invite for you on that
//     challenge." `my_state` is the right gate and is what is used here.
//
//  3. THERE WAS NO ACCEPTED STATE. Accepting re-fetched and drew the same two buttons again, so
//     the only feedback was a counter ticking somewhere else on the card.
//
// The SERVER half of (2) — create_group_challenge writing no row for its own creator — is
// migration 0147, already on prod. This component alone would only turn the error into a card
// with no buttons.

export function ChallengeAcceptRow({
  challenge,
  busy,
  onRespond,
}: {
  challenge: SocialChallenge;
  busy: boolean;
  onRespond: (accept: boolean) => void;
}) {
  if (challenge.my_state === 'invited') {
    return (
      <View style={styles.actions}>
        <View style={styles.half}>
          <PrimaryButton label="Accept" disabled={busy} loading={busy} onPress={() => onRespond(true)} />
        </View>
        <View style={styles.half}>
          <PrimaryButton label="Decline" variant="ghost" disabled={busy} onPress={() => onRespond(false)} />
        </View>
      </View>
    );
  }

  if (challenge.my_state === 'accepted' && (challenge.status === 'draft' || challenge.status === 'pending')) {
    // Deliberately NOT a disabled button. There is nothing left for this viewer to do until an
    // admin fires the gun, and a greyed-out Accept reads as something that failed rather than as
    // something that worked.
    return (
      <View style={styles.state}>
        <Ionicons name="checkmark-circle" size={15} color={Colors.green} />
        <Text style={styles.joined}>
          You&apos;re in
          {challenge.invited_count > 0 ? ` · waiting on ${challenge.invited_count} more` : ' · waiting on the gun'}
        </Text>
      </View>
    );
  }

  if (challenge.my_state === 'declined') {
    return (
      <View style={styles.state}>
        <Ionicons name="close-circle" size={15} color={Colors.muted} />
        <Text style={styles.declined}>You passed on this one</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  half: {
    flex: 1,
  },
  state: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: Spacing.two,
  },
  joined: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.green,
  },
  declined: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
});
