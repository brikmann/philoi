import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { BodyDoubleStrip, BodyDoubleStripCollapsed } from '@/components/body-double-strip';
import { CindyBubble } from '@/components/cindy/cindy-bubble';
import { CindyFlamePress } from '@/components/cindy/cindy-flame-press';
import { CindyQuickSheet, type CindyQuickAction } from '@/components/cindy/cindy-quick-sheet';
import { DriftingEmbers } from '@/components/drifting-embers';
import { ErrorBoundary } from '@/components/error-boundary';
import { EquippedFlameSvg } from '@/components/flame-icon';
import { EquippedFlameParticles, EquippedFlarePerimeter, useFlareEquipped } from '@/components/economy/flare-perimeter';
import { useKeepScreenAwakePref } from '@/lib/reward-settings';
import { FireShareCard } from '@/components/fire-share-card';
import { LockInShareCard } from '@/components/lock-in-share-card';
import { FlameMeterComplete } from '@/components/flame-meter-complete';
import { LockInDoneScreen } from '@/components/lockin-done-screen';
import { RankUpCelebration } from '@/components/rank-up-celebration';
import { RankUpShareCard } from '@/components/rank-up-share-card';
import { RewardBurst, type RewardBurstHandle } from '@/components/reward-burst';
import { SessionFlame } from '@/components/session-flame';
import { SessionPhotoGallery } from '@/components/session-photo-gallery';
import { TutorialTooltip } from '@/components/tutorial-tooltip';
import { Screen } from '@/components/ui/screen';
import { WorkoutLog } from '@/components/workout-log';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useActiveWorkout } from '@/hooks/use-active-workout';
import { useCindy } from '@/hooks/use-cindy';
import { useCindyLockInLine } from '@/hooks/use-cindy-lockin-line';
import { useElapsedSeconds } from '@/hooks/use-elapsed-seconds';
import { useInventory } from '@/hooks/use-inventory';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useActiveSession } from '@/lib/active-session-context';
import { track } from '@/lib/analytics';
import { creditLockInTimeGoals } from '@/lib/api/challenges';
import { fetchOrCreateDailyFire } from '@/lib/api/daily-fire';
import { fetchMyRanks } from '@/lib/api/goals';
import { fetchWorkoutRecap, startWorkout } from '@/lib/api/gym';
import { type ActiveCircleLockIn, confirmLockInSession, fetchActiveCircleLockIns, stopLockInSession } from '@/lib/api/lock-ins';
import { fetchMyStreak } from '@/lib/api/profile';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { formatDurationClock } from '@/lib/format';
import { shareFireCompleteStory } from '@/lib/fire-share-card';
import { GOAL_TYPE_META } from '@/lib/goal-types';
import { deriveRankUpLevel } from '@/lib/rank-watch';
import { isRankUp } from '@/lib/rank-tiers';
import { clearSessionAudioChoice, playEquippedSfx, stopEquippedAmbient } from '@/lib/economy/equipped-audio';
import { fireIgnite } from '@/lib/reward-feedback';

import { shareCardImage } from '@/lib/share-card';
import { isFirstLockInTutorialDone, markFirstLockInTutorialDone } from '@/lib/tutorial';
import type { CheckIn, GoalType, MyRank, RankTierName, WorkoutEnergy, WorkoutRecap } from '@/types/database';

const PARTICIPANTS_POLL_MS = 20000;
const STILL_HERE_THRESHOLD_MS = 55 * 60 * 1000; // matches the ~1hr server-side reminder, shown client-side too so it's not a surprise
const MAX_PHOTOS = 6;
// One tag for this screen's wake lock, so activate/deactivate always refer to the same lock.
const KEEP_AWAKE_TAG = 'philoi-lock-in';
// "Immersive darker background, minimal chrome" (PHILOI_UI_SPEC.md §13, design-mocks/51) —
// distinct from every other screen's Colors.cream, a one-off for this screen only.
const IMMERSIVE_BG = '#17131f';
// The pre-workout energy state, shrunk to a single word for the gym header chip (design-mocks/52's
// `.energy`, which reads "DIALED") — it's what nudged the suggested numbers on every row below,
// so it stays visible while lifting, just no longer as a full sentence.
const ENERGY_CHIP_LABEL: Record<WorkoutEnergy, string> = {
  light: 'Light',
  same: 'Same',
  dialed: 'Dialed',
};

