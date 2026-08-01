import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';

import { ExercisePicker } from '@/components/exercise-picker';
import { GymClipCaptureButton } from '@/components/gym-clip-capture-button';
import { GYM_VIDEO_CLIPS_ENABLED } from '@/constants/feature-flags';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { getErrorMessage } from '@/lib/errors';
import { fireConfirm, fireLightTap } from '@/lib/reward-feedback';
import type { ActiveWorkout, ActiveWorkoutExercise, Exercise, WorkoutSet, WorkoutSetClipRefs } from '@/types/database';

type WorkoutLogProps = {
  workout: ActiveWorkout;
  onLogSet: (workoutExerciseId: string, weight: number | null, reps: number) => Promise<WorkoutSet>;
  onRemoveSet: (workoutExerciseId: string, setId: string) => Promise<void>;
  onAddExercise: (exerciseId: string) => Promise<void>;
  onReplaceExercise: (workoutExerciseId: string, exerciseId: string) => Promise<void>;
  onRemoveExercise: (workoutExerciseId: string) => Promise<void>;
  onMoveExercise: (workoutExerciseId: string, direction: -1 | 1) => Promise<void>;
  /** Per-set video clips (§23 phase-2) — patches one banked set's clip refs after a capture or
   * removal. Only called when GYM_VIDEO_CLIPS_ENABLED. */
  onSetClipChanged: (workoutExerciseId: string, refs: WorkoutSetClipRefs) => void;
};

/** An un-banked row. Sets only exist server-side once ✓ is tapped, so these live here — which
 * is also what makes a half-typed row survive a scroll but never pollute anyone's PR history. */
type Draft = { key: string; weight: string; reps: string };

let draftSeq = 0;
function newDraft(weight: string, reps: string): Draft {
  draftSeq += 1;
  return { key: `d${draftSeq}`, weight, reps };
}

function numText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/** What a fresh row starts as: the last set you banked for this lift today, else the
 * energy-nudged suggestion from your last session (§23 rule 1 — a starting point, never a
 * mandate; both fields stay fully editable).
 *
 * The key is DERIVED from the exercise, not from the counter — this draft is recomputed on
 * every render until the user first types into it, and the running timer above re-renders this
 * screen once a second. A fresh key each time would remount the row's inputs every tick and
 * throw away focus mid-set. */
function defaultDraft(exercise: ActiveWorkoutExercise): Draft {
  const last = exercise.sets[exercise.sets.length - 1];
  const seed = { key: `seed-${exercise.id}-${exercise.sets.length}` };
  if (last) return { ...seed, weight: numText(last.weight), reps: String(last.reps) };
  return { ...seed, weight: numText(exercise.suggested?.weight), reps: numText(exercise.suggested?.reps) };
}

