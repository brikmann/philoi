import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { challengeTitle } from '@/lib/challenge-metric';
import { fetchCircleActiveChallenges, joinCampfireChallenge } from '@/lib/api/social-challenges';
import { getErrorMessage } from '@/lib/errors';
import type { CircleActiveChallenge } from '@/types/database';

// WHAT THIS FIXES (CODE_PROMPT_campfire_history_join.md §1.2, migration 0163).
//
// The run club: an owner posts a challenge, invites people, and every one of them opens a campfire
// with nothing in it. The chat card (0162) carries the challenge into HISTORY — it is a message, so
// the member-read policy shows it to everyone who ever joins — but history scrolls. A member who
// joins a fire that has been talking for a week has to scroll back through that week to find out a
// race is running, and a race they cannot see is a race they cannot enter.
//
// So the live challenge is ALSO pinned, above the chat, where it cannot be scrolled past.
//
// WHY IT DOES NOT READ fetchMySocialChallenges. That read is scoped to challenge_participants, and
// under the opt-in model the people this strip is FOR are exactly the ones not on that roster yet.
// Asking "what am I in" would return nothing to them — which is the original bug, reproduced one
// component higher. get_circle_active_challenges asks the circle instead and hands back `i_am_in`.

export function ActiveChallengeStrip({
  groupId,
  onJoined,
}: {
  groupId: string;
  /** The timeline refetches its own challenge embeds after an opt-in changes the roster. */
  onJoined?: () => void;
}) {
  const router = useRouter();
  const [challenges, setChallenges] = useState<CircleActiveChallenge[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchCircleActiveChallenges(groupId)
      .then(setChallenges)
      .catch(() => {
        // A pinned extra, not the screen. A failed read leaves the chat exactly as it was rather
        // than putting an error bar above every message in the campfire.
        setChallenges([]);
      });
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  if (challenges.length === 0) return null;

  // The newest live one gets the row; the rest are a count. A campfire with four races running is
  // rare enough that four pinned rows would cost more chat than they are worth, and every one of
  // them is still in history and on the Challenges tab.
  const [top, ...rest] = challenges;
  const title = challengeTitle(top);

  const join = async () => {
    setBusyId(top.id);
    setError(null);
    try {
      await joinCampfireChallenge(top.id);
      // Optimistic on this row only, then a real read — participant_count moved too, and the
      // honest number is the one the server has.
      setChallenges((prev) => prev.map((c) => (c.id === top.id ? { ...c, i_am_in: true } : c)));
      load();
      onJoined?.();
    } catch (e) {
      setError(getErrorMessage(e, "That didn't go through."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.strip}>
        <Pressable
          style={styles.main}
          onPress={() => router.push(`/challenge-info/${top.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open the campfire challenge ${title}`}>
          <View style={styles.badge}>
            <Ionicons name="bonfire" size={13} color={Colors.ember} />
          </View>
          <View style={styles.text}>
            <Text style={styles.kicker}>
              {challenges.length === 1 ? 'Active challenge' : `${challenges.length} active challenges`}
            </Text>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          </View>
        </Pressable>

        {top.i_am_in ? (
          <View style={styles.inRow}>
            <Ionicons name="checkmark-circle" size={14} color={Colors.green} />
            <Text style={styles.in}>You&apos;re in</Text>
          </View>
        ) : (
          // THE OPT-IN, ON THE PINNED ROW. A late joiner should not have to find the original card
          // in history to enter a race that is still running — §Opt-in's whole point is that people
          // put themselves in, and this is the shortest path to doing it.
          <Pressable
            style={styles.joinBtn}
            onPress={join}
            disabled={busyId === top.id}
            accessibilityRole="button"
            accessibilityLabel={`Join ${title}`}>
            {busyId === top.id ? (
              <ActivityIndicator size="small" color={Colors.onEmber} />
            ) : (
              <Text style={styles.joinLabel}>Join</Text>
            )}
          </Pressable>
        )}
      </View>

      {rest.length > 0 && (
        <Text style={styles.more}>
          +{rest.length} more running in this campfire
        </Text>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // 14, matching the timeline list's own paddingHorizontal so the pinned row sits on the same
    // gutter as the messages beneath it rather than a hair inside or outside them.
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 2,
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.4)',
    borderRadius: Radius.card,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.twelve,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(242,163,60,0.14)',
  },
  text: { flex: 1, gap: 1 },
  kicker: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
  },
  title: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  joinBtn: {
    minWidth: 62,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.ember,
  },
  joinLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.onEmber },
  inRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  in: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.green },
  more: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    paddingTop: 4,
    paddingLeft: Spacing.two,
  },
  error: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.danger, paddingTop: 4 },
});