// Mock 52's top scrim — `linear-gradient(180deg,#17131f 8%,rgba(23,19,31,.55) 40%,
// rgba(23,19,31,.15) 70%,transparent)`, so the workout log stays readable over the flame behind
// it. An SVG gradient rather than stacked translucent Views, which band visibly at this height.
function GymScrim() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="gymScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.08" stopColor={IMMERSIVE_BG} stopOpacity={1} />
            <Stop offset="0.4" stopColor={IMMERSIVE_BG} stopOpacity={0.55} />
            <Stop offset="0.7" stopColor={IMMERSIVE_BG} stopOpacity={0.15} />
            <Stop offset="1" stopColor={IMMERSIVE_BG} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#gymScrim)" />
      </Svg>
    </View>
  );
}

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
  // Flips 12s into a start that hasn't resolved — reveals the manual way out below rather than
  // stranding the user on a modal with no back affordance (punchlist #42).
  const [startStalled, setStartStalled] = useState(false);
  const [photos, setPhotos] = useState<{ id: string; uri: string }[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
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
  const lockInCardRef = useRef<View>(null);
  const [lockInSharing, setLockInSharing] = useState(false);

  // Slow ink->coral color breathe on the running timer — a quiet "this is live" signal
  // distinct from SessionFlame's own flick (kept separate to avoid prop-drilling a shared value).
  const reduceMotion = useReduceMotion();
  const timerPulse = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      // Rest at 0 = plain ink, the same color the pulse spends most of its cycle at.
      timerPulse.value = 0;
      return;
    }
    timerPulse.value = withRepeat(withSequence(withTiming(1, { duration: 1400 }), withTiming(0, { duration: 1400 })), -1, false);
  }, [timerPulse, reduceMotion]);
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
  // TRUE for as long as this screen is on-screen — deliberately NOT the old per-effect-run
  // `let mounted` flag. That flag was set false by the effect's CLEANUP, which React runs on
  // every dep change, not just unmount; `start()` below sets activeSession (a dep), so the
  // in-flight run was routinely marked "stale" the instant it succeeded. Everything after the
  // await then short-circuited — including `finally { setLoading(false) }` — while
  // startHandledRef.current, already claimed, blocked the re-run from ever retrying. Result:
  // `loading` pinned true forever on the "Starting your session…" screen with no way out
  // (punchlist #42, the gym freeze — gym hit it hardest because its own start_workout effect
  // fires in the same commit and adds the extra render that loses the race). Unmount is the
  // only thing that should silence this work, so that's what this tracks.
  const screenMountedRef = useRef(true);
  useEffect(() => {
    screenMountedRef.current = true;
    return () => {
      screenMountedRef.current = false;
    };
  }, []);
  // Read inside the async body instead of via the dep array — this effect is "at most once per
  // mount" by construction (startHandledRef), so re-running it on every activeSession change
  // bought nothing and caused the churn above.
  const activeSessionRef = useRef(activeSession);
  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);
  useEffect(() => {
    if (activeLoading || !session) return;
    if (posted || stopping) return;
    if (startHandledRef.current) return;
    (async () => {
      // Claimed immediately, before any await — "at most once per mount" regardless of which
      // branch below ends up running or how long it takes.
      startHandledRef.current = true;
      try {
        const tutorialDone = await isFirstLockInTutorialDone();
        if (!screenMountedRef.current) return;
        if (!tutorialDone) {
          setTutorialStep(1);
          track('first_lock_in_tutorial_shown', {});
        }

        if (!activeSessionRef.current) {
          if (typeParam) {
            await start(typeParam as GoalType, detailParam ?? null, circleIdParam ?? null);
            if (!screenMountedRef.current) return;
            // "Ignite" (PHILOI_UI_SPEC.md §22) — only for a genuinely NEW session, never on
            // resuming an existing one (e.g. reopened from a "still here?" notification).
            fireIgnite();
          } else {
            setError('No active lock-in session to resume.');
          }
        }
      } catch (e) {
        if (screenMountedRef.current) setError(getErrorMessage(e, 'Could not start your session.'));
      } finally {
        if (screenMountedRef.current) setLoading(false);
      }
    })();
  }, [activeLoading, session, typeParam, detailParam, circleIdParam, start, posted, stopping]);

  const starting = loading || activeLoading || !activeSession;
  useEffect(() => {
    if (!starting) return;
    const timer = setTimeout(() => setStartStalled(true), 12000);
    // Cleared rather than reset via setState — once the start resolves this effect simply stops
    // arming the timer, and `starting && startStalled` at the render site is what gates the
    // escape hatch, so there's no synchronous state write in an effect body here.
    return () => clearTimeout(timer);
  }, [starting]);

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
    patchSetClip,
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
    (async () => {
      try {
        await startWorkout(sessionId, routineIdParam ?? null, (energyParam as WorkoutEnergy) ?? 'same');
      } catch (e) {
        if (screenMountedRef.current) setError(getErrorMessage(e, 'Could not set up your workout.'));
      }
      // Unconditional (same fix as the start effect above): this used to be gated on a
      // per-effect-run `mounted` flag that the cleanup cleared on any dep change, so a single
      // extra render between start_workout being called and it returning left `workout` null
      // forever — a gym session stuck on an empty log with no exercises and no way to add any,
      // since gymStartedRef had already been claimed. useActiveWorkout's own setState is the
      // right place to be unmount-safe, not this call site.
      if (screenMountedRef.current) await refetchWorkout();
    })();
  }, [activeSession, isGym, posted, stopping, routineIdParam, energyParam, refetchWorkout]);

  const elapsedSeconds = useElapsedSeconds(activeSession?.startedAt ?? null);

  // ── HOLD THE SCREEN ON (COSMETIC_UI_FIXES §7) ──
  //
  // The reported bug is that a lock-in quietly dies: the display auto-sleeps mid-session and the
  // flare, the flame and the ambient loop all stop at the same instant, because all three are
  // driven by things a sleeping screen suspends. Every cosmetic on this screen is undercut by it,
  // and the user's own read of the moment is that the app broke.
  //
  // activateKeepAwakeAsync/deactivateKeepAwake rather than `useKeepAwake()`: the hook holds the
  // lock for as long as the component is mounted, unconditionally, and this has to be gated on
  // BOTH an actually-running session and the user's preference — neither of which a hook call at
  // the top of the component can express. The tag is explicit so this lock is the only one this
  // screen releases, whatever else in the app might hold one.
  //
  // Failures are swallowed. A device that cannot take a wake lock is a device where the session
  // still runs; it is not a reason to put an error on top of someone's timer.
  //
  // NOTE (deliberately not built): this covers auto-sleep, which is the bug. If the user manually
  // locks the phone or backgrounds the app, the audio still stops — that needs true background
  // audio (`shouldPlayInBackground` plus UIBackgroundModes: ['audio'] in app.config), which is an
  // App Store review question rather than a rendering fix. Flagged, not slipped in.
  const keepScreenAwake = useKeepScreenAwakePref();
  useEffect(() => {
    if (!activeSession || !keepScreenAwake) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [activeSession, keepScreenAwake]);

  // The real spendable balance (ember_wallet via get_inventory) — see the note at the
  // embersBeforeSnapshot capture below.
  const { embers: walletEmbers, refetch: refetchInventory } = useInventory();
  const flareEquipped = useFlareEquipped();
  // Keyed off last confirmation, not session start — matches the server-side sweep
  // (notify_stale_lock_ins), so tapping "still here" actually dismisses this banner
  // instead of it staying stuck on for the rest of a long session. Recomputed inline (not
  // memoized) since useElapsedSeconds above already forces a re-render every second, which
  // this piggybacks on rather than running its own separate ticking interval.
  const stillHereDue = activeSession ? Date.now() - activeSession.lastConfirmedAt.getTime() > STILL_HERE_THRESHOLD_MS : false;

  // ── CINDY, mid-session (CINDY_SPEC "Entry points — Lock-in", mock 117 §C) ──
  // Consent gates both halves, the same way home does: no consent means no bubble, no fetch, and
  // a flame that behaves exactly as it did before she existed.
  const { consented: cindyConsented, bubbleEnabled } = useCindy();
  const [cindySheetOpen, setCindySheetOpen] = useState(false);
  const { line: cindyLine, dismiss: dismissCindyLine, notePr } = useCindyLockInLine({
    enabled: cindyConsented && bubbleEnabled && !posted && !stopping,
    sessionId: activeSession?.id ?? null,
    elapsedSeconds,
  });

  function handleCindyQuickAction(action: CindyQuickAction) {
    setCindySheetOpen(false);
    track('cindy_lockin_quick_action', { action });
    // All three land in the existing chat. "Add a note" is deliberately conversational (§C:
    // she takes the note in chat) — the in-session caption field the §13 redesign moved to the
    // done screen does not come back for this.
    const ask =
      action === 'status'
        ? 'how am I doing this session?'
        : action === 'note'
          ? 'add a note to my current lock-in'
          : null;
    router.push(ask ? `/cindy?ask=${encodeURIComponent(ask)}` : '/cindy');
  }

  // A personal record is the one milestone the clock cannot predict, so the logger tells her.
  // Wrapping logSet rather than reaching into useActiveWorkout keeps the server's `is_pr` verdict
  // the single source of truth — this only listens to it.
  async function handleLogSet(workoutExerciseId: string, weight: number | null, reps: number) {
    const set = await logSet(workoutExerciseId, weight, reps);
    if (set.is_pr) notePr();
    return set;
  }

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

  async function handleStop() {
    if (!activeSession || !session) return;
    setStopping(true);
    setError(null);
    try {
      // The WALLET balance, not profiles.embers (Ember pass §4). These were two different
      // numbers pretending to be one currency: the daily-fire trigger in 0065 pays into
      // ember_wallet, which is what the shop, boxes and Forge Pass all spend from, while
      // profiles.embers is a legacy counter nothing credits any more. The celebration was
      // counting up from the legacy figure — so a user with thousands of real embers watched
      // the fire bonus land on a balance of 40.
      //
      // Still snapshotted up front: refetch() after the stop replaces this with the POST-bonus
      // balance, and the counter animation needs the pre-bonus number to count FROM.
      const embersBeforeSnapshot = walletEmbers;
      const [ranksBefore, streakBefore] = await Promise.all([
        fetchMyRanks().catch(() => [] as MyRank[]),
        fetchMyStreak(session.user.id).catch(() => ({ current_streak: 0, longest_streak: 0 })),
      ]);
      const wasFirstEver = streakBefore.current_streak === 0 && streakBefore.longest_streak === 0;
      const goalType = activeSession.goalType;

      // No caption here: the §13 redesign took the field off this screen, and it now lives on the
      // done screen next to "Post to the campfire" (written via set_my_check_in_caption, migration
      // 0048) — you caption a session once you know how it went, at the moment you decide who
      // sees it. stopLockInSession's `caption` param stays optional for that reason.
      const checkIn = await stopLockInSession({
        sessionId: activeSession.id,
        userId: session.user.id,
        goalType,
        photoUris: photos.map((p) => p.uri),
      });

      // The session's closing beat (PUNCHLIST_12/13). Order matters: the ambient loop is torn down
      // FIRST so the sting lands in silence rather than fighting a bonfire crackle that's still
      // running. LoadoutSync would stop the loop anyway once activeSession clears, but that's a
      // render away — too late for a sting firing on this tick.
      stopEquippedAmbient();
      // This session's audio choice dies with this session (COSMETIC_UI_FIXES §6.2). Cleared HERE
      // rather than inside stopEquippedAmbient(), which also runs as LoadoutSync's effect cleanup
      // on the very render that starts the next session — clearing there would wipe the choice the
      // start sheet had just made, a frame before it was read.
      clearSessionAudioChoice();
      playEquippedSfx('sfx_stop');

      // The gym log was already persisted set-by-set; stop_lock_in_session bound it to this
      // check-in and rolled it up, so this reads back the finished summary (including whether
      // the "dialed" brag was actually earned — see §23's honest-brag rule).
      if (goalType === 'gym') {
        setWorkoutRecap(await fetchWorkoutRecap(checkIn.id).catch(() => null));
      }

      // A time-counted custom goal (design-mocks/74) is fed by exactly this: a finished lock-in
      // whose detail matches the goal's name. Idempotent per check-in server-side, and swallowed
      // on failure — a goal that misses a credit is a bad day, a stop that fails because of one
      // is a lost session.
      creditLockInTimeGoals(checkIn.id).catch(() => {});

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
      // The wallet moves server-side when the daily-fire trigger pays out, and nothing else on
      // this screen would notice — without this the balance stays stale until a cold reload, which
      // is the same "my purchase did nothing" class of bug punchlist 8 §3 fixed for the shop.
      await refetchInventory();
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

  // The proof-of-work card (mock 96, card 2) — the done screen's own share, distinct from the
  // daily-fire card above it: one is "I did a session", the other is "I kept the fire".
  async function handleShareLockIn() {
    setLockInSharing(true);
    try {
      await shareCardImage(lockInCardRef, 'Share your lock-in');
    } finally {
      setLockInSharing(false);
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
          handle={profile?.handle ?? null}
          // Same derivation the global watcher uses (RANKUP_SPEC §6) — a stop that crosses into
          // the Realm of Legend or the apex gets the cinematic here too, not just via the watcher.
          isBandCrossing={
            deriveRankUpLevel(
              { tier: rankUpInfo.fromTier, division: rankUpInfo.fromDivision },
              { tier: rankUpInfo.tier, division: rankUpInfo.division }
            ).isBandCrossing
          }
          onContinue={handleRankUpContinue}
          onShare={handleShareRankUp}
          sharing={sharing}
        />
        <View style={styles.offscreenCard} pointerEvents="none">
          <RankUpShareCard
            ref={rankCardRef}
            handle={profile?.handle ?? null}
            tier={rankUpInfo.tier}
            division={rankUpInfo.division}
            isDivisionBump={rankUpInfo.fromTier === rankUpInfo.tier}
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
            handle={profile?.handle ?? null}
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
          onShare={handleShareLockIn}
          sharing={lockInSharing}
        />
        <View style={styles.offscreenCard} pointerEvents="none">
          <LockInShareCard
            ref={lockInCardRef}
            goalType={postedCheckIn.goal_type}
            goalDetail={postedCheckIn.goal_detail}
            durationSeconds={postedCheckIn.duration_seconds ?? 0}
            circleName={doneCircleName}
            handle={profile?.handle ?? null}
            tier={rankAfter?.tier}
            division={rankAfter?.division}
            streakDays={streakAfter}
            xpEarned={postedCheckIn.xp_earned}
          />
        </View>
      </Screen>
    );
  }

  if (loading || activeLoading || !activeSession) {
    return (
      <Screen style={styles.container}>
        <Text style={styles.loading}>{error ?? 'Starting your session…'}</Text>
        {/* Belt-and-braces for punchlist #42: the wedge above is fixed at the source, but a
            genuinely stalled network call can still park someone here, and this screen is a
            modal with no header — i.e. no back button. Never leave the only way out as a
            force-quit. */}
        {startStalled && (
          <Pressable onPress={() => router.replace('/')} style={styles.bailOut} accessibilityRole="button">
            <Text style={styles.bailOutLabel}>Back to Philoi</Text>
          </Pressable>
        )}
      </Screen>
    );
  }

  // GYM (PHILOI_UI_SPEC.md §23, design-mocks/52) — the sole exception to the base screen. The
  // giant flame STAYS but drops to a dimmed background layer with a top scrim over it, and the
  // translucent workout log rides on top. The timer shrinks to a header pill beside an energy
  // chip, the body-doubles collapse to one line, and the CTA becomes "Finish workout."
  if (isGym) {
    return (
      <Screen backgroundColor={IMMERSIVE_BG} style={styles.gymContainer} padded={false}>
        <View style={styles.gymFlameLayer} pointerEvents="none">
          {/* The equipped PARTICLE cosmetic, finally painted (COSMETIC_UI_FIXES §5) — a field
              scoped to the flame's own box, not to the screen, so it can be worn alongside a flare
              without the two becoming one wash. Dimmed here for the same reason the flame is: the
              workout log has to stay readable over it. */}
          <View style={styles.flameField}>
            <EquippedFlameParticles dimmed />
            <SessionFlame height={240} dimmed />
          </View>
        </View>
        <GymScrim />

        <View style={styles.gymHeader}>
          <View style={styles.gymHeaderText}>
            <Text style={styles.activityLine} numberOfLines={1}>
              {GOAL_TYPE_META.gym.label}
              {workout?.routine_name ? ` · ${workout.routine_name}` : activeSession.goalDetail ? ` · ${activeSession.goalDetail}` : ''}
            </Text>
            {activeSession.circleName && <Text style={styles.campfireName}>{activeSession.circleName}</Text>}
          </View>
          {/* Gym's Cindy entry point. The giant flame behind the log is a pointer-transparent
              background layer here, so it cannot be the hit target the base screen uses — a
              full-screen tap zone under a scrolling logger would fight every swipe. This is the
              same small header flame she wears on every non-home screen (mock 117 "Global"),
              just routed to the session quick-sheet rather than straight to chat. */}
          {cindyConsented && (
            <CindyFlamePress
              size={22}
              onTap={() => setCindySheetOpen(true)}
              accessibilityLabel="Ask Cindy about this session">
              <EquippedFlameSvg width={18} height={22} />
            </CindyFlamePress>
          )}
          <View style={styles.gymHeaderRight}>
            <View style={styles.timerPill}>
              <Animated.Text style={[styles.timerPillValue, timerPulseStyle]}>{formatDurationClock(elapsedSeconds)}</Animated.Text>
            </View>
            {workout && (
              <View style={styles.energyChip}>
                <Text style={styles.energyChipText}>{ENERGY_CHIP_LABEL[workout.energy]}</Text>
              </View>
            )}
          </View>
        </View>

        <ScrollView
          style={styles.gymLog}
          contentContainerStyle={styles.gymLogContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          {/* Same Option A placement as the base screen, read against gym's own chrome: under the
              header, above the log — never over the sets being typed. */}
          {cindyLine && (
            <View style={styles.gymCindyLine}>
              <CindyBubble
                message={cindyLine}
                onPress={() => setCindySheetOpen(true)}
                onDismiss={dismissCindyLine}
              />
            </View>
          )}

          <BodyDoubleStripCollapsed lockIns={activeLockIns} />

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
              onLogSet={handleLogSet}
              onRemoveSet={removeSet}
              onAddExercise={addExercise}
              onReplaceExercise={replaceExercise}
              onRemoveExercise={removeExercise}
              onMoveExercise={moveExercise}
              onSetClipChanged={patchSetClip}
            />
          )}

          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>

        <View style={styles.gymFooter}>
          <View style={styles.actions}>
            <Pressable
              onPress={takePhoto}
              disabled={photos.length >= MAX_PHOTOS}
              style={[styles.cameraButton, photos.length >= MAX_PHOTOS && styles.cameraButtonDisabled]}
              accessibilityLabel="Take a photo"
              accessibilityRole="button">
              <Ionicons name="camera" size={20} color={Colors.ink} />
              {photos.length > 0 && (
                <View style={styles.cameraBadge}>
                  <Text style={styles.cameraBadgeText}>{photos.length}</Text>
                </View>
              )}
            </Pressable>
            {photos.length > 0 && (
              <Pressable
                onPress={() => setGalleryOpen(true)}
                style={styles.galleryArrow}
                accessibilityLabel="See this session's photos"
                accessibilityRole="button">
                <Ionicons name="chevron-up" size={14} color={Colors.muted} />
              </Pressable>
            )}
            {/* Solid coral, unlike the base screen's quiet Stop (mock 52) — finishing a logged
                workout is a deliberate commit, not the same "let the session end" gesture. */}
            <Pressable
              onPress={handleStop}
              disabled={stopping}
              style={styles.finishButton}
              accessibilityLabel="Finish workout"
              accessibilityRole="button">
              <Text style={styles.finishLabel}>{stopping ? 'Finishing…' : 'Finish workout'}</Text>
            </Pressable>
          </View>
        </View>

        {/* Slides up over the camera/Stop row with the screen dimmed behind, so the flame and the
            timer stay visible above it — you can see your session while you ask about it (§C). */}
        <CindyQuickSheet
          visible={cindySheetOpen}
          onClose={() => setCindySheetOpen(false)}
          onSelect={handleCindyQuickAction}
        />

        <SessionPhotoGallery
          visible={galleryOpen}
          photos={photos}
          onRemove={removePhoto}
          onClose={() => setGalleryOpen(false)}
        />

        {/* The equipped flare's perimeter aura (FLARES_SPEC.md, punchlist 15.2). LOCK-IN ONLY, and
            only for as long as the session runs — it used to be mounted at the root and painted
            every screen in the app, which read as a permanent full-screen wash rather than a
            cosmetic. Renders nothing when the slot is empty (most users — there is no free flare),
            and is pointer-transparent end to end. */}
        <EquippedFlarePerimeter />
      </Screen>
    );
  }

  // BASE — every non-gym goal type uses this exact screen (PHILOI_UI_SPEC.md §13 redesign,
  // design-mocks/51 + 53); only the header text swaps between Study / Run / Read / Job apps /
  // Custom. The fire and the timer own it: no goal-tool symbol in the flame, no filler copy, no
  // in-session caption field.
  return (
    <Screen backgroundColor={IMMERSIVE_BG} style={styles.container} padded={false}>
      <DriftingEmbers />

      {/* TOP — centered activity over the campfire name, with minimize parked top-right. */}
      <View style={styles.top}>
        <Text style={styles.activityLine} numberOfLines={1}>
          {GOAL_TYPE_META[activeSession.goalType].label}
          {activeSession.goalDetail ? ` · ${activeSession.goalDetail}` : ''}
        </Text>
        {activeSession.circleName && <Text style={styles.campfireName}>{activeSession.circleName}</Text>}
        {/* Minimize, NOT stop — the session lives in ActiveSessionContext, so it keeps running
            and home swaps its CTA to "Return to your lock-in". */}
        <Pressable
          onPress={() => router.replace('/')}
          hitSlop={12}
          style={styles.minimize}
          accessibilityLabel="Minimize lock-in"
          accessibilityRole="button">
          <Ionicons name="remove" size={22} color={Colors.textTertiary} />
        </Pressable>
      </View>

      {/* CENTER — the only flex:1 sibling in this column, so it claims 100% of whatever's left
          between TOP and BOTTOM and centers the flame/label/timer group inside that space.
          This is what pins BOTTOM to the bottom too — nothing below here needs its own
          flex/margin trick, it just renders right after however much space this consumes. */}
      <View style={styles.stage}>
        {/* CINDY'S PROACTIVE LINE — ABOVE the flame, under the header (mock 117 §C, Option A).
            Deliberately not over the flame or beside the timer: those two are the centrepiece the
            screen exists for, and Option A was chosen precisely so a line from her never lands on
            top of them. Milestones only, and it takes itself away. */}
        {cindyLine && (
          <CindyBubble
            message={cindyLine}
            onPress={() => setCindySheetOpen(true)}
            onDismiss={dismissCindyLine}
          />
        )}
        {/* Steps back ~50% when a flare is equipped (punchlist 17 P2c): the flare is the
            centrepiece, and a full-strength coloured flame competes with it for the same eye.
            No flare -> full strength. */}
        {/* Tapping her HERE opens the quick-sheet, not the full chat — mid-session, a whole
            conversation over the timer turns a glance into a detour (§C). No hold-to-talk on this
            screen for the same reason: voice mid-lock-in is the derailment the sheet avoids.
            Ring size tracks the glow rather than the flame box; at 240 a full-width ripple would
            run off both edges of the screen. */}
        <CindyFlamePress
          size={200}
          disabled={!cindyConsented}
          onTap={() => setCindySheetOpen(true)}
          accessibilityLabel="Ask Cindy about this session">
          <View style={styles.flameField}>
            {/* Particles sit BEHIND the flame in the same box, so they read as thrown off it
                rather than as a layer over the top of it. */}
            <EquippedFlameParticles />
            <SessionFlame height={240} dimmed={flareEquipped} />
          </View>
        </CindyFlamePress>
        <TutorialTooltip
          visible={tutorialStep === 1}
          text="This is your flame — it burns for as long as you stay locked in."
          onDismiss={() => setTutorialStep(2)}
        />
        <Text style={styles.lockedLabel}>Locked in</Text>
        <Animated.Text style={[styles.timer, timerPulseStyle]}>{formatDurationClock(elapsedSeconds)}</Animated.Text>
      </View>

      {/* BOTTOM — pinned, natural size. */}
      <View style={styles.footer}>
        {/* "75% to Gold III" with the pulsing gap + "~2h" (#87 surface 4, mock 91). It sits at the
            bottom on purpose: the flame and the timer are the hero, and the ladder is context you
            glance at, not the thing you're staring at for an hour. Renders nothing until the rank
            resolves, so a slow network can't push the actions around mid-session. */}
        {/* No rank bar here. The projection lives on Home and on the Lock-Screen Live Activity;
            the in-app lock-in screen is flame + timer only (mock 91 / FLARES_SPEC). I added this in
            868b1f6 against the older spec — punchlist 17 P2(a) removes it. */}

        {stillHereDue && (
          <Animated.View entering={FadeInDown.springify().damping(14)} exiting={FadeOutUp.duration(200)} style={styles.bannerInset}>
            <Pressable onPress={handleConfirmStillHere} style={styles.stillHereBanner}>
              <Text style={styles.stillHereText}>Long session — still here? Tap to confirm.</Text>
            </Pressable>
          </Animated.View>
        )}

        <BodyDoubleStrip lockIns={activeLockIns} />

        {error && <Text style={styles.error}>{error}</Text>}

        <TutorialTooltip visible={tutorialStep === 2} text="Tap Stop when you're done to lock it in for real." />

        <View style={styles.actions}>
          <Pressable
            onPress={takePhoto}
            disabled={photos.length >= MAX_PHOTOS}
            style={[styles.cameraButton, photos.length >= MAX_PHOTOS && styles.cameraButtonDisabled]}
            accessibilityLabel="Take a photo"
            accessibilityRole="button">
            <Ionicons name="camera" size={18} color={Colors.ink} />
            {photos.length > 0 && (
              <View style={styles.cameraBadge}>
                <Text style={styles.cameraBadgeText}>{photos.length}</Text>
              </View>
            )}
          </Pressable>
          {/* Only once there's something to show — an empty gallery arrow is a dead control. */}
          {photos.length > 0 && (
            <Pressable
              onPress={() => setGalleryOpen(true)}
              style={styles.galleryArrow}
              accessibilityLabel="See this session's photos"
              accessibilityRole="button">
              <Ionicons name="chevron-up" size={14} color={Colors.muted} />
            </Pressable>
          )}
          {/* Quiet, not alarm-red (§13) — closing a good session should feel satisfying. */}
          <Pressable
            onPress={handleStop}
            disabled={stopping}
            style={styles.stopButton}
            accessibilityLabel="Stop lock-in"
            accessibilityRole="button">
            <Text style={styles.stopLabel}>{stopping ? 'Stopping…' : 'Stop'}</Text>
          </Pressable>
        </View>
      </View>

      {/* Slides up over the camera/Stop row with the screen dimmed behind, so the flame and the
          timer stay visible above it — you can see your session while you ask about it (§C). */}
      <CindyQuickSheet
        visible={cindySheetOpen}
        onClose={() => setCindySheetOpen(false)}
        onSelect={handleCindyQuickAction}
      />

      <SessionPhotoGallery
        visible={galleryOpen}
        photos={photos}
        onRemove={removePhoto}
        onClose={() => setGalleryOpen(false)}
      />

      {/* The equipped flare's perimeter aura (FLARES_SPEC.md, punchlist 15.2). LOCK-IN ONLY, and
          only for as long as the session runs — it used to be mounted at the root and painted
          every screen in the app, which read as a permanent full-screen wash rather than a
          cosmetic. Renders nothing when the slot is empty (most users — there is no free flare),
          and is pointer-transparent end to end. */}
      <EquippedFlarePerimeter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Wraps the flame so the particle field has a box to fill: it is absolutely positioned and works
  // outward from its parent, and this parent is sized to the flame and nothing else.
  flameField: {
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  bailOut: {
    marginTop: Spacing.three,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    borderRadius: 13,
    paddingVertical: Spacing.twelve,
    paddingHorizontal: Spacing.four,
  },
  bailOutLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.coldButtonText,
  },
  // Flame + timer + "LOCKED IN" claim the leftover vertical space between the header chip and
  // whatever's below (still-here banner / body-doubles / photos / actions) and center within
  // it — the focal moment of the screen, not packed up against the header.
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Mock 51's `.center{gap:2px}` — the flame, label and timer read as ONE stacked object, so
    // this is deliberately tight; the label's own negative margin tucks it under the flame's base.
    gap: 2,
  },
  // Centered header (mock 51): activity line on top, campfire name under it, minimize parked
  // absolutely top-right so it doesn't push the centered text off-axis.
  top: {
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.five,
  },
  activityLine: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
  },
  minimize: {
    position: 'absolute',
    top: 0,
    right: Spacing.three,
  },
  // BOTTOM zone — a plain (non-flex) block; it renders at its natural size right after
  // whatever space CENTER's flex:1 didn't consume, which is what pins it to the bottom.
  // Full-bleed inside the footer's own padding, sitting above the still-here banner and actions.
  footer: {
    alignSelf: 'stretch',
    gap: Spacing.twelve,
    paddingBottom: Spacing.two,
  },
  campfireName: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
    marginTop: 3,
  },
  timer: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 64,
    letterSpacing: 1,
    color: Colors.ink,
    // Mock's `text-shadow:0 0 28px rgba(242,163,60,.45)` — the timer catches the firelight.
    textShadowColor: 'rgba(242,163,60,0.45)',
    textShadowRadius: 28,
  },
  // Sits between the flame and the timer (mock 51), tucked up under the flame's base.
  lockedLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: Colors.amber,
    marginTop: -6,
  },
  stillHereBanner: {
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'stretch',
  },
  // Base screen only. It runs `padded={false}` so the flame and embers can bleed to the edges,
  // which means each inset block supplies its own — whereas gym's copy of this banner already
  // sits inside the padded log ScrollView and would double up if the inset lived on the banner.
  bannerInset: {
    paddingHorizontal: Spacing.three,
  },
  stillHereText: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.achieverText,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    width: '100%',
    paddingHorizontal: Spacing.three,
  },
  // Smaller than the old 52px (mock 51's `.cam` is 42) — the controls deliberately recede so the
  // fire and timer stay the loudest thing on screen.
  cameraButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraButtonDisabled: {
    opacity: 0.5,
  },
  // Deliberately smaller and quieter than the camera it sits beside — a peek at what you've
  // already shot, not a second primary control competing with it.
  galleryArrow: {
    width: 26,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
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
  // "Style it quiet (not alarm-red)" (§13) — a translucent slab, no icon, no color shout.
  stopButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    borderRadius: 13,
    paddingVertical: Spacing.twelve,
  },
  stopLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.coldButtonText,
  },
  finishButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.coral,
    borderRadius: 13,
    paddingVertical: Spacing.twelve,
  },
  finishLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
  },
  // ─────────────── gym session (§23, design-mocks/52) ───────────────
  // Its own three-band layout — header / scrolling log / footer — rather than the flame
  // screen's TOP/CENTER/BOTTOM, because the middle band here is a scroll view that has to
  // claim every pixel the other two don't. The flame and scrim sit behind all three.
  gymContainer: {
    flex: 1,
  },
  // The giant flame, kept but demoted: pinned low and centered so it glows up through the log
  // (mock 52's `.bgflame` at bottom:2%). zIndex-free — it's first in the tree, so everything
  // after it paints on top.
  gymFlameLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '2%',
    alignItems: 'center',
  },
  gymHeader: {
    flexDirection: 'row',
    // Vertically center the activity title against the timer pill on the right (was 'flex-start',
    // which top-aligned the title above the "minutes" pill instead of level with it).
    alignItems: 'center',
    gap: 8,
    paddingTop: Spacing.twelve,
    paddingBottom: 10,
    paddingHorizontal: Spacing.three,
  },
  gymHeaderText: {
    flex: 1,
    alignItems: 'flex-start',
    minWidth: 0,
  },
  gymHeaderRight: {
    alignItems: 'flex-end',
    gap: 5,
  },
  timerPill: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  timerPillValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  energyChip: {
    backgroundColor: 'rgba(242,163,60,0.16)',
    borderRadius: Radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  energyChipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    textTransform: 'uppercase',
    color: Colors.ember,
  },
  gymCindyLine: {
    // The bubble sizes itself to its own 280px max and centres its tail; the log column it sits
    // in is full-bleed, so the alignment has to come from here.
    alignItems: 'center',
    alignSelf: 'center',
  },
  gymLog: {
    flex: 1,
  },
  gymLogContent: {
    gap: Spacing.twelve,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  gymFooter: {
    paddingTop: 9,
    paddingBottom: Spacing.twelve,
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
