import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ExerciseLibraryPanel, sheetStyles, type PickedExercise } from '@/components/fitness/exercise-library-sheet';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { SpaceSection, SpaceTile } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { MetricCatalogRow } from '@/types/house';

// "Rank by…" (mock 289): the Fitness board isn't one number. The fitness half of the stat library,
// grouped the way the mock reads — Cardio, Strength, Consistency — plus "Any exercise…", which turns
// the same sheet into the exercise library (mock 294) rather than stacking a second Modal on this
// one (iOS drops a Modal presented while another is still dismissing).

type Group = { key: string; label: string; rows: MetricCatalogRow[] };

const GROUP_ORDER: { key: string; label: string }[] = [
  { key: 'run', label: 'Cardio' },
  { key: 'gym', label: 'Strength' },
  { key: 'consistency', label: 'Consistency' },
];

/** One line under each stat — what it actually counts. */
function metricHint(row: MetricCatalogRow): string {
  if (row.metric.startsWith('ex:')) return 'top est. 1RM · needs a logged set';
  switch (row.unit) {
    case 'metres':
      return row.metric_window === '30d' ? 'km, from Strava · last 30 days' : 'single-run distance';
    case 'seconds':
      return 'hours logged · last 30 days';
    case 'lb':
      return 'total weight moved';
    case 'days':
      return 'consecutive active days';
    default:
      return row.metric_window === '30d' ? 'total · last 30 days' : 'total';
  }
}

export function fitnessGroups(catalog: MetricCatalogRow[]): Group[] {
  const fitness = catalog.filter((r) => r.fitness).sort((a, b) => a.sort - b.sort);
  return GROUP_ORDER.map((g) => ({
    ...g,
    // Run and gym keep their own group; anything else (the day streak) is consistency.
    rows: fitness.filter((r) => (r.group_key === 'run' || r.group_key === 'gym' ? r.group_key : 'consistency') === g.key),
  })).filter((g) => g.rows.length > 0);
}

export function MetricPickerSheet({
  visible,
  catalog,
  selectedKey,
  onPick,
  onPickExercise,
  onClose,
}: {
  visible: boolean;
  catalog: MetricCatalogRow[];
  /** The catalog key on the board now, ticked. */
  selectedKey: string | null;
  onPick: (row: MetricCatalogRow) => void;
  onPickExercise: (exercise: PickedExercise) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState<'stats' | 'exercise'>('stats');
  const groups = fitnessGroups(catalog);

  const close = () => {
    setPage('stats');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView style={sheetStyles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={sheetStyles.backdrop} onPress={close}>
          <Pressable style={sheetStyles.sheet} onPress={() => {}}>
            <View style={sheetStyles.grabber} />
            {page === 'exercise' ? (
              <ExerciseLibraryPanel
                onBack={() => setPage('stats')}
                onPick={(exercise) => {
                  setPage('stats');
                  onPickExercise(exercise);
                }}
              />
            ) : (
              <>
                <View style={styles.headRow}>
                  <Text style={styles.title}>Rank by…</Text>
                  <Pressable onPress={close} hitSlop={10} accessibilityRole="button">
                    <Text style={styles.done}>Done</Text>
                  </Pressable>
                </View>
                <ScrollView style={styles.list}>
                  {groups.length === 0 ? <Text style={styles.empty}>The stat library didn&apos;t load. Close this and pull the board down to try again.</Text> : null}
                  {groups.map((g) => (
                    <View key={g.key}>
                      <SpaceSection>{g.label}</SpaceSection>
                      {g.rows.map((r) => {
                        const on = r.key === selectedKey;
                        return (
                          <Pressable
                            key={r.key}
                            style={[styles.row, on && styles.rowOn]}
                            onPress={() => {
                              onPick(r);
                              close();
                            }}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}>
                            <SpaceTile tone={on ? 'ember' : 'panel'}>
                              <Text style={styles.emoji}>{r.emoji}</Text>
                            </SpaceTile>
                            <View style={styles.who}>
                              <Text style={styles.label}>{r.label}</Text>
                              <Text style={styles.hint}>{metricHint(r)}</Text>
                            </View>
                            {on ? <UiGlyph name="check" size={16} color={Colors.navEmber} /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                  <SpaceSection>Any exercise</SpaceSection>
                  <Pressable style={styles.row} onPress={() => setPage('exercise')} accessibilityRole="button">
                    <SpaceTile>
                      <NavGlyph name="search" size={18} color={Colors.spaceDim} />
                    </SpaceTile>
                    <View style={styles.who}>
                      <Text style={styles.label}>Any exercise…</Text>
                      <Text style={styles.hint}>search the library or create one — every exercise gets a board</Text>
                    </View>
                    <UiGlyph name="forward" size={14} color={Colors.spaceFaint} />
                  </Pressable>
                  <Text style={styles.note}>Every metric re-ranks the board live, within whatever scope you picked.</Text>
                </ScrollView>
              </>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  title: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: Colors.ink,
  },
  done: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.navEmber2,
  },
  list: {
    flex: 1,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
    paddingVertical: Spacing.three,
  },
  // SpaceRow's panel, with the kit's ember selected state (SpaceRow has none).
  row: {
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
  rowOn: {
    backgroundColor: 'rgba(255,122,47,0.12)',
    borderColor: Colors.navEmber,
  },
  emoji: {
    fontSize: 18,
    textAlign: 'center',
  },
  who: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
});
