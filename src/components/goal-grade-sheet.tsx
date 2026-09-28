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
// Two states in one sheet: ask, then verdict. You type 87, you find out.
//
// report_goal_grade SETS the mark (not logChallengeProgress, which ADDS) and writes the verdict —
// completed_at on a pass, missed_at on a miss. Setting completed_at fires the challenges_economy
// trigger, which mints the crate and writes reward_payload; GoalRevealWatcher draws the full reveal
// on the next foreground. So this sheet's pass state is the ANSWER, not a second celebration.
//
// ── BUILD 10 · VOUCHING REMOVED (migration 0221) ───────────────────────────────────────────────
//
// A reported grade is honour, capped at The Furnace, and that is the final word: there is no vouch
// step and no way up short of a sensor the app can read. A passing mark reports straight away — the
// old "how do you want to settle it" chooser is gone. The grade box is also capped at Epic and
// rationed to the season's first two grade goals server-side; this sheet just names what was paid.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const articleFor = (t: string) => (/^[aeiou]/i.test(t) ? 'an' : 'a');

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
    setError(null);
    await settle(gradeNum);
  }

  async function settle(value: number) {
    setSaving(true);
    setError(null);
    try {
      const result = await reportGoalGrade(goal.id, value);
      setReport(result);
      // Told to the list IMMEDIATELY, not on dismiss, so the card behind this sheet stops saying
      // "Report your grade" the moment the grade exists.
      onSettled(result);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not report that.'));
    } finally {
      setSaving(false);
    }
  }

  function close() {
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
                    <BoxArt boxKey={boxKey} size={62} pedestal />
                  ) : (
                    <EmberIcon size={38} />
                  )
                ) : (
                  <Ionicons name="remove-circle-outline" size={40} color={Colors.textTertiary} />
                )}
              </View>

              <Text style={[styles.verdictTitle, report.passed && styles.verdictTitlePass]}>
                {!report.passed
                  ? 'Missed it.'
                  : report.grade >= report.grade_target || !report.earned_tier
                    ? 'You hit it.'
                    : `You earned ${articleFor(report.earned_tier)} ${cap(report.earned_tier)}.`}
              </Text>
              <Text style={styles.verdictLine}>
                {report.grade}% against a {report.grade_target}% target
                {report.label ? ` · ${report.label}` : ''}
              </Text>
              {report.passed && report.scoped_tier && report.earned_tier && report.scoped_tier !== report.earned_tier ? (
                <Text style={styles.verdictLine}>
                  You aimed for {report.scoped_tier.toUpperCase()} — passing still pays, a tier down per
                  step short.
                </Text>
              ) : null}

              {report.passed && report.reward ? (
                <View style={[styles.rewardRow, tier ? { borderColor: TIER_COLOR[tier] } : null]}>
                  {boxKey ? <BoxArt boxKey={boxKey} size={30} /> : <EmberIcon size={20} />}
                  <Text style={styles.rewardText}>
                    {boxKey ? BOXES[boxKey].name : 'Embers'} + {report.reward.embers.toLocaleString('en-US')} embers
                  </Text>
                </View>
              ) : (
                <Text style={styles.missNote}>
                  No reward for this one — the pass line was {report.pass_mark ?? report.grade_target}%.
                  Nothing was paid, and nothing was taken. Set it again next term if you want another
                  run at it.
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
                  goal either way. */}
              <View style={styles.warnRow}>
                <Ionicons name="lock-closed-outline" size={14} color={Colors.textTertiary} />
                <Text style={styles.warn}>
                  You only report it once. Any pass pays — a tier down per step short of{' '}
                  {target}%. Only failing the course (under {Math.min(goal.pass_mark ?? 50, target)}%)
                  is a miss.
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
