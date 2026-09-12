import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { addCourse, fetchMyCourses } from '@/lib/api/courses';
import { useAuth } from '@/lib/auth/auth-context';
import {
  FITNESS_ACTIVITIES,
  FITNESS_ACTIVITY_META,
  LOCK_IN_CATEGORIES,
  LOCK_IN_CATEGORY_META,
} from '@/lib/goal-types';
import type { FitnessActivity, LockInCategory, UserCourse } from '@/types/database';

// ── THE TWO-TAP TAXONOMY, AS ONE COMPONENT (0182, design-mocks/194-lockin-two-tap.html) ──────
//
// This was the inside of lockin-goal-picker.tsx and nothing else could reach it, which is why
// goal/create.tsx and group/create.tsx were still rendering the pre-0182 flat six-type list --
// the two screens that could still write a `deep_work`/`meditate`/`read`/`job_applications` the
// schema no longer has. Extracted rather than copied: a second picker is a second answer to
// "what are the choices", and the first thing that drifts is the labels.
//
// CONTROLLED, not self-driving. The host owns `category`/`activity`/`courseId` because each host
// does something different with the choice at the moment it is made -- the lock-in sheet STARTS a
// session on tap 2 (unless its Options drawer is open), while a create screen only selects and
// waits for a name and a Create button. A component that owned the state would have to be told
// which of those it was, which is just the host's own state with a flag on it.
//
// What DOES live here is everything identical in all three: the tap-1 cards, the course list, the
// Custom row, the add-a-course form, the Cardio/Strength rows, and the styles for them.

export type TaxonomyStep = 'category' | 'second';

/** What tap 2 produced. Exactly one of the two is meaningful, decided by the category. */
export type TaxonomySecondChoice = { activity?: FitnessActivity | null; courseId?: string | null };

/**
 * The header above the rows, which changes with the step and the category.
 *
 * Exported because each host draws its own header chrome -- the sheet has a grab handle and a
 * Back affordance, a create screen has neither -- but the WORDS have to be the same words.
 */
export function taxonomyStepCopy(
  step: TaxonomyStep,
  category: LockInCategory | null
): { title: string; subtitle: string } {
  if (step === 'category') return { title: 'Lock in', subtitle: "Pick what you're focusing on." };
  if (category === 'study') return { title: 'Which course?', subtitle: 'Your lock-in counts toward it.' };
  return { title: 'What kind?', subtitle: 'Feeds your discipline relics.' };
}

type TaxonomyTwoTapProps = {
  step: TaxonomyStep;
  category: LockInCategory | null;
  activity: FitnessActivity | null;
  courseId: string | null;
  onChooseCategory: (next: LockInCategory) => void;
  onChooseSecond: (next: TaxonomySecondChoice) => void;
  /**
   * Whether the courses read should run. The sheet passes its own `visible` so a closed modal
   * isn't fetching; a create screen is its own screen and simply leaves this true.
   */
  active?: boolean;
};

