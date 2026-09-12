import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { previewScopedReward, updateGoal } from '@/lib/api/challenges';
import { asBoxKey, TIER_COLOR } from '@/lib/challenge-tier';
import { BOXES } from '@/lib/economy/boxes';
import { getErrorMessage } from '@/lib/errors';
import { canonicalGoalUnit, personalGoalTitle } from '@/lib/goal-types';
import type { Challenge, ScopedRewardPreview, UpdatedGoal } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// EDIT A GOAL (§B/§D) — target and deadline, and the reward RE-SCORES.
//
// 🔒 THE REWARD IS NOT ON THIS FORM, and its absence is the design. §B: "reward tier follows
// automatically from the re-scored difficulty — don't let the user hand-pick reward." So there is
// no tier picker, no crate picker and no ember field here; there is a TARGET, and what that target
// is worth is the server's answer to it.
//
// THE SAME BACKEND AS CINDY'S EDIT. This calls `update_goal`, which is the identical RPC
// performCoachAction's `update_challenge` arm calls — §D's "don't build a parallel edit path". The
// lifecycle rules, the owner check and the anti-cheese leap gate therefore hold identically whether
// the edit came from a sentence or from this sheet, because they are the same function.
//
// WHY THE TIER IS NOT SENT FROM HERE. Cindy re-judges difficulty when SHE edits, and passes the new
// tier. A user dragging a number has judged nothing, so this sends no tier and update_goal keeps the
// one the goal already carries — the reward moves only because the price of the SAME tier at a
// different duration moves, never because the client picked a better one.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export function GoalEditSheet({
  visible,
  goal,
  onClose,
  onSaved,
}: {
  visible: boolean;
  goal: Challenge;
  onClose: () => void;
  onSaved: (updated: UpdatedGoal) => void;
}) {
  const isGrade = goal.grade_target != null;
  const [target, setTarget] = useState(String(goal.target));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScopedRewardPreview | null>(null);

  const unit = canonicalGoalUnit(goal.type, goal.unit, goal.label);
  const targetNum = Number(target.trim());
  const valid = Number.isFinite(targetNum) && targetNum > 0 && (!isGrade || targetNum <= 100);
  const changed = valid && targetNum !== goal.target;

  // What the goal is worth as it stands, so "the reward changed" has a before to be a change from.
  // Keyed on the TIER, not on the typed target: the tier is what prices a goal and typing a number
  // does not re-judge it, so refetching per keystroke would be the same answer at a cost.
  //
  // The `alive` flag is per-effect-run, not per-mount — cleanup fires on every dep change, which is
  // the thing that has bitten this codebase before. Here that is exactly what it should do: a
  // reopened sheet for a different goal must not be painted by the previous goal's in-flight reply.
  const tier = goal.difficulty_tier;
  const claimLevel = goal.verifiability ?? 'honor';
  useEffect(() => {
    if (!visible || !tier) return;
    let alive = true;
    previewScopedReward(tier, claimLevel).then((r) => {
      if (alive) setPreview(r);
    });
    return () => {
      alive = false;
    };
  }, [visible, tier, claimLevel]);

  async function save() {
    if (!valid) {
      setError(isGrade ? 'A grade is a percentage between 1 and 100.' : 'Enter a target greater than 0.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateGoal({ goalId: goal.id, target: targetNum });
      onSaved(updated);
      onClose();
    } catch (e) {
      // 🔴 §D — NO GENERIC ERROR TOAST. update_goal's refusals are written as sentences a person can
      // act on ("you are already at 84 — pick a number ahead of you"), so the whole value of this
      // path is showing THAT rather than "Something went wrong". Rendered inline in the sheet, not
      // as an Alert, so the number they typed is still on screen beside the reason it was refused.
      setError(getErrorMessage(e, 'Could not save that change.'));
    } finally {
      setSaving(false);
    }
  }

  const boxKey = asBoxKey(preview?.box);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <Text style={styles.title} numberOfLines={1}>
              {personalGoalTitle(goal)}
            </Text>

            <Text style={styles.fieldLabel}>{isGrade ? 'TARGET GRADE' : 'TARGET'}</Text>
            <View style={styles.targetRow}>
              <TextInput
                value={target}
                onChangeText={(t) => {
                  setTarget(t);
                  setError(null);
                }}
                keyboardType="numeric"
                maxLength={isGrade ? 3 : 7}
                style={styles.targetInput}
                accessibilityLabel="Target"
              />
              <Text style={styles.unit}>{isGrade ? '%' : unit}</Text>
            </View>

            {/* Progress is shown because it is the thing the leap gate reasons about — a user who
                can see "you are at 84" understands the refusal before they hit it. */}
            {goal.progress > 0 ? (
              <Text style={styles.progressNote}>
                You are at {goal.progress.toLocaleString('en-US')} {isGrade ? '%' : unit} so far.
              </Text>
            ) : null}

            {/* What it pays, as it stands. It does not move when the number does — the tier prices a
                goal and typing does not re-judge the tier — so this is stated as the goal's standing
                price rather than as a live preview that would look broken for not reacting. */}
            {tier && preview ? (
              <View style={[styles.reward, { borderColor: TIER_COLOR[tier] }]}>
                <Ionicons name="cube-outline" size={16} color={TIER_COLOR[tier]} />
                <Text style={styles.rewardText} numberOfLines={2}>
                  <Text style={[styles.rewardTier, { color: TIER_COLOR[tier] }]}>{tier.toUpperCase()}</Text>
                  {' · '}
                  {boxKey ? BOXES[boxKey].name : 'Embers only'}
                  {` + ${preview.embers.toLocaleString('en-US')} embers`}
                </Text>
              </View>
            ) : null}

            <Text style={styles.footnote}>
              Move the target and Cindy re-scores what it&apos;s worth — you don&apos;t pick the reward,
              the difficulty does.
            </Text>

            {error ? (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={15} color={Colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.cta}>
              <PrimaryButton
                label={saving ? 'Saving…' : 'Save changes'}
                onPress={save}
                loading={saving}
                disabled={saving || !changed}
              />
              <Pressable style={styles.cancelRow} onPress={onClose} accessibilityRole="button">
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    maxHeight: '86%',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.line,
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  body: { paddingBottom: Spacing.two },
  title: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.ink, marginBottom: Spacing.three },
  fieldLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 2,
    color: Colors.textTertiary,
    marginBottom: 6,
  },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  targetInput: { flex: 1 },
  unit: { fontFamily: Fonts.body, fontSize: 14, color: Colors.muted, minWidth: 44 },
  progressNote: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.textTertiary, marginTop: 6 },
  reward: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: 11,
    marginTop: Spacing.three,
    backgroundColor: 'rgba(20,14,26,0.66)',
  },
  rewardTier: { fontFamily: Fonts.bodyBold, fontSize: 11.5, letterSpacing: 0.8 },
  rewardText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, lineHeight: 16.5, color: Colors.muted },
  footnote: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 15.5,
    color: Colors.textTertiary,
    marginTop: Spacing.two,
  },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: Spacing.three },
  errorText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, lineHeight: 16.5, color: Colors.danger },
  cta: { marginTop: Spacing.four, gap: Spacing.two },
  cancelRow: { paddingVertical: Spacing.three, alignItems: 'center' },
  cancelLabel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.muted },
});
