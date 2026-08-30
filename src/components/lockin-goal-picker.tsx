import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SessionAudioPicker } from '@/components/economy/session-audio-picker';
import { GymRoutineBlock } from '@/components/gym-routine-block';
import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useActiveCircleLockIns } from '@/hooks/use-active-circle-lockins';
import { useMyGroups } from '@/hooks/use-my-groups';
import { fetchLockinTimeGoals } from '@/lib/api/challenges';
import { fetchMyGoals } from '@/lib/api/goals';
import { useAuth } from '@/lib/auth/auth-context';
import { setSessionAudioChoice } from '@/lib/economy/equipped-audio';
import { GOAL_TYPES, GOAL_TYPE_GLYPH, GOAL_TYPE_META } from '@/lib/goal-types';
import type { Challenge, Goal, GoalType, WorkoutEnergy } from '@/types/database';

type LockinGoalPickerProps = {
  visible: boolean;
  onClose: () => void;
  // Set when opened from inside a campfire's timeline — that campfire is fixed and the
  // solo/campfire toggle is hidden (PHILOI_UI_SPEC.md §12: "pre-selecting that circle and
  // disabling the solo/campfire toggle").
  lockedCircleId?: string;
  lockedCircleName?: string;
};

// 1.5 not 1.50, 10 not 10.00 — the credit is stored to 2dp (0113) and a chip reading
// "1.50/10.00h" is noisier than the number is precise.
function formatHours(value: number): string {
  return String(Math.round(value * 100) / 100);
}