// The live workout log (PHILOI_UI_SPEC.md §23, design-mocks/24) — a real in-session log rather
// than a bare timer: exercise cards → weight×reps set rows → ✓ to bank, with a ⋯ menu per
// exercise for replacing a lift when a machine's taken, reordering, or dropping it.
//
// Banking a set is a server round trip on purpose: the PR verdict is the server's to make
// (log_workout_set), so the badge the user sees is the same one written to their record.
export function WorkoutLog({
  workout,
  onLogSet,
  onRemoveSet,
  onAddExercise,
  onReplaceExercise,
  onRemoveExercise,
  onMoveExercise,
  onSetClipChanged,
}: WorkoutLogProps) {
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({});
  // The set id whose ✓ just came back is_pr — the ONE set that gets the "Film this PR?" prompt
  // opened for it (§23). Cleared as soon as the next set is banked, so the prompt never
  // re-fires for a set the user already declined.
  const [prPromptSetId, setPrPromptSetId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function draftsFor(exercise: ActiveWorkoutExercise): Draft[] {
    return drafts[exercise.id] ?? [defaultDraft(exercise)];
  }

  function patchDraft(exercise: ActiveWorkoutExercise, index: number, patch: Partial<Draft>) {
    const current = draftsFor(exercise);
    setDrafts((prev) => ({ ...prev, [exercise.id]: current.map((d, i) => (i === index ? { ...d, ...patch } : d)) }));
  }

  function addDraft(exercise: ActiveWorkoutExercise) {
    const current = draftsFor(exercise);
    const last = current[current.length - 1];
    setDrafts((prev) => ({ ...prev, [exercise.id]: [...current, newDraft(last?.weight ?? '', last?.reps ?? '')] }));
  }

  function dropDraft(exercise: ActiveWorkoutExercise, index: number) {
    const current = draftsFor(exercise);
    setDrafts((prev) => ({ ...prev, [exercise.id]: current.filter((_, i) => i !== index) }));
  }

  async function handleBank(exercise: ActiveWorkoutExercise, index: number) {
    const draft = draftsFor(exercise)[index];
    const reps = Number(draft.reps);
    if (!Number.isFinite(reps) || reps <= 0) {
      setError('A set needs at least one rep.');
      return;
    }
    const weightText = draft.weight.trim();
    // Empty weight is bodyweight work (push-ups, pull-ups), not a validation failure.
    const weight = weightText === '' ? null : Number(weightText);
    if (weight !== null && (!Number.isFinite(weight) || weight < 0)) {
      setError('That weight doesn’t look right.');
      return;
    }

    setSavingKey(draft.key);
    setError(null);
    try {
      const saved = await onLogSet(exercise.id, weight, reps);
      // The banked row is removed; a fresh one (carrying the same numbers — the "same again"
      // default most sets actually are) only takes its place if NO other draft row is left
      // waiting. Punchlist 3: this used to always append a new row regardless, so banking one
      // of several already-queued rows (from a manual "+ Add set" tap) kept adding an extra
      // empty row on top of the one you hadn't touched yet — new rows now only ever come from
      // that manual tap, except for keeping exactly one ready row when the list would otherwise
      // go empty.
      const current = draftsFor(exercise);
      const remaining = current.filter((_, i) => i !== index);
      setDrafts((prev) => ({
        ...prev,
        [exercise.id]: remaining.length > 0 ? remaining : [newDraft(numText(saved.weight), String(saved.reps))],
      }));
      // Auto-prompt only on a PR, and only when clips are actually shipping — §23's rule is
      // that nothing ever films by itself; this opens the recorder with a "Film this PR?"
      // framing the user can dismiss.
      setPrPromptSetId(GYM_VIDEO_CLIPS_ENABLED && saved.is_pr ? saved.id : null);
      if (saved.is_pr) fireConfirm();
      else fireLightTap();
    } catch (e) {
      // The draft stays on screen with what was typed — losing a set you just did is worse
      // than showing the error and letting the user tap ✓ again.
      setError(getErrorMessage(e, 'Could not save that set.'));
    } finally {
      setSavingKey(null);
    }
  }

  async function handleUnbank(exercise: ActiveWorkoutExercise, setId: string) {
    setError(null);
    try {
      await onRemoveSet(exercise.id, setId);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not remove that set.'));
    }
  }

  function handleReplacePressed(exercise: ActiveWorkoutExercise) {
    setMenuFor(null);
    if (exercise.sets.length === 0) {
      setReplacingId(exercise.id);
      return;
    }
    // Swapping keeps the slot but not the work: those sets were performed on a different lift,
    // so crediting them to the new one would be a lie (and would move the wrong PR).
    Alert.alert(
      'Replace this exercise?',
      `The ${exercise.sets.length} ${exercise.sets.length === 1 ? 'set' : 'sets'} you logged for ${exercise.name} will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: () => setReplacingId(exercise.id) },
      ]
    );
  }

  function handleRemovePressed(exercise: ActiveWorkoutExercise) {
    setMenuFor(null);
    Alert.alert('Remove this exercise?', `${exercise.name} and any sets logged for it will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await onRemoveExercise(exercise.id);
          } catch (e) {
            setError(getErrorMessage(e, 'Could not remove that exercise.'));
          }
        },
      },
    ]);
  }

  async function handlePicked(exercise: Exercise) {
    const replacing = replacingId;
    setReplacingId(null);
    setAddOpen(false);
    setError(null);
    try {
      if (replacing) {
        // A replace keeps the same workout_exercise row, so any half-typed draft under it would
        // otherwise survive the swap and show the OLD lift's numbers against the new one.
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[replacing];
          return next;
        });
        await onReplaceExercise(replacing, exercise.id);
      } else {
        await onAddExercise(exercise.id);
      }
    } catch (e) {
      setError(getErrorMessage(e, 'Could not update your workout.'));
    }
  }

  return (
    <View style={styles.container}>
      {workout.exercises.map((exercise, exerciseIndex) => {
        const exerciseDrafts = draftsFor(exercise);
        const hasPr = exercise.sets.some((s) => s.is_pr);
        const menuOpen = menuFor === exercise.id;

        return (
          <View key={exercise.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.nameWrap}>
                <Text style={styles.name} numberOfLines={1}>
                  {exercise.name}
                </Text>
                {hasPr && (
                  <Animated.View entering={ZoomIn.springify().damping(12)} style={styles.prPill}>
                    <Ionicons name="trophy" size={9} color={Colors.achieverText} />
                    <Text style={styles.prPillText}>PR</Text>
                  </Animated.View>
                )}
              </View>
              <Text style={styles.setCount}>
                {exercise.sets.length} {exercise.sets.length === 1 ? 'set' : 'sets'}
              </Text>
              <Pressable
                onPress={() => setMenuFor(menuOpen ? null : exercise.id)}
                hitSlop={8}
                accessibilityLabel={`Options for ${exercise.name}`}>
                <Ionicons name="ellipsis-horizontal" size={16} color={Colors.textTertiary} />
              </Pressable>
            </View>

            {menuOpen && (
              <Animated.View entering={FadeIn.duration(120)} style={styles.menu}>
                <Pressable style={styles.menuItem} onPress={() => handleReplacePressed(exercise)}>
                  <Ionicons name="swap-horizontal" size={15} color={Colors.amber} />
                  <Text style={styles.menuLabel}>Replace exercise</Text>
                </Pressable>
                {/* Two explicit moves rather than drag-to-reorder — no drag library exists in
                    this project, and a lean tracker doesn't justify adding one. */}
                <Pressable
                  style={styles.menuItem}
                  disabled={exerciseIndex === 0}
                  onPress={() => {
                    setMenuFor(null);
                    onMoveExercise(exercise.id, -1);
                  }}>
                  <Ionicons name="arrow-up" size={15} color={exerciseIndex === 0 ? Colors.disabled : Colors.amber} />
                  <Text style={[styles.menuLabel, exerciseIndex === 0 && styles.menuLabelDisabled]}>Move up</Text>
                </Pressable>
                <Pressable
                  style={styles.menuItem}
                  disabled={exerciseIndex === workout.exercises.length - 1}
                  onPress={() => {
                    setMenuFor(null);
                    onMoveExercise(exercise.id, 1);
                  }}>
                  <Ionicons
                    name="arrow-down"
                    size={15}
                    color={exerciseIndex === workout.exercises.length - 1 ? Colors.disabled : Colors.amber}
                  />
                  <Text
                    style={[styles.menuLabel, exerciseIndex === workout.exercises.length - 1 && styles.menuLabelDisabled]}>
                    Move down
                  </Text>
                </Pressable>
                <Pressable style={styles.menuItem} onPress={() => handleRemovePressed(exercise)}>
                  <Ionicons name="trash-outline" size={15} color={Colors.danger} />
                  <Text style={[styles.menuLabel, styles.menuLabelDanger]}>Remove exercise</Text>
                </Pressable>
              </Animated.View>
            )}

            <View style={styles.setHead}>
              <Text style={[styles.setHeadCell, styles.colNo]}>Set</Text>
              <Text style={[styles.setHeadCell, styles.colField]}>lb</Text>
              <Text style={[styles.setHeadCell, styles.colField]}>reps</Text>
              <View style={styles.colAction} />
            </View>

            {exercise.sets.map((set, index) => (
              <Animated.View key={set.id} entering={FadeInDown.duration(180)} style={styles.setRow}>
                <Text style={[styles.setNo, styles.colNo]}>{index + 1}</Text>
                <View style={[styles.cell, styles.cellBanked, styles.colField]}>
                  <Text style={styles.cellText}>{set.weight === null ? '—' : set.weight}</Text>
                </View>
                <View style={[styles.cell, styles.cellBanked, styles.colField]}>
                  <Text style={styles.cellText}>{set.reps}</Text>
                </View>
                {/* Tapping a banked ✓ un-banks it — the same control both ways, so an
                    accidental or mistyped set is one tap to undo. */}
                <Pressable
                  onPress={() => handleUnbank(exercise, set.id)}
                  style={[styles.check, styles.checkOn, styles.colAction]}
                  accessibilityLabel={`Remove set ${index + 1}`}>
                  <Ionicons name="checkmark" size={15} color={Colors.ink} />
                </Pressable>
                {/* Per-set clip (§23 phase-2, design-mocks/38) — a banked set only. There's
                    nothing to attach a clip to before ✓, since the workout_sets row is what
                    holds the reference. */}
                {GYM_VIDEO_CLIPS_ENABLED && (
                  <GymClipCaptureButton
                    set={set}
                    autoPromptPr={prPromptSetId === set.id}
                    onChanged={(refs) => onSetClipChanged(exercise.id, refs)}
                  />
                )}
                {set.is_pr && (
                  <Animated.View entering={ZoomIn.springify().damping(12)} style={styles.rowPr}>
                    <Ionicons name="trophy" size={9} color={Colors.achieverText} />
                  </Animated.View>
                )}
              </Animated.View>
            ))}

            {exerciseDrafts.map((draft, index) => (
              <View key={draft.key} style={styles.setRow}>
                <Text style={[styles.setNo, styles.colNo]}>{exercise.sets.length + index + 1}</Text>
                <TextInput
                  style={[styles.cell, styles.cellInput, styles.colField]}
                  value={draft.weight}
                  onChangeText={(t) => patchDraft(exercise, index, { weight: t })}
                  placeholder="—"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="decimal-pad"
                  maxLength={6}
                  accessibilityLabel="Weight"
                />
                <TextInput
                  style={[styles.cell, styles.cellInput, styles.colField]}
                  value={draft.reps}
                  onChangeText={(t) => patchDraft(exercise, index, { reps: t })}
                  placeholder="0"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="number-pad"
                  maxLength={3}
                  accessibilityLabel="Reps"
                />
                <Pressable
                  onPress={() => handleBank(exercise, index)}
                  disabled={savingKey === draft.key}
                  style={[styles.check, styles.colAction]}
                  accessibilityLabel="Save set">
                  <Ionicons name="checkmark" size={15} color={savingKey === draft.key ? Colors.amber : Colors.trackAlt} />
                </Pressable>
                {/* Only offered past the first row, so an exercise always keeps one row ready
                    to log into. */}
                {index > 0 && (
                  <Pressable onPress={() => dropDraft(exercise, index)} hitSlop={6} style={styles.dropDraft}>
                    <Ionicons name="close" size={12} color={Colors.textTertiary} />
                  </Pressable>
                )}
              </View>
            ))}

            <Pressable onPress={() => addDraft(exercise)} style={styles.addSet} hitSlop={6}>
              <Ionicons name="add" size={13} color={Colors.amber} />
              <Text style={styles.addSetLabel}>Add set</Text>
            </Pressable>
          </View>
        );
      })}

      {workout.exercises.length === 0 && (
        <Text style={styles.empty}>Freestyle — add the first lift when you get to it.</Text>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable onPress={() => setAddOpen(true)} style={styles.addExercise}>
        <Ionicons name="add" size={15} color={Colors.amber} />
        <Text style={styles.addExerciseLabel}>Add exercise</Text>
      </Pressable>

      <ExercisePicker
        visible={addOpen || replacingId !== null}
        title={replacingId ? 'Replace with…' : 'Add exercise'}
        onClose={() => {
          setAddOpen(false);
          setReplacingId(null);
        }}
        onPick={handlePicked}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 11,
  },
  // Translucent, not solid (design-mocks/52's `.ex`) — Colors.card (#241C38) at 82% so the
  // dimmed flame behind the gym session glows through the log instead of being walled off by it.
  card: {
    backgroundColor: 'rgba(36,28,56,0.82)',
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  nameWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  name: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  prPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  prPillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    color: Colors.achieverText,
  },
  setCount: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  menu: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: 10,
    padding: 4,
    marginBottom: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 8,
    paddingHorizontal: 9,
    borderRadius: 7,
  },
  menuLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink,
  },
  menuLabelDisabled: {
    color: Colors.disabled,
  },
  menuLabelDanger: {
    color: Colors.danger,
  },
  setHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  setHeadCell: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  // A fixed four-column grid (mock 24's `.shead`/`.set`) so the header labels line up with
  // every row's fields, banked or draft.
  colNo: {
    width: 26,
  },
  colField: {
    flex: 1,
  },
  colAction: {
    width: 30,
  },
  setNo: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
  },
  cell: {
    backgroundColor: Colors.forgeBg,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 4,
  },
  cellBanked: {
    borderColor: 'rgba(224,97,44,0.4)',
  },
  cellInput: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.ink,
    textAlign: 'center',
    // Android's TextInput carries vertical padding of its own that would make these rows
    // taller than the banked ones sitting right above them.
    paddingVertical: 5,
  },
  cellText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.ink,
    textAlign: 'center',
  },
  check: {
    height: 30,
    borderRadius: 8,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: Colors.coral,
    borderColor: Colors.coral,
  },
  rowPr: {
    position: 'absolute',
    right: -4,
    top: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropDraft: {
    position: 'absolute',
    right: -12,
  },
  addSet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: 3,
  },
  addSetLabel: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.amber,
  },
  addExercise: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.lineStrong,
    borderRadius: Radius.card,
    paddingVertical: 11,
  },
  addExerciseLabel: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.amber,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingVertical: Spacing.two,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
    textAlign: 'center',
  },
});
