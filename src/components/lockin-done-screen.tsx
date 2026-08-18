import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { CampfireFlameStage } from '@/components/campfire-flame-stage';
import { GymClipThumbnail } from '@/components/gym-clip-player';
import { HexagonBadge } from '@/components/hexagon-badge';
import { TextInput } from '@/components/ui/text-input';
import { GYM_VIDEO_CLIPS_ENABLED } from '@/constants/feature-flags';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMyGroups } from '@/hooks/use-my-groups';
import { fetchCheckInClips } from '@/lib/api/gym-clips';
import { postCheckInToCircle, setCheckInCaption } from '@/lib/api/lock-ins';
import { getErrorMessage } from '@/lib/errors';
import { formatDurationClock } from '@/lib/format';
import { GOAL_TYPE_META } from '@/lib/goal-types';
import { formatRankTier, RANK_TIER_METAL, xpProgressRatio } from '@/lib/rank-tiers';
import { fireConfirm, fireXpTick } from '@/lib/reward-feedback';
import type { GoalType, MyRank, WorkoutRecap, WorkoutSet } from '@/types/database';

type LockInDoneScreenProps = {
  goalType: GoalType;
  goalDetail: string | null;
  durationSeconds: number;
  checkInId: string;
  xpEarned: number;
  rankBefore?: MyRank;
  rankAfter?: MyRank;
  streakBefore: number;
  streakAfter: number;
  photos: { id: string; uri: string }[];
  /** The finished gym workout (§23) — persisted set-by-set during the session and rolled up at
   * Finish, so this is purely a recap. Null for every non-gym lock-in. */
  workoutRecap?: WorkoutRecap | null;
  circleId: string | null;
  circleName: string | null;
  onDone: () => void;
};

const FLAME_SIZE = 140;