// "What are you locking in for?" — design-mocks/07's real bottom sheet: a dimmed backdrop
// (the campfire you came from, still visible underneath) with a rounded card floating over
// its bottom edge. No bottom-sheet library exists in this project, so this is a transparent
// Modal + a manual backdrop/card rather than adding a new native dependency.
export function LockinGoalPicker({ visible, onClose, lockedCircleId, lockedCircleName }: LockinGoalPickerProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { groups } = useMyGroups();
  const [goalType, setGoalType] = useState<GoalType>('gym');
  const [detail, setDetail] = useState('');
  const [withCampfire, setWithCampfire] = useState(Boolean(lockedCircleId));
  const [circleId, setCircleId] = useState<string | null>(lockedCircleId ?? null);
  // Gym only (PHILOI_UI_SPEC.md §23) — null routine means Freestyle. Kept here rather than
  // inside GymRoutineBlock because both values ride along to /lock-in as route params.
  const [routineId, setRoutineId] = useState<string | null>(null);
  const [energy, setEnergy] = useState<WorkoutEnergy>('same');
  // This session's ambient environment (COSMETIC_UI_FIXES §6.2). `undefined` means "whatever is
  // equipped", which is what every session did before the picker existed.
  const [audioChoice, setAudioChoice] = useState<string | undefined>(undefined);
  const isGym = goalType === 'gym';

  // A time-counted custom goal is credited by matching the goal's own name against this
  // session's detail (0061/0113), which until now meant retyping it character-for-character with
  // nothing in this sheet saying so. These chips ARE the match: tapping one writes the label
  // verbatim, so the credit lands rather than depending on the user guessing the mechanism.
  const [timeGoals, setTimeGoals] = useState<Challenge[]>([]);
  // A request counter rather than a `mounted` flag: an effect cleanup runs on every dep change,
  // not only on unmount, so the flag version cancels the fetch it just started when `visible`
  // flips (the freeze in lock-in/index.tsx was this bug). Comparing ids only ever discards a
  // response that a newer one has already superseded.
  // The user's own named goals, as SUB-ITEMS OF THE CATEGORY they were created under (§3).
  //
  // This is what makes "KP231 under Study" a real thing rather than a string in a text field: the
  // chip carries the goal's label, and picking it starts the session with type='study' — the
  // category tile above is untouched. That is the whole counting story, because
  // economy_evaluate_relics aggregates hours by session_discipline(goal_type) and never looks at
  // the label (0119 §7). A named Study lock-in therefore feeds Socrates' Scroll and Study's totals
  // identically to an unnamed one, and the same holds for every other category — nothing here is
  // Study-specific.
  const [myGoals, setMyGoals] = useState<Goal[]>([]);
  const latestGoalReq = useRef(0);
  useEffect(() => {
    if (!visible || !session) return;
    const req = latestGoalReq.current + 1;
    latestGoalReq.current = req;
    fetchLockinTimeGoals(session.user.id)
      .then((goals) => {
        if (latestGoalReq.current === req) setTimeGoals(goals);
      })
      // Silent: the chips are a shortcut, and the free-text field underneath still works.
      .catch(() => {
        if (latestGoalReq.current === req) setTimeGoals([]);
      });
  }, [visible, session]);

  const latestMineReq = useRef(0);
  const loadMyGoals = useCallback(() => {
    if (!session) return;
    const req = latestMineReq.current + 1;
    latestMineReq.current = req;
    fetchMyGoals(session.user.id)
      .then((g) => {
        if (latestMineReq.current === req) setMyGoals(g);
      })
      // Silent, for the same reason the challenge chips are: these are a shortcut over a text
      // field that still works without them.
      .catch(() => {
        if (latestMineReq.current === req) setMyGoals([]);
      });
  }, [session]);

  // Two triggers, because neither covers the other.
  //
  //   opening the sheet — the ordinary path.
  //   regaining focus   — the "+ New" chip PUSHES /goal/create over this modal without ever
  //                       closing it, so `visible` is still true when the user comes back and the
  //                       open-effect would never re-run. Without this the goal they just created
  //                       is missing from the row that sent them to create it.
  useEffect(() => {
    if (visible) loadMyGoals();
  }, [visible, loadMyGoals]);

  useFocusEffect(
    useCallback(() => {
      if (visible) loadMyGoals();
    }, [visible, loadMyGoals])
  );

  // Grouped under the selected category, and only the NAMED ones — the category's own unnamed goal
  // is the tile already selected above, so a chip for it would be the same choice twice.
  const categoryGoals = myGoals.filter((g) => g.type === goalType && (g.label ?? '').trim().length > 0);

  const effectiveCircleId = lockedCircleId ?? (withCampfire ? circleId : null);
  const canStart = !withCampfire || Boolean(effectiveCircleId);

  // Live count for the "With the campfire" pill's subtitle (design-mocks/07: "3 already
  // locked in — join them") — only resolvable once a specific circle is known.
  const activeLockIns = useActiveCircleLockIns(effectiveCircleId ?? '');
  const withCampfireSub =
    effectiveCircleId && activeLockIns.length > 0
      ? `${activeLockIns.length} already locked in — join them`
      : groups.length > 0
        ? 'join them'
        : 'pick a Campfire';

  function handleStart() {
    const trimmedDetail = detail.trim();
    // Written on EVERY start, including when nothing was picked, so a choice can never survive into
    // a session the user did not make it for. LoadoutSync reads it the moment the session appears.
    setSessionAudioChoice(audioChoice);
    onClose();
    setDetail('');
    router.push({
      pathname: '/lock-in',
      params: {
        type: goalType,
        ...(trimmedDetail ? { detail: trimmedDetail } : {}),
        ...(effectiveCircleId ? { circleId: effectiveCircleId } : {}),
        // The gym session screen turns these into the workout itself (start_workout) once the
        // lock-in session exists — nothing gym-specific is persisted before Start.
        ...(isGym ? { energy, ...(routineId ? { routineId } : {}) } : {}),
      },
    });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        {lockedCircleId && (
          <View style={[styles.circleHeader, { top: insets.top + Spacing.three }]}>
            <View style={styles.circleHeaderIcon}>
              <Ionicons name="flame" size={14} color={Colors.amber} />
            </View>
            <Text style={styles.circleHeaderLabel}>{lockedCircleName ?? 'This Campfire'}</Text>
          </View>
        )}

        <View style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={styles.grab} />

          <Text style={styles.title}>What are you locking in for?</Text>

          {/* Everything above the CTA scrolls: picking Gym reveals the routine list + energy
              chips (§23), which on a small screen is more than the sheet can show at once.
              "Start lock-in" stays pinned below so it never scrolls out of reach. */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
          <View style={styles.grid}>
            {GOAL_TYPES.map((type) => {
              const selected = goalType === type;
              return (
                <Pressable
                  key={type}
                  onPress={() => setGoalType(type)}
                  style={[styles.tile, selected && styles.tileSelected]}>
                  <View style={styles.tileIcon}>
                    <DisciplineIcon name={GOAL_TYPE_GLYPH[type]} size={16} color={Colors.amber} />
                  </View>
                  <Text style={[styles.tileLabel, selected && styles.tileLabelSelected]}>
                    {GOAL_TYPE_META[type].label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.detailRow}>
            <Ionicons name="pricetag" size={14} color={Colors.textTertiary} />
            <TextInput
              style={styles.detailInput}
              value={detail}
              onChangeText={setDetail}
              placeholder='Add a detail — "leg day", "CS midterm"…'
              placeholderTextColor={Colors.textTertiary}
              maxLength={60}
            />
          </View>

          {/* ── The selected category's named goals (§3) ──
              Rendered directly under the category grid and above the free-text detail, because
              that is the reading order of the claim they make: Study → KP231 → anything else you
              want to add. Picking one fills the detail field rather than replacing it with a
              separate mechanism, so the credit path (0061/0113 matches the session's detail against
              the goal's name) is the one that already works. */}
          <Text style={styles.goalHint}>
            Under {GOAL_TYPE_META[goalType].label}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.goalRow}>
            {categoryGoals.map((goal) => {
              const label = (goal.label ?? '').trim();
              const selected = detail.trim().toLowerCase() === label.toLowerCase();
              return (
                <Pressable
                  key={goal.id}
                  onPress={() => setDetail(selected ? '' : label)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${label}, a ${GOAL_TYPE_META[goalType].label} goal`}
                  style={[styles.goalChip, selected && styles.goalChipSelected]}>
                  <DisciplineIcon
                    name={GOAL_TYPE_GLYPH[goalType]}
                    size={12}
                    color={selected ? Colors.coral : Colors.textTertiary}
                  />
                  <Text style={[styles.goalChipLabel, selected && styles.goalChipLabelSelected]}>{label}</Text>
                </Pressable>
              );
            })}
            {/* The create pathway's only entry point. /goal/create was registered as a route and
                linked from nowhere, which is the literal reason "the custom-goal pathway isn't
                built" — the screen existed and was unreachable. Opened WITH the category so the
                new goal lands under the one the user is already looking at, rather than defaulting
                to Gym and stranding itself somewhere else. */}
            <Pressable
              onPress={() => router.push({ pathname: '/goal/create', params: { type: goalType } })}
              accessibilityRole="button"
              accessibilityLabel={`New ${GOAL_TYPE_META[goalType].label} goal`}
              style={[styles.goalChip, styles.goalChipNew]}>
              <Ionicons name="add" size={12} color={Colors.amber} />
              <Text style={[styles.goalChipLabel, styles.goalChipNewLabel]}>New</Text>
            </Pressable>
          </ScrollView>

          {timeGoals.length > 0 && (
            <>
              <Text style={styles.goalHint}>Name it after a goal and the time counts toward it</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.goalRow}>
                {timeGoals.map((goal) => {
                  const label = goal.label ?? '';
                  const selected = detail.trim().toLowerCase() === label.trim().toLowerCase();
                  return (
                    <Pressable
                      key={goal.id}
                      // Tapping the selected chip clears it again, so the field never becomes a
                      // one-way door for someone who picked the wrong goal.
                      onPress={() => setDetail(selected ? '' : label)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[styles.goalChip, selected && styles.goalChipSelected]}>
                      <Ionicons name="flag" size={12} color={selected ? Colors.coral : Colors.textTertiary} />
                      <Text style={[styles.goalChipLabel, selected && styles.goalChipLabelSelected]}>{label}</Text>
                      <Text style={styles.goalChipMeta}>
                        {formatHours(goal.progress)}/{formatHours(goal.target)}h
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}

          {isGym && (
            <GymRoutineBlock
              routineId={routineId}
              onRoutineChange={setRoutineId}
              energy={energy}
              onEnergyChange={setEnergy}
            />
          )}

          {/* Which ambient this session runs, or none at all. Sits after the goal and before the
              campfire choice because it is about how the next hour SOUNDS, not about what it is
              for — and because "none" is the row people reach for on the way into a gym. */}
          <SessionAudioPicker value={audioChoice} onChange={setAudioChoice} />

          {!lockedCircleId && (
            <View style={styles.mode}>
              <Pressable onPress={() => setWithCampfire(true)} style={[styles.pill, withCampfire && styles.pillOn]}>
                <Text style={[styles.pillLabel, withCampfire && styles.pillLabelOn]}>With the campfire</Text>
                <Text style={[styles.pillSub, withCampfire && styles.pillSubOn]}>{withCampfireSub}</Text>
              </Pressable>
              <Pressable onPress={() => setWithCampfire(false)} style={[styles.pill, !withCampfire && styles.pillOn]}>
                <Text style={[styles.pillLabel, !withCampfire && styles.pillLabelOn]}>Solo</Text>
                <Text style={[styles.pillSub, !withCampfire && styles.pillSubOn]}>just you</Text>
              </Pressable>
            </View>
          )}

          {withCampfire && !lockedCircleId && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.circleRow}>
              {groups.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => setCircleId(g.id)}
                  style={[styles.circleChip, circleId === g.id && styles.circleChipSelected]}>
                  <Text style={styles.circleEmoji}>{g.emoji}</Text>
                  <Text style={[styles.circleName, circleId === g.id && styles.circleNameSelected]}>{g.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          </ScrollView>

          <Pressable style={[styles.start, !canStart && styles.startDisabled]} onPress={handleStart} disabled={!canStart}>
            <Ionicons name="lock-closed" size={16} color={Colors.ink} />
            <Text style={styles.startLabel}>Start lock-in</Text>
          </Pressable>
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
  circleHeader: {
    position: 'absolute',
    left: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    opacity: 0.8,
  },
  circleHeaderIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleHeaderLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  sheet: {
    // Capped so the gym branch (routines + energy, §23) scrolls internally instead of pushing
    // the sheet past the top of the screen.
    maxHeight: '90%',
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 15,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.4,
    shadowRadius: 30,
    elevation: 12,
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
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ink,
    marginBottom: 12,
  },
  // flexGrow:0 keeps the sheet content-sized for the non-gym goals (no dead space under a
  // three-tile grid); it only starts scrolling once it hits the sheet's maxHeight.
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingBottom: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tile: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 10,
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: Colors.cream,
  },
  tileSelected: {
    borderColor: Colors.coral,
    backgroundColor: Colors.selectedBg,
  },
  tileIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  tileLabelSelected: {
    color: Colors.achieverText,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.cream,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginTop: 11,
  },
  detailInput: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.ink,
    padding: 0,
  },
  goalHint: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
    marginTop: 9,
  },
  goalRow: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  goalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.cream,
  },
  goalChipNew: {
    borderStyle: 'dashed',
    borderColor: Colors.amber,
  },
  goalChipNewLabel: {
    color: Colors.amber,
  },
  goalChipSelected: {
    borderColor: Colors.coral,
    backgroundColor: Colors.selectedBg,
  },
  goalChipLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
  goalChipLabelSelected: {
    color: Colors.ink,
  },
  goalChipMeta: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
  },
  mode: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 11,
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.cream,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    padding: 10,
  },
  pillOn: {
    borderColor: Colors.coral,
    backgroundColor: Colors.selectedBg,
  },
  pillLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
  pillLabelOn: {
    color: Colors.achieverText,
  },
  pillSub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  pillSubOn: {
    color: Colors.warmSubtext,
  },
  circleRow: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  circleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.cream,
  },
  circleChipSelected: {
    borderColor: Colors.coral,
    backgroundColor: Colors.selectedBg,
  },
  circleEmoji: {
    fontSize: 16,
  },
  circleName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  circleNameSelected: {
    color: Colors.achieverText,
  },
  start: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.coral,
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
  },
  startDisabled: {
    backgroundColor: Colors.disabled,
  },
  startLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
});
