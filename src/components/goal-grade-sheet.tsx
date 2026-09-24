import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { BoxArt } from '@/components/economy/box-art';
import { EmberIcon } from '@/components/economy/ember-icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { TextInput } from '@/components/ui/text-input';
import { isRealUpgrade, upgradeLabel, useVouchedReward } from '@/components/vouch-unlock-line';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { previewScopedReward, reportGoalGrade } from '@/lib/api/challenges';
import { captureAndUploadProof, PROOF_MAX_SECONDS } from '@/lib/api/vouch';
import { useAuth } from '@/lib/auth/auth-context';
import { asBoxKey, TIER_COLOR } from '@/lib/challenge-tier';
import { BOXES } from '@/lib/economy/boxes';
import { getErrorMessage } from '@/lib/errors';
import { personalGoalTitle } from '@/lib/goal-types';
import type { Challenge, GradeReport, ScopedRewardPreview } from '@/types/database';

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
//
// ── 0209 · A PASS ASKS ONE MORE QUESTION: HOW DO YOU WANT TO SETTLE IT ─────────────────────────
//
// A reported grade is honour, capped at The Furnace — and that cap stays. What changed is that a
// pass can now take the way out of it: two friends vouch and the goal pays its full tier. So a
// passing mark does not go to the server straight away. It opens a third state offering the three
// arms of report_goal_grade: ask friends, film the grade and ask friends, or settle on my word.
// The first two hand off to /goal/vouch-ask (the picker a described feat already uses) carrying
// the grade, and THAT screen makes the one call. A miss skips all of this: you do not vouch a miss.
//
// A clip never lifts the tier by itself (0165) — it is shown to the friends so their yes is
// informed. The copy says so rather than implying a screenshot is a shortcut.
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
  // 0209 — a passing mark waiting on "how do you want to settle it". Nothing is sent until they pick.
  const [choosing, setChoosing] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const router = useRouter();
  const { session } = useAuth();

  const target = goal.grade_target ?? goal.target;
  const gradeNum = Number(grade.trim());
  const valid = grade.trim().length > 0 && Number.isFinite(gradeNum) && gradeNum >= 0 && gradeNum <= 100;

  // The two prices the choice sits between, from the server. Fetched when the sheet opens so the
  // choice screen names real crates rather than "the full crate".
  const goalTier = goal.difficulty_tier ?? null;
  const [capped, setCapped] = useState<ScopedRewardPreview | null>(null);
  useEffect(() => {
    if (!visible || !goalTier) return;
    let alive = true;
    previewScopedReward(goalTier, 'honor').then((r) => {
      if (alive) setCapped(r);
    });
    return () => {
      alive = false;
    };
  }, [visible, goalTier]);
  const vouched = useVouchedReward(goalTier, capped);
  const cappedKey = asBoxKey(capped?.box);
  const cappedName = cappedKey ? BOXES[cappedKey].name : 'the honour rate';
  const fullName = capped && vouched ? upgradeLabel(capped, vouched) : 'the full tier';

  // Offer the choice unless we KNOW vouching buys nothing (both prices in, no upgrade). Unknown —
  // prices still loading — offers it: skipping it by a race would silently forfeit a tier.
  const vouchable =
    goalTier != null && goal.verifiability !== 'auto' && !(capped && vouched && !isRealUpgrade(capped, vouched));

  function submit() {
    if (!valid) {
      setError('A grade is a percentage between 0 and 100.');
      return;
    }
    if (gradeNum >= target && vouchable) {
      setError(null);
      setChoosing(gradeNum);
      return;
    }
    void settle(gradeNum);
  }

  // Leave the sheet for the friend picker, which makes the one report_goal_grade call.
  function askFriends(proofPath: string | null) {
    const g = choosing;
    if (g == null) return;
    close();
    router.push({
      pathname: '/goal/vouch-ask',
      params: {
        goalId: goal.id,
        label: goal.label ?? personalGoalTitle(goal),
        tier: goalTier ?? '',
        grade: String(g),
        ...(proofPath ? { proofPath } : {}),
      },
    });
  }

  async function filmThenAsk() {
    if (!session) return;
    setRecording(true);
    try {
      const path = await captureAndUploadProof(session.user.id);
      if (path) askFriends(path); // null = cancelled at the camera; stay on the choice
    } catch (e) {
      Alert.alert('That clip did not save', getErrorMessage(e, 'The upload did not go through.'));
    } finally {
      setRecording(false);
    }
  }

  async function settle(value: number) {
    setSaving(true);
    setError(null);
    try {
      const result = await reportGoalGrade(goal.id, value);
      setReport(result);
      // Told to the list IMMEDIATELY, not on dismiss. The card behind this sheet has to stop saying
      // "Report your grade" the moment the grade exists, and a refresh deferred to onClose would
      // leave a stale card visible under a verdict that contradicts it.
      onSettled(result);
      setChoosing(null);
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
    setChoosing(null);
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
          ) : choosing != null ? (
            // ── 0209 · THE PASS, BEFORE IT SETTLES ────────────────────────────────────────
            <View>
              <Text style={[styles.title, styles.titlePass]}>You hit it.</Text>
              <Text style={styles.sub}>
                {choosing}% against a {target}% target. How do you want to settle it?
              </Text>

              <View style={styles.options}>
                <Pressable
                  style={styles.option}
                  onPress={() => askFriends(null)}
                  disabled={saving || recording}
                  accessibilityRole="button"
                  accessibilityLabel="Ask two friends to vouch">
                  <Ionicons name="people" size={19} color={Colors.amber} />
                  <View style={styles.optionMeta}>
                    <Text style={styles.optionName}>Ask 2 friends to vouch</Text>
                    <Text style={styles.optionDesc}>They confirm → {fullName}. If they don&apos;t answer in 48h it settles at {cappedName}.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={Colors.textTertiary} />
                </Pressable>

                <Pressable
                  style={styles.option}
                  onPress={filmThenAsk}
                  disabled={saving || recording}
                  accessibilityRole="button"
                  accessibilityLabel="Film your grade, then ask friends to vouch">
                  {recording ? (
                    <ActivityIndicator size="small" color={Colors.amber} />
                  ) : (
                    <Ionicons name="videocam" size={19} color={Colors.amber} />
                  )}
                  <View style={styles.optionMeta}>
                    <Text style={styles.optionName}>Film your grade, then ask</Text>
                    <Text style={styles.optionDesc}>
                      {recording
                        ? 'Saving your clip…'
                        : `Live camera, up to ${PROOF_MAX_SECONDS}s. Your friends see it with the ask — it's their yes that unlocks the tier.`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={Colors.textTertiary} />
                </Pressable>
              </View>

              {error ? (
                <View style={styles.errorRow}>
                  <Ionicons name="alert-circle-outline" size={15} color={Colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <View style={styles.cta}>
                <PrimaryButton
                  label={`Settle on my word · ${cappedName}`}
                  variant="ghost"
                  onPress={() => void settle(choosing)}
                  loading={saving}
                  disabled={saving || recording}
                />
                <Pressable
                  style={styles.cancelRow}
                  onPress={() => setChoosing(null)}
                  disabled={saving || recording}
                  accessibilityRole="button">
                  <Text style={styles.cancelLabel}>Back</Text>
                </Pressable>
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
                  You only report it once. A miss settles now; a pass pays on your word, or the
                  full tier if two friends vouch.
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
  titlePass: { color: Colors.green },
  options: { gap: 9, marginTop: Spacing.three },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: 'rgba(160,108,213,0.45)',
    borderRadius: 14,
    padding: 12,
  },
  optionMeta: { flex: 1 },
  optionName: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.ink },
  optionDesc: { fontFamily: Fonts.body, fontSize: 10.5, lineHeight: 15, color: Colors.textTertiary, marginTop: 2 },
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
