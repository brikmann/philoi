import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { personalGoalTitle } from '@/lib/goal-types';
import type { Challenge } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE GOAL KEBAB — a sheet, because Alert cannot hold this menu (§D).
//
// 🛑 THE ROOT CAUSE OF THE DEAD TAPS, found in RN itself rather than in our code.
// react-native/Libraries/Alert/Alert.js line 100:
//
//     ? buttons.slice(0, 3)
//
// Android's AlertDialog has exactly three slots — neutral, negative, positive — so RN TRUNCATES
// any button list longer than three and then pop()s the survivors into those slots from the end.
// The old kebab passed four (Mark complete · Goal info · Delete goal · Cancel) on any scoped goal,
// so on Android — which is the pilot device — Cancel was silently dropped and the remaining three
// were re-seated into slots they were not written for. That is what "generic UI errors and dead
// taps" looked like from the outside: a menu missing its way out, with its items in a different
// order than the code lists them.
//
// It is not fixable by trimming the list, because §D adds Edit — five items on a live grade goal.
// A Modal has no slots, so the ceiling disappears rather than moving.
//
// ── EVERY ROW EITHER WORKS OR SAYS WHY NOT ────────────────────────────────────────────────────
//
// The §D rule is "no generic error toast, no silent no-op". So a row the lifecycle forbids is
// rendered DISABLED WITH ITS REASON UNDER IT — "already finished", "waiting on a vouch" — rather
// than hidden or left to fail at the RPC. Hiding it answers "where did Edit go?" with nothing;
// letting it fail answers a deliberate tap with an error dialog. Both are worse than a grey row
// that says the rule.
//
// Ownership is not a state this sheet renders, because a personal goal has exactly one owner: the
// list it opens from is `challenges where user_id = auth.uid()`. The server still checks (every
// 0183 RPC re-reads auth.uid() against the row) — that check exists for the case this component
// cannot see, not for this one.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type GoalManageSheetProps = {
  visible: boolean;
  goal: Challenge;
  onClose: () => void;
  onReportGrade: () => void;
  onClaim: () => void;
  onEdit: () => void;
  onInfo: () => void;
  onDelete: () => void;
  onHide: () => void;
};

type RowSpec = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
  /** Non-null makes the row grey and un-tappable, and prints this under the label. */
  disabledReason?: string | null;
};

export function GoalManageSheet({
  visible,
  goal,
  onClose,
  onReportGrade,
  onClaim,
  onEdit,
  onInfo,
  onDelete,
  onHide,
}: GoalManageSheetProps) {
  const isGrade = goal.grade_target != null;
  const settled = goal.completed_at != null || goal.missed_at != null;
  const awaitingVouch = goal.claimed_at != null && goal.completed_at == null;

  // 0164's rule, unchanged: "Mark complete" is the honour path's only entry, offered on a described
  // feat that nothing can auto-complete. A grade goal is excluded even though it is also honour —
  // it has a REAL number to report, and two ways to finish one goal is two ways to disagree about
  // whether it was met.
  const canClaim =
    !isGrade && goal.difficulty_tier != null && goal.verifiability !== 'auto' && !settled && !goal.claimed_at;

  const rows: RowSpec[] = [];

  if (isGrade) {
    rows.push({
      key: 'grade',
      icon: 'school-outline',
      label: goal.completed_at ? 'Grade reported' : goal.missed_at ? 'Grade reported' : 'Report your grade',
      onPress: onReportGrade,
      disabledReason: settled ? 'You already reported this one.' : null,
    });
  }

  if (canClaim) {
    rows.push({ key: 'claim', icon: 'checkmark-circle-outline', label: 'Mark complete', onPress: onClaim });
  }

  rows.push({
    key: 'edit',
    icon: 'create-outline',
    label: 'Edit goal',
    onPress: onEdit,
    // The same three refusals update_goal enforces, said here in the same order so a user who taps
    // through anyway gets the sentence they already read rather than a second, different one.
    disabledReason: settled
      ? "It's finished — set up a new one instead."
      : awaitingVouch
        ? "You've claimed it, so the target is locked until friends answer."
        : goal.retired_at
          ? 'This was collapsed into another goal reading the same source.'
          : null,
  });

  rows.push({ key: 'info', icon: 'information-circle-outline', label: 'Goal info', onPress: onInfo });

  // Delete and Hide are the SAME slot, not two rows, because exactly one of them applies at a time
  // and offering both would make "which one removes it?" a question. A live goal is deleted; a
  // settled one is hidden, because its reward_payload is the receipt for embers that already moved.
  if (settled) {
    rows.push({ key: 'hide', icon: 'eye-off-outline', label: 'Hide from History', onPress: onHide, danger: true });
  } else {
    rows.push({ key: 'delete', icon: 'trash-outline', label: 'Delete goal', onPress: onDelete, danger: true });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.title} numberOfLines={1}>
            {personalGoalTitle(goal)}
          </Text>

          {rows.map((r, i) => {
            const disabled = r.disabledReason != null;
            return (
              <Pressable
                key={r.key}
                disabled={disabled}
                style={[styles.row, i === rows.length - 1 && styles.rowLast]}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                accessibilityLabel={disabled ? `${r.label}, unavailable: ${r.disabledReason}` : r.label}
                onPress={() => {
                  // Closed FIRST, then the action, so a row that opens a screen does not leave a
                  // modal sitting under it — and so the sheet is never the thing blocking a route.
                  onClose();
                  r.onPress();
                }}>
                <Ionicons
                  name={r.icon}
                  size={19}
                  color={disabled ? Colors.textTertiary : r.danger ? Colors.danger : Colors.ink}
                />
                <View style={styles.rowText}>
                  <Text
                    style={[
                      styles.rowLabel,
                      r.danger && !disabled && styles.rowLabelDanger,
                      disabled && styles.rowLabelDisabled,
                    ]}>
                    {r.label}
                  </Text>
                  {disabled ? <Text style={styles.rowReason}>{r.disabledReason}</Text> : null}
                </View>
              </Pressable>
            );
          })}

          <Pressable style={styles.cancelRow} onPress={onClose} accessibilityRole="button">
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
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
    marginBottom: Spacing.two,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.textTertiary,
    paddingBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink },
  rowLabelDanger: { color: Colors.danger },
  rowLabelDisabled: { color: Colors.textTertiary },
  rowReason: { fontFamily: Fonts.body, fontSize: 11.5, lineHeight: 15, color: Colors.textTertiary },
  cancelRow: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    borderRadius: Radius.card,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  cancelLabel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.muted },
});
