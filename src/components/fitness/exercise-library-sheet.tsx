import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EmberSearchBar } from '@/components/ui/ember-search-bar';
import { SpaceButton, SpaceChip, SpaceSection, SpaceTile, SPACE_GUTTER } from '@/components/ui/space-kit';
import { TextInput } from '@/components/ui/text-input';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { createExercise, searchExerciseLibrary } from '@/lib/api/stats';
import { getErrorMessage } from '@/lib/errors';
import type { ExerciseLibraryRow, ExerciseUnit } from '@/types/house';

// "Rank by exercise" (mock 294): any movement can have a board. Search the shared library, or name a
// new one — it joins the library, de-duped by normalized name, so "weighted pull up" and "Weighted
// Pull-Up!" are one board. A community name only shows to others once two people have logged it
// (0265), so a one-off typo never surfaces.
//
// This is the BOARD's picker, separate from the gym logger's exercise-picker.tsx: it picks a board,
// it never adds an exercise to a workout.

export type PickedExercise = { slug: string; name: string; unit: ExerciseUnit; muscleGroup: string | null };

export const MUSCLE_GROUPS = ['arms', 'back', 'chest', 'core', 'legs', 'shoulders', 'full_body', 'cardio'] as const;
type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  arms: 'Arms',
  back: 'Back',
  chest: 'Chest',
  core: 'Core',
  legs: 'Legs',
  shoulders: 'Shoulders',
  full_body: 'Full body',
  cardio: 'Cardio',
};

const MUSCLE_EMOJI: Record<MuscleGroup, string> = {
  arms: '💪',
  back: '🪢',
  chest: '🏋️',
  core: '🧱',
  legs: '🦵',
  shoulders: '🤸',
  full_body: '🏗️',
  cardio: '🏃',
};

const UNITS: ExerciseUnit[] = ['weight', 'reps', 'time', 'distance'];
const UNIT_LABEL: Record<ExerciseUnit, string> = { weight: 'Weight', reps: 'Reps', time: 'Time', distance: 'Distance' };
const UNIT_HINT: Record<ExerciseUnit, string> = {
  weight: 'weight × reps',
  reps: 'bodyweight reps',
  time: 'held for time',
  distance: 'distance covered',
};

export function muscleLabel(group: string | null | undefined): string | null {
  return group && group in MUSCLE_LABEL ? MUSCLE_LABEL[group as MuscleGroup] : null;
}

function muscleEmoji(group: string | null | undefined): string {
  return group && group in MUSCLE_EMOJI ? MUSCLE_EMOJI[group as MuscleGroup] : '🏋️';
}

