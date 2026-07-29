import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  FadeOutUp,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { BodyDoubleRow } from '@/components/body-double-row';
import { ErrorBoundary } from '@/components/error-boundary';
import { BouncingPhoto } from '@/components/bouncing-photo';
import { FireShareCard } from '@/components/fire-share-card';
import { FlameMeterComplete } from '@/components/flame-meter-complete';
import { LockInDoneScreen } from '@/components/lockin-done-screen';
import { LockInFlame, type LockInFlameParticipant } from '@/components/lock-in-flame';
import { RankUpCelebration } from '@/components/rank-up-celebration';
import { RankUpShareCard } from '@/components/rank-up-share-card';
import { RewardBurst, type RewardBurstHandle } from '@/components/reward-burst';
import { TutorialTooltip } from '@/components/tutorial-tooltip';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { WorkoutLog } from '@/components/workout-log';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useActiveWorkout } from '@/hooks/use-active-workout';
import { useElapsedSeconds } from '@/hooks/use-elapsed-seconds';
import { useActiveSession } from '@/lib/active-session-context';
import { track } from '@/lib/analytics';
import { fetchOrCreateDailyFire } from '@/lib/api/daily-fire';
import { fetchMyRanks } from '@/lib/api/goals';
import { fetchWorkoutRecap, startWorkout } from '@/lib/api/gym';
import { type ActiveCircleLockIn, confirmLockInSession, fetchActiveCircleLockIns, stopLockInSession } from '@/lib/api/lock-ins';
import { fetchMyStreak } from '@/lib/api/profile';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { formatDurationClock } from '@/lib/format';
import { shareFireCompleteStory } from '@/lib/fire-share-card';
import { GOAL_TYPE_ICON, GOAL_TYPE_META } from '@/lib/goal-types';
import { isRankUp } from '@/lib/rank-tiers';
import { fireIgnite } from '@/lib/reward-feedback';
import { shareCardImage } from '@/lib/share-card';
import { isFirstLockInTutorialDone, markFirstLockInTutorialDone } from '@/lib/tutorial';
import type { CheckIn, GoalType, MyRank, RankTierName, WorkoutEnergy, WorkoutRecap } from '@/types/database';

const PARTICIPANTS_POLL_MS = 20000;
const STILL_HERE_THRESHOLD_MS = 55 * 60 * 1000; // matches the ~1hr server-side reminder, shown client-side too so it's not a surprise
// Matches LockInFlame's own MAX_STAGE, so the bounded photo area and the flame's growth
// stages top out at roughly the same session-length feel.
const MAX_PHOTOS = 6;
// "Immersive darker background, minimal chrome" (PHILOI_UI_SPEC.md §13, design-mocks/09) —
// distinct from every other screen's Colors.cream, a one-off for this screen only.
const IMMERSIVE_BG = '#17131f';
const BODY_DOUBLES_BG = '#201a2c';
// The pre-workout energy state, echoed in the gym session header (design-mocks/24's `.moodchip`)
// so it's visible while lifting — it's what nudged the suggested numbers on every row below.
const ENERGY_CHIP: Record<WorkoutEnergy, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  light: { label: 'Light — easing off', icon: 'leaf-outline' },
  same: { label: 'Same as usual', icon: 'reorder-two-outline' },
  dialed: { label: 'Dialed — targets +', icon: 'flash' },
};

function findUniversal(ranks: MyRank[]): MyRank | undefined {
  return ranks.find((r) => r.scope === 'universal');
}

export default function LockInScreenWithBoundary() {
  // A failed RPC on this screen (e.g. a stale PostgREST schema cache right after a migration —
  // this project has hit that exact class of bug before) must never trap the user on a frozen
  // screen with no way out. See error-boundary.tsx.
  return (
    <ErrorBoundary title="Something went wrong with this lock-in">
      <LockInScreen />
    </ErrorBoundary>
  );
}