export function TaxonomyTwoTap({
  step,
  category,
  activity,
  courseId,
  onChooseCategory,
  onChooseSecond,
  active = true,
}: TaxonomyTwoTapProps) {
  const { session } = useAuth();
  const [courses, setCourses] = useState<UserCourse[]>([]);
  const [addingCourse, setAddingCourse] = useState(false);
  const [newCourseCode, setNewCourseCode] = useState('');
  const [newCourseTitle, setNewCourseTitle] = useState('');

  // The member's courses, for tap 2 under Studying. Silent on failure: the "Custom" row below the
  // list still starts a study session, so an unreachable list degrades to the flow that existed
  // before courses did.
  //
  // A request counter rather than a `mounted` flag -- an effect cleanup runs on every dep change,
  // not only on unmount, so the flag version cancels the fetch it just started whenever `active`
  // flips. Comparing ids only ever discards a response a newer one has already superseded.
  const latestCoursesReq = useRef(0);
  useEffect(() => {
    if (!active) return;
    const req = latestCoursesReq.current + 1;
    latestCoursesReq.current = req;
    fetchMyCourses()
      .then((rows) => {
        if (latestCoursesReq.current === req) setCourses(rows);
      })
      .catch(() => {
        if (latestCoursesReq.current === req) setCourses([]);
      });
  }, [active]);

  // Clearing the half-typed course form here rather than in an effect keyed on `step`: the hosts
  // reset their own step in three different places, and a setState in an effect body is the
  // cascading-render pattern this codebase lints against. Tap 1 is the only way back into the
  // course list, so clearing on it covers every route in.
  function handleCategory(next: LockInCategory) {
    setAddingCourse(false);
    onChooseCategory(next);
  }

  async function saveNewCourse() {
    const title = newCourseTitle.trim() || newCourseCode.trim();
    if (!session || !title) return;
    try {
      const created = await addCourse(session.user.id, title, newCourseCode.trim() || null);
      setCourses((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]));
      setAddingCourse(false);
      setNewCourseCode('');
      setNewCourseTitle('');
      onChooseSecond({ courseId: created.id });
    } catch {
      // Silent, same as the read above: the Custom row still starts a study session, so a failed
      // save costs the label, never the lock-in.
      setAddingCourse(false);
    }
  }

  return (
    <>
      {/* ── TAP 1 ── Two cards, bare labels, no subtitles (mock 194). The first screen asks
          exactly one question, which is the entire point of the redesign. */}
      {step === 'category' && (
        <View style={styles.bigCards}>
          {LOCK_IN_CATEGORIES.map((cat) => (
            <Pressable
              key={cat}
              onPress={() => handleCategory(cat)}
              accessibilityRole="button"
              accessibilityLabel={LOCK_IN_CATEGORY_META[cat].label}
              style={styles.bigCard}>
              <View style={styles.bigCardIcon}>
                <DisciplineIcon name={LOCK_IN_CATEGORY_META[cat].glyph} size={26} color={Colors.amber} />
              </View>
              <Text style={styles.bigCardLabel}>{LOCK_IN_CATEGORY_META[cat].label}</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      )}

      {/* ── TAP 2A ── the member's own courses. */}
      {step === 'second' && category === 'study' && (
        <View style={styles.rows}>
          {courses.map((course) => (
            <Pressable
              key={course.id}
              onPress={() => onChooseSecond({ courseId: course.id })}
              accessibilityRole="button"
              style={[styles.row, courseId === course.id && styles.rowSelected]}>
              <View style={styles.rowDot}>
                {/* The numeric tail of the code ("390"), as the mock draws it. Falls back to
                    an initial for a course with no code — a Custom entry someone named. */}
                <Text style={styles.rowDotText}>
                  {course.code?.replace(/^[A-Za-z]+/, '') || course.title.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{course.code ?? course.title}</Text>
                {course.code ? <Text style={styles.rowSub}>{course.title}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={15} color={Colors.textTertiary} />
            </Pressable>
          ))}

          {/* "Custom" is a real destination, not a fallback: reading, job apps and side
              projects stopped being their own lock-in types and live here. */}
          <Pressable
            onPress={() => onChooseSecond({ courseId: null })}
            accessibilityRole="button"
            style={[styles.row, styles.rowDashed]}>
            <View style={[styles.rowDot, styles.rowDotDashed]}>
              <Ionicons name="ellipsis-horizontal" size={14} color={Colors.muted} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Custom</Text>
              <Text style={styles.rowSub}>Reading, job apps, side project…</Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={Colors.textTertiary} />
          </Pressable>

          {addingCourse ? (
            <View style={styles.addCourse}>
              <View style={styles.addCourseFields}>
                <TextInput
                  style={[styles.courseInput, styles.addCourseCode]}
                  value={newCourseCode}
                  onChangeText={setNewCourseCode}
                  placeholder="KP390"
                  placeholderTextColor={Colors.textTertiary}
                  autoCapitalize="characters"
                  maxLength={10}
                />
                <TextInput
                  style={styles.courseInput}
                  value={newCourseTitle}
                  onChangeText={setNewCourseTitle}
                  placeholder="Data Analysis"
                  placeholderTextColor={Colors.textTertiary}
                  maxLength={80}
                />
              </View>
              <Pressable
                onPress={() => void saveNewCourse()}
                disabled={!newCourseCode.trim() && !newCourseTitle.trim()}
                accessibilityRole="button"
                style={[
                  styles.addCourseSave,
                  !newCourseCode.trim() && !newCourseTitle.trim() && styles.addCourseSaveDisabled,
                ]}>
                <Text style={styles.addCourseSaveLabel}>Add & start</Text>
              </Pressable>
            </View>
          ) : (
            // Without this the list can only ever hold what 0182 seeded from history, which
            // for most members is nothing — the picker would be a Custom row and no courses.
            <Pressable
              onPress={() => setAddingCourse(true)}
              accessibilityRole="button"
              style={[styles.row, styles.rowDashed]}>
              <View style={[styles.rowDot, styles.rowDotDashed]}>
                <Ionicons name="add" size={15} color={Colors.amber} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Add a course</Text>
                <Text style={styles.rowSub}>Code and name — it stays in this list</Text>
              </View>
            </Pressable>
          )}
        </View>
      )}

      {/* ── TAP 2B ── which ladder this hour climbs. */}
      {step === 'second' && category === 'fitness' && (
        <View style={styles.rows}>
          {FITNESS_ACTIVITIES.map((act) => {
            const meta = FITNESS_ACTIVITY_META[act];
            return (
              <Pressable
                key={act}
                onPress={() => onChooseSecond({ activity: act })}
                accessibilityRole="button"
                accessibilityLabel={meta.label}
                style={[styles.row, activity === act && styles.rowSelected]}>
                <View style={styles.rowDot}>
                  <DisciplineIcon name={meta.glyph} size={16} color={Colors.ink} />
                </View>
                <View style={styles.rowText}>
                  <View style={styles.rowLabelLine}>
                    <Text style={styles.rowLabel}>{meta.label}</Text>
                    {meta.autoStrava && (
                      <View style={styles.autoPill}>
                        <Text style={styles.autoPillLabel}>Auto · Strava</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.rowSub}>{meta.sub}</Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={Colors.textTertiary} />
              </Pressable>
            );
          })}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  bigCards: {
    gap: Spacing.two,
  },

  // Deliberately tall and bare. The mock gives tap 1 two cards and no subtitles, because the
  // whole redesign is that the first screen asks exactly one question.
  bigCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 18,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    backgroundColor: Colors.selectedBg,
  },

  bigCardIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.achieverBg,
  },

  bigCardLabel: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },

  rows: {
    gap: Spacing.two,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 12,
    paddingHorizontal: 13,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.selectedBg,
  },

  // In the lock-in sheet this is only ever visible with Options open, since a tap otherwise starts
  // the session outright. On the create screens it is the ordinary resting state: tap 2 selects,
  // and the row stays lit while the member names the thing and presses Create.
  rowSelected: {
    borderColor: Colors.amber,
    backgroundColor: Colors.achieverBg,
  },

  rowDot: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.disabled,
  },

  rowDotText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ink,
  },

  rowDotDashed: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.lineStrong,
  },

  rowDashed: {
    borderStyle: 'dashed',
    borderColor: Colors.lineStrong,
    backgroundColor: 'transparent',
  },

  rowText: {
    flex: 1,
    gap: 1,
  },

  rowLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },

  rowLabelLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  rowSub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
  },

  autoPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.achieverBg,
  },

  autoPillLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    color: Colors.achieverText,
  },

  addCourse: {
    gap: Spacing.two,
    padding: 13,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.lineStrong,
  },

  addCourseFields: {
    gap: Spacing.two,
  },

  addCourseCode: {
    // Short field for a short value -- a code is six characters, not a sentence.
    maxWidth: 130,
  },

  // The sheet's `detailInput`, which stayed behind with the free-text detail field it is also
  // used by. Borderless on purpose: the dashed `addCourse` box around it is the border.
  courseInput: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.ink,
    padding: 0,
  },

  addCourseSave: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.button,
    backgroundColor: Colors.achieverBg,
  },

  addCourseSaveDisabled: {
    backgroundColor: Colors.disabled,
  },

  addCourseSaveLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.achieverText,
  },
});
