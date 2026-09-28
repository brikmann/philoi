import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { getErrorMessage } from '@/lib/errors';
import { previewScopedReward } from '@/lib/api/challenges';
import { claimGoalComplete } from '@/lib/api/vouch';
import { BOXES, BOX_KEYS, type BoxKey } from '@/lib/economy/boxes';
import type { DifficultyTier } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// "You landed a backflip?" — the honour path's "I did it".
//
// WHEN THIS FIRES: not at creation. An honour goal is scoped by Cindy and then sits ACTIVE with
// nothing able to finish it — there is no data source for "learn a backflip". It waits for the owner
// to tap "Mark complete" on the card, which opens this screen. An auto-tracked goal never arrives
// here: its data completes it through log_challenge_progress and it goes straight to the reveal.
//
// ── BUILD 10 · VOUCHING REMOVED (migration 0221) ───────────────────────────────────────────────
//
// A self-reported feat settles directly at the Unvouched tier now — one confirmation, no proof
// clip, no friend-vouch, no 48h window. The band it pays is capped at Rare (goal_paid_band caps
// every honour claim at The Furnace), and that cap is the anti-cheese firewall: you cannot mint a
// top box by describing a hard thing. This screen names the crate it pays and makes the one call.
//
// 🔒 NOTHING HERE DECIDES ANYTHING. The level, the completion and the payout all belong to
// claim_goal_complete, which settles at honour.
// ══════════════════════════════════════════════════════════════════════════════════════════════

function asBoxKey(key: string | null | undefined): BoxKey | null {
  return key != null && (BOX_KEYS as readonly string[]).includes(key) ? (key as BoxKey) : null;
}

export default function GoalClaimScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ goalId: string; label?: string; tier?: string }>();
  const goalId = params.goalId;
  const label = params.label?.trim() || 'your goal';
  const tier = (params.tier as DifficultyTier | undefined) ?? null;

  // The crate this claim pays, named by the server rather than guessed locally.
  const [honorCrate, setHonorCrate] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (!tier) return;
    let alive = true;
    previewScopedReward(tier, 'honor')
      .then((honor) => {
        if (!alive) return;
        const down = asBoxKey(honor?.box);
        setHonorCrate(down ? BOXES[down].name : null);
      })
      .catch(() => {
        // Copy degrades to "your crate" rather than blocking the claim.
      });
    return () => {
      alive = false;
    };
  }, [tier]);

  const claim = () => {
    Alert.alert(
      'Mark it complete?',
      `It pays ${honorCrate ?? 'your crate'} on your word. You can't do this one again afterwards.`,
      [
        { text: 'Back', style: 'cancel' },
        {
          text: 'Claim it',
          onPress: async () => {
            setClaiming(true);
            try {
              await claimGoalComplete({ goalId });
              router.back();
            } catch (e) {
              Alert.alert('That did not go through', getErrorMessage(e, 'Try again in a moment.'));
            } finally {
              setClaiming(false);
            }
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Complete goal', headerShown: true }} />

      {tier ? <Text style={styles.tierTag}>{tier.toUpperCase()} GOAL</Text> : null}
      <Text style={styles.goalName}>You did it?</Text>
      <Text style={styles.claimLine}>&ldquo;{label}&rdquo;</Text>
      <Text style={styles.question}>
        Mark it complete and it settles on your word — {honorCrate ?? 'your crate'}.
      </Text>

      <View style={styles.note}>
        <Ionicons name="information-circle-outline" size={16} color={Colors.textTertiary} />
        <Text style={styles.noteText}>
          Self-reported goals pay a capped tier. App-tracked goals (steps, workouts, focus time) pay
          the full tier automatically — nothing to claim here.
        </Text>
      </View>

      <View style={styles.spacer} />

      {claiming ? (
        <ActivityIndicator size="small" color={Colors.amber} style={{ marginBottom: Spacing.three }} />
      ) : null}
      <PrimaryButton label="Mark it complete" onPress={claim} disabled={claiming} />
      <Pressable onPress={() => router.back()} disabled={claiming} accessibilityRole="button" style={styles.cancelWrap}>
        <Text style={styles.cancel}>Not yet</Text>
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
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.cardDark,
    borderRadius: 14,
    padding: 14,
    marginTop: Spacing.four,
  },
  noteText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.textTertiary,
  },
  spacer: { flex: 1, minHeight: Spacing.four },
  cancelWrap: { paddingVertical: Spacing.three, alignItems: 'center' },
  cancel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.muted },
});
