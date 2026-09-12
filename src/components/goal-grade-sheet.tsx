import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { BoxArt } from '@/components/economy/box-art';
import { EmberIcon } from '@/components/economy/ember-icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { reportGoalGrade } from '@/lib/api/challenges';
import { asBoxKey, TIER_COLOR } from '@/lib/challenge-tier';
import { BOXES } from '@/lib/economy/boxes';
import { getErrorMessage } from '@/lib/errors';
import { personalGoalTitle } from '@/lib/goal-types';
import type { Challenge, GradeReport } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// REPORT THE MARK, AND LEARN THE ANSWER (§C — "how the user learns whether the goal was achieved").
//
// Two states in one sheet: ask, then verdict. They are not two screens because they are one moment
// — you type 87, you find out — and pushing a route between them would put the answer behind a
// transition and leave the question in the back stack.
//
// ── WHY THIS AND NOT logChallengeProgress ────────────────────────────────────────────────────
//
// That RPC ADDS. Reporting 85 twice on an 85% goal stored 170 and completed it, which is not a
// rounding error, it is the wrong arithmetic for the quantity: a grade arrives ONCE and it is
// absolute. report_goal_grade SETS it and writes the verdict — completed_at on a pass, missed_at on
// a miss — so a missed goal settles instead of sitting open forever pretending it might still land.
//
// ── WHERE THE PASS ACTUALLY REVEALS ──────────────────────────────────────────────────────────
//
// Here, and then again properly. Setting completed_at fires the `challenges_economy` trigger, which
// mints the crate and writes reward_payload; GoalRevealWatcher picks that up on the next foreground
// and draws the full reveal with its rays. So this sheet's pass state is the ANSWER ("you got it"),
// not a second celebration competing with the real one — it names the crate and gets out of the way.
//
// A MISS reveals nowhere else, and that is deliberate rather than an omission: teaching
// get_unseen_goal_rewards to emit payload-less rows would hand every INSTALLED build a reward screen
// with a null crate, on a path OTA cannot reach. So the honest miss lives here, where the user
// asked the question — which is also the only place it is not a surprise.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export function GoalGradeSheet({
  visible,
  goal,
  onClose,
  onSettled,
}: {
  visible: boolean;
  goal: Challenge;
  onClose: () => void;
  onSettled: (report: GradeReport) => void;
}) {
  const [grade, setGrade] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<GradeReport | null>(null);

  const target = goal.grade_target ?? goal.target;
  const gradeNum = Number(grade.trim());
  const valid = grade.trim().length > 0 && Number.isFinite(gradeNum) && gradeNum >= 0 && gradeNum <= 100;

  async function submit() {
    if (!valid) {
      setError('A grade is a percentage between 0 and 100.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await reportGoalGrade(goal.id, gradeNum);
      setReport(result);
      // Told to the list IMMEDIATELY, not on dismiss. The card behind this sheet has to stop saying
      // "Report your grade" the moment the grade exists, and a refresh deferred to onClose would
      // leave a stale card visible under a verdict that contradicts it.
      onSettled(result);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not report that.'));
    } finally {
      setSaving(false);
    }
  }

  function close() {
    // Reset so a reopened sheet asks again rather than reprinting a verdict from a previous goal.
    setGrade('');
    setReport(null);
    setError(null);
    onClose();
  }

  const boxKey = asBoxKey(report?.reward?.box);
  const tier = report?.tier ?? goal.difficulty_tier ?? null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />

          {report ? (
            // ── THE VERDICT ───────────────────────────────────────────────────────────────
            <View style={styles.verdict}>
              <View
                style={[
                  styles.verdictIcon,
                  { backgroundColor: report.passed ? 'rgba(60,190,120,0.14)' : 'rgba(255,255,255,0.06)' },
                ]}>
                {report.passed ? (
                  boxKey ? (
                    <BoxArt boxKey={boxKey} size={62} />
                  ) : (
                    <EmberIcon size={38} />
                  )
                ) : (
                  <Ionicons name="remove-circle-outline" size={40} color={Colors.textTertiary} />
                )}
              </View>

              <Text style={[styles.verdictTitle, report.passed && styles.verdictTitlePass]}>
                {report.passed ? 'You hit it.' : 'Missed it.'}
              </Text>
              <Text style={styles.verdictLine}>
                {/* The two numbers, always both. "You got 84" without "you needed 85" is a fact
                    without the judgement, and the judgement is the whole reason they reported it. */}
                {report.grade}% against a {report.grade_target}% target
                {report.label ? ` · ${report.label}` : ''}
              </Text>

              {report.passed && report.reward ? (
                <View style={[styles.rewardRow, tier ? { borderColor: TIER_COLOR[tier] } : null]}>
                  {boxKey ? <BoxArt boxKey={boxKey} size={30} /> : <EmberIcon size={20} />}
                  <Text style={styles.rewardText}>
                    {boxKey ? BOXES[boxKey].name : 'Embers'} + {report.reward.embers.toLocaleString('en-US')} embers
                  </Text>
                </View>
              ) : (
                // 🔴 §C — "an honest 'missed — no reward' state (don't silently pay or silently
                // drop)". Said plainly, with no crate art and no figure: showing an ember number
                // beside a miss reads as a payout that never moved.
                <Text style={styles.missNote}>
                  No reward for this one — the bar was {report.grade_target}%. Nothing was paid, and
                  nothing was taken. Set it again next term if you want another run at it.
                </Text>
              )}

              <View style={styles.cta}>
                <PrimaryButton label="Done" onPress={close} />
              </View>
            </View>
          ) : (
            // ── THE QUESTION ──────────────────────────────────────────────────────────────
            <View>
              <Text style={styles.title} numberOfLines={1}>
                {personalGoalTitle(goal)}
              </Text>
              <Text style={styles.sub}>
                You were chasing {target}%. What did you actually get?
              </Text>

              <View style={styles.inputRow}>
                <TextInput
                  value={grade}
                  onChangeText={(t) => {
                    setGrade(t);
                    setError(null);
                  }}
                  keyboardType="numeric"
                  maxLength={3}
                  placeholder="87"
                  style={styles.input}
                  accessibilityLabel="Your grade"
                />
                <Text style={styles.pct}>%</Text>
              </View>

              {/* Said BEFORE the tap, because it cannot be undone: report_goal_grade settles the
                  goal either way, and a user who did not know that would experience a miss as
                  something the app did to them. */}
              <View style={styles.warnRow}>
                <Ionicons name="lock-closed-outline" size={14} color={Colors.textTertiary} />
                <Text style={styles.warn}>
                  This settles the goal — you only report it once, and we take your word for it.
                </Text>
              </View>

              {error ? (
                <View style={styles.errorRow}>
                  <Ionicons name="alert-circle-outline" size={15} color={Colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <View style={styles.cta}>
                <PrimaryButton
                  label="Report it"
                  onPress={submit}
                  loading={saving}
                  disabled={saving || !valid}
                />
                <Pressable style={styles.cancelRow} onPress={close} accessibilityRole="button">
                  <Text style={styles.cancelLabel}>Not yet</Text>
                </Pressable>
              </View>
            </View>
          )}
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
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.line,
    marginTop: Spacing.two,
    marginBottom: Spacing.three,
  },
  title: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.ink },
  sub: { fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 17, color: Colors.muted, marginTop: 5 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.three },
  input: { flex: 1 },
  pct: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.muted, minWidth: 24 },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: Spacing.three },
  warn: { flex: 1, fontFamily: Fonts.body, fontSize: 11, lineHeight: 15.5, color: Colors.textTertiary },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: Spacing.three },
  errorText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, lineHeight: 16.5, color: Colors.danger },
  verdict: { alignItems: 'center' },
  verdictIcon: {
    width: 96,
    height: 96,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.three,
  },
  verdictTitle: { fontFamily: Fonts.bodyBold, fontSize: 22, color: Colors.muted },
  verdictTitlePass: { color: Colors.green },
  verdictLine: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 6,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    padding: 11,
    marginTop: Spacing.three,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(20,14,26,0.66)',
  },
  rewardText: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.ink },
  missNote: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  cta: { alignSelf: 'stretch', marginTop: Spacing.four, gap: Spacing.two },
  cancelRow: { paddingVertical: Spacing.three, alignItems: 'center' },
  cancelLabel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.muted },
});
