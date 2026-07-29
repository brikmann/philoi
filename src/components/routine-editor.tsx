import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExercisePicker } from '@/components/exercise-picker';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { getErrorMessage } from '@/lib/errors';
import type { Exercise, RoutineWithExercises } from '@/types/database';

type RoutineEditorProps = {
  visible: boolean;
  /** Null = creating a new routine; set = editing that one. */
  routine: RoutineWithExercises | null;
  onClose: () => void;
  onSave: (input: { id?: string | null; name: string; exerciseIds: string[] }) => Promise<unknown>;
  onDelete?: (routineId: string) => Promise<unknown>;
};

type DraftExercise = { exercise_id: string; name: string };

// Lightweight routine management (§23) — a name and an ordered list of lifts, nothing more.
// Targets are deliberately absent: they come from what was actually lifted last time, so a
// routine never carries stale numbers that contradict the log.
//
// The draft is seeded once, from props, at mount. Callers mount this only while the sheet is
// open and key it by the routine being edited (see gym-routine-block.tsx), so switching from
// one routine to another remounts with a fresh draft — no effect syncing props into state, and
// no way for a previous edit's draft to leak into the next one.
export function RoutineEditor({ visible, routine, onClose, onSave, onDelete }: RoutineEditorProps) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(routine?.name ?? '');
  const [items, setItems] = useState<DraftExercise[]>(
    () => routine?.exercises.map((e) => ({ exercise_id: e.exercise_id, name: e.name })) ?? []
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && items.length > 0 && !saving;

  function handleAdd(exercise: Exercise) {
    setPickerOpen(false);
    setItems((prev) => (prev.some((i) => i.exercise_id === exercise.id) ? prev : [...prev, { exercise_id: exercise.id, name: exercise.name }]));
  }

  function move(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ id: routine?.id ?? null, name: name.trim(), exerciseIds: items.map((i) => i.exercise_id) });
      onClose();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save that routine.'));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!routine || !onDelete) return;
    Alert.alert('Delete routine?', `"${routine.name}" will be removed. Workouts you've already logged stay put.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await onDelete(routine.id);
            onClose();
          } catch (e) {
            setError(getErrorMessage(e, 'Could not delete that routine.'));
          }
        },
      },
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={styles.grab} />
          <View style={styles.header}>
            <Text style={styles.title}>{routine ? 'Edit routine' : 'New routine'}</Text>
            {routine && onDelete && (
              <Pressable onPress={handleDelete} hitSlop={10} accessibilityLabel="Delete routine">
                <Ionicons name="trash-outline" size={18} color={Colors.danger} />
              </Pressable>
            )}
          </View>

          <TextInput
            style={styles.nameInput}
            placeholder="Routine name — “Push day”"
            value={name}
            onChangeText={setName}
            maxLength={40}
          />

          <Text style={styles.sectionLabel}>Exercises</Text>

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {items.length === 0 && <Text style={styles.empty}>Add the lifts this routine is made of.</Text>}

            {items.map((item, index) => (
              <View key={item.exercise_id} style={styles.row}>
                <Text style={styles.rowIndex}>{index + 1}</Text>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Pressable onPress={() => move(index, -1)} hitSlop={6} disabled={index === 0} accessibilityLabel="Move up">
                  <Ionicons name="chevron-up" size={16} color={index === 0 ? Colors.disabled : Colors.textTertiary} />
                </Pressable>
                <Pressable
                  onPress={() => move(index, 1)}
                  hitSlop={6}
                  disabled={index === items.length - 1}
                  accessibilityLabel="Move down">
                  <Ionicons name="chevron-down" size={16} color={index === items.length - 1 ? Colors.disabled : Colors.textTertiary} />
                </Pressable>
                <Pressable
                  onPress={() => setItems((prev) => prev.filter((i) => i.exercise_id !== item.exercise_id))}
                  hitSlop={6}
                  accessibilityLabel={`Remove ${item.name}`}>
                  <Ionicons name="close" size={16} color={Colors.textTertiary} />
                </Pressable>
              </View>
            ))}

            <Pressable onPress={() => setPickerOpen(true)} style={styles.addRow}>
              <Ionicons name="add" size={16} color={Colors.amber} />
              <Text style={styles.addLabel}>Add exercise</Text>
            </Pressable>
          </ScrollView>

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={[styles.save, !canSave && styles.saveDisabled]} onPress={handleSave} disabled={!canSave}>
            <Text style={styles.saveLabel}>{saving ? 'Saving…' : 'Save routine'}</Text>
          </Pressable>
        </View>
      </View>

      <ExercisePicker visible={pickerOpen} title="Add to routine" onClose={() => setPickerOpen(false)} onPick={handleAdd} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(9,7,14,0.55)',
  },
  sheet: {
    maxHeight: '86%',
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 15,
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.trackAlt,
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ink,
  },
  nameInput: {
    paddingVertical: 11,
    fontSize: 14,
  },
  sectionLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 14,
    marginBottom: 7,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.cream,
    borderRadius: Radius.card,
    paddingVertical: 10,
    paddingHorizontal: 11,
    marginBottom: 6,
  },
  rowIndex: {
    width: 14,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  rowName: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.lineStrong,
    borderRadius: Radius.card,
    paddingVertical: 10,
    marginBottom: 4,
  },
  addLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.amber,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.textTertiary,
    paddingVertical: Spacing.two,
  },
  save: {
    alignItems: 'center',
    backgroundColor: Colors.coral,
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
  },
  saveDisabled: {
    backgroundColor: Colors.disabled,
  },
  saveLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.coral,
    marginTop: Spacing.two,
  },
});
