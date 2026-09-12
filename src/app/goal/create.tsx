import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  TaxonomyTwoTap,
  taxonomyStepCopy,
  type TaxonomySecondChoice,
  type TaxonomyStep,
} from '@/components/taxonomy-two-tap';
import { PrimaryButton } from '@/components/ui/primary-button';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchMyCourses } from '@/lib/api/courses';
import { createGoal } from '@/lib/api/goals';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { GOAL_CADENCE_PRESETS, GOAL_TYPE_META, categoryForGoalType, goalTypeForChoice } from '@/lib/goal-types';
import type { FitnessActivity, GoalType, LockInCategory } from '@/types/database';

/**
 * ── THIS SCREEN COULD WRITE A TYPE THE SCHEMA NO LONGER HAS ──────────────────────────────────
 *
 * It rendered the flat six-tile GOAL_TYPES grid, which still offers `job_applications` and
 * `read`. 0182 collapsed the taxonomy to two taps and three live relic families, and reading and
 * job apps became Custom COURSES under Studying rather than types of their own -- so every goal
 * created from the old grid under one of those tiles landed on a type nothing aggregates. The
 * hours were real and reached no ladder, which is invisible rather than broken, and therefore
 * worse.
 *
 * Now it mounts the same <TaxonomyTwoTap> the lock-in sheet does. `goalTypeForChoice` is the only
 * thing that decides the stored type, and it can only answer 'study', 'run' or 'gym'.
 *
 * WHAT IS NOT STORED, and why: 0182 added `category`/`activity`/`course_id` to `check_ins` and
 * `lock_in_sessions` only -- `goals` (0002) has no such columns, and adding them is a migration
 * this change is explicitly not allowed to make. So the two-tap choice is persisted the way this
 * table can hold it: `type` carries the discipline, and a chosen course carries its own name into
 * `label`. That is exactly how the lock-in sheet already treats "KP231 under Study" -- the label
 * names the goal and `type` is what economy_evaluate_relics aggregates on (0119 §7) -- so a goal
 * created here and one created from the sheet are the same row.
 */
