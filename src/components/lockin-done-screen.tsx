import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { HexagonBadge } from '@/components/hexagon-badge';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { saveWorkoutAsRoutine } from '@/lib/api/gym';
import { postCheckInToCircle } from '@/lib/api/lock-ins';
import { getErrorMessage } from '@/lib/errors';
import { formatDurationClock } from '@/lib/format';
import { GOAL_TYPE_ICON, GOAL_TYPE_META } from '@/lib/goal-types';
import { formatRankTier, xpProgressRatio } from '@/lib/rank-tiers';
import { fireConfirm, fireXpTick } from '@/lib/reward-feedback';
import type { GoalType, MyRank, WorkoutRecap } from '@/types/database';

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

// design-mocks/18-lockin-done.html's small flicker on the header flame — same `flick`
// keyframe as the splash screen, just at a much smaller size here.
function MiniFlickerFlame() {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(0, withTiming(1, { duration: 950, easing: Easing.inOut(Easing.ease) }));
  }, [progress]);
  // Simple one-shot settle rather than an infinite loop — this screen is meant to read as
  // calm/settled, not another animated flame demanding attention.
  return <FlameSvg width={46 * FLAME_ASPECT_RATIO} height={46} />;
}

// The "done" screen (PHILOI_UI_SPEC.md §13, design-mocks/18) — a satisfying recap, not a loud
// celebration. On open, the XP bar fills from the pre-session total to the new one (the
// "+XP" fades in and the number counts up). Any rank-up at all — crossing or a same-tier
// division bump — is handled by the caller showing RankUpCelebration's full-screen forge
// instead of this component entirely (see lock-in/index.tsx); this screen only ever renders
// for a stop that didn't move the rank.
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
  const [displayXp, setDisplayXp] = useState(rankBefore?.xp_into_tier ?? 0);
  const [plusVisible, setPlusVisible] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Routines build from memory" (§23) — offered right after a freestyle gym session, the one
  // moment the user knows exactly what the routine is.
  const [routineName, setRoutineName] = useState('');
  const [savingRoutine, setSavingRoutine] = useState(false);
  const [routineSaved, setRoutineSaved] = useState(false);
  const [namingRoutine, setNamingRoutine] = useState(false);
  const fillRatio = useSharedValue(rankBefore ? xpProgressRatio(rankBefore.xp_into_tier, rankBefore.xp_for_next_tier) : 0);

  useEffect(() => {
    if (!rankBefore || !rankAfter) return;
    const start = rankBefore.xp_into_tier;
    const end = rankAfter.xp_into_tier;
    const delay = setTimeout(() => {
      setPlusVisible(true);
      fireXpTick();
      fillRatio.value = withTiming(xpProgressRatio(end, rankAfter.xp_for_next_tier), {
        duration: 1100,
        easing: Easing.bezier(0.2, 0.7, 0.3, 1),
      });
      const durationMs = 1100;
      const t0 = Date.now();
      let raf: ReturnType<typeof requestAnimationFrame>;
      const step = () => {
        const p = Math.min((Date.now() - t0) / durationMs, 1);
        setDisplayXp(Math.round(start + (end - start) * p));
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

  const atMaxRank = rankAfter ? rankAfter.xp_for_next_tier <= 0 : false;
  const streakIncreased = streakAfter > streakBefore;

  const workoutExercises = workoutRecap?.exercises ?? [];
  const prCount = workoutExercises.filter((e) => e.is_pr).length;
  // Only for a session that wasn't already run off a saved routine — re-saving one you just
  // followed would just duplicate it.
  const canSaveRoutine = workoutExercises.length > 0 && !workoutRecap?.routine_name && !routineSaved;

  async function handleSaveRoutine() {
    if (!workoutRecap || savingRoutine) return;
    const trimmed = routineName.trim();
    if (!trimmed) return;
    setSavingRoutine(true);
    setError(null);
    try {
      await saveWorkoutAsRoutine(workoutRecap.workout_id, trimmed);
      setRoutineSaved(true);
      setNamingRoutine(false);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save that as a routine.'));
    } finally {
      setSavingRoutine(false);
    }
  }

  async function handlePost() {
    // A solo session has no campfire to post to — nothing to write, just finish (same
    // outcome as "Keep this one private" would give it).
    if (!circleId) {
      onDone();
      return;
    }
    setPosting(true);
    setError(null);
    try {
      await postCheckInToCircle(checkInId, circleId);
      fireConfirm();
      onDone();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not post to the campfire — try again.'));
    } finally {
      setPosting(false);
    }
  }

  return (
    <View style={styles.container}>
      {/* The whole recap is ONE group centered in the space above the bottom action(s) —
          design-mocks/18: flame → "Nice work" → activity chip → time → XP card → streak →
          photos, never stretched out with a dead gap before the button. */}
      <View style={styles.recap}>
        <View style={styles.top}>
          <MiniFlickerFlame />
          <Text style={styles.done}>Nice work</Text>
        </View>

        <View style={styles.goalChip}>
          <Ionicons name={GOAL_TYPE_ICON[goalType]} size={13} color={Colors.amber} />
          <Text style={styles.goalChipText}>
            {GOAL_TYPE_META[goalType].label}
            {goalDetail ? ` · ${goalDetail}` : ''}
          </Text>
        </View>

        <Text style={styles.dur}>{formatDurationClock(durationSeconds)}</Text>
        <Text style={styles.durLabel}>LOCKED IN</Text>

        {rankBefore && rankAfter && (
          <View style={styles.xpRow}>
            <View style={styles.badgeWrap}>
              <HexagonBadge tier={rankAfter.tier} division={rankAfter.division} size={44} />
            </View>
            <View style={styles.xpCol}>
              <View style={styles.xpTop}>
                <Text style={styles.xpTier} numberOfLines={1}>
                  {formatRankTier(rankAfter.tier, rankAfter.division)}
                </Text>
                <View style={styles.xpTopRight}>
                  <Animated.Text style={[styles.xpPlus, plusStyle]}>+{Math.round(xpEarned)} XP</Animated.Text>
                  <Text style={styles.xpNum}>{displayXp.toLocaleString()}</Text>
                  <Text style={styles.xpMax}>
                    {atMaxRank ? ' max' : ` / ${Math.round(rankAfter.xp_for_next_tier).toLocaleString()}`}
                  </Text>
                </View>
              </View>
              <View style={styles.trk}>
                <Animated.View style={[styles.trkFill, barStyle]} />
              </View>
            </View>
          </View>
        )}

        {streakAfter > 0 && (
          <View style={styles.streak}>
            <Ionicons name="flame" size={19} color={Colors.amber} />
            <Text style={styles.streakMain}>{streakAfter}-day streak</Text>
            <Text style={styles.streakSub}>{streakIncreased ? '+1' : 'kept alive'}</Text>
          </View>
        )}

        {photos.length > 0 && (
          <>
            <Text style={styles.photosLabel}>From this session</Text>
            <View style={styles.photosRow}>
              {photos.map((p) => (
                <Image key={p.id} source={{ uri: p.uri }} style={styles.photoThumb} />
              ))}
            </View>
          </>
        )}

        {workoutExercises.length > 0 && (
          <>
            <Text style={styles.photosLabel}>
              {workoutRecap?.routine_name ?? 'Your workout'}
              {prCount > 0 ? ` · ${prCount} PR${prCount === 1 ? '' : 's'}` : ''}
            </Text>
            <View style={styles.setsList}>
              {workoutExercises.map((s, i) => (
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
            </View>

            {/* HONEST BRAG (§23 rule 2): decided server-side at Finish — `dialed` alone never
                earns this line, a personal best actually logged in the session does. */}
            {workoutRecap?.brag_earned && (
              <View style={styles.bragRow}>
                <Ionicons name="flash" size={13} color={Colors.achieverText} />
                <Text style={styles.bragText}>You were feeling dialed — and the numbers backed it up.</Text>
              </View>
            )}

            {canSaveRoutine &&
              (namingRoutine ? (
                <View style={styles.routineSaveRow}>
                  <TextInput
                    style={styles.routineNameInput}
                    placeholder="Name this routine"
                    value={routineName}
                    onChangeText={setRoutineName}
                    maxLength={40}
                    autoFocus
                  />
                  <Pressable
                    onPress={handleSaveRoutine}
                    disabled={savingRoutine || routineName.trim().length === 0}
                    style={[styles.routineSaveBtn, routineName.trim().length === 0 && styles.routineSaveBtnDisabled]}>
                    <Ionicons name="checkmark" size={16} color={Colors.ink} />
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setNamingRoutine(true)} style={styles.routineLink}>
                  <Ionicons name="bookmark-outline" size={12} color={Colors.amber} />
                  <Text style={styles.routineLinkText}>Save this as a routine</Text>
                </Pressable>
              ))}

            {routineSaved && <Text style={styles.routineSavedText}>Saved — it&apos;ll be there next time.</Text>}
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      {/* Every finished session ends here — asking to share or keep private is not optional,
          so these two controls always render regardless of solo vs. campfire (see
          handlePost: a solo session just finishes, since there's nothing to post to). */}
      <View style={styles.bottom}>
        <Text style={styles.postingLabel}>Posting to {circleName ?? 'your campfire'}</Text>
        <Pressable style={styles.postBtn} onPress={handlePost} disabled={posting}>
          {posting ? (
            <ActivityIndicator color={Colors.ink} />
          ) : (
            <>
              <Ionicons name="send" size={16} color={Colors.ink} />
              <Text style={styles.postBtnLabel}>Post to the campfire</Text>
            </>
          )}
        </Pressable>
        <Pressable onPress={onDone} disabled={posting}>
          <Text style={styles.privateLink}>Keep this one private</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // width:'100%' matters here: the caller centers this component inside a flex column
  // (alignItems:'center'), which shrink-wraps children that don't claim full width — without
  // it every row below silently renders in a squeezed, content-sized box instead of the real
  // screen width, which is what was causing "Bronze III" to wrap and the XP bar to look like
  // a stub.
  container: {
    flex: 1,
    width: '100%',
    paddingTop: 18,
    paddingHorizontal: Spacing.three,
    paddingBottom: 14,
    alignItems: 'center',
  },
  // The recap group claims the leftover space above `bottom` and centers within it — same
  // TOP/CENTER/BOTTOM technique as the running-session screen, so there's no dead gap.
  recap: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    width: '100%',
  },
  top: {
    alignItems: 'center',
  },
  done: {
    fontFamily: Fonts.display,
    fontSize: 19,
    color: Colors.ink,
    marginTop: 2,
  },
  goalChip: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 11,
  },
  goalChipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.achieverText,
  },
  dur: {
    fontFamily: Fonts.display,
    fontSize: 38,
    letterSpacing: 1,
    color: Colors.ink,
    marginTop: 4,
    textAlign: 'center',
  },
  durLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 1,
    color: Colors.textTertiary,
    marginTop: -2,
  },
  xpRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 12,
  },
  badgeWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  xpCol: {
    flex: 1,
    minWidth: 0,
  },
  xpTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  xpTier: {
    flexShrink: 0,
    marginRight: Spacing.two,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
  },
  xpTopRight: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  xpPlus: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.achieverText,
    marginRight: 6,
  },
  xpNum: {
    fontFamily: Fonts.display,
    fontSize: 11.5,
    color: Colors.ink,
  },
  xpMax: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
  },
  trk: {
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
    overflow: 'hidden',
    marginTop: 7,
  },
  trkFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.coral,
  },
  streak: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  streakMain: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  streakSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  photosLabel: {
    alignSelf: 'flex-start',
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 14,
    marginBottom: 7,
  },
  photosRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 6,
  },
  photoThumb: {
    width: 50,
    height: 50,
    borderRadius: 9,
    backgroundColor: Colors.disabled,
  },
  setsList: {
    alignSelf: 'stretch',
    gap: 5,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  setText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12,
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
    alignSelf: 'stretch',
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
  routineLink: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 10,
  },
  routineLinkText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.amber,
  },
  routineSaveRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
    marginTop: 10,
  },
  routineNameInput: {
    flex: 1,
    paddingVertical: 9,
    fontSize: 13,
  },
  routineSaveBtn: {
    width: 42,
    borderRadius: Radius.input,
    backgroundColor: Colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routineSaveBtnDisabled: {
    backgroundColor: Colors.disabled,
  },
  routineSavedText: {
    alignSelf: 'flex-start',
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
    marginTop: 10,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.coral,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  postingLabel: {
    alignSelf: 'stretch',
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  // design-mocks/18's `.cta`: full-width, radius 14, padding 14, #E0612C bg. Bespoke rather
  // than the shared PrimaryButton since this needs a leading send icon (matching the other
  // icon+label buttons already built bespoke throughout this same lock-in flow — Start
  // lock-in, Stop lock-in). Label color is Colors.ink (not the mock's literal white) to match
  // this app's established "coral bg -> cream text" precision, same as every other coral CTA.
  postBtn: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.coral,
    borderRadius: 14,
    padding: 14,
  },
  postBtnLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  privateLink: {
    alignSelf: 'stretch',
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 10,
  },
});
