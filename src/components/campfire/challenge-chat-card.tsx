import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

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
// 🔒 WHAT IT DELIBERATELY DOES NOT DO: read the challenge. The message body already carries the
// headline the host posted ("1000 pushups — who's in?"), so the card renders from what it has and
// puts the detail one tap away on the challenge screen. No read, no spinner, no empty state — and
// one card per message never costs one query per message.
//
// 🔴 AN ANNOUNCEMENT, NOT A SECOND JOIN. This card used to carry its own Join button and a local
// `joined` flag, beside the pinned ActiveChallengeStrip's Join, so the campfire had two join
// surfaces that kept separate state: join from the strip and the card still offered Join; join
// from the card and nothing else knew. The strip is the one live surface now (roster-aware via
// get_circle_active_challenges, flips to "You're in"), and this card is the record of when the
// challenge was posted. Tapping it opens the same challenge-info screen the strip and the
// Challenges → Friends row open.

export function ChallengeChatCard({
  challengeId,
  headline,
  isOwn,
}: {
  challengeId: string;
  /** The host's own line, from the message body. Null when it was deleted or empty. */
  headline: string | null;
  /** The host sees their own card. */
  isOwn: boolean;
}) {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/challenge-info/${challengeId}`)}
      accessibilityRole="button"
      accessibilityLabel={`Open challenge${headline ? `: ${headline}` : ''}`}
      style={styles.card}>
      <View style={styles.head}>
        <View style={styles.badge}>
          <Ionicons name="bonfire" size={13} color={Colors.ember} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.kicker}>{isOwn ? 'You hosted a challenge' : 'Campfire challenge'}</Text>
          {headline ? (
            <Text style={styles.headline} numberOfLines={2}>
              {headline}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={15} color={Colors.textTertiary} />
      </View>
      <Text style={styles.footer}>See standings</Text>
    </Pressable>
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
  footer: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.ember, paddingLeft: 34 },
  headline: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
});