function LockInScreen() {
  const router = useRouter();
  const {
    type: typeParam,
    detail: detailParam,
    circleId: circleIdParam,
    // Gym only (PHILOI_UI_SPEC.md §23) — chosen in the goal picker's routine block, turned into
    // the workout itself once the session exists. Absent for every other goal type.
    routineId: routineIdParam,
    energy: energyParam,
  } = useLocalSearchParams<{
    type?: string;
    detail?: string;
    circleId?: string;
    routineId?: string;
    energy?: string;
  }>();
  const { session, profile, refreshProfile } = useAuth();
  const { session: activeSession, loading: activeLoading, start, clear, touchConfirmedAt } = useActiveSession();

  const [activeLockIns, setActiveLockIns] = useState<ActiveCircleLockIn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [photos, setPhotos] = useState<{ id: string; uri: string }[]>([]);
  const [photoAreaBounds, setPhotoAreaBounds] = useState({ width: 0, height: 0 });
  const [caption, setCaption] = useState('');
  // The finished gym workout (exercises, top sets, PRs), read back once the check-in exists so
  // the done screen can offer it as part of the lock-in data — private or posted (§23).
  const [workoutRecap, setWorkoutRecap] = useState<WorkoutRecap | null>(null);
  // 0 = resolved-done or not-yet-resolved; 1/2 = which of the two tooltips is showing.
  const [tutorialStep, setTutorialStep] = useState<0 | 1 | 2>(0);

  const [posted, setPosted] = useState(false);
  const [postedCheckIn, setPostedCheckIn] = useState<CheckIn | null>(null);
  const [rankBefore, setRankBefore] = useState<MyRank | undefined>(undefined);
  const [rankAfter, setRankAfter] = useState<MyRank | undefined>(undefined);
  const [streakBefore, setStreakBefore] = useState(0);
  const [streakAfter, setStreakAfter] = useState(0);
  const [rankUpInfo, setRankUpInfo] = useState<{
    tier: RankTierName;
    division: number;
    fromTier: RankTierName;
    fromDivision: number;
    streakDays: number;
  } | null>(null);
  // Set only when this exact stop is the one that crosses the daily flame meter to 100%
  // (PHILOI_UI_SPEC.md §13) — never on later same-day lock-ins, which still earn normal XP but
  // don't re-trigger the celebration. Rendered after rankUpInfo resolves (§11's "rank-up wins"
  // rule — see the render branches below and handleRankUpContinue).
  const [fireCompleteInfo, setFireCompleteInfo] = useState<{
    bonusXp: number;
    bonusEmbers: number;
    embersBefore: number;
    day: string;
  } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [fireSharing, setFireSharing] = useState(false);
  // Snapshot of activeSession's circle at the moment Stop succeeds — clear() (called right
  // after a successful stop, so the mini-map/home update immediately) wipes activeSession
  // before this screen's own Done-recap render happens, so this is captured separately.
  const [doneCircleId, setDoneCircleId] = useState<string | null>(null);
  const [doneCircleName, setDoneCircleName] = useState<string | null>(null);

  const rewardBurstRef = useRef<RewardBurstHandle>(null);
  // The off-screen 9:16 share cards — mounted (but never visible) as soon as their celebration
  // is set, so they're already laid out and ready to capture by the time the user actually
  // taps Share.
  const fireCardRef = useRef<View>(null);
  const rankCardRef = useRef<View>(null);

  // Slow ink->coral color breathe on the running timer — a quiet "this is live" signal
  // distinct from LockInFlame's own breathe (kept separate to avoid prop-drilling a shared value).
  const timerPulse = useSharedValue(0);
  useEffect(() => {
    timerPulse.value = withRepeat(withSequence(withTiming(1, { duration: 1400 }), withTiming(0, { duration: 1400 })), -1, false);
  }, [timerPulse]);
  const timerPulseStyle = useAnimatedStyle(() => ({
    color: interpolateColor(timerPulse.value, [0, 1], [Colors.ink, Colors.coral]),
  }));

  // Only for the plain "done" recap — a tier CROSS skips this entirely, since
  // RankUpCelebration fires its own sound/haptic timed to the forge's flare beat instead of
  // the moment the screen mounts (see rank-up-celebration.tsx).
  useEffect(() => {
    if (posted && !rankUpInfo) rewardBurstRef.current?.fire();
  }, [posted, rankUpInfo]);

  // Landing here IS the "press to start" action, unless there's already an active session
  // (e.g. reopened from a "still here?" notification, or resumed from the mini-map) — that
  // always wins over the incoming params, since a user can only ever have one active session
  // (enforced server-side, and now also reflected app-wide via ActiveSessionProvider).
  //
  // startHandledRef guards against a real bug: clear() (called from handleStop, right after a
  // successful stop) sets activeSession back to null while typeParam/detailParam/circleIdParam
  // are still sitting in the route params (they don't clear themselves) — without this guard,
  // activeSession flipping to null re-triggers this effect, activeSession is falsy again, and
  // it happily calls start() a second time with the same stale params, spawning a phantom
  // session right after Stop. The ref makes the start/resume decision fire at most once per
  // mount; `posted || stopping` is a second, redundant belt-and-suspenders check for the same
  // window (once a stop is underway or done, this effect should never do anything more).
  const startHandledRef = useRef(false);
  useEffect(() => {
    if (activeLoading || !session) return;
    if (posted || stopping) return;
    if (startHandledRef.current) return;
    let mounted = true;
    (async () => {
      // Claimed immediately, before any await — "at most once per mount" regardless of which
      // branch below ends up running or how long it takes.
      startHandledRef.current = true;
      try {
        const tutorialDone = await isFirstLockInTutorialDone();
        if (!mounted) return;
        if (!tutorialDone) {
          setTutorialStep(1);
          track('first_lock_in_tutorial_shown', {});
        }

        if (!activeSession) {
          if (typeParam) {
            await start(typeParam as GoalType, detailParam ?? null, circleIdParam ?? null);
            if (!mounted) return;
            // "Ignite" (PHILOI_UI_SPEC.md §22) — only for a genuinely NEW session, never on
            // resuming an existing one (e.g. reopened from a "still here?" notification).
            fireIgnite();
          } else {
            setError('No active lock-in session to resume.');
          }
        }
      } catch (e) {
        if (mounted) setError(getErrorMessage(e, 'Could not start your session.'));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeLoading, activeSession, session, typeParam, detailParam, circleIdParam, start, posted, stopping]);

  // "Locked in with you" (PHILOI_UI_SPEC.md §13) — scoped to this campfire only; a solo
  // session (circleId null) shows no body-doubles. Polling, not Realtime Presence (see the
  // lock-in build plan for why: no existing Presence usage in this codebase yet).
  useEffect(() => {
    if (!session || !activeSession?.circleId) return;
    const circleId = activeSession.circleId;
    let mounted = true;
    async function poll() {
      try {
        const active = await fetchActiveCircleLockIns(circleId);
        if (mounted) setActiveLockIns(active.filter((a) => a.session.user_id !== session!.user.id));
      } catch {
        // Ambient presence is a nice-to-have — a failed poll shouldn't surface an error to the user.
      }
    }
    poll();
    const interval = setInterval(poll, PARTICIPANTS_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [session, activeSession?.id, activeSession?.circleId]);

  // The live workout log (PHILOI_UI_SPEC.md §23). `mode` on the active session already routes
  // gym here (see active-session-context.tsx) — this is the logger that hook was reserved for.
  const isGym = activeSession?.goalType === 'gym';
  const {
    workout,
    loading: workoutLoading,
    refetch: refetchWorkout,
    logSet,
    removeSet,
    addExercise,
    replaceExercise,
    removeExercise,
    moveExercise,
  } = useActiveWorkout(Boolean(isGym) && !posted);

  // start_workout is idempotent by design, so this runs on BOTH paths that can land here with a
  // gym session: a fresh start (creating the workout from the picked routine + energy) and a
  // resume after the app was closed mid-session (returning the workout already in progress).
  // Once per session id — routineId/energy are stale route params that outlive the start, same
  // hazard startHandledRef guards above.
  const gymStartedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSession || !isGym || posted || stopping) return;
    if (gymStartedRef.current === activeSession.id) return;
    gymStartedRef.current = activeSession.id;
    const sessionId = activeSession.id;
    let mounted = true;
    (async () => {
      try {
        await startWorkout(sessionId, routineIdParam ?? null, (energyParam as WorkoutEnergy) ?? 'same');
      } catch (e) {
        if (mounted) setError(getErrorMessage(e, 'Could not set up your workout.'));
      }
      if (mounted) await refetchWorkout();
    })();
    return () => {
      mounted = false;
    };
  }, [activeSession, isGym, posted, stopping, routineIdParam, energyParam, refetchWorkout]);

  const participants: LockInFlameParticipant[] = activeLockIns.map((a) => ({
    user_id: a.session.user_id,
    display_name: a.display_name,
    avatar_url: a.avatar_url,
  }));

  const elapsedSeconds = useElapsedSeconds(activeSession?.startedAt ?? null);
  // Keyed off last confirmation, not session start — matches the server-side sweep
  // (notify_stale_lock_ins), so tapping "still here" actually dismisses this banner
  // instead of it staying stuck on for the rest of a long session. Recomputed inline (not
  // memoized) since useElapsedSeconds above already forces a re-render every second, which
  // this piggybacks on rather than running its own separate ticking interval.
  const stillHereDue = activeSession ? Date.now() - activeSession.lastConfirmedAt.getTime() > STILL_HERE_THRESHOLD_MS : false;

  async function handleConfirmStillHere() {
    if (!activeSession) return;
    await confirmLockInSession(activeSession.id);
    touchConfirmedAt();
  }

  async function takePhoto() {
    if (photos.length >= MAX_PHOTOS) return;
    setError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Philoi needs camera access to add a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (result.canceled || !result.assets[0]) return;

      // Resize + compress before it ever touches state — these are the images that bounce
      // around the screen for the rest of the session, so keeping them small keeps that
      // animation cheap, and it's the size that eventually uploads at Stop time too.
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      setPhotos((prev) => [...prev, { id: Crypto.randomUUID(), uri: manipulated.uri }]);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not open the camera.'));
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  function handlePhotoAreaLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setPhotoAreaBounds({ width, height });
  }

  async function handleStop() {
    if (!activeSession || !session) return;
    setStopping(true);
    setError(null);
    try {
      // Snapshotted before stopLockInSession/refreshProfile — refreshProfile() later in this
      // function overwrites the AuthContext's profile.embers with the POST-bonus balance, so
      // the fire-complete celebration's ember counter (if this stop crosses the meter) needs
      // this pre-bonus figure captured up front, not re-derived after the fact.
      const embersBeforeSnapshot = profile?.embers ?? 0;
      const [ranksBefore, streakBefore] = await Promise.all([
        fetchMyRanks().catch(() => [] as MyRank[]),
        fetchMyStreak(session.user.id).catch(() => ({ current_streak: 0, longest_streak: 0 })),
      ]);
      const wasFirstEver = streakBefore.current_streak === 0 && streakBefore.longest_streak === 0;
      const goalType = activeSession.goalType;

      const checkIn = await stopLockInSession({
        sessionId: activeSession.id,
        userId: session.user.id,
        goalType,
        photoUris: photos.map((p) => p.uri),
        caption,
      });

      // The gym log was already persisted set-by-set; stop_lock_in_session bound it to this
      // check-in and rolled it up, so this reads back the finished summary (including whether
      // the "dialed" brag was actually earned — see §23's honest-brag rule).
      if (goalType === 'gym') {
        setWorkoutRecap(await fetchWorkoutRecap(checkIn.id).catch(() => null));
      }

      const [streakAfter, ranksAfter] = await Promise.all([
        fetchMyStreak(session.user.id).catch(() => streakBefore),
        fetchMyRanks().catch(() => [] as MyRank[]),
      ]);

      const universalBefore = findUniversal(ranksBefore);
      const universalAfter = findUniversal(ranksAfter);
      const rankedUp = universalBefore && universalAfter && isRankUp(universalBefore, universalAfter);
      // The full-screen forge runs on EVERY rank-up now (PHILOI_UI_SPEC.md §21/§22) — both tier
      // crossings AND within-tier division bumps. RankUpCelebration derives the lighter flare
      // payoff (soft tier-tinted flash + scaled-down cue) for a bump from before/after itself, so
      // there's a single path here. universalAfter already IS the final resulting rank (a single
      // before/after comparison, not a per-step walk), so a multi-rank jump shows only the final
      // tier — no extra handling needed.
      if (rankedUp && universalBefore && universalAfter) {
        setRankUpInfo({
          tier: universalAfter.tier,
          division: universalAfter.division,
          fromTier: universalBefore.tier,
          fromDivision: universalBefore.division,
          streakDays: streakAfter.current_streak,
        });
      }

      // Did THIS stop cross the daily flame meter? just_completed is only true on the exact
      // call that transitions completed false->true, so later same-day lock-ins never
      // re-trigger this even though they still call the same RPC (§13).
      const dailyFire = await fetchOrCreateDailyFire().catch(() => null);
      if (dailyFire?.just_completed) {
        setFireCompleteInfo({
          bonusXp: dailyFire.bonus_xp,
          bonusEmbers: dailyFire.bonus_embers,
          embersBefore: embersBeforeSnapshot,
          day: dailyFire.day,
        });
      }

      setRankBefore(universalBefore);
      setRankAfter(universalAfter);
      setStreakBefore(streakBefore.current_streak);
      setStreakAfter(streakAfter.current_streak);
      setPostedCheckIn(checkIn);
      // Snapshot before clear() wipes activeSession, then clear immediately — the session is
      // done server-side, so the mini-map/home should stop reflecting it right away, even
      // while this screen still shows the recap.
      setDoneCircleId(activeSession.circleId);
      setDoneCircleName(activeSession.circleName);
      clear();
      setPosted(true);

      if (wasFirstEver) track('first_check_in', { goal_type: goalType });

      // Tutorial completes on the real action (a successfully stopped lock-in), not on
      // dismissing tooltip chrome — see tutorial.ts.
      if (tutorialStep > 0) {
        setTutorialStep(0);
        await markFirstLockInTutorialDone();
        track('first_lock_in_tutorial_completed', { goal_type: goalType });
      }

      await refreshProfile();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not end your session.'));
    } finally {
      setStopping(false);
    }
  }

  async function handleShareRankUp() {
    if (!rankUpInfo) return;
    setSharing(true);
    try {
      await shareCardImage(rankCardRef, 'Share to your story');
    } finally {
      setSharing(false);
    }
  }

  // Rank-up wins (PHILOI_UI_SPEC.md §11) — if both fired on the same stop, RankUpCelebration
  // shows first; Continue here just drops rankUpInfo (rather than navigating home), which lets
  // the render fall through to the fireCompleteInfo branch below on the very next render.
  function handleRankUpContinue() {
    if (fireCompleteInfo) {
      setRankUpInfo(null);
    } else {
      router.replace('/');
    }
  }

  async function handleShareFireComplete() {
    if (!fireCompleteInfo) return;
    setFireSharing(true);
    try {
      await shareFireCompleteStory(fireCardRef);
    } finally {
      setFireSharing(false);
    }
  }

  if (posted && postedCheckIn && rankUpInfo) {
    return (
      // Immersive forge backdrop (Colors.forgeBg), not the plum `dark` Screen — the celebration
      // paints its own radial glow over this, and the safe-area insets stay dark too.
      <Screen backgroundColor={Colors.forgeBg} padded={false}>
        <RankUpCelebration
          tier={rankUpInfo.tier}
          division={rankUpInfo.division}
          fromTier={rankUpInfo.fromTier}
          fromDivision={rankUpInfo.fromDivision}
          streakDays={rankUpInfo.streakDays}
          firstName={profile?.display_name?.split(' ')[0] ?? 'You'}
          university={profile?.university}
          onContinue={handleRankUpContinue}
          onShare={handleShareRankUp}
          sharing={sharing}
        />
        <View style={styles.offscreenCard} pointerEvents="none">
          <RankUpShareCard
            ref={rankCardRef}
            displayName={profile?.display_name ?? 'You'}
            tier={rankUpInfo.tier}
            division={rankUpInfo.division}
            streakDays={rankUpInfo.streakDays}
            circleName={doneCircleName}
          />
        </View>
      </Screen>
    );
  }

  if (posted && postedCheckIn && fireCompleteInfo) {
    return (
      <Screen dark>
        <FlameMeterComplete
          displayName={profile?.display_name ?? 'You'}
          goalType={postedCheckIn.goal_type}
          goalDetail={postedCheckIn.goal_detail}
          durationSeconds={postedCheckIn.duration_seconds ?? 0}
          checkInId={postedCheckIn.id}
          xpEarned={postedCheckIn.xp_earned}
          bonusXp={fireCompleteInfo.bonusXp}
          bonusEmbers={fireCompleteInfo.bonusEmbers}
          embersBefore={fireCompleteInfo.embersBefore}
          day={fireCompleteInfo.day}
          rankBefore={rankBefore}
          rankAfter={rankAfter}
          circleId={doneCircleId}
          circleName={doneCircleName}
          onShare={handleShareFireComplete}
          sharing={fireSharing}
          onDone={() => router.replace('/')}
        />
        <View style={styles.offscreenCard} pointerEvents="none">
          <FireShareCard
            ref={fireCardRef}
            displayName={profile?.display_name ?? 'You'}
            streakDays={streakAfter}
            tier={rankAfter?.tier ?? 'bronze'}
            division={rankAfter?.division ?? 3}
          />
        </View>
      </Screen>
    );
  }

  if (posted && postedCheckIn) {
    return (
      <Screen style={styles.container}>
        <RewardBurst ref={rewardBurstRef} cue="settle" />
        <LockInDoneScreen
          goalType={postedCheckIn.goal_type}
          goalDetail={postedCheckIn.goal_detail}
          durationSeconds={postedCheckIn.duration_seconds ?? 0}
          checkInId={postedCheckIn.id}
          xpEarned={postedCheckIn.xp_earned}
          rankBefore={rankBefore}
          rankAfter={rankAfter}
          streakBefore={streakBefore}
          streakAfter={streakAfter}
          photos={photos}
          workoutRecap={workoutRecap}
          circleId={doneCircleId}
          circleName={doneCircleName}
          onDone={() => router.replace('/')}
        />
      </Screen>
    );
  }

  if (loading || activeLoading || !activeSession) {
    return (
      <Screen style={styles.container}>
        <Text style={styles.loading}>{error ?? 'Starting your session…'}</Text>
      </Screen>
    );
  }

  // GYM (PHILOI_UI_SPEC.md §23, design-mocks/24) — the same running session, but the flame and
  // the big timer give up the stage to the workout log. The timer shrinks to a header pill, the
  // body-doubles collapse to a one-line avatar strip, and the middle of the screen becomes the
  // scrollable log. Everything else (photos, the still-here banner, Finish) behaves identically.
  if (isGym) {
    return (
      <Screen backgroundColor={IMMERSIVE_BG} style={styles.gymContainer} padded={false}>
        <View style={styles.gymHeader}>
          <View style={styles.gymHeaderText}>
            {activeSession.circleName && <Text style={styles.campfireName}>{activeSession.circleName}</Text>}
            <View style={styles.goalChip}>
              <Ionicons name={GOAL_TYPE_ICON.gym} size={13} color={Colors.amber} />
              <Text style={styles.goalChipText}>
                {GOAL_TYPE_META.gym.label}
                {workout?.routine_name ? ` · ${workout.routine_name}` : activeSession.goalDetail ? ` · ${activeSession.goalDetail}` : ''}
              </Text>
            </View>
            {workout && (
              <View style={styles.energyChip}>
                <Ionicons name={ENERGY_CHIP[workout.energy].icon} size={10} color={Colors.achieverText} />
                <Text style={styles.energyChipText}>{ENERGY_CHIP[workout.energy].label}</Text>
              </View>
            )}
          </View>
          <View style={styles.gymTimer}>
            <Animated.Text style={[styles.gymTimerValue, timerPulseStyle]}>{formatDurationClock(elapsedSeconds)}</Animated.Text>
            <Text style={styles.gymTimerLabel}>LOCKED IN</Text>
          </View>
        </View>

        <ScrollView
          style={styles.gymLog}
          contentContainerStyle={styles.gymLogContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          {stillHereDue && (
            <Animated.View entering={FadeInDown.springify().damping(14)} exiting={FadeOutUp.duration(200)}>
              <Pressable onPress={handleConfirmStillHere} style={styles.stillHereBanner}>
                <Text style={styles.stillHereText}>Long session — still here? Tap to confirm.</Text>
              </Pressable>
            </Animated.View>
          )}

          {workoutLoading && !workout && <Text style={styles.loading}>Setting up your workout…</Text>}

          {workout && (
            <WorkoutLog
              workout={workout}
              onLogSet={logSet}
              onRemoveSet={removeSet}
              onAddExercise={addExercise}
              onReplaceExercise={replaceExercise}
              onRemoveExercise={removeExercise}
              onMoveExercise={moveExercise}
            />
          )}

          {photos.length > 0 && (
            <View style={styles.gymPhotoArea} onLayout={handlePhotoAreaLayout}>
              {photos.map((p) => (
                <BouncingPhoto key={p.id} uri={p.uri} bounds={photoAreaBounds} onRemove={() => removePhoto(p.id)} />
              ))}
            </View>
          )}

          <TextInput placeholder="Add a caption (optional)" value={caption} onChangeText={setCaption} maxLength={140} />

          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>

        <View style={styles.gymFooter}>
          {/* Collapsed to a strip here — in a gym the log is what you're looking at, so the
              body-doubles stay present as ambient company rather than a stack of rows. */}
          {activeLockIns.length > 0 && (
            <View style={styles.doubleStrip}>
              <View style={styles.doubleAvatars}>
                {activeLockIns.slice(0, 4).map((a, i) => (
                  <View key={a.session.id} style={[styles.doubleAvatar, i > 0 && styles.doubleAvatarStacked]}>
                    <Text style={styles.doubleAvatarText}>{a.display_name.charAt(0).toUpperCase()}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.doubleStripText} numberOfLines={1}>
                {activeLockIns.length === 1
                  ? `${activeLockIns[0].display_name} is locked in with you`
                  : `${activeLockIns.length} locked in with you`}
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={takePhoto}
              disabled={photos.length >= MAX_PHOTOS}
              style={[styles.cameraButton, photos.length >= MAX_PHOTOS && styles.cameraButtonDisabled]}
              accessibilityLabel="Take a photo"
              accessibilityRole="button">
              <Ionicons name="camera" size={22} color={Colors.ink} />
              {photos.length > 0 && (
                <View style={styles.cameraBadge}>
                  <Text style={styles.cameraBadgeText}>{photos.length}</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={handleStop}
              disabled={stopping}
              style={styles.stopButton}
              accessibilityLabel="Finish workout"
              accessibilityRole="button">
              <Ionicons name="stop" size={16} color={Colors.ink} />
              <Text style={styles.stopLabel}>{stopping ? 'Finishing…' : 'Finish workout'}</Text>
            </Pressable>
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen backgroundColor={IMMERSIVE_BG} style={styles.container}>
      {/* TOP — pinned, natural size. */}
      <View style={styles.top}>
        {activeSession.circleName && <Text style={styles.campfireName}>{activeSession.circleName}</Text>}
        <View style={styles.goalChip}>
          <Ionicons name={GOAL_TYPE_ICON[activeSession.goalType]} size={13} color={Colors.amber} />
          <Text style={styles.goalChipText}>
            {GOAL_TYPE_META[activeSession.goalType].label}
            {activeSession.goalDetail ? ` · ${activeSession.goalDetail}` : ''}
          </Text>
        </View>
      </View>

      {/* CENTER — the only flex:1 sibling in this column, so it claims 100% of whatever's left
          between TOP and BOTTOM and centers the flame/timer/caption group inside that space.
          This is what pins BOTTOM to the bottom too — nothing below here needs its own
          flex/margin trick, it just renders right after however much space this consumes. */}
      <View style={styles.stage}>
        <LockInFlame goalType={activeSession.goalType} elapsedSeconds={elapsedSeconds} participants={participants} />
        <TutorialTooltip
          visible={tutorialStep === 1}
          text="This is your flame — it grows the longer you stay locked in."
          onDismiss={() => setTutorialStep(2)}
        />
        <Animated.Text style={[styles.timer, timerPulseStyle]}>{formatDurationClock(elapsedSeconds)}</Animated.Text>
        <Text style={styles.lockedCaption}>LOCKED IN</Text>
      </View>

      {/* BOTTOM — pinned, natural size. */}
      <View style={styles.footer}>
        {stillHereDue && (
          <Animated.View entering={FadeInDown.springify().damping(14)} exiting={FadeOutUp.duration(200)}>
            <Pressable onPress={handleConfirmStillHere} style={styles.stillHereBanner}>
              <Text style={styles.stillHereText}>Long session — still here? Tap to confirm.</Text>
            </Pressable>
          </Animated.View>
        )}

        {activeLockIns.length > 0 && (
          <View style={styles.bodyDoubles}>
            <Text style={styles.bodyDoublesTitle}>Locked in with you</Text>
            {activeLockIns.map((a) => (
              <BodyDoubleRow key={a.session.id} activeLockIn={a} />
            ))}
          </View>
        )}

        <View style={styles.photoArea} onLayout={handlePhotoAreaLayout}>
          {photos.map((p) => (
            <BouncingPhoto key={p.id} uri={p.uri} bounds={photoAreaBounds} onRemove={() => removePhoto(p.id)} />
          ))}
        </View>

        <TextInput placeholder="Add a caption (optional)" value={caption} onChangeText={setCaption} maxLength={140} />

        {error && <Text style={styles.error}>{error}</Text>}

        <TutorialTooltip visible={tutorialStep === 2} text="Tap Stop when you're done to lock it in for real." />

        <View style={styles.actions}>
          <Pressable
            onPress={takePhoto}
            disabled={photos.length >= MAX_PHOTOS}
            style={[styles.cameraButton, photos.length >= MAX_PHOTOS && styles.cameraButtonDisabled]}
            accessibilityLabel="Take a photo"
            accessibilityRole="button">
            <Ionicons name="camera" size={22} color={Colors.ink} />
            {photos.length > 0 && (
              <View style={styles.cameraBadge}>
                <Text style={styles.cameraBadgeText}>{photos.length}</Text>
              </View>
            )}
          </Pressable>
          <Pressable
            onPress={handleStop}
            disabled={stopping}
            style={styles.stopButton}
            accessibilityLabel="Stop lock-in"
            accessibilityRole="button">
            <Ionicons name="stop" size={16} color={Colors.ink} />
            <Text style={styles.stopLabel}>{stopping ? 'Stopping…' : 'Stop lock-in'}</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: Spacing.three,
    paddingTop: Spacing.three,
    alignItems: 'center',
  },
  loading: {
    fontFamily: Fonts.body,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.six,
  },
  // Flame + timer + "LOCKED IN" claim the leftover vertical space between the header chip and
  // whatever's below (still-here banner / body-doubles / photos / actions) and center within
  // it — the focal moment of the screen, not packed up against the header.
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  top: {
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  // BOTTOM zone — a plain (non-flex) block; it renders at its natural size right after
  // whatever space CENTER's flex:1 didn't consume, which is what pins it to the bottom.
  footer: {
    alignSelf: 'stretch',
    gap: Spacing.three,
  },
  campfireName: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  goalChip: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  goalChipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.achieverText,
  },
  timer: {
    fontFamily: Fonts.display,
    fontSize: 46,
    letterSpacing: 1,
    color: Colors.ink,
  },
  lockedCaption: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    letterSpacing: 1,
    color: Colors.muted,
    marginTop: -Spacing.one,
  },
  stillHereBanner: {
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'stretch',
  },
  stillHereText: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.achieverText,
    textAlign: 'center',
  },
  bodyDoubles: {
    alignSelf: 'stretch',
    borderRadius: 14,
    backgroundColor: BODY_DOUBLES_BG,
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  bodyDoublesTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.textTertiary,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.one,
  },
  photoArea: {
    width: '100%',
    height: 180,
    overflow: 'hidden',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    width: '100%',
  },
  cameraButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraButtonDisabled: {
    opacity: 0.5,
  },
  cameraBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: Colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.ink,
  },
  stopButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.disabled,
    borderRadius: 16,
    paddingVertical: Spacing.three,
  },
  stopLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    textAlign: 'center',
  },
  // ─────────────── gym session (§23, design-mocks/24) ───────────────
  // Its own three-band layout — header / scrolling log / footer — rather than the flame
  // screen's TOP/CENTER/BOTTOM, because the middle band here is a scroll view that has to
  // claim every pixel the other two don't.
  gymContainer: {
    flex: 1,
  },
  gymHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    paddingTop: Spacing.twelve,
    paddingBottom: 10,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  gymHeaderText: {
    flex: 1,
    alignItems: 'flex-start',
    minWidth: 0,
  },
  energyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: 'rgba(224,97,44,0.45)',
    borderRadius: Radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  energyChipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.achieverText,
  },
  gymTimer: {
    alignItems: 'flex-end',
  },
  gymTimerValue: {
    fontFamily: Fonts.display,
    fontSize: 20,
    letterSpacing: 0.5,
    color: Colors.ink,
  },
  gymTimerLabel: {
    fontFamily: Fonts.body,
    fontSize: 8.5,
    letterSpacing: 1,
    color: Colors.textTertiary,
  },
  gymLog: {
    flex: 1,
  },
  gymLogContent: {
    gap: Spacing.twelve,
    paddingTop: Spacing.twelve,
    paddingBottom: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  // Only mounted once there's a photo to bounce (unlike the flame screen, where the area is
  // always reserved) — an empty 180px hole in the middle of a workout log is dead weight.
  gymPhotoArea: {
    width: '100%',
    height: 180,
    overflow: 'hidden',
  },
  gymFooter: {
    gap: 9,
    paddingTop: 9,
    paddingBottom: Spacing.twelve,
    paddingHorizontal: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  doubleStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  doubleAvatars: {
    flexDirection: 'row',
  },
  doubleAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.achieverBg,
    borderWidth: 1.5,
    borderColor: Colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doubleAvatarStacked: {
    marginLeft: -5,
  },
  doubleAvatarText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9,
    color: Colors.achieverText,
  },
  doubleStripText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  // Laid out (so react-native-view-shot has real dimensions to capture) but positioned well
  // outside the viewport — never a screenshot of the visible celebration UI, a purpose-built
  // 9:16 card rendered in its own hidden tree (see fire-share-card.tsx).
  offscreenCard: {
    position: 'absolute',
    top: -10000,
    left: 0,
  },
});
