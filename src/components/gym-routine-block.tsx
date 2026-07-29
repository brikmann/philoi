import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RoutineEditor } from '@/components/routine-editor';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { useRoutines } from '@/hooks/use-routines';
import type { RoutineWithExercises, WorkoutEnergy } from '@/types/database';

type GymRoutineBlockProps = {
  /** Null = Freestyle (log exercises as you go). */
  routineId: string | null;
  onRoutineChange: (routineId: string | null) => void;
  energy: WorkoutEnergy;
  onEnergyChange: (energy: WorkoutEnergy) => void;
};

const ENERGY_OPTIONS: { value: WorkoutEnergy; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'light', label: 'Light', sub: 'ease it off', icon: 'leaf-outline' },
  { value: 'same', label: 'Same', sub: 'as usual', icon: 'reorder-two-outline' },
  { value: 'dialed', label: 'Dialed', sub: 'push it', icon: 'flash' },
];

// Revealed inside the lock-in goal picker the moment GYM is selected (PHILOI_UI_SPEC.md §23,
// design-mocks/23): the routines you've built up, Freestyle, and a one-tap energy state.
//
// The energy chips are GENTLE by design (§23 rule 1) — they nudge the SUGGESTED numbers by
// ~±5% and nothing else. The subtitle says "nudges today's suggested numbers" rather than
// "sets today's targets" precisely because nothing here can constrain what actually gets
// logged; every set stays fully editable in the session logger.
export function GymRoutineBlock({ routineId, onRoutineChange, energy, onEnergyChange }: GymRoutineBlockProps) {
  const { routines, loading, save, remove } = useRoutines();
  const [editing, setEditing] = useState<RoutineWithExercises | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  function openEditor(routine: RoutineWithExercises | null) {
    setEditing(routine);
    setEditorOpen(true);
  }

  async function handleSave(input: { id?: string | null; name: string; exerciseIds: string[] }) {
    const saved = await save(input);
    // A routine you just built is almost certainly the one you're about to do.
    onRoutineChange(saved.id);
  }

  async function handleDelete(id: string) {
    await remove(id);
    if (routineId === id) onRoutineChange(null);
  }

  return (
    <>
      <View style={styles.labelRow}>
        <Text style={styles.label}>Today&apos;s routine</Text>
        {routines.length > 0 && (
          <View style={styles.fromMem}>
            <Ionicons name="time-outline" size={11} color={Colors.amber} />
            <Text style={styles.fromMemText}>from your routines</Text>
          </View>
        )}
      </View>

      {routines.map((routine) => {
        const selected = routineId === routine.id;
        return (
          <Pressable
            key={routine.id}
            onPress={() => onRoutineChange(routine.id)}
            onLongPress={() => openEditor(routine)}
            style={[styles.routine, selected && styles.routineSelected]}>
            <View style={styles.routineIcon}>
              <Ionicons name="barbell" size={15} color={Colors.amber} />
            </View>
            <View style={styles.routineMeta}>
              <Text style={[styles.routineName, selected && styles.routineNameSelected]} numberOfLines={1}>
                {routine.name}
              </Text>
              <Text style={styles.routineExercises} numberOfLines={1}>
                {routine.exercises.map((e) => e.name).join(' · ') || 'No lifts yet'}
              </Text>
            </View>
            <Pressable onPress={() => openEditor(routine)} hitSlop={8} accessibilityLabel={`Edit ${routine.name}`}>
              <Text style={styles.routineCount}>
                {routine.exercises.length} {routine.exercises.length === 1 ? 'lift' : 'lifts'}
              </Text>
            </Pressable>
          </Pressable>
        );
      })}

      <Pressable
        onPress={() => onRoutineChange(null)}
        style={[styles.routine, routineId === null && styles.routineSelected]}>
        <View style={[styles.routineIcon, styles.freestyleIcon]}>
          <Ionicons name="flash-outline" size={15} color={Colors.soloChipText} />
        </View>
        <View style={styles.routineMeta}>
          <Text style={[styles.routineName, routineId === null && styles.routineNameSelected]}>Freestyle</Text>
          <Text style={styles.routineExercises}>
            {loading && routines.length === 0 ? 'Loading your routines…' : 'Log exercises as you go'}
          </Text>
        </View>
      </Pressable>

      <Pressable onPress={() => openEditor(null)} style={styles.newRoutine}>
        <Ionicons name="add" size={14} color={Colors.amber} />
        <Text style={styles.newRoutineLabel}>New routine</Text>
      </Pressable>

      <View style={styles.labelRow}>
        <Text style={styles.label}>Energy today</Text>
        <Text style={styles.labelHint}>nudges today&apos;s suggested numbers</Text>
      </View>

      <View style={styles.moods}>
        {ENERGY_OPTIONS.map((option) => {
          const selected = energy === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onEnergyChange(option.value)}
              style={[styles.mood, selected && styles.moodSelected]}>
              <Ionicons name={option.icon} size={15} color={Colors.amber} />
              <Text style={[styles.moodLabel, selected && styles.moodLabelSelected]}>{option.label}</Text>
              <Text style={[styles.moodSub, selected && styles.moodSubSelected]}>{option.sub}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Mounted only while open, and keyed by what's being edited — that's what lets the
          editor seed its draft straight from props at mount instead of syncing them in an
          effect (see routine-editor.tsx). */}
      {editorOpen && (
        <RoutineEditor
          key={editing?.id ?? 'new'}
          visible
          routine={editing}
          onClose={() => setEditorOpen(false)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 7,
  },
  label: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  labelHint: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textTertiary,
  },
  fromMem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  fromMemText: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.amber,
  },
  routine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.cream,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: Radius.card,
    paddingVertical: 10,
    paddingHorizontal: 11,
    marginBottom: 7,
  },
  routineSelected: {
    borderColor: Colors.coral,
    backgroundColor: Colors.selectedBg,
  },
  routineIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  freestyleIcon: {
    backgroundColor: Colors.disabled,
  },
  routineMeta: {
    flex: 1,
    minWidth: 0,
  },
  routineName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  routineNameSelected: {
    color: Colors.achieverText,
  },
  routineExercises: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
    marginTop: 1,
  },
  routineCount: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  newRoutine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.lineStrong,
    borderRadius: Radius.card,
    paddingVertical: 9,
  },
  newRoutineLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.amber,
  },
  moods: {
    flexDirection: 'row',
    gap: 6,
  },
  mood: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.cream,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 11,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  moodSelected: {
    borderColor: Colors.coral,
    backgroundColor: Colors.selectedBg,
  },
  moodLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.muted,
    marginTop: 3,
  },
  moodLabelSelected: {
    color: Colors.achieverText,
  },
  moodSub: {
    fontFamily: Fonts.body,
    fontSize: 9,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  moodSubSelected: {
    color: Colors.warmSubtext,
  },
});
