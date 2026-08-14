import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChallengeSentSheet } from '@/components/challenge-sent-sheet';
import { FitnessSyncPrompt } from '@/components/fitness-sync-prompt';
import { PrimaryButton } from '@/components/ui/primary-button';
import { TextInput } from '@/components/ui/text-input';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useFriends } from '@/hooks/use-friends';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { useMyGroups } from '@/hooks/use-my-groups';
import { useAuth } from '@/lib/auth/auth-context';
import { createChallenge } from '@/lib/api/challenges';
import { syncChallengeFromDevice } from '@/lib/api/fitness-challenge-sync';
import { getErrorMessage } from '@/lib/errors';
import {
  AUTO_SOURCE_NAME,
  canAutoTrackChallengeType,
  getRealFitnessSourceForChallengeType,
  metricSourceLabel,
  metricSourceShort,
} from '@/lib/fitness-sync';
import { createGroupChallenge, createH2HChallenge } from '@/lib/api/social-challenges';
import type { ChallengePeriod, ChallengeType, SocialChallengeMode, SocialChallengeRaceMetric } from '@/types/database';

// Solo (announced) mode was removed — a solo goal the campfire can see is already covered by
// the lock-in flow's own "with the campfire" toggle, so a separate solo-challenge concept was
// redundant. Only h2h and group remain.
const MODE_OPTIONS: { value: SocialChallengeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'h2h', label: 'Head-to-head', icon: 'flash' },
  { value: 'group', label: 'Group', icon: 'people' },
];

const WINDOW_OPTIONS = [
  { label: '24h', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
];

const PAYOUT_XP: Record<SocialChallengeMode, number> = { h2h: 200, group: 300 };

// Two genuinely different challenge kinds live behind this one route: a social challenge
// (invite/accept, multi-party, scores itself off real check_ins — design-mocks/13) and the
// older personal habit tracker (a private quantified target you log progress against
// yourself, optionally shared to a Campfire for visibility). Neither mock covers the personal
// tracker, but it's real working functionality — folding it in behind a top toggle instead of
// deleting it.
export default function CreateChallengeScreen() {
  const [kind, setKind] = useState<'social' | 'personal'>('social');

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.kindRow}>
        <Pressable onPress={() => setKind('social')} style={[styles.kindTab, kind === 'social' && styles.kindTabActive]}>
          <Text style={[styles.kindTabLabel, kind === 'social' && styles.kindTabLabelActive]}>Challenge a friend</Text>
        </Pressable>
        <Pressable onPress={() => setKind('personal')} style={[styles.kindTab, kind === 'personal' && styles.kindTabActive]}>
          <Text style={[styles.kindTabLabel, kind === 'personal' && styles.kindTabLabelActive]}>Personal goal</Text>
        </Pressable>
      </View>
      {kind === 'social' ? <SocialChallengeForm /> : <PersonalChallengeForm />}
    </KeyboardAvoidingView>
  );
}