// The "done" screen (design-mocks/81-done-screen.html) — built around the SAME big living flame
// as the work session, stripped to the four things that matter: you locked in, for how long, the
// XP it moved, and one tap to post.
//
// Everything else was pushed off this screen deliberately (punchlist 6 §3): the routine-naming
// block now lives on the gym screen, the caption is folded into the post card as an optional
// note, the campfire multi-select hides behind "change", and a gym recap collapses to one line
// with a "View" that opens the full thing.
//
// Any rank-up at all — a tier crossing or a same-tier division bump — is handled by the caller
// showing RankUpCelebration's full-screen forge instead of this component entirely (see
// lock-in/index.tsx); this screen only ever renders for a stop that didn't move the rank.
export function LockInDoneScreen({
  goalType,
  goalDetail,
  durationSeconds,
  checkInId,
  xpEarned,
  rankBefore,
  rankAfter,
  streakBefore,
  streakAfter,
  photos,
  workoutRecap = null,
  circleId,
  circleName,
  onDone,
}: LockInDoneScreenProps) {
  const { groups } = useMyGroups();
  // Seeded with the campfire this session was started in, so the common case is one tap — the
  // multi-select is still there, just behind "change" instead of being a decision every time.
  const [selectedCircleIds, setSelectedCircleIds] = useState<string[]>(circleId ? [circleId] : []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);
  // Phase-2 video clips (§23) — the rolled-up recap only has per-exercise totals (no individual
  // set ids), so clips need their own fetch, keyed by this same checkInId. Recap modal only.
  const [clips, setClips] = useState<WorkoutSet[]>([]);

  const [displayXp, setDisplayXp] = useState(0);
  const [plusVisible, setPlusVisible] = useState(false);
  const fillRatio = useSharedValue(rankBefore ? xpProgressRatio(rankBefore.xp_into_tier, rankBefore.xp_for_next_tier) : 0);

  useEffect(() => {
    if (!GYM_VIDEO_CLIPS_ENABLED || !workoutRecap) return;
    fetchCheckInClips(checkInId)
      .then(setClips)
      .catch(() => {
        // Clips are a bonus recap row, not core data — a failed fetch just hides it.
      });
  }, [checkInId, workoutRecap]);

  // The bar fills from the pre-session position toward the next tier while the "+XP" fades in and
  // counts up — the one animation this screen keeps. It counts the EARNED xp rather than the
  // running tier total (mock 81 shows only "+210 XP" on this row), so the number that moves is
  // the number the session actually produced.
  useEffect(() => {
    if (!rankBefore || !rankAfter) return;
    const end = Math.round(xpEarned);
    const delay = setTimeout(() => {
      setPlusVisible(true);
      fireXpTick();
      fillRatio.value = withTiming(xpProgressRatio(rankAfter.xp_into_tier, rankAfter.xp_for_next_tier), {
        duration: 1100,
        easing: Easing.bezier(0.2, 0.7, 0.3, 1),
      });
      const durationMs = 1100;
      const t0 = Date.now();
      let raf: ReturnType<typeof requestAnimationFrame>;
      const step = () => {
        const p = Math.min((Date.now() - t0) / durationMs, 1);
        setDisplayXp(Math.round(end * p));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }, 250);
    return () => clearTimeout(delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount for the open animation
  }, []);

  const barStyle = useAnimatedStyle(() => ({ width: `${fillRatio.value * 100}%` }));
  const plusStyle = useAnimatedStyle(() => ({ opacity: withDelay(300, withTiming(plusVisible ? 1 : 0, { duration: 400 })) }));

  const streakIncreased = streakAfter > streakBefore;
  // "Deep work · solo" (mock 81) — the goal, plus whatever qualifies it: the typed detail if there
  // is one, else the campfire it ran in, else solo.
  const goalLine = `${GOAL_TYPE_META[goalType].label} · ${goalDetail ?? circleName ?? 'solo'}`;

  const workoutExercises = workoutRecap?.exercises ?? [];
  const prCount = workoutExercises.filter((e) => e.is_pr).length;
  const totalSets = workoutExercises.reduce((n, e) => n + e.sets, 0);
  // Bodyweight work carries no weight, so a bodyweight-only session simply drops this segment
  // rather than claiming "0 lb".
  const totalVolume = workoutExercises.reduce((n, e) => n + e.sets * e.reps * (e.weight ?? 0), 0);
  const gymSummary = [
    `${workoutExercises.length} exercise${workoutExercises.length === 1 ? '' : 's'}`,
    `${totalSets} set${totalSets === 1 ? '' : 's'}`,
    totalVolume > 0 ? `${Math.round(totalVolume).toLocaleString()} lb` : null,
    prCount > 0 ? `${prCount} PR${prCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  function labelForCircle(id: string): string {
    const group = groups.find((g) => g.id === id);
    if (group) return `${group.emoji} ${group.name}`;
    // useMyGroups hasn't answered yet (or the session's campfire isn't in it) — the name the
    // session carried is still the right thing to show rather than a blank row.
    return id === circleId && circleName ? circleName : 'this campfire';
  }

  const willPost = selectedCircleIds.length > 0;
  // With nothing selected the row used to read "Post to nowhere — pick one", which lands as a
  // placeholder someone forgot to wire rather than as a choice (punchlist 17 P3). The label below
  // switches instead of the value, so the empty state asks for the pick rather than narrating it.
  const postTarget =
    selectedCircleIds.length === 0
      ? 'a campfire'
      : selectedCircleIds.length === 1
        ? labelForCircle(selectedCircleIds[0])
        : `${selectedCircleIds.length} campfires`;

  // The note belongs to the lock-in, not to the act of posting — so it's saved on BOTH exits. A
  // private lock-in with a note is a journal entry to yourself and it's already visible in your
  // own history; silently dropping what someone typed because they chose "Just finish" would be
  // the surprising behaviour.
  async function saveNote() {
    const trimmed = note.trim();
    if (!trimmed) return;
    await setCheckInCaption(checkInId, trimmed);
  }

  function toggleCircle(id: string) {
    setSelectedCircleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handlePost() {
    setPosting(true);
    setError(null);
    try {
      await saveNote();
      // Sequential, not Promise.all: post_check_in_to_circle writes a feed row and pushes that
      // circle's members, and one failure shouldn't leave the rest in an unknown state.
      for (const id of selectedCircleIds) {
        await postCheckInToCircle(checkInId, id);
      }
      if (selectedCircleIds.length > 0) fireConfirm();
      onDone();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not post to the campfire — try again.'));
    } finally {
      setPosting(false);
    }
  }

  async function handleJustFinish() {
    setPosting(true);
    try {
      await saveNote();
    } catch {
      // Deliberately not surfaced or blocking: the user asked to be done, and the lock-in itself
      // (time, XP, streak, photos) is already safely recorded. Losing only an unsaved note is a
      // far better outcome than trapping them on this screen behind a retry.
    } finally {
      setPosting(false);
      onDone();
    }
  }

  return (
    <View style={styles.container}>
      {/* Scrolls rather than compressing: the hero block is fixed-height by design, and a gym
          session with photos would otherwise squeeze the flame on a short screen. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <View style={styles.flameWrap}>
          <Svg width={FLAME_SIZE * 1.4} height={FLAME_SIZE * 1.4} style={styles.flameGlow} pointerEvents="none">
            <Defs>
              <RadialGradient id="doneFlameGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={Colors.amber} stopOpacity={0.28} />
                <Stop offset="62%" stopColor={Colors.amber} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={FLAME_SIZE * 0.7} cy={FLAME_SIZE * 0.7} r={FLAME_SIZE * 0.7} fill="url(#doneFlameGlow)" />
          </Svg>
          {/* Settled, not roaring — the session is over. Same component the campfire carousel and
              the running session use, so the flame reads as one continuous thing. */}
          <CampfireFlameStage state="steady" size={FLAME_SIZE} />
        </View>

        <Text style={styles.lockedInLabel}>LOCKED IN</Text>
        <Text style={styles.dur}>{formatDurationClock(durationSeconds)}</Text>
        <Text style={styles.goal} numberOfLines={1}>
          {goalLine}
        </Text>

        {rankBefore && rankAfter && (
          <View style={styles.rankRow}>
            <HexagonBadge tier={rankAfter.tier} division={rankAfter.division} size={40} />
            <View style={styles.rankInfo}>
              <View style={styles.rankTop}>
                <Text style={[styles.rankTier, { color: RANK_TIER_METAL[rankAfter.tier].text }]} numberOfLines={1}>
                  {formatRankTier(rankAfter.tier, rankAfter.division)}
                </Text>
                <Animated.Text style={[styles.rankXp, plusStyle]}>+{displayXp.toLocaleString()} XP</Animated.Text>
              </View>
              <View style={styles.bar}>
                <Animated.View style={[styles.barFill, barStyle]} />
              </View>
            </View>
          </View>
        )}

        {streakAfter > 0 && (
          <View style={styles.streak}>
            <Ionicons name="flame" size={15} color={Colors.amber} />
            <Text style={styles.streakText}>
              {streakAfter}-day streak · {streakIncreased ? '+1 today' : 'kept alive'}
            </Text>
          </View>
        )}

        {/* One line, not the old recap sprawl — the full per-exercise breakdown, PRs, brag line
            and clips all live behind "View". */}
        {workoutExercises.length > 0 && (
          <Pressable style={styles.gymLine} onPress={() => setRecapOpen(true)} accessibilityRole="button">
            <Ionicons name="barbell" size={14} color={Colors.amber} />
            <Text style={styles.gymSummary} numberOfLines={1}>
              {gymSummary}
            </Text>
            <Text style={styles.gymView}>View</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={styles.bottom}>
        {/* A thumbnail row, never a gallery — the photos are already saved to the lock-in. */}
        {photos.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.photoScroll}
            contentContainerStyle={styles.photoRow}>
            {photos.map((p) => (
              <Image key={p.id} source={{ uri: p.uri }} style={styles.photoThumb} />
            ))}
          </ScrollView>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.post}>
          {groups.length > 0 && (
            <View style={styles.postTo}>
              <Text style={styles.postToLabel}>{willPost ? 'Post to' : 'Pick'}</Text>
              <Text style={styles.postToName} numberOfLines={1}>
                {postTarget}
              </Text>
              <Pressable onPress={() => setPickerOpen((v) => !v)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.change}>{pickerOpen ? 'done' : 'change'}</Text>
              </Pressable>
            </View>
          )}

          {/* Still multi-post (migration 0059) — just not a decision every time. */}
          {pickerOpen && groups.length > 0 && (
            <View style={styles.circleGrid}>
              {groups.map((group) => {
                const on = selectedCircleIds.includes(group.id);
                return (
                  <Pressable
                    key={group.id}
                    onPress={() => toggleCircle(group.id)}
                    disabled={posting}
                    style={[styles.circleChip, on && styles.circleChipOn]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`Post to ${group.name}`}>
                    {on && <Ionicons name="checkmark" size={12} color={Colors.achieverText} />}
                    <Text style={[styles.circleChipText, on && styles.circleChipTextOn]} numberOfLines={1}>
                      {group.emoji} {group.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <TextInput
            style={styles.note}
            placeholder="Add a note… (optional)"
            value={note}
            onChangeText={setNote}
            maxLength={140}
            editable={!posting}
          />
        </View>

        <Pressable style={styles.cta} onPress={handlePost} disabled={posting}>
          {posting ? (
            <ActivityIndicator color={Colors.ink} />
          ) : (
            <Text style={styles.ctaLabel}>{willPost ? 'Post & finish' : 'Finish'}</Text>
          )}
        </Pressable>
        {/* Only when there's actually something to skip — otherwise it's the same button twice. */}
        {willPost && (
          <Pressable onPress={handleJustFinish} disabled={posting} style={styles.skip}>
            <Text style={styles.skipLabel}>Just finish</Text>
          </Pressable>
        )}
      </View>

      <GymRecapSheet
        visible={recapOpen}
        onClose={() => setRecapOpen(false)}
        recap={workoutRecap}
        clips={clips}
        prCount={prCount}
      />
    </View>
  );
}

// The full gym recap, one tap away from the summary line. Everything the done screen used to
// render inline: per-exercise rollups, PR tags, the honest-brag line and any clips.
function GymRecapSheet({
  visible,
  onClose,
  recap,
  clips,
  prCount,
}: {
  visible: boolean;
  onClose: () => void;
  recap: WorkoutRecap | null;
  clips: WorkoutSet[];
  prCount: number;
}) {
  if (!recap) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.grab} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {recap.routine_name ?? 'Your workout'}
              {prCount > 0 ? ` · ${prCount} PR${prCount === 1 ? '' : 's'}` : ''}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={19} color={Colors.textTertiary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetBody}>
            {recap.exercises.map((s, i) => (
              <View key={i} style={styles.setRow}>
                <Ionicons name="barbell-outline" size={12} color={Colors.amber} />
                <Text style={styles.setText} numberOfLines={1}>
                  {s.exercise} · {s.sets}×{s.reps}
                  {s.weight ? ` @ ${s.weight}` : ''}
                </Text>
                {s.is_pr && (
                  <View style={styles.prTag}>
                    <Ionicons name="trophy" size={9} color={Colors.achieverText} />
                    <Text style={styles.prTagText}>PR</Text>
                  </View>
                )}
              </View>
            ))}

            {/* HONEST BRAG (§23 rule 2): decided server-side at Finish — `dialed` alone never
                earns this line, a personal best actually logged in the session does. */}
            {recap.brag_earned && (
              <View style={styles.bragRow}>
                <Ionicons name="flash" size={13} color={Colors.achieverText} />
                <Text style={styles.bragText}>You were feeling dialed — and the numbers backed it up.</Text>
              </View>
            )}

            {clips.length > 0 && (
              <>
                <Text style={styles.clipsLabel}>Clips from this session</Text>
                <View style={styles.clipsRow}>
                  {clips.map((c) => (
                    <GymClipThumbnail key={c.id} workoutSetId={c.id} size={72} />
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // width:'100%' matters here: the caller centers this component inside a flex column
  // (alignItems:'center'), which shrink-wraps children that don't claim full width.
  container: {
    flex: 1,
    width: '100%',
    paddingHorizontal: Spacing.three,
    paddingBottom: 14,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
  },
  flameWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  flameGlow: {
    position: 'absolute',
  },
  lockedInLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 2.5,
    color: Colors.amber,
    marginTop: 10,
  },
  dur: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 44,
    letterSpacing: 1,
    color: Colors.ink,
    marginTop: 2,
  },
  goal: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    marginTop: 2,
  },
  rankRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 22,
  },
  rankInfo: {
    flex: 1,
    minWidth: 0,
  },
  rankTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  rankTier: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
  },
  rankXp: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.green,
  },
  bar: {
    height: 8,
    borderRadius: 5,
    backgroundColor: Colors.disabled,
    overflow: 'hidden',
    marginTop: 6,
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: Colors.amber,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  streakText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    // Brighter than the goal line above it — the streak is a result, not a caption.
    color: Colors.coldChipText,
  },
  gymLine: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 12,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  gymSummary: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
  },
  gymView: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.amber,
  },
  bottom: {
    width: '100%',
  },
  // Explicit height: a horizontal ScrollView in a non-flex column otherwise collapses to nothing.
  photoScroll: {
    flexGrow: 0,
    height: 54,
  },
  photoRow: {
    flexDirection: 'row',
    gap: 6,
  },
  photoThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: Colors.disabled,
  },
  // The mock's post card is one step up from its stage; this screen's stage is Colors.cream, so
  // the elevated surface here is Colors.card and the note field insets back down to cream.
  post: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  postTo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  postToLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
  postToName: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  change: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  circleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: 10,
  },
  circleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 180,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: Colors.line,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  circleChipOn: {
    borderColor: Colors.coral,
    backgroundColor: Colors.selectedBg,
  },
  circleChipText: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
  },
  circleChipTextOn: {
    color: Colors.achieverText,
  },
  // Flatter than the standalone field it replaced — inside the post card it reads as part of the
  // card, not as a second input competing with it.
  note: {
    backgroundColor: Colors.cream,
    borderWidth: 0,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  cta: {
    backgroundColor: Colors.coral,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 12,
  },
  ctaLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  skip: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
    marginTop: 3,
  },
  skipLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.textTertiary,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.coral,
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  // ───────────────────────── full gym recap sheet ─────────────────────────
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(9,7,14,0.55)',
  },
  sheet: {
    maxHeight: '82%',
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 15,
    paddingBottom: Spacing.four,
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
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginBottom: 10,
  },
  sheetTitle: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  sheetBody: {
    gap: 6,
    paddingBottom: Spacing.two,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  setText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
  },
  prTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingVertical: 1,
    paddingHorizontal: 5,
  },
  prTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    color: Colors.achieverText,
  },
  bragRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 9,
  },
  bragText: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.achieverText,
  },
  clipsLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 12,
  },
  clipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
});