/** Mirrors exercise_slug() (0265) — only a fallback for when the library can't name a just-created row. */
function localSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatLifters(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/** The library as a page — the metric picker hosts it in its own sheet; ExerciseLibrarySheet wraps it. */
export function ExerciseLibraryPanel({ onPick, onBack }: { onPick: (exercise: PickedExercise) => void; onBack?: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ExerciseLibraryRow[]>([]);
  const [searching, setSearching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    // An empty query is the popular list, so this runs on open too.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the spinner follows each debounced search
    setSearching(true);
    let live = true;
    const timeout = setTimeout(() => {
      searchExerciseLibrary(query)
        .then((rows) => {
          if (!live) return;
          setError(null);
          setResults(rows);
        })
        .catch((e) => {
          if (!live) return;
          setResults([]);
          setError(getErrorMessage(e, 'Could not search the exercise library.'));
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timeout);
    };
  }, [query]);

  if (creating) {
    return <CreateExerciseForm initialName={query.trim()} onCancel={() => setCreating(false)} onCreated={onPick} />;
  }

  return (
    <View style={styles.panel}>
      <View style={styles.headRow}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back to stats">
            <UiGlyph name="back" size={18} color={Colors.ink} />
          </Pressable>
        ) : null}
        <Text style={styles.title}>Rank by exercise</Text>
      </View>
      <EmberSearchBar value={query} onChangeText={setQuery} placeholder="Search bench, pull-ups, hip thrust…" />
      <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
        <SpaceSection>{query.trim() ? 'Matches' : 'Popular'}</SpaceSection>
        {searching && results.length === 0 ? <ActivityIndicator color={Colors.navEmber} style={styles.spinner} /> : null}
        {error ? <Text style={styles.empty}>{error}</Text> : null}
        {!searching && !error && results.length === 0 ? (
          <Text style={styles.empty}>Nothing by that name yet — create it below and it gets a board.</Text>
        ) : null}
        {results.map((r) => {
          const muscle = muscleLabel(r.muscle_group);
          return (
            <Pressable
              key={r.slug}
              style={styles.result}
              onPress={() => onPick({ slug: r.slug, name: r.name, unit: r.unit, muscleGroup: r.muscle_group })}
              accessibilityRole="button">
              <SpaceTile>
                <Text style={styles.resultEmoji}>{muscleEmoji(r.muscle_group)}</Text>
              </SpaceTile>
              <View style={styles.resultWho}>
                <Text style={styles.resultName} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={styles.resultSub} numberOfLines={1}>
                  {[muscle, UNIT_HINT[r.unit]].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={styles.lifters}>
                {formatLifters(r.lifters)} {r.lifters === 1 ? 'lifter' : 'lifters'}
              </Text>
            </Pressable>
          );
        })}
        <Pressable style={styles.create} onPress={() => setCreating(true)} accessibilityRole="button">
          <View style={styles.createHead}>
            <UiGlyph name="add" size={14} color={Colors.navEmber2} />
            <Text style={styles.createTitle}>Create an exercise</Text>
          </View>
          <Text style={styles.createSub}>Name it, set the unit — it joins the library</Text>
        </Pressable>
        <Text style={styles.note}>Any movement can have a board — community-shared, de-duped by name.</Text>
      </ScrollView>
    </View>
  );
}

function CreateExerciseForm({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string;
  onCancel: () => void;
  onCreated: (exercise: PickedExercise) => void;
}) {
  const [name, setName] = useState(initialName);
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [unit, setUnit] = useState<ExerciseUnit>('weight');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim().replace(/\s+/g, ' ');

  async function handleCreate() {
    if (busy || trimmed.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createExercise(trimmed, muscle, unit);
      // create_exercise returns an id, not a slug. It may have matched an existing row ("bench
      // press" → the built-in), so read the library's own row back for the canonical name and unit.
      const match = (await searchExerciseLibrary(trimmed).catch(() => [] as ExerciseLibraryRow[])).find((r) => r.exercise_id === id);
      onCreated(
        match
          ? { slug: match.slug, name: match.name, unit: match.unit, muscleGroup: match.muscle_group }
          : { slug: localSlug(trimmed), name: trimmed, unit, muscleGroup: muscle }
      );
    } catch (e) {
      // The server's own words — the length rule and the name filter (0242) read fine as-is.
      setError(getErrorMessage(e, 'Could not create that exercise.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.panel} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <View style={styles.headRow}>
        <Pressable onPress={onCancel} hitSlop={10} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back to the library">
          <UiGlyph name="back" size={18} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>Create an exercise</Text>
      </View>
      <TextInput value={name} onChangeText={setName} placeholder="Weighted pull-up" maxLength={40} autoFocus={!initialName} />

      <SpaceSection>Muscle group</SpaceSection>
      <View style={styles.chips}>
        {MUSCLE_GROUPS.map((g) => (
          <SpaceChip key={g} label={MUSCLE_LABEL[g]} selected={muscle === g} onPress={() => setMuscle(muscle === g ? null : g)} />
        ))}
      </View>

      <SpaceSection>What a set measures</SpaceSection>
      <View style={styles.chips}>
        {UNITS.map((u) => (
          <SpaceChip key={u} label={UNIT_LABEL[u]} selected={unit === u} onPress={() => setUnit(u)} />
        ))}
      </View>
      <Text style={styles.note}>{UNIT_HINT[unit]} — the board ranks on this, so pick it carefully.</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <SpaceButton label="Create & open its board" onPress={handleCreate} loading={busy} disabled={trimmed.length < 2} />
    </ScrollView>
  );
}

/** The library on its own — the exercise board's "change exercise". */
export function ExerciseLibrarySheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (exercise: PickedExercise) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.grabber} />
            {visible ? <ExerciseLibraryPanel onPick={onPick} /> : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const sheetStyles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.spacePanel,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.spaceLine,
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.five,
    height: '82%',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.spaceLine,
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
});

const styles = StyleSheet.create({
  ...sheetStyles,
  panel: {
    flex: 1,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.twelve,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: Colors.ink,
  },
  results: {
    flex: 1,
    marginTop: Spacing.two,
  },
  spinner: {
    marginVertical: Spacing.three,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
    paddingVertical: Spacing.two,
  },
  // SpaceRow's panel look; not SpaceRow itself, which has no slot for the lifter count's colour.
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 10,
    paddingHorizontal: Spacing.twelve,
    marginBottom: Spacing.two,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  resultEmoji: {
    fontSize: 18,
    textAlign: 'center',
  },
  resultWho: {
    flex: 1,
    minWidth: 0,
  },
  resultName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  resultSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
  },
  lifters: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.navEmber2,
  },
  create: {
    marginTop: Spacing.three,
    padding: Spacing.twelve,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.navEmber,
    backgroundColor: 'rgba(255,122,47,0.08)',
  },
  createHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  createTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.navEmber2,
  },
  createSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceDim,
    marginTop: 2,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
    marginTop: Spacing.twelve,
  },
  form: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.danger,
  },
});