function SocialChallengeForm() {
  const router = useRouter();
  const { groups } = useMyGroups();
  const { friends } = useFriends();
  // Deep-link prefill from the friend-ping sheet (design-mocks/21): a pre-picked opponent, and
  // optionally a shared campfire — h2h treats it as a "let this campfire watch" default, group
  // treats it as the (mandatory) campfire itself. Captured once; `mode` can change afterward if
  // the user taps a different challenge type tile, so this doesn't move with it.
  const params = useLocalSearchParams<{ mode?: string; opponentId?: string; opponentName?: string; circleId?: string }>();
  const prefillOpponentId = params.opponentId ?? null;
  const prefillOpponentName = params.opponentName ?? null;
  const prefillCircleId = params.circleId ?? null;
  const prefillMode: SocialChallengeMode = params.mode === 'group' ? 'group' : 'h2h';
  const opponentPrefilled = Boolean(prefillOpponentId);

  // Group's own mandatory campfire.
  const [circleIndex, setCircleIndex] = useState(0);
  const circle = groups[circleIndex];
  const { rows: members } = useLeaderboard(circle?.id ?? '');

  // H2H's OPTIONAL "let a campfire watch" — a friend-to-friend challenge never requires one
  // (§16), so this is tracked completely separately from Group's mandatory circle above.
  const [watchOn, setWatchOn] = useState(false);
  const [watchCircleIndex, setWatchCircleIndex] = useState(0);
  const watchCircle = groups[watchCircleIndex];
  const canWatch = groups.length > 0;
  const watching = canWatch && watchOn;

  const [mode, setMode] = useState<SocialChallengeMode>(prefillMode);
  const [opponentId, setOpponentId] = useState<string | null>(prefillOpponentId);
  const [raceMetric, setRaceMetric] = useState<SocialChallengeRaceMetric>('xp');
  const [targetCount, setTargetCount] = useState(5);
  const [windowHours, setWindowHours] = useState(72);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // design-mocks/55a — kept open until the user taps Done, rather than an Alert dismissed and
  // immediately followed by router.back() (punchlist 3: needs a clear "sent" confirmation).
  const [justSentTo, setJustSentTo] = useState<string | null>(null);

  // Route the deep-link's shared campfire to the right place once groups load: Group's
  // mandatory picker, or H2H's optional watch-toggle (pre-enabled, since a shared campfire from
  // a friend-ping is a reasonable default for "let them watch" — the user can still turn it off).
  useEffect(() => {
    if (!prefillCircleId) return;
    const i = groups.findIndex((g) => g.id === prefillCircleId);
    if (i < 0) return;
    if (prefillMode === 'group') {
      setCircleIndex(i);
    } else {
      setWatchCircleIndex(i);
      setWatchOn(true);
    }
  }, [prefillCircleId, groups, prefillMode]);

  const effectiveOpponentId = opponentId;
  const opponentName = friends.find((f) => f.friend_id === effectiveOpponentId)?.display_name ?? prefillOpponentName ?? undefined;
  const payoutXp = PAYOUT_XP[mode];

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      if (mode === 'h2h') {
        if (!effectiveOpponentId) {
          setError('Pick a friend to challenge.');
          return;
        }
        await createH2HChallenge({
          opponentId: effectiveOpponentId,
          raceMetric,
          windowHours,
          circleId: watching ? (watchCircle?.id ?? null) : null,
        });
        // A visible confirmation, not a silent navigate-back (punchlist 2, §2: "no 'request
        // sent' state") — the opponent sees it as a real Accept/Decline invite on their own
        // Challenges tab as soon as they open it. Held open until they tap Done (mock 55a);
        // router.back() only fires once they dismiss it, not immediately.
        setJustSentTo(opponentName ?? 'They');
        return;
      } else {
        if (!circle) {
          setError('Start or join a Campfire first.');
          return;
        }
        await createGroupChallenge({ circleId: circle.id, targetCount, windowHours });
      }
      router.back();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not create your challenge.'));
    } finally {
      setSaving(false);
    }
  }

  // H2H can't send without an opponent — show a clear instruction + disable, never a dangling
  // "Challenge …" (design-mocks/13's send relabels to the exact action once someone's picked).
  const noOpponent = mode === 'h2h' && !effectiveOpponentId;
  const sendLabel = mode === 'h2h' ? (noOpponent ? 'Pick someone to challenge' : `Challenge ${opponentName ?? 'them'}`) : 'Start group challenge';
  return (
    <ScrollView style={styles.scrollFlex} contentContainerStyle={styles.container}>
      <Text style={styles.label}>Challenge type</Text>
      <View style={styles.typesRow}>
        {MODE_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => setMode(option.value)}
            style={[styles.typeTile, mode === option.value && styles.typeTileSelected]}>
            <Ionicons name={option.icon} size={16} color={mode === option.value ? Colors.achieverText : Colors.muted} />
            <Text style={[styles.typeLabel, mode === option.value && styles.chipTextSelected2]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'h2h' && (
        <>
          {/* Opponent-first, friend-to-friend — not campfire-bound (§16). */}
          {opponentPrefilled ? (
            <View style={styles.vsContext}>
              <Ionicons name="flash" size={14} color={Colors.achieverText} />
              <Text style={styles.vsContextText}>Challenging {prefillOpponentName ?? 'them'}</Text>
            </View>
          ) : (
            <>
              <Text style={styles.label}>Challenge who?</Text>
              {friends.length === 0 ? (
                <Text style={styles.hint}>Add a friend first to challenge them.</Text>
              ) : (
                <View style={styles.peopleRow}>
                  {friends.map((f) => (
                    <Pressable key={f.friend_id} onPress={() => setOpponentId(f.friend_id)} style={styles.personTile}>
                      <View style={[styles.personAvatar, f.friend_id === effectiveOpponentId && styles.personAvatarSelected]}>
                        <Text style={styles.personInitial}>{f.display_name.charAt(0).toUpperCase()}</Text>
                      </View>
                      <Text style={styles.personName} numberOfLines={1}>
                        {f.display_name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}

          <Text style={styles.label}>The race</Text>
          <View style={styles.pillsRow}>
            <Pressable
              onPress={() => setRaceMetric('xp')}
              style={[styles.pill, raceMetric === 'xp' && styles.chipSelected]}>
              <Text style={[styles.pillText, raceMetric === 'xp' && styles.chipTextSelected]}>Most XP</Text>
            </Pressable>
            <Pressable
              onPress={() => setRaceMetric('lockin_time')}
              style={[styles.pill, raceMetric === 'lockin_time' && styles.chipSelected]}>
              <Text style={[styles.pillText, raceMetric === 'lockin_time' && styles.chipTextSelected]}>Most lock-in time</Text>
            </Pressable>
          </View>

          <View style={styles.shareRow}>
            <View style={styles.shareText}>
              <Text style={styles.label}>Let a campfire watch</Text>
              <Text style={styles.hint}>
                {canWatch
                  ? "Optional — a Campfire can cheer you both on, but no one has to watch."
                  : 'Join a Campfire to have one watch (optional).'}
              </Text>
            </View>
            <Toggle value={watching} onValueChange={setWatchOn} disabled={!canWatch} />
          </View>
          {watching && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.circleRow}>
              {groups.map((g, i) => (
                <Pressable
                  key={g.id}
                  onPress={() => setWatchCircleIndex(i)}
                  style={[styles.circleChip, i === watchCircleIndex && styles.chipSelected]}>
                  <Text style={styles.circleEmoji}>{g.emoji}</Text>
                  <Text style={[styles.chipText, i === watchCircleIndex && styles.chipTextSelected]}>{g.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </>
      )}

      {mode === 'group' && (
        <>
          <Text style={styles.label}>Which campfire?</Text>
          {groups.length === 0 ? (
            <Text style={styles.hint}>Join or start a Campfire first to challenge it.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.circleRow}>
              {groups.map((g, i) => (
                <Pressable
                  key={g.id}
                  onPress={() => setCircleIndex(i)}
                  style={[styles.circleChip, i === circleIndex && styles.chipSelected]}>
                  <Text style={styles.circleEmoji}>{g.emoji}</Text>
                  <Text style={[styles.chipText, i === circleIndex && styles.chipTextSelected]}>{g.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <Text style={styles.label}>The goal</Text>
          <View style={styles.stepperRow}>
            <Text style={styles.stepperLabel}>Everyone locks in</Text>
            <View style={styles.stepper}>
              <Pressable onPress={() => setTargetCount((n) => Math.max(1, n - 1))} hitSlop={8}>
                <Ionicons name="remove" size={16} color={Colors.amber} />
              </Pressable>
              <Text style={styles.stepperValue}>{targetCount}×</Text>
              <Pressable onPress={() => setTargetCount((n) => n + 1)} hitSlop={8}>
                <Ionicons name="add" size={16} color={Colors.amber} />
              </Pressable>
            </View>
          </View>
          {circle && (
            <View style={styles.whosInChip}>
              <Ionicons name="people" size={13} color={Colors.muted} />
              <Text style={styles.whosInText}>
                All of {circle.name} · {members.length} members
              </Text>
            </View>
          )}
        </>
      )}

      <Text style={styles.label}>How long</Text>
      <View style={styles.pillsRow}>
        {WINDOW_OPTIONS.map((option) => (
          <Pressable
            key={option.hours}
            onPress={() => setWindowHours(option.hours)}
            style={[styles.pill, windowHours === option.hours && styles.chipSelected]}>
            <Text style={[styles.pillText, windowHours === option.hours && styles.chipTextSelected]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.payoutCard}>
        <Ionicons name="trophy" size={18} color={Colors.achieverText} />
        <View style={styles.payoutText}>
          <Text style={styles.payoutTitle}>
            {mode === 'h2h' ? `Winner takes +${payoutXp} XP` : `Up to +${payoutXp} XP each (more for top finishers) — only if everyone finishes`}
          </Text>
          {mode === 'h2h' && <Text style={styles.payoutSubtitle}>scales with effort · capped to keep it fair</Text>}
        </View>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      <PrimaryButton label={sendLabel} onPress={handleCreate} loading={saving} disabled={noOpponent} />

      <ChallengeSentSheet
        visible={justSentTo !== null}
        onClose={() => router.back()}
        opponentName={justSentTo ?? 'them'}
        raceMetric={raceMetric}
        windowHours={windowHours}
        payoutXp={payoutXp}
      />
    </ScrollView>
  );
}

// `defaultTarget` is the sensible weekly number for each metric — a per-option value rather than
// a nested ternary in handlePickType, which stopped scaling once there were nine of these.
// The five metrics mock 73A names, in its order. `defaultTarget` is the sensible weekly number
// for each — a per-option value rather than a nested ternary in handlePickType, which stopped
// scaling once there were nine of these.
const PERSONAL_TYPE_OPTIONS: { value: ChallengeType; label: string; unit: string; defaultTarget: string }[] = [
  { value: 'steps', label: '👟 Steps', unit: 'steps', defaultTarget: '10000' },
  { value: 'study_hours', label: '📚 Study time', unit: 'hours', defaultTarget: '10' },
  { value: 'gym_visits', label: '🏋️ Gym visits', unit: 'visits', defaultTarget: '4' },
  { value: 'run_distance', label: '🏃 Run', unit: 'km', defaultTarget: '20' },
];

// Kept off the primary row so it reads as mock 73A's clean five, but NOT deleted: each of these
// is wired to a real verifiable source (Strava for rides, Whoop for the rest, §17), and dropping
// them from setup would quietly make those integrations unreachable.
const MORE_TYPE_OPTIONS: typeof PERSONAL_TYPE_OPTIONS = [
  { value: 'ride_distance', label: '🚴 Riding', unit: 'km', defaultTarget: '20' },
  // Whoop has no step count, so its three metrics live here and never on the steps option above.
  { value: 'workout_minutes', label: '💪 Workout minutes', unit: 'minutes', defaultTarget: '150' },
  { value: 'strain', label: '🔥 Strain', unit: 'strain', defaultTarget: '70' },
  { value: 'sleep_hours', label: '😴 Sleep', unit: 'hours', defaultTarget: '49' },
];

// A pill that names its own data source. Previously every metric looked equally automatic, so
// study/gym/sleep read as auto-tracked while silently sitting at zero — the tag is what makes
// "this needs WHOOP" and "this comes from your own lock-ins" visible before you commit to a goal.
function MetricChip({
  option,
  selected,
  onPress,
}: {
  option: (typeof PERSONAL_TYPE_OPTIONS)[number];
  selected: boolean;
  onPress: () => void;
}) {
  const source = metricSourceShort(option.value);
  return (
    <Pressable onPress={onPress} style={[styles.personalChip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
      {source ? (
        <Text style={[styles.chipSource, selected && styles.chipSourceSelected]} numberOfLines={1}>
          {source}
        </Text>
      ) : null}
    </Pressable>
  );
}

const CUSTOM_TYPE_OPTION: (typeof PERSONAL_TYPE_OPTIONS)[number] = {
  value: 'custom',
  label: '＋ Custom',
  unit: '',
  defaultTarget: '',
};

// "How often" (mock 73A) — the cadence itself, not a one-off window. The old labels ("This week"
// / "Today") described a single period; these describe the repeat, which is what a goal that
// resets every Monday actually is.
const PERSONAL_PERIOD_OPTIONS: { value: ChallengePeriod; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
];

/** What a custom goal counts (mock 74). Built-in metrics all have their own source, so this
 * only ever applies to `custom`. */
type CustomCountMode = 'lockin_time' | 'manual';

// The original self-tracked habit tracker — a private quantified target (steps, gym visits,
// study hours, or a custom metric), logged manually, optionally shared to a Campfire for
// visibility. Predates the social-challenge system above and still works the same way.
function PersonalChallengeForm() {
  const router = useRouter();
  const { session } = useAuth();
  const [type, setType] = useState<ChallengeType>('steps');
  const [target, setTarget] = useState('10000');
  const [unit, setUnit] = useState('steps');
  const [customLabel, setCustomLabel] = useState('');
  const [customCountMode, setCustomCountMode] = useState<CustomCountMode>('lockin_time');
  const [period, setPeriod] = useState<ChallengePeriod>('week');
  const [moreOpen, setMoreOpen] = useState(false);
  // "Track it" (mock 73A) — only ever offered when a real device metric exists for the chosen
  // metric; see canAutoTrack below.
  const [trackAuto, setTrackAuto] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Track this automatically?" (design-mocks/14, PHILOI_UI_SPEC.md §17) — only for a type that
  // has a real source behind it; everything else has no automatic source to offer. Shown once at
  // submit time, not on every type tap.
  const [showSyncPrompt, setShowSyncPrompt] = useState(false);
  // Set only by THIS sheet's own onSourceConnected callback — each connection hook is a separate
  // instance per component, so this can't be re-derived by re-reading connection state from here;
  // it has to be told.
  const [justConnectedDeviceFitness, setJustConnectedDeviceFitness] = useState(false);

  const isCustom = type === 'custom';
  // Show "Automatically" ONLY when something can actually measure this metric (§7). Custom never
  // can — it has no device metric — so it gets the lock-in-time / count-I-log choice from mock 74
  // instead of a Connect row that goes nowhere.
  const canAutoTrack = canAutoTrackChallengeType(type);
  const autoOn = canAutoTrack && trackAuto;

  function handlePickType(option: (typeof PERSONAL_TYPE_OPTIONS)[number]) {
    setType(option.value);
    if (option.value !== 'custom') {
      setUnit(option.unit);
      setTarget(option.defaultTarget);
    } else {
      // Time-counted is the default custom shape (mock 74 lists it first) — so the unit follows
      // it rather than starting blank and looking broken.
      setUnit('hours');
      setTarget('');
      setCustomCountMode('lockin_time');
    }
  }

  function handlePickCountMode(mode: CustomCountMode) {
    setCustomCountMode(mode);
    // Time is always measured in hours here; a count is in whatever the user calls it, so the
    // unit becomes theirs to fill in rather than a stale "hours" left over from the other mode.
    setUnit(mode === 'lockin_time' ? 'hours' : '');
  }

  function handleCreate() {
    if (!session) return;
    const targetNum = Number(target);
    if (!targetNum || targetNum <= 0) {
      setError('Enter a target greater than 0.');
      return;
    }
    if (!unit.trim()) {
      setError('Give it a unit — e.g. "reps", "pages".');
      return;
    }
    if (isCustom && !customLabel.trim()) {
      setError('Give your goal a name.');
      return;
    }
    setError(null);
    // The sync sheet is offered only when the user actually asked to auto-track AND something
    // can measure this metric — picking "Log it myself" shouldn't then be interrupted by a
    // Connect prompt (design-mocks/14).
    if (autoOn) {
      setShowSyncPrompt(true);
      return;
    }
    doCreate();
  }

  async function doCreate() {
    if (!session) return;
    const targetNum = Number(target);
    setSaving(true);
    setError(null);
    try {
      const created = await createChallenge({
        userId: session.user.id,
        type,
        label: isCustom ? customLabel.trim() || null : null,
        target: targetNum,
        unit: unit.trim(),
        period,
        // A time-counted custom goal is fed by lock-ins whose detail matches its name
        // (credit_lockin_time_goals, migration 0061) — which is also what makes that name behave
        // like a lock-in goal type of its own.
        countMode: isCustom ? customCountMode : 'manual',
      });
      // First sync right away if they just connected on this exact screen — no reason to make
      // them wait for the next Challenges-tab focus to see it start counting.
      if (justConnectedDeviceFitness) {
        syncChallengeFromDevice(created).catch(() => {});
      }
      router.back();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not create your challenge.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.scrollFlex} contentContainerStyle={styles.container}>
      {/* No campfire step anywhere in here (migration 0059): a goal is yours, and who sees the
          work behind it is picked per lock-in on the done screen, which can post to several
          campfires at once rather than the one this screen used to bind forever. */}
      <Text style={styles.label}>What are you tracking?</Text>
      {/* Horizontally scrollable (punchlist 5.4): this row is a plain non-wrapping flex row, so
          every metric past the screen edge was rendered but unreachable — you couldn't pick Run or
          anything after it. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsScroll}>
        {PERSONAL_TYPE_OPTIONS.map((option) => (
          <MetricChip key={option.value} option={option} selected={type === option.value} onPress={() => handlePickType(option)} />
        ))}
        <Pressable
          onPress={() => handlePickType(CUSTOM_TYPE_OPTION)}
          style={[styles.personalChip, isCustom && styles.chipSelected]}>
          <Text style={[styles.chipText, isCustom && styles.chipTextSelected]}>{CUSTOM_TYPE_OPTION.label}</Text>
        </Pressable>
      </ScrollView>

      {/* The device-verified metrics that aren't in mock 73A's headline five, kept reachable. */}
      {!moreOpen && !MORE_TYPE_OPTIONS.some((o) => o.value === type) ? (
        <Pressable onPress={() => setMoreOpen(true)} hitSlop={6}>
          <Text style={styles.moreLink}>More metrics — riding, Whoop…</Text>
        </Pressable>
      ) : (
        // Same treatment as the headline row above — this one grows as more device metrics land.
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsScroll}>
          {MORE_TYPE_OPTIONS.map((option) => (
            <MetricChip key={option.value} option={option} selected={type === option.value} onPress={() => handlePickType(option)} />
          ))}
        </ScrollView>
      )}

      {/* The full source sentence for whatever's selected. The pills carry a one-word tag; this
          spells out what actually feeds the number — including the gym metric's photo/sets
          requirement, which is the difference between a visit counting and not. */}
      {metricSourceLabel(type) ? <Text style={styles.sourceLine}>{metricSourceLabel(type)}</Text> : null}

      {/* ── Custom (design-mocks/74) ─────────────────────────────────────────── */}
      {isCustom && (
        <>
          <Text style={styles.label}>Name it</Text>
          <TextInput placeholder="e.g. Read, Cold plunges" value={customLabel} onChangeText={setCustomLabel} maxLength={40} />

          <Text style={styles.label}>What counts toward it</Text>
          <CountModeOption
            selected={customCountMode === 'lockin_time'}
            onPress={() => handlePickCountMode('lockin_time')}
            emoji="🔥"
            title="Time locked in"
            body={`Lock in on "${customLabel.trim() || 'this'}" and the minutes add up — same as a Study or Gym session.`}
          />
          <CountModeOption
            selected={customCountMode === 'manual'}
            onPress={() => handlePickCountMode('manual')}
            emoji="#️⃣"
            title="A count I log"
            body="Track a number by hand — pages, reps, sessions, glasses…"
          />
        </>
      )}

      <Text style={styles.label}>Target</Text>
      <View style={styles.targetRow}>
        <TextInput
          style={styles.targetInput}
          placeholder="e.g. 10000"
          keyboardType="numeric"
          value={target}
          onChangeText={setTarget}
        />
        <TextInput
          style={styles.unitInput}
          placeholder="unit"
          value={unit}
          onChangeText={setUnit}
          // A built-in metric's unit is fixed by the metric; a hand-counted custom goal's unit is
          // the user's own word for it. Time is always hours, so that stays fixed too.
          editable={isCustom && customCountMode === 'manual'}
        />
      </View>

      <Text style={styles.label}>How often</Text>
      <View style={styles.pillsRow}>
        {PERSONAL_PERIOD_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => setPeriod(option.value)}
            style={[styles.personalChip, period === option.value && styles.chipSelected]}>
            <Text style={[styles.chipText, period === option.value && styles.chipTextSelected]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── Track it (mock 73A) ───────────────────────────────────────────────
          "Automatically" appears ONLY when a real source can measure this metric. Everything
          else gets the honest line instead of a Connect row that would never connect. */}
      <Text style={styles.label}>Track it</Text>
      {canAutoTrack ? (
        <>
          <TrackOption
            selected={autoOn}
            onPress={() => setTrackAuto(true)}
            emoji="⚡"
            title="Automatically"
            body={`${AUTO_SOURCE_NAME[getRealFitnessSourceForChallengeType(type)!]} · counts on its own`}
          />
          <TrackOption
            selected={!autoOn}
            onPress={() => setTrackAuto(false)}
            emoji="✏️"
            title="Log it myself"
            body="Enter progress by hand"
          />
        </>
      ) : (
        <View style={styles.noAutoNote}>
          <Text style={styles.noAutoText}>
            {isCustom && customCountMode === 'lockin_time'
              ? `🔒 Custom goals can't read a device — time comes from your lock-ins on "${customLabel.trim() || 'this'}".`
              : isCustom
                ? "🔒 Custom goals can't read a device — this one's a count you log yourself."
                : '✏️ No device measures this one — you log it by hand.'}
          </Text>
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      <PrimaryButton label="Set goal" onPress={handleCreate} loading={saving} />

      <FitnessSyncPrompt
        visible={showSyncPrompt}
        onClose={() => {
          setShowSyncPrompt(false);
          doCreate();
        }}
        onSourceConnected={() => setJustConnectedDeviceFitness(true)}
        challengeType={type}
        challengeTitle={`${target || '0'} ${unit} ${period === 'day' ? 'today' : 'this week'}`}
        challengeSubtitle="Just for you"
      />
    </ScrollView>
  );
}

// The radio rows shared by mock 74's "What counts toward it" and mock 73A's "Track it" — same
// shape (emoji tile, title, one explanatory line, selected border), so they're one component
// rather than two that drift.
function CountModeOption(props: { selected: boolean; onPress: () => void; emoji: string; title: string; body: string }) {
  return <TrackOption {...props} />;
}

function TrackOption({
  selected,
  onPress,
  emoji,
  title,
  body,
}: {
  selected: boolean;
  onPress: () => void;
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.trackOption, selected && styles.trackOptionSelected]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}>
      <Text style={styles.trackEmoji}>{emoji}</Text>
      <View style={styles.trackText}>
        <Text style={[styles.trackTitle, selected && styles.trackTitleSelected]}>{title}</Text>
        <Text style={styles.trackBody}>{body}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.cream,
  },
  moreLink: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.amber,
  },
  trackOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: 'transparent',
    padding: Spacing.three,
  },
  trackOptionSelected: {
    borderColor: Colors.coral,
    backgroundColor: Colors.selectedBg,
  },
  trackEmoji: {
    fontSize: 16,
  },
  trackText: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  trackTitleSelected: {
    color: Colors.achieverText,
  },
  trackBody: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.muted,
    marginTop: 2,
  },
  noAutoNote: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  noAutoText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.muted,
  },
  scrollFlex: {
    flex: 1,
  },
  kindRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  kindTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  kindTabActive: {
    backgroundColor: Colors.coral,
    borderColor: Colors.coral,
  },
  kindTabLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.muted,
  },
  kindTabLabelActive: {
    color: Colors.ink,
  },
  // Matches typesRow/typeTile's filled-card treatment above (SocialChallengeForm) — both forms
  // share one visual language for selectable chips now, not two generations of it.
  personalChip: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  chipSource: {
    fontFamily: Fonts.body,
    fontSize: 9,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  chipSourceSelected: {
    color: Colors.warmSubtext,
  },
  sourceLine: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.muted,
    marginTop: Spacing.two,
  },
  targetRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  targetInput: {
    flex: 2,
  },
  unitInput: {
    flex: 1,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.three,
  },
  shareText: {
    flex: 1,
    gap: Spacing.half,
  },
  container: {
    padding: Spacing.four,
    gap: Spacing.two,
    backgroundColor: Colors.cream,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  vsContext: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    alignSelf: 'flex-start',
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.coral,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  vsContextText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.achieverText,
  },
  circleRow: {
    gap: Spacing.two,
  },
  circleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  circleEmoji: {
    fontSize: 15,
  },
  typesRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  typeTile: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: Spacing.two,
  },
  typeTileSelected: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.coral,
  },
  typeLabel: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
  },
  peopleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  personTile: {
    alignItems: 'center',
    gap: 4,
  },
  personAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.disabled,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  personAvatarSelected: {
    borderColor: Colors.coral,
    backgroundColor: Colors.achieverBg,
  },
  personInitial: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.muted,
  },
  personName: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  // contentContainerStyle for the horizontal metric scrollers — the gap lives here, not on the
  // ScrollView itself, or it would space the scroll container rather than the chips inside it.
  pillsScroll: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingRight: Spacing.four,
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: Spacing.two,
  },
  pillText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  stepperLabel: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  stepperValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  whosInChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    backgroundColor: Colors.card,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  whosInText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.soloChipText,
  },
  payoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    padding: Spacing.three,
    marginTop: Spacing.three,
  },
  payoutText: {
    flex: 1,
  },
  payoutTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.achieverText,
  },
  payoutSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    marginTop: Spacing.two,
  },
  chipSelected: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.coral,
  },
  chipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  chipTextSelected: {
    color: Colors.achieverText,
  },
  chipTextSelected2: {
    color: Colors.achieverText,
  },
});
