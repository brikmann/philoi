import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useExerciseLibrary } from '@/hooks/use-exercise-library';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { Exercise } from '@/types/database';

type ExercisePickerProps = {
  visible: boolean;
  title?: string;
  onClose: () => void;
  onPick: (exercise: Exercise) => void;
};

// The one place a lift gets chosen — shared by "Add exercise" and "Replace exercise" in the
// session logger and by the routine editor, so the search/create behaviour is identical
// everywhere. The seeded library is small enough to filter in memory (see useExerciseLibrary).
export function ExercisePicker({ visible, title = 'Choose an exercise', onClose, onPick }: ExercisePickerProps) {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { exercises, loading, addCustom } = useExerciseLibrary();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = query.trim();
  const filtered = useMemo(() => {
    if (!trimmed) return exercises;
    const q = trimmed.toLowerCase();
    return exercises.filter((e) => e.name.toLowerCase().includes(q) || (e.muscle_group ?? '').toLowerCase().includes(q));
  }, [exercises, trimmed]);

  // Only offered when nothing in the library already answers what was typed — otherwise every
  // search would invite a near-duplicate ("Bench Press" next to "Bench press"), which would
  // quietly split someone's PR history across two lifts.
  const canCreate = trimmed.length > 1 && !exercises.some((e) => e.name.toLowerCase() === trimmed.toLowerCase());

  function handlePick(exercise: Exercise) {
    setQuery('');
    setError(null);
    onPick(exercise);
  }

  async function handleCreate() {
    if (!session || creating) return;
    setCreating(true);
    setError(null);
    try {
      handlePick(await addCustom(session.user.id, trimmed));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not add that exercise.'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={styles.grab} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={Colors.textTertiary} />
            </Pressable>
          </View>

          <TextInput
            style={styles.search}
            placeholder="Search lifts…"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            maxLength={40}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {canCreate && (
              <Pressable onPress={handleCreate} disabled={creating} style={styles.createRow}>
                <Ionicons name="add-circle-outline" size={17} color={Colors.amber} />
                <Text style={styles.createLabel} numberOfLines={1}>
                  {creating ? 'Adding…' : `Add "${trimmed}" as a new exercise`}
                </Text>
              </Pressable>
            )}

            {loading && exercises.length === 0 && <Text style={styles.empty}>Loading lifts…</Text>}
            {!loading && filtered.length === 0 && !canCreate && <Text style={styles.empty}>No lifts match that.</Text>}

            {filtered.map((exercise) => (
              <Pressable key={exercise.id} onPress={() => handlePick(exercise)} style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name="barbell" size={14} color={Colors.amber} />
                </View>
                <Text style={styles.rowName} numberOfLines={1}>
                  {exercise.name}
                </Text>
                {exercise.muscle_group && <Text style={styles.rowMeta}>{exercise.muscle_group}</Text>}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
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
    // Capped rather than full-screen so the session underneath stays visible — picking a lift
    // is a detour inside a running workout, not a place you navigate to.
    maxHeight: '82%',
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
  search: {
    paddingVertical: 10,
    fontSize: 14,
  },
  list: {
    marginTop: 10,
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
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowName: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  rowMeta: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.lineStrong,
    borderRadius: Radius.card,
    paddingVertical: 10,
    paddingHorizontal: 11,
    marginBottom: 8,
  },
  createLabel: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.amber,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.coral,
    marginTop: Spacing.two,
  },
});
