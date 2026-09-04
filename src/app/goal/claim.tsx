import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { previewScopedReward } from '@/lib/api/challenges';
import { captureAndUploadProof, claimGoalComplete, PROOF_MAX_SECONDS } from '@/lib/api/vouch';
import { BOXES, BOX_KEYS, type BoxKey } from '@/lib/economy/boxes';
import type { DifficultyTier } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FRAME A — "You landed a backflip?" (mock 176, CODE_PROMPT_honor_vouch.md §1)
//
// WHEN THIS FIRES, because it is the confusing part. Not at creation. An honour goal is scoped by
// Cindy and then sits ACTIVE on the goals list with nothing able to finish it — there is no data
// source for "learn a backflip". It waits for the owner to tap "Mark complete" on the card, and
// that tap opens this screen. An auto-tracked goal never arrives here at all: its data completes it
// through log_challenge_progress and it goes straight to the reveal.
//
// A CHOOSER, NOT A FORM. The earlier build put proof and the friend-picker on one scrolling page
// with a button whose verb changed underneath you. Both paths lead to the same place — the mock is
// explicit that a clip is shown TO the vouchers — so presenting them as parallel choices misread
// the flow. Here they are what they actually are: two ways to start the SAME ask, plus a way out.
//
// THE PRICE IS NAMED, IN BOXES, BEFORE THE TAP. "unverified pays The Furnace (one tier down)" is a
// sentence someone can act on; "verification affects rewards" is not. Both box names come from
// preview_challenge_reward — the same function grant_reward reads at settlement — so the screen
// cannot promise a crate the reveal then contradicts.
//
// 🔒 NOTHING HERE DECIDES ANYTHING. The level, the completion and the payout all belong to
// claim_goal_complete. This screen carries an intent and at most a file path.
// ══════════════════════════════════════════════════════════════════════════════════════════════

function asBoxKey(key: string | null | undefined): BoxKey | null {
  return key != null && (BOX_KEYS as readonly string[]).includes(key) ? (key as BoxKey) : null;
}

export default function GoalClaimScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ goalId: string; label?: string; tier?: string }>();
  const goalId = params.goalId;
  const label = params.label?.trim() || 'your goal';
  const tier = (params.tier as DifficultyTier | undefined) ?? null;

  // The two crates this choice sits between, named by the server rather than guessed locally.
  const [fullCrate, setFullCrate] = useState<string | null>(null);
  const [honorCrate, setHonorCrate] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    if (!tier) return;
    let alive = true;
    Promise.all([previewScopedReward(tier, 'vouched'), previewScopedReward(tier, 'honor')])
      .then(([vouched, honor]) => {
        if (!alive) return;
        const full = asBoxKey(vouched?.box);
        const down = asBoxKey(honor?.box);
        setFullCrate(full ? BOXES[full].name : null);
        setHonorCrate(down ? BOXES[down].name : null);
      })
      .catch(() => {
        // Copy degrades to "the full crate" / "one tier down" rather than blocking the claim.
      });
    return () => {
      alive = false;
    };
  }, [tier]);

  // ── record, then ask. The clip is an attachment to the vouch request, never a substitute for it
  //    (migration 0165): it makes a friend's yes informed, and only the yes moves the band.
  const recordThenAsk = async () => {
    if (!session) return;
    setRecording(true);
    try {
      const path = await captureAndUploadProof(session.user.id);
      if (!path) return; // cancelled at the camera — not an error, stay put
      router.push({ pathname: '/goal/vouch-ask', params: { goalId, label, tier: tier ?? '', proofPath: path } });
    } catch (e) {
      Alert.alert('That clip did not save', getErrorMessage(e, 'The upload did not go through.'));
    } finally {
      setRecording(false);
    }
  };

  const askWithoutClip = () =>
    router.push({ pathname: '/goal/vouch-ask', params: { goalId, label, tier: tier ?? '' } });

  // ── the way out. Offered plainly: this is the band the goal has been worth since it was scoped,
  //    and dressing it as a penalty would make an honest choice feel like a toll booth.
  const claimUnverified = () => {
    Alert.alert(
      'Claim it unverified?',
      `It pays ${honorCrate ?? 'one tier down'} instead of ${fullCrate ?? 'the full crate'}. You can't do this one again afterwards.`,
      [
        { text: 'Back', style: 'cancel' },
        {
          text: 'Claim it',
          onPress: async () => {
            setSkipping(true);
            try {
              await claimGoalComplete({ goalId });
              router.back();
            } catch (e) {
              Alert.alert('That did not go through', getErrorMessage(e, 'Try again in a moment.'));
            } finally {
              setSkipping(false);
            }
          },
        },
      ]
    );
  };

  const busy = recording || skipping;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Complete goal', headerShown: true }} />

      {tier ? <Text style={styles.tierTag}>{tier.toUpperCase()} GOAL</Text> : null}
      <Text style={styles.goalName}>You did it?</Text>
      <Text style={styles.claimLine}>&ldquo;{label}&rdquo;</Text>
      <Text style={styles.question}>Show your friends — they confirm the win.</Text>

      <View style={styles.options}>
        <Pressable
          style={styles.option}
          onPress={recordThenAsk}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Record a clip, live, then ask friends to vouch">
          <View style={styles.optionIcon}>
            {recording ? (
              <ActivityIndicator size="small" color={Colors.amber} />
            ) : (
              <Ionicons name="videocam" size={20} color={Colors.amber} />
            )}
          </View>
          <View style={styles.optionMeta}>
            <Text style={styles.optionName}>Record a clip (live)</Text>
            <Text style={styles.optionDesc}>
              {recording
                ? 'Saving your clip…'
                : `In-app camera, no uploads. Up to ${PROOF_MAX_SECONDS}s. Your friends confirm it → ${fullCrate ?? 'the full crate'}.`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
        </Pressable>

        <Pressable
          style={styles.option}
          onPress={askWithoutClip}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Ask friends to vouch">
          <View style={styles.optionIcon}>
            <Ionicons name="people" size={20} color={Colors.amber} />
          </View>
          <View style={styles.optionMeta}>
            <Text style={styles.optionName}>Ask friends to vouch</Text>
            <Text style={styles.optionDesc}>2 friends confirm → {fullCrate ?? 'the full crate'}.</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
        </Pressable>
      </View>

      <View style={styles.spacer} />

      <Pressable onPress={claimUnverified} disabled={busy} accessibilityRole="button" style={styles.skipWrap}>
        {skipping ? (
          <ActivityIndicator size="small" color={Colors.textTertiary} />
        ) : (
          <Text style={styles.skip}>
            Just claim it — <Text style={styles.skipWarn}>unverified pays {honorCrate ?? 'one tier down'}</Text>
            {honorCrate ? ' (one tier down)' : ''}
          </Text>
        )}
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tierTag: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 2,
    color: '#A06CD5',
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  goalName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 6,
  },
  claimLine: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 4,
  },
  question: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 6,
  },
  options: { gap: 11, marginTop: Spacing.four },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: 'rgba(160,108,213,0.45)',
    borderRadius: 15,
    padding: 14,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.scrim,
  },
  optionMeta: { flex: 1 },
  optionName: { fontFamily: Fonts.bodyBold, fontSize: 14.5, color: Colors.ink },
  optionDesc: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    lineHeight: 15,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  spacer: { flex: 1, minHeight: Spacing.four },
  skipWrap: { paddingVertical: Spacing.two, alignItems: 'center' },
  skip: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  skipWarn: { fontFamily: Fonts.bodySemiBold, color: Colors.coral },
});
