import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GymRoutineBlock } from '@/components/gym-routine-block';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useActiveCircleLockIns } from '@/hooks/use-active-circle-lockins';
import { useMyGroups } from '@/hooks/use-my-groups';
import { GOAL_TYPES, GOAL_TYPE_ICON, GOAL_TYPE_META } from '@/lib/goal-types';
import type { GoalType, WorkoutEnergy } from '@/types/database';

type LockinGoalPickerProps = {
  visible: boolean;
  onClose: () => void;
  // Set when opened from inside a campfire's timeline — that campfire is fixed and the
  // solo/campfire toggle is hidden (PHILOI_UI_SPEC.md §12: "pre-selecting that circle and
  // disabling the solo/campfire toggle").
  lockedCircleId?: string;
  lockedCircleName?: string;
};

// "What are you locking in for?" — design-mocks/07's real bottom sheet: a dimmed backdrop
// (the campfire you came from, still visible underneath) with a rounded card floating over
// its bottom edge. No bottom-sheet library exists in this project, so this is a transparent
// Modal + a manual backdrop/card rather than adding a new native dependency.
export function LockinGoalPicker({ visible, onClose, lockedCircleId, lockedCircleName }: LockinGoalPickerProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { groups } = useMyGroups();
  const [goalType, setGoalType] = useState<GoalType>('gym');
  const [detail, setDetail] = useState('');
  const [withCampfire, setWithCampfire] = useState(Boolean(lockedCircleId));
  const [circleId, setCircleId] = useState<string | null>(lockedCircleId ?? null);
  // Gym only (PHILOI_UI_SPEC.md §23) — null routine means Freestyle. Kept here rather than
  // inside GymRoutineBlock because both values ride along to /lock-in as route params.
  const [routineId, setRoutineId] = useState<string | null>(null);
  const [energy, setEnergy] = useState<WorkoutEnergy>('same');
  const isGym = goalType === 'gym';

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
                    <Ionicons name={GOAL_TYPE_ICON[type]} size={16} color={Colors.amber} />
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

          {isGym && (
            <GymRoutineBlock
              routineId={routineId}
              onRoutineChange={setRoutineId}
              energy={energy}
              onEnergyChange={setEnergy}
            />
          )}

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
