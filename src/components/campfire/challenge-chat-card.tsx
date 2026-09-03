import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { joinCampfireChallenge } from '@/lib/api/social-challenges';
import { getErrorMessage } from '@/lib/errors';

// THE CHALLENGE CARD IN THE CHAT (CHALLENGE_CINDY_SCOPING.md §Distribution, migration 0162).
//
// §Distribution asks for two things when a challenge is hosted for a whole campfire: a
// notification to every member, AND the challenge posted "as a card in the campfire chat (join CTA
// inline)". The notification is notify_event('challenge_hosted'); this is the card.
//
// WHY IT IS A REAL MESSAGE ROW AND NOT A SYNTHETIC FEED ITEM. host_campfire_challenge inserts into
// `messages` with attach_kind 'challenge' and attach_ref_id = the challenge id, so the card rides
// the campfire message pipeline whole — realtime delivery, unread counts, the timeline's own
// ordering, delete-my-message. §Distribution's "first-class chat item" is a literal requirement and
// this is what satisfies it; a parallel feed of pseudo-messages would have needed every one of
// those behaviours rebuilt.
//
// 🔒 WHAT IT DELIBERATELY DOES NOT DO: read the challenge. A member who has not joined yet is not
// on the roster, so get_my_social_challenges does not necessarily return it to them — a card that
// fetched its own subject would render blank for exactly the people the join CTA is FOR. The
// message body already carries the headline the host posted ("1000 pushups — who's in?"), so the
// card renders from what it has and puts the detail one tap away on the challenge screen. No read,
// no spinner, no empty state.
//
// JOINING IS OPEN, HOSTING IS NOT. join_campfire_challenge admits any member of the campfire;
// host_campfire_challenge admits only an owner or admin. That asymmetry IS the §Opt-in model — an
// open challenge posts to the fire and people put themselves in it — so this button is shown to
// everyone and gated by nothing on the client.

export function ChallengeChatCard({
  challengeId,
  headline,
  isOwn,
}: {
  challengeId: string;
  /** The host's own line, from the message body. Null when it was deleted or empty. */
  headline: string | null;
  /** The host sees their own card. They are already enrolled, so there is nothing to join. */
  isOwn: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => router.push(`/challenge-info/${challengeId}`);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      await joinCampfireChallenge(challengeId);
      setJoined(true);
    } catch (e) {
      // Shown inline rather than in an Alert: the refusals this can return are ordinary and
      // legible ("That challenge is over", "belongs to a campfire you're not in"), and a modal for
      // a race that closed while you scrolled is heavier than the news deserves.
      setError(getErrorMessage(e, "That didn't go through."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`Open challenge${headline ? `: ${headline}` : ''}`}
        style={styles.head}>
        <View style={styles.badge}>
          <Ionicons name="bonfire" size={13} color={Colors.ember} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.kicker}>Campfire challenge</Text>
          {headline ? (
            <Text style={styles.headline} numberOfLines={2}>
              {headline}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={15} color={Colors.textTertiary} />
      </Pressable>

      {joined ? (
        // Same shape as ChallengeAcceptRow's accepted state, and for the same reason: a greyed-out
        // Join reads as something that failed rather than as something that worked.
        <View style={styles.state}>
          <Ionicons name="checkmark-circle" size={15} color={Colors.green} />
          <Text style={styles.joined}>You&apos;re in — it&apos;s on your lock-in menu now</Text>
        </View>
      ) : isOwn ? (
        <View style={styles.state}>
          <Ionicons name="megaphone-outline" size={15} color={Colors.textTertiary} />
          <Text style={styles.hosting}>You&apos;re hosting this one</Text>
        </View>
      ) : (
        <PrimaryButton label="Join" disabled={busy} loading={busy} onPress={join} />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.4)',
    borderRadius: Radius.card,
    padding: Spacing.twelve,
    marginBottom: Spacing.two,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(242,163,60,0.14)',
  },
  headText: { flex: 1, gap: 1 },
  kicker: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
  },
  headline: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  state: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: Spacing.two - 2,
  },
  joined: { fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.green },
  hosting: { fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.textTertiary },
  error: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.danger },
});
