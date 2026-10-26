import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { SpaceButton } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
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

      {tier ? (
        <View style={styles.tierTag}>
          <Text style={styles.tierTagText}>{tier.toUpperCase()} GOAL</Text>
        </View>
      ) : null}
      <Text style={styles.goalName}>You did it?</Text>
      <Text style={styles.claimLine}>&ldquo;{label}&rdquo;</Text>
      {/* The crate is the earned thing on this screen, so it alone takes gold. */}
      <Text style={styles.question}>
        Mark it complete and it settles on your word — <Text style={styles.crate}>{honorCrate ?? 'your crate'}</Text>.
      </Text>

      <View style={styles.note}>
        <UiGlyph name="info" size={16} color={Colors.legend} />
        <Text style={styles.noteText}>
          Self-reported goals pay a capped tier. App-tracked goals (steps, workouts, focus time) pay
          the full tier automatically — nothing to claim here.
        </Text>
      </View>

      <View style={styles.spacer} />

      {/* The kit's primary carries the in-flight spinner itself (it was a separate indicator above
          the button); disabled the whole time, exactly as before. */}
      <SpaceButton label="Mark it complete" onPress={claim} loading={claiming} />
      <SpaceButton label="Not yet" variant="ghost" onPress={() => router.back()} disabled={claiming} style={styles.cancelWrap} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Legend purple: the tier is secondary context, not the action and not the reward.
  tierTag: {
    alignSelf: 'center',
    marginTop: Spacing.three,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: '#3A2D5A',
    backgroundColor: 'rgba(185,139,255,0.08)',
  },
  tierTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: Colors.legend,
  },
  goalName: {
    fontFamily: Fonts.black,
    fontSize: 26,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 6,
  },
  claimLine: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 6,
  },
  question: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.spaceDim,
    textAlign: 'center',
    marginTop: 8,
  },
  crate: {
    fontFamily: Fonts.bodyBold,
    color: Colors.gold,
  },
  // SpaceCard's legend tone — an informational aside.
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(185,139,255,0.08)',
    borderWidth: 1,
    borderColor: '#3A2D5A',
    borderRadius: 14,
    padding: 14,
    marginTop: Spacing.four,
  },
  noteText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.spaceDim,
  },
  spacer: { flex: 1, minHeight: Spacing.four },
  cancelWrap: { marginTop: Spacing.two, marginBottom: Spacing.two },
});