export default function CreateGoalScreen() {
  const router = useRouter();
  const { session } = useAuth();
  // Opened from the lock-in picker's "+ New" chip with the category the user was already looking
  // at. Landing on Gym regardless of where they came from is how a "KP231 under Study" ends up
  // filed under something else — and the type is the ONLY thing that decides which discipline
  // ladder the hours reach (0119 §3), so getting it wrong here is not cosmetic.
  //
  // The chip sends a GoalType, which is what it has. Mapped back through the same table the
  // picker derives with so the two taps open already standing where the user was.
  const params = useLocalSearchParams<{ type?: string }>();
  const seeded = seedFromParam(params.type);

  const [step, setStep] = useState<TaxonomyStep>(seeded ? 'second' : 'category');
  const [category, setCategory] = useState<LockInCategory | null>(seeded?.category ?? null);
  const [activity, setActivity] = useState<FitnessActivity | null>(seeded?.activity ?? null);
  const [courseId, setCourseId] = useState<string | null>(null);
  // Null until tap 2 lands. Until then there is nothing to name and nothing to create, which is
  // why the whole lower half of this screen is gated on it.
  const [chosen, setChosen] = useState<GoalType | null>(null);
  const [label, setLabel] = useState('');
  const [cadence, setCadence] = useState(GOAL_CADENCE_PRESETS.gym[1]);
  const [customCadence, setCustomCadence] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepCopy = taxonomyStepCopy(step, category);

  function chooseCategory(next: LockInCategory) {
    setCategory(next);
    setActivity(null);
    setCourseId(null);
    setChosen(null);
    setStep('second');
  }

  /**
   * Tap 2. Unlike the lock-in sheet this only ever SELECTS -- a goal needs a name and a cadence
   * before it exists, so starting on tap 2 would create it before the user had said what it was.
   *
   * The choice is passed in rather than read back from state for the same reason it is in the
   * sheet: a setState is not visible to the tick that scheduled it.
   */
  function chooseSecond(next: TaxonomySecondChoice) {
    if (!category) return;
    const nextActivity = next.activity ?? null;
    const nextCourseId = next.courseId ?? null;
    setActivity(nextActivity);
    setCourseId(nextCourseId);
    const type = goalTypeForChoice(category, nextActivity);
    setChosen(type);
    if (!customCadence) setCadence(GOAL_CADENCE_PRESETS[type][0]);
    // A course IS the goal's name. Picking KP390 and then being handed an empty "give it a name"
    // field is asking the same question twice, and the answer that makes the goal count toward
    // that course is the one the row already knows.
    if (nextCourseId) void nameFromCourse(nextCourseId);
  }

  async function nameFromCourse(id: string) {
    try {
      const courses = await fetchMyCourses();
      const course = courses.find((c) => c.id === id);
      // Only ever PRE-fills. If the user has already typed something it is theirs, and a course
      // tapped afterwards must not overwrite it.
      if (course) setLabel((current) => current.trim() || course.code || course.title);
    } catch {
      // Silent: the name field is right there and still works. Same posture as every other
      // optional read behind this taxonomy.
    }
  }

  function goBack() {
    setStep('category');
    setCategory(null);
    setActivity(null);
    setCourseId(null);
    setChosen(null);
  }

  async function handleCreate() {
    if (!session || !chosen) return;
    setLoading(true);
    setError(null);
    try {
      await createGoal({
        userId: session.user.id,
        type: chosen,
        label: label.trim() || null,
        cadence: cadence.trim(),
      });
      router.back();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not create your goal.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {step === 'second' && (
          <Pressable onPress={goBack} style={styles.back} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.backLabel}>‹ Back</Text>
          </Pressable>
        )}

        <Text style={styles.title}>{stepCopy.title}</Text>
        <Text style={styles.subtitle}>{stepCopy.subtitle}</Text>

        <TaxonomyTwoTap
          step={step}
          category={category}
          activity={activity}
          courseId={courseId}
          onChooseCategory={chooseCategory}
          onChooseSecond={chooseSecond}
        />

        {/* Everything below is the goal itself, and none of it means anything until the two taps
            have said which discipline it belongs to. */}
        {chosen && (
          <>
            <Text style={styles.label}>Give it a name (optional)</Text>
            <Text style={styles.help}>
              A named goal stays a {GOAL_TYPE_META[chosen].label} goal — &ldquo;KP231&rdquo; under Study still counts
              toward Study&rsquo;s totals and its relic. Re-using a name you already have just opens that goal again.
            </Text>
            <TextInput
              placeholder={`e.g. ${GOAL_TYPE_META[chosen].label}`}
              value={label}
              onChangeText={setLabel}
              maxLength={40}
            />

            <Text style={styles.label}>Cadence</Text>
            <View style={styles.row}>
              {GOAL_CADENCE_PRESETS[chosen].map((preset) => (
                <Pressable
                  key={preset}
                  onPress={() => {
                    setCadence(preset);
                    setCustomCadence(false);
                  }}
                  style={[styles.chip, !customCadence && cadence === preset && styles.chipSelected]}>
                  <Text style={[styles.chipText, !customCadence && cadence === preset && styles.chipTextSelected]}>
                    {preset}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => {
                  setCustomCadence(true);
                  setCadence('');
                }}
                style={[styles.chip, customCadence && styles.chipSelected]}>
                <Text style={[styles.chipText, customCadence && styles.chipTextSelected]}>Custom</Text>
              </Pressable>
            </View>
            {customCadence && (
              <TextInput
                placeholder="e.g. 2x/week, every other day"
                value={cadence}
                onChangeText={setCadence}
                maxLength={20}
              />
            )}

            {error && <Text style={styles.error}>{error}</Text>}
            <PrimaryButton label="Start this goal" onPress={handleCreate} loading={loading} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * The `type` route param, as a place to stand in the two taps.
 *
 * Only the three live families can be honoured. A param naming a retired type (an old deep link,
 * or a notification queued before the build that stopped writing them) resolves to null and the
 * user simply starts at tap 1 — which is the correct answer to "open the picker at a category
 * that no longer exists", and much better than filing them under a guess.
 */
function seedFromParam(
  raw: string | undefined
): { category: LockInCategory; activity: FitnessActivity | null } | null {
  if (raw !== 'study' && raw !== 'run' && raw !== 'gym') return null;
  return categoryForGoalType(raw);
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    padding: Spacing.four,
    gap: Spacing.two,
    // Was Colors.cream, an opaque flat fill that painted over the deep-purple radial. These
    // screens don't route through <Screen>, so the radial reaches them from the navigator's
    // scene background — an opaque colour here blocks it (Ember reskin sweep).
    backgroundColor: 'transparent',
  },
  back: {
    alignSelf: 'flex-start',
  },
  backLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.ink,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    marginBottom: Spacing.two,
  },
  help: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    lineHeight: 17,
    marginTop: -4,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
    marginTop: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  chip: {
    borderWidth: 2,
    borderColor: Colors.line,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  chipSelected: {
    borderColor: Colors.coral,
    backgroundColor: Colors.coral,
  },
  chipText: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.ink,
  },
  chipTextSelected: {
    color: Colors.ink,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    marginTop: Spacing.two,
  },
});
