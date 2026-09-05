import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChallengeMemberTicker } from '@/components/challenge-member-ticker';
import { CindyChallengeEntry, cindyChallengeSeed } from '@/components/cindy/cindy-challenge-entry';
import { ChallengeSentSheet } from '@/components/challenge-sent-sheet';
import { FitnessSyncPrompt } from '@/components/fitness-sync-prompt';
import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { EmberFill } from '@/components/ui/ember-fill';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { SelectField, type SelectOption } from '@/components/ui/select-field';
import { TextInput } from '@/components/ui/text-input';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useFriends } from '@/hooks/use-friends';

import { useMyGroups } from '@/hooks/use-my-groups';
import { useAuth } from '@/lib/auth/auth-context';
import { createChallenge, duplicateGoalMessage, findDuplicateActiveGoal } from '@/lib/api/challenges';
import { inviteChallengeMembers } from '@/lib/api/challenge-lifecycle';
import { syncChallengeFromDevice } from '@/lib/api/fitness-challenge-sync';
import { getErrorMessage } from '@/lib/errors';
import { CHALLENGE_TYPE_GLYPH } from '@/lib/goal-types';
import {
  AUTO_SOURCE_NAME,
  canAutoTrackChallengeType,
  getRealFitnessSourceForChallengeType,
  metricSourceLabel,
  metricSourceShort,
} from '@/lib/fitness-sync';
import {
  ChallengeSpanPicker,
  spanError,
  spanWindowHours,
  type ChallengeSpan,
} from '@/components/challenge-span-picker';
import { createGroupChallenge, createH2HChallenge, createPlacementChallenge } from '@/lib/api/social-challenges';
import type {
  ChallengePeriod,
  ChallengeShape,
  ChallengeType,
  SocialChallengeMode,
  SocialChallengeRaceMetric,
} from '@/types/database';

// Solo (announced) mode was removed — a solo goal the campfire can see is already covered by
// the lock-in flow's own "with the campfire" toggle, so a separate solo-challenge concept was
// redundant. Only h2h and group remain.
//
// THE TILES ARE SHAPES NOW, NOT MODES (mock 114's "⚡ Duel · 🎯 Collective · 🏆 Placement").
// `shape` has existed since 0096 and 'placement' has always been a legal value; nothing ever
// created one. `mode` is still what every pre-v2 reader matches on, so each shape carries the mode
// it rides — placement is a 'group' row, exactly as 0096 intended when it kept the two columns
// separate rather than widening mode's check constraint.
const SHAPE_OPTIONS: {
  value: ChallengeShape;
  mode: SocialChallengeMode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: 'duel', mode: 'h2h', label: 'Duel', icon: 'flash' },
  { value: 'collective', mode: 'group', label: 'Collective', icon: 'people' },
  { value: 'placement', mode: 'group', label: 'Placement', icon: 'trophy' },
];

/**
 * The v2 race metrics. XP is deliberately absent: it correlates with lock-in time, so offering both
 * asked people to pick between two names for the same effort. The column still ACCEPTS xp so
 * in-flight races finish on it — it is just not creatable.
 *
 * `source` is shown under the picker. Volume and Distance are only real if something is feeding
 * them, and saying so up front is the same honesty the personal-goal picker already applies.
 */
const RACE_METRIC_OPTIONS: {
  value: SocialChallengeRaceMetric;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  source: string;
}[] = [
  { value: 'lockin_time', label: 'Lock-in time', icon: 'time', source: 'From your lock-ins — works for everyone, no setup.' },
  { value: 'volume', label: 'Volume', icon: 'barbell', source: 'Total weight lifted, from your logged gym sets.' },
  { value: 'distance', label: 'Distance', icon: 'walk', source: 'From a connected fitness source (Strava).' },
  // THE ONE METRIC NOBODY CAN OBSERVE (0145). Every option above is scored off something the app
  // already wrote — check-ins, gym sets, a Strava sync — and the `source` line under the picker
  // exists to say which. A grade has no source: you type it in, and the honesty this picker
  // already practises about Volume needing a feed applies double here, so the line says outright
  // that it is honour-based and pays less.
  {
    value: 'grade',
    label: 'Grade',
    icon: 'school',
    source: 'A mark you report yourself — honour-based, so it pays a little less than tracked races.',
  },
];

/**
 * The pill VALUES a collective goal can offer.
 *
 * 'custom' is not a metric and never reaches the server — see COLLECTIVE_METRIC_OPTIONS below.
 */
type MetricChoice = SocialChallengeRaceMetric | 'custom';

/**
 * A COLLECTIVE goal's bar — the same set placement offers, plus Custom.
 *
 * Noah: "in collective we need races based on distance, volume, custom, etc, same as placement."
 * The list was Lock-ins and Grade, and the asymmetry was real but not arbitrary: a placement race
 * RANKS the field, so it needs only a metric, while a collective goal is the whole house clearing
 * the SAME bar, so every metric it offers needs somewhere to put the number everyone reaches.
 * Migration 0169 adds that column (social_challenges.target_value); these are the pills for it.
 *
 * Three shapes behind five pills, and which one you get is what the metric chooses:
 *
 *   Lock-ins          race_metric null + target_count — the ×N stepper. UNCHANGED, and deliberately
 *                     so: every collective goal live on prod is this shape. 'lockin_time' is a
 *                     stand-in value so the pills have something to show as selected, not a metric
 *                     race; the challenge is still created with race_metric null exactly as before.
 *   Volume/Distance   race_metric + target_value — "everyone lifts 10,000 lb". The numeric-target
 *                     shape, not the count one.
 *   Grade             race_metric 'grade' + grade_target — unchanged.
 *
 * Custom is the fourth thing and is not a bar at all: it is a metric nobody has written down yet,
 * so it routes into Ask Cindy to be scoped rather than pretending to be a pill you can select.
 */
const COLLECTIVE_METRIC_OPTIONS: {
  value: MetricChoice;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  source: string;
}[] = [
  { value: 'lockin_time', label: 'Lock-ins', icon: 'time', source: 'Everyone logs the same number of qualifying lock-ins.' },
  // The two measured bars. Their source lines are the ones RACE_METRIC_OPTIONS already carries,
  // rewritten from "most" to "the same target" — the honesty is the point either way: Volume and
  // Distance are only real if something is feeding them, and a collective goal on a source nobody
  // in the campfire has connected is a bar the whole house fails at zero.
  {
    value: 'volume',
    label: 'Volume',
    icon: 'barbell',
    source: 'Everyone lifts the same total weight, from their logged gym sets.',
  },
  {
    value: 'distance',
    label: 'Distance',
    icon: 'walk',
    source: 'Everyone covers the same distance, from a connected fitness source (Strava).',
  },
  {
    value: 'grade',
    label: 'Grade',
    icon: 'school',
    source: 'Everyone in the course hits the same mark — honour-based, so it pays a little less.',
  },
  {
    value: 'custom',
    label: 'Custom',
    icon: 'sparkles',
    source: 'Something these pills can\'t say. Describe it to Cindy and she\'ll scope it.',
  },
];

/** What a measured collective bar is collected in, and how it reaches the server's raw units. */
const MEASURED_TARGET: Record<'volume' | 'distance', {
  label: string;
  unit: string;
  placeholder: string;
  hint: string;
  /** The server stores each metric in what challenge_metric_value sums — pounds, and METRES. */
  toRaw: (typed: number) => number;
}> = {
  volume: {
    label: 'Everyone has to lift',
    unit: 'lb',
    placeholder: '10000',
    hint: 'Total weight lifted over the window. Everyone is aiming at the same number.',
    toRaw: (v) => v,
  },
  distance: {
    label: 'Everyone has to cover',
    unit: 'km',
    placeholder: '20',
    // COLLECTED IN KM, STORED IN METRES. challenge_metric_value sums check_ins.distance_m, so the
    // raw column is metres; asking for "20000" here would be the form leaking the schema.
    hint: 'Total distance over the window. Everyone is aiming at the same number.',
    toRaw: (v) => v * 1000,
  },
};

// The presets and the custom span both live in ChallengeSpanPicker — see its header for why the
// date picker is hand-drawn rather than a native module.

const PAYOUT_XP: Record<ChallengeShape, number> = { duel: 200, collective: 300, placement: 300 };

// Two genuinely different challenge kinds live behind this one route: a social challenge
// (invite/accept, multi-party, scores itself off real check_ins — design-mocks/13) and the
// older personal habit tracker (a private quantified target you log progress against
// yourself, optionally shared to a Campfire for visibility). Neither mock covers the personal
// tracker, but it's real working functionality — folding it in behind a top toggle instead of
// deleting it.
export default function CreateChallengeScreen() {
  const router = useRouter();
  const [kind, setKind] = useState<'social' | 'personal'>('social');

  // Its own top row rather than the navigator's header (mock 98): the native modal header was
  // drawing a trailing glyph at the right edge of the "New challenge" bar that means nothing
  // here — there's no forward step to take from a title. Back on the left, title centred, and a
  // matching spacer on the right so the title stays optically centred.
  //
  // <Screen> also brings the deep-purple radial and the keyboard avoidance this screen used to
  // hand-roll, so the form sits on the same ground as everything else.
  return (
    <Screen padded={false}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.topSide} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.topTitle}>New challenge</Text>
        <View style={styles.topSide} />
      </View>
      <View style={styles.kindRow}>
        <KindTab label="Challenge a friend" active={kind === 'social'} onPress={() => setKind('social')} />
        <KindTab label="Personal goal" active={kind === 'personal'} onPress={() => setKind('personal')} />
      </View>
      {kind === 'social' ? <SocialChallengeForm /> : <PersonalChallengeForm />}
    </Screen>
  );
}

/**
 * The segmented toggle at the top.
 *
 * 🎨 WAS THE OLD PHILOI ORANGE. `kindTabActive` filled with Colors.coral (#E0612C) and wrote
 * Colors.ink over it — the pre-Ember primary treatment, and the last control on this screen still
 * wearing it. DESIGN_LANGUAGE_EMBER §3 is explicit that a flat coral fill with cream text "is
 * legible but says nothing"; the lit surfaces in this app are the ember gradient with near-black
 * on top, which is what the Lock-in pill, the send button and PrimaryButton all use.
 *
 * EmberFill rather than a hand-rolled SVG: its header names "the selected tab" as one of the three
 * surfaces it exists for, and this is that tab. Horizontal direction, per §3's rule for pills.
 */
function KindTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  if (!active) {
    return (
      <Pressable onPress={onPress} style={[styles.kindTab, styles.kindTabIdle]} accessibilityRole="button">
        <Text style={styles.kindTabLabel}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={styles.kindTabPress}
      accessibilityRole="button"
      accessibilityState={{ selected: true }}>
      <EmberFill radius={Radius.pill} style={styles.kindTab}>
        <Text style={[styles.kindTabLabel, styles.kindTabLabelActive]}>{label}</Text>
      </EmberFill>
    </Pressable>
  );
}

function SocialChallengeForm() {
  const router = useRouter();
  const { session } = useAuth();
  const { groups } = useMyGroups();
  const { friends } = useFriends();
  // Deep-link prefill from the friend-ping sheet (design-mocks/21): a pre-picked opponent, and
  // optionally a shared campfire — h2h treats it as a "let this campfire watch" default, group
  // treats it as the (mandatory) campfire itself. Captured once; `mode` can change afterward if
  // the user taps a different challenge type tile, so this doesn't move with it.
  const params = useLocalSearchParams<{
    mode?: string;
    shape?: string;
    opponentId?: string;
    opponentName?: string;
    circleId?: string;
    groupId?: string;
  }>();
  const prefillOpponentId = params.opponentId ?? null;
  const prefillOpponentName = params.opponentName ?? null;
  // 🐛 `groupId` IS ACCEPTED HERE BECAUSE THAT IS WHAT THE CAMPFIRE ACTUALLY SENDS (#128).
  //
  // Two callers deep-link into this screen from inside a campfire — challenges-tab.tsx's "Start a
  // challenge" and social-challenge-card.tsx's "Run it again" — and BOTH pass `groupId`, while this
  // screen only ever read `circleId`. So the param was dropped on the floor: opening the create
  // screen from a campfire landed on `groups[0]` (whatever campfire happens to sort first) with the
  // shape defaulted to a duel. An owner starting a race for the fire they were standing in had to
  // find that fire again in the picker, and would silently create the race in the wrong campfire if
  // they didn't notice. Reading both names fixes every existing caller without a coordinated change.
  const prefillCircleId = params.circleId ?? params.groupId ?? null;

  // `shape` is the direct control (#113): a campfire owner tapping "Set a race" should ARRIVE on
  // the placement tile, not have to find it. `mode` stays supported because the friend-ping sheet
  // and the rematch button still speak it, and it only distinguishes duel from campfire.
  const paramShape = params.shape;
  const prefillShape: ChallengeShape =
    paramShape === 'placement' || paramShape === 'collective' || paramShape === 'duel'
      ? paramShape
      : params.mode === 'group'
        ? 'collective'
        : 'duel';
  const prefillMode: SocialChallengeMode = prefillShape === 'duel' ? 'h2h' : 'group';
  const opponentPrefilled = Boolean(prefillOpponentId);

  // Group's own mandatory campfire.
  const [circleIndex, setCircleIndex] = useState(0);
  const circle = groups[circleIndex];
  // The leaderboard read that fed the old "All of {circle} · N members" label is gone with it.
  // The ticker fetches the roster itself, and it needs the ROSTER (list_campfire_members) rather
  // than the leaderboard — a member who has not earned any XP yet is still someone you can invite.

  // H2H's OPTIONAL "let a campfire watch" — a friend-to-friend challenge never requires one
  // (§16), so this is tracked completely separately from Group's mandatory circle above.
  const [watchOn, setWatchOn] = useState(false);
  const [watchCircleIndex, setWatchCircleIndex] = useState(0);
  const watchCircle = groups[watchCircleIndex];
  const canWatch = groups.length > 0;
  const watching = canWatch && watchOn;

  // `shape` is the control now; `mode` is derived from it, so nothing downstream has to learn a
  // second vocabulary and every existing `mode === 'h2h'` reader keeps meaning what it meant.
  const [shape, setShape] = useState<ChallengeShape>(prefillShape);
  const mode: SocialChallengeMode = shape === 'duel' ? 'h2h' : 'group';
  const [opponentId, setOpponentId] = useState<string | null>(prefillOpponentId);
  // lockin_time, not xp: xp is retired from creation, and lock-in time is the one metric that
  // works for every user with no connected source.
  const [raceMetric, setRaceMetric] = useState<SocialChallengeRaceMetric>('lockin_time');
  const [publicName, setPublicName] = useState('');
  // The grade race's two extra terms. Held as strings because they are text fields: an empty box
  // is "not set", which a number state cannot represent without conflating it with zero.
  const [gradeTarget, setGradeTarget] = useState('');
  /** The measured collective bar, in the unit the form SHOWS (km for distance, not metres). */
  const [measuredTarget, setMeasuredTarget] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const grading = raceMetric === 'grade';
  // 0169 — a COLLECTIVE goal whose bar is a measured number rather than a count of lock-ins:
  // "everyone lifts 10,000 lb". Held as its own string rather than reusing gradeTarget, which is
  // capped at 100 and would silently reject the first realistic volume anyone typed.
  //
  // Collective only, and that is not an oversight. A duel or a placement race on volume RANKS the
  // field — it has no shared bar to clear, which is exactly why create_placement_challenge takes a
  // metric and no target at all.
  const measured = shape === 'collective' && (raceMetric === 'volume' || raceMetric === 'distance');
  const measuredSpec = measured ? MEASURED_TARGET[raceMetric as 'volume' | 'distance'] : null;
  const measuredNum = Number(measuredTarget.trim());
  const measuredValid = measuredTarget.trim().length > 0 && Number.isFinite(measuredNum) && measuredNum > 0;
  const gradeTargetNum = Number(gradeTarget.trim());
  const gradeTargetValid = gradeTarget.trim().length > 0 && Number.isFinite(gradeTargetNum) && gradeTargetNum > 0 && gradeTargetNum <= 100;
  // The member ticker's selection. Held here rather than inside the ticker so it survives a
  // failed submit — retyping the whole invite list because the create call timed out is the
  // opposite of what a "sent" confirmation is for.
  const [invitees, setInvitees] = useState<string[]>([]);
  const [targetCount, setTargetCount] = useState(5);
  // The window, as either a preset or an explicit start -> end. window_hours is still what gets
  // sent for both (spanWindowHours resolves a custom span to one); a custom span sends the two
  // dates ALONGSIDE it, and start_challenge (0096) already prefers them when they are set.
  const [span, setSpan] = useState<ChallengeSpan>({ kind: 'preset', windowHours: 72 });
  const windowHours = spanWindowHours(span);
  const customSpan = span.kind === 'custom' ? span : null;
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
  const payoutXp = PAYOUT_XP[shape];

  async function handleCreate() {
    // Checked before the spinner starts: a custom span with the end before the start is a form
    // error, and it should read like one rather than as a failed round trip. The server refuses
    // the same range independently — this message is the helpful half, not the enforcing one.
    const badSpan = spanError(span);
    if (badSpan) {
      setError(badSpan);
      return;
    }
    // A grade duel or collective goal is a shared BAR — "who got more" between two people in
    // different courses is not a race, which is why the server's constraint requires the target
    // too. A placement board ranks without one and is exempt.
    if (grading && shape !== 'placement' && !gradeTargetValid) {
      setError('Set the grade everyone is aiming for, between 1 and 100.');
      return;
    }
    // Same argument one metric over: a measured collective goal IS its bar, and the server refuses
    // a null one. Caught here so it reads as a form error rather than a failed round trip.
    if (measured && !measuredValid) {
      setError(`Set the ${measuredSpec?.unit ?? 'target'} everyone is aiming for.`);
      return;
    }
    setSaving(true);
    setError(null);
    // Only sent on a grade race — every other metric leaves both null and behaves exactly as it
    // did before 0145.
    const gradeTerms = grading
      ? { gradeTarget: shape === 'placement' ? null : gradeTargetNum, courseCode: courseCode.trim() || null }
      : {};
    try {
      if (shape === 'duel') {
        if (!effectiveOpponentId) {
          setError('Pick a friend to challenge.');
          return;
        }
        await createH2HChallenge({
          opponentId: effectiveOpponentId,
          raceMetric,
          windowHours,
          startsOn: customSpan?.startsOn.toISOString() ?? null,
          endsOn: customSpan?.endsOn.toISOString() ?? null,
          circleId: watching ? (watchCircle?.id ?? null) : null,
          publicName,
          ...gradeTerms,
        });
        // A visible confirmation, not a silent navigate-back (punchlist 2, §2: "no 'request
        // sent' state") — the opponent sees it as a real Accept/Decline invite on their own
        // Challenges tab as soon as they open it. Held open until they tap Done (mock 55a);
        // router.back() only fires once they dismiss it, not immediately.
        setJustSentTo(opponentName ?? 'They');
        return;
      } else if (shape === 'placement') {
        if (!circle) {
          setError('Start or join a Campfire first.');
          return;
        }
        // NO INVITE STEP, by design (mock 114: "students auto-enter by being in the course
        // campfire"). A placement race is the admin's to call and the whole campfire is the field,
        // so create enrols every member as accepted — which is also what makes challenge_field
        // return a real roster with real baselines instead of falling through to its legacy arm.
        await createPlacementChallenge({
          circleId: circle.id,
          raceMetric,
          windowHours,
          startsOn: customSpan?.startsOn.toISOString() ?? null,
          endsOn: customSpan?.endsOn.toISOString() ?? null,
          publicName,
          ...gradeTerms,
        });
      } else {
        if (!circle) {
          setError('Start or join a Campfire first.');
          return;
        }
        const created = await createGroupChallenge({
          // Exactly ONE bar, matching the server's constraint (0169 widened it from two columns to
          // three): a grade goal's is the mark, a measured goal's is the value, and only a lock-in
          // goal sends a count. Sending more than one is refused.
          ...(measured && measuredSpec
            ? // The metric's RAW units — the form collects km and the column stores metres, which
              // is what challenge_metric_value sums. See MEASURED_TARGET.
              { raceMetric, targetValue: measuredSpec.toRaw(measuredNum) }
            : {}),
          circleId: circle.id,
          targetCount: grading || measured ? null : targetCount,
          windowHours,
          startsOn: customSpan?.startsOn.toISOString() ?? null,
          endsOn: customSpan?.endsOn.toISOString() ?? null,
          publicName,
          ...gradeTerms,
        });
        // The invite is a SECOND call rather than a parameter on create, because that is the
        // shape the server already has: invite_challenge_members (0096) is admin-gated,
        // pre-start-only, and flips the draft to 'pending' as it goes. Folding it into create
        // would duplicate all three rules in a second place.
        //
        // Deliberately not fatal. The challenge exists at this point; failing the whole flow
        // because the invite call was refused would leave a draft behind with an error that
        // looks like nothing was created. The draft is startable from the campfire's Challenges
        // tab either way, and the ticker there can invite people afterwards.
        if (invitees.length > 0) {
          try {
            await inviteChallengeMembers(created.id, invitees);
          } catch (e) {
            setError(getErrorMessage(e, 'The challenge was created, but the invites did not go out.'));
            return;
          }
        }
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
  const noOpponent = shape === 'duel' && !effectiveOpponentId;

  // 🔒 HOSTING FOR A WHOLE CAMPFIRE IS AN ADMIN ACTION, and it is enforced server-side —
  // create_placement_challenge has raised "Only campfire admins can start a placement race" since
  // 0126, and create_group_challenge joined it in 0162 (a collective goal names the fire, posts to
  // its chat and pushes every member, so the authority to use it is the fire's own).
  //
  // This is NOT the enforcement; it is the courtesy. Until now MyGroup carried no role, so
  // social-challenges.ts had a standing comment that "the client cannot grey the tile out; a
  // non-admin gets the RPC's own refusal" — which meant the form cheerfully offered an action it
  // knew nothing about and failed at the last tap. fetchMyGroups reads the membership row anyway,
  // so the role is now on MyGroup for free and the form can say so up front.
  //
  // A DUEL IS UNAFFECTED. It is friend-to-friend and needs no campfire at all (§16), so this only
  // ever gates the two campfire shapes.
  const campfireAdmin = !circle || circle.role === 'owner' || circle.role === 'admin';
  const notCampfireAdmin = mode === 'group' && !campfireAdmin;

  // ONE SEED, TWO DOORS. The "Ask Cindy" card at the top of the form and the Custom pill in the
  // collective metric picker are the same request — "this is a goal the pills below cannot say" —
  // so they hand Cindy the same sentence rather than two that drift.
  //
  // 🔒 THE CAMPFIRE IS ONLY NAMED AS A HOSTING TARGET FOR AN ADMIN. Saying "for Goat" is what
  // steers Cindy to host_campfire_challenge, which posts a card into that campfire's chat and
  // pushes every member. A non-admin gets the ordinary personal-goal sentence instead, so the flow
  // they are offered is the one they can actually complete.
  //
  // This is a COURTESY, not the enforcement, and the distinction matters: create_group_challenge
  // and host_campfire_challenge both re-read the caller's role out of group_members at the moment
  // of the write (0162) and refuse regardless of what any sentence here said. Widening the prose
  // could not widen the permission; it would only walk somebody into a refusal.
  const cindySeed = cindyChallengeSeed({
    shape,
    opponentName,
    circleName: mode === 'group' ? circle?.name : null,
    canHostForCampfire: mode === 'group' && campfireAdmin && Boolean(circle),
  });
  const askCindy = () => router.push({ pathname: '/cindy', params: { ask: cindySeed } });

  const sendLabel =
    shape === 'duel'
      ? noOpponent
        ? 'Pick someone to challenge'
        : `Challenge ${opponentName ?? 'them'}`
      : notCampfireAdmin
        ? `Only ${circle?.name ?? 'campfire'} admins can`
        : shape === 'placement'
          ? 'Start placement race'
          : 'Start group challenge';
  return (
    <>
      <ScrollView style={styles.scrollFlex} contentContainerStyle={styles.container}>
        {/* Mock 143's other door, above the form rather than in front of it — see the component's
            header for why it is opt-in and what it deliberately does not promise. Seeded from
            whatever the form already knows, so a half-filled duel does not have to be retyped. */}
        <CindyChallengeEntry seed={cindySeed} />

        <Text style={styles.label}>Challenge type</Text>
        <View style={styles.typesRow}>
          {SHAPE_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => setShape(option.value)}
              style={[styles.typeTile, shape === option.value && styles.typeTileSelected]}>
              <Ionicons name={option.icon} size={16} color={shape === option.value ? Colors.achieverText : Colors.muted} />
              <Text style={[styles.typeLabel, shape === option.value && styles.chipTextSelected2]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>

        {shape === 'duel' && (
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

            {/* THE RACE — v2's four metrics. "Most XP" is gone: XP correlates with lock-in time,
                so offering both asked people to choose between two names for the same effort.
                Existing XP races keep running (the column still accepts it); it is simply no
                longer creatable. */}
            <Text style={styles.label}>The race</Text>
            <RaceMetricPills value={raceMetric} onChange={setRaceMetric} />

            {grading && (
              <GradeTermsFields
                target={gradeTarget}
                onTarget={setGradeTarget}
                course={courseCode}
                onCourse={setCourseCode}
                showTarget
              />
            )}

            <PublicNameField value={publicName} onChange={setPublicName} />

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

        {/* Both campfire shapes pick a campfire; only what they do with it differs. */}
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

            {/* THE PUBLIC NAME, ON A GROUP CHALLENGE AT LAST (ledger item 15). The field rendered
                only in the h2h branch, so a group challenge always sent a null public_name — while
                the card, the watch screen and the share card all READ it and fell back to
                describing the metric. One input, not one line of backend: create_group_challenge
                has taken p_public_name since 0098 and nothing was ever passing it. */}
            {notCampfireAdmin && (
              // Says the rule and what to do about it, rather than just going grey. The person who
              // can grant them the role is the owner, and naming that is the whole difference
              // between a dead end and a next step.
              <View style={styles.adminNotice}>
                <Ionicons name="lock-closed" size={13} color={Colors.muted} />
                <Text style={styles.adminNoticeText}>
                  Only admins can set a challenge for {circle?.name ?? 'a campfire'}. Ask an owner to make you one —
                  or challenge a friend to a duel instead.
                </Text>
              </View>
            )}

            <PublicNameField value={publicName} onChange={setPublicName} />
          </>
        )}

        {shape === 'placement' && (
          <>
            {/* Everyone is ranked on the same metric, so a placement race HAS one — unlike a
                collective goal, whose target is a count of lock-ins and which leaves race_metric
                null on purpose. */}
            <Text style={styles.label}>The race</Text>
            <RaceMetricPills value={raceMetric} onChange={setRaceMetric} />

            {/* No target field here on purpose. A placement board ranks the field 1..N and the
                ranking IS the result — a bar on top would be a second, redundant verdict, which
                is what the server's constraint says too. */}
            {grading && (
              <GradeTermsFields
                target={gradeTarget}
                onTarget={setGradeTarget}
                course={courseCode}
                onCourse={setCourseCode}
                showTarget={false}
              />
            )}

            <View style={styles.payoutCard}>
              <Ionicons name="people" size={18} color={Colors.achieverText} />
              <View style={styles.payoutText}>
                <Text style={styles.payoutTitle}>Everyone in {circle?.name ?? 'the campfire'} is entered</Text>
                <Text style={styles.payoutSubtitle}>
                  No invites to chase — members auto-enter, and everyone finishes with a rank. Admins
                  only.
                </Text>
              </View>
            </View>
          </>
        )}

        {shape === 'collective' && (
          <>
            <Text style={styles.label}>The goal</Text>
            {/* A collective goal's bar is normally a count of lock-ins. On a course it is a mark,
                and the two are mutually exclusive — the metric picker is what chooses between
                them, so the stepper is replaced rather than sitting there meaning nothing. */}
            <RaceMetricPills value={raceMetric} onChange={setRaceMetric} collective onCustom={askCindy} />
            {grading ? (
              <GradeTermsFields
                target={gradeTarget}
                onTarget={setGradeTarget}
                course={courseCode}
                onCourse={setCourseCode}
                showTarget
                targetLabel="Everyone has to hit"
              />
            ) : measuredSpec ? (
              /* 0169 — the measured bar. The same numeric-target control the grade goal uses, with
                 the metric's unit beside it, in place of the ×N stepper: "everyone lifts 10,000 lb"
                 is a number in a unit, not a count of sessions. */
              <NumericTargetField
                label={measuredSpec.label}
                value={measuredTarget}
                onChange={setMeasuredTarget}
                placeholder={measuredSpec.placeholder}
                hint={measuredSpec.hint}
                unit={measuredSpec.unit}
              />
            ) : (
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
            )}
            {/* THE MEMBER TICKER (CHALLENGE_V2_SPEC §1). This was the line
                  "All of {circle.name} · {members.length} members"
                — a label, not a control, and it was lying: since 0098 a group challenge is created
                as a draft with no participants at all, so "all of" was nobody. Nothing in the app
                called invite_challenge_members, which meant every group challenge created since
                that migration hit "Nobody has accepted yet." the moment an admin pressed Start.

                Picking people here is what gives the draft a roster. The creator is already on it
                (0112), so they are not in the list. */}
            {circle && (
              <>
                <Text style={styles.label}>Who&apos;s racing?</Text>
                <ChallengeMemberTicker
                  groupId={circle.id}
                  value={invitees}
                  onChange={setInvitees}
                  excludeUserIds={session?.user.id ? [session.user.id] : []}
                />
                <Text style={styles.hint}>
                  They get an invite to accept. You&apos;re in already — start the race once they&apos;ve
                  answered.
                </Text>
              </>
            )}
          </>
        )}

        <Text style={styles.label}>How long</Text>
        <ChallengeSpanPicker value={span} onChange={setSpan} />

        <View style={styles.payoutCard}>
          <Ionicons name="trophy" size={18} color={Colors.achieverText} />
          <View style={styles.payoutText}>
            <Text style={styles.payoutTitle}>
              {shape === 'duel'
                ? `Winner takes +${payoutXp} XP`
                : shape === 'placement'
                  ? `Up to +${payoutXp} XP — scaled by where you finish`
                  : `Up to +${payoutXp} XP each (more for top finishers) — only if everyone finishes`}
            </Text>
            {shape === 'duel' && <Text style={styles.payoutSubtitle}>scales with effort · capped to keep it fair</Text>}
            {/* Placement pays EVERYONE by percentile band rather than all-or-nothing, which is the
                one economic difference between it and a collective goal and therefore the thing
                worth saying on the create screen. */}
            {shape === 'placement' && (
              <Text style={styles.payoutSubtitle}>every finisher is paid · top of the board pays most</Text>
            )}
          </View>
        </View>
      </ScrollView>

      {/* The one action on this screen, pinned to the bottom edge (mock 98) rather than trailing
          the last form field — where it landed at a different height per mode and could be
          scrolled clean out of sight. Disabled it goes muted-on-brand, not orange: see
          PrimaryButton's `disabled`. */}
      <View style={styles.footer}>
        {error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton
          label={sendLabel}
          onPress={handleCreate}
          loading={saving}
          disabled={noOpponent || notCampfireAdmin}
        />
      </View>

      <ChallengeSentSheet
        visible={justSentTo !== null}
        onClose={() => router.back()}
        onStartAnother={() => setJustSentTo(null)}
        opponentName={justSentTo ?? 'them'}
        raceMetric={raceMetric}
        windowHours={windowHours}
        payoutXp={payoutXp}
      />
    </>
  );
}

/**
 * The race picker, shared by Duel and Placement.
 *
 * Extracted rather than copied into the placement branch: the hint under it is per-metric prose
 * about whether anything is actually feeding that source, and two copies of it is how one of them
 * goes stale the next time a metric is added.
 */
function RaceMetricPills({
  value,
  onChange,
  /** A COLLECTIVE goal is not a metric race — its bar is a count of lock-ins and it leaves
   *  race_metric null on purpose (0098). The one exception is a grade goal, whose bar is a mark,
   *  so this variant offers exactly that choice and nothing else: "lock-ins" vs "a grade". */
  collective = false,
  /**
   * What the Custom pill does. Required in practice for the collective variant and unused by the
   * race one, because Custom is only offered there.
   *
   * A HANDLER RATHER THAN A SELECTABLE VALUE, which is the whole reason `value` stays typed as a
   * real metric. "Custom" is not a bar the form can collect — it is a metric that does not exist
   * yet — so letting it become the selected state would mean every branch below (the stepper, the
   * target field, the submit) needing a fourth arm meaning "nothing is chosen". Tapping it leaves.
   */
  onCustom,
}: {
  value: SocialChallengeRaceMetric;
  onChange: (metric: SocialChallengeRaceMetric) => void;
  collective?: boolean;
  onCustom?: () => void;
}) {
  const options: { value: MetricChoice; label: string; icon: keyof typeof Ionicons.glyphMap; source: string }[] =
    collective ? COLLECTIVE_METRIC_OPTIONS : RACE_METRIC_OPTIONS;
  return (
    <>
      <View style={styles.pillsRow}>
        {options.map((option) => {
          // Never selected, by construction — `value` is a metric and this is not one.
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => (option.value === 'custom' ? onCustom?.() : onChange(option.value))}
              style={[styles.pill, selected && styles.chipSelected]}>
              <Ionicons name={option.icon} size={13} color={selected ? Colors.ink : Colors.muted} />
              <Text style={[styles.pillText, selected && styles.chipTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {/* Each metric names its own source, because "Volume" and "Distance" are only real if
          something is feeding them — the same honesty the personal-goal picker already applies
          with its "needs WHOOP" tags. */}
      <Text style={styles.hint}>{options.find((o) => o.value === value)?.source}</Text>
    </>
  );
}

/**
 * ONE numeric bar field, used by both metrics that have one.
 *
 * Extracted rather than copied when the collective goal grew a measured target (0169): the grade
 * field and the volume/distance field are the same control down to the input sanitiser, and the
 * sanitiser is the part that must not drift — `keyboardType` is a HINT the OS may ignore, and
 * several Android locales still offer a comma on the decimal pad, so the filter below is what
 * actually guarantees a parseable number rather than the keyboard.
 *
 * `unit` is the one thing they do not share: a grade is a bare percentage, while a measured target
 * is 10,000 OF something and is unreadable without saying of what.
 */
function NumericTargetField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  unit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint: string;
  unit?: string;
}) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.numTargetRow}>
        <View style={styles.numTargetInput}>
          <TextInput
            value={value}
            // Digits and one decimal point — see this component's header for why the filter, and
            // not the keyboard type, is what makes that true.
            onChangeText={(t) => onChange(t.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
            placeholder={placeholder}
            keyboardType="decimal-pad"
            inputMode="decimal"
            // 6 was the grade cap and is far too short for a volume target — 100000 lb is a
            // realistic term for a whole campfire over a week.
            maxLength={9}
          />
        </View>
        {unit ? <Text style={styles.numTargetUnit}>{unit}</Text> : null}
      </View>
      <Text style={styles.hint}>{hint}</Text>
    </>
  );
}

/**
 * The two extra terms a grade race carries — the mark, and the course it is in.
 *
 * The course is not decoration. Mock 140's Cindy refuses to price the challenge until she has the
 * code, because "Physiology at one school isn't the same as another"; the same is true of reading
 * the result later, where a bare "70%" says nothing about what was actually asked of anyone.
 */
function GradeTermsFields({
  target,
  onTarget,
  course,
  onCourse,
  showTarget,
  targetLabel = 'The mark to hit',
}: {
  target: string;
  onTarget: (v: string) => void;
  course: string;
  onCourse: (v: string) => void;
  showTarget: boolean;
  targetLabel?: string;
}) {
  return (
    <>
      {showTarget ? (
        <NumericTargetField
          label={targetLabel}
          value={target}
          onChange={onTarget}
          placeholder="70"
          hint="A percentage. Everyone in the challenge is aiming at the same one."
        />
      ) : null}
      <Text style={styles.label}>Course</Text>
      <TextInput value={course} onChangeText={onCourse} placeholder="KP451" maxLength={24} autoCapitalize="characters" />
      <Text style={styles.hint}>
        Optional, but it is what makes the target mean something — a 70 in an intro course and a 70
        in a 400-level one are not the same ask.
      </Text>
    </>
  );
}

/** "Name it" — every shape, not just the duel (ledger item 15). */
function PublicNameField({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <>
      <Text style={styles.label}>Name it</Text>
      <TextInput value={value} onChangeText={onChange} placeholder="Morning grind" maxLength={60} />
      <Text style={styles.hint}>
        What everyone sees on the card and the share. Optional — the metric names it otherwise.
      </Text>
    </>
  );
}

// `defaultTarget` is the sensible weekly number for each metric — a per-option value rather than
// a nested ternary in handlePickType, which stopped scaling once there were nine of these.
// The five metrics mock 73A names, in its order. `defaultTarget` is the sensible weekly number
// for each — a per-option value rather than a nested ternary in handlePickType, which stopped
// scaling once there were nine of these.
const PERSONAL_TYPE_OPTIONS: { value: ChallengeType; label: string; unit: string; defaultTarget: string }[] = [
  // Labels carry no emoji — MetricChip renders CHALLENGE_TYPE_GLYPH beside them, so the glyph is a
  // recolourable vector that takes the chip's selected/unselected tint instead of a fixed-colour
  // emoji that ignores it (§A3).
  { value: 'steps', label: 'Steps', unit: 'steps', defaultTarget: '10000' },
  { value: 'study_hours', label: 'Study time', unit: 'hours', defaultTarget: '10' },
  { value: 'gym_visits', label: 'Gym visits', unit: 'visits', defaultTarget: '4' },
  { value: 'run_distance', label: 'Run', unit: 'km', defaultTarget: '20' },
];

// Kept off the primary row so it reads as mock 73A's clean five, but NOT deleted: each of these
// is wired to a real verifiable source (Strava for rides, Whoop for the rest, §17), and dropping
// them from setup would quietly make those integrations unreachable.
const MORE_TYPE_OPTIONS: typeof PERSONAL_TYPE_OPTIONS = [
  { value: 'ride_distance', label: 'Riding', unit: 'km', defaultTarget: '20' },
  // Whoop has no step count, so its three metrics live here and never on the steps option above.
  { value: 'workout_minutes', label: 'Workout minutes', unit: 'minutes', defaultTarget: '150' },
  { value: 'strain', label: 'Strain', unit: 'strain', defaultTarget: '70' },
  { value: 'sleep_hours', label: 'Sleep', unit: 'hours', defaultTarget: '49' },
];

const CUSTOM_TYPE_OPTION: (typeof PERSONAL_TYPE_OPTIONS)[number] = {
  value: 'custom',
  // No '＋' any more: it was a chip that had to look like an add button sitting among peers. In a
  // list of things you can track, "Custom" is just the last one.
  label: 'Custom',
  unit: '',
  defaultTarget: '',
};

/**
 * ONE PICKER, NOT TWO SLIDING ROWS (§F).
 *
 * What this replaces: the headline four as a horizontal chip scroller, a "More metrics — riding,
 * Whoop…" link under it, and a SECOND horizontal scroller that appeared when you tapped it. Noah:
 * "two sliding bars… really weird, should just be a dropdown where you select what you're
 * racing/tracking."
 *
 * The metric set is unchanged and nothing is hidden any more — the four headline metrics, the four
 * that were behind the More link, and Custom, in one list, each with the full source sentence it
 * previously had to abbreviate to one word to fit in a chip. `metricSourceShort` was written for
 * that constraint and is no longer needed here; the sheet has the width for the real thing.
 */
const METRIC_SELECT_OPTIONS: SelectOption<ChallengeType>[] = [
  ...PERSONAL_TYPE_OPTIONS,
  ...MORE_TYPE_OPTIONS,
  CUSTOM_TYPE_OPTION,
].map((option) => ({
  value: option.value,
  label: option.label,
  detail: metricSourceLabel(option.value) ?? metricSourceShort(option.value),
  icon: <DisciplineIcon name={CHALLENGE_TYPE_GLYPH[option.value]} size={16} color={Colors.ember} />,
}));

/** Every option the dropdown offers, keyed for the unit/target defaults its selection carries. */
const METRIC_OPTION_BY_TYPE = new Map(
  [...PERSONAL_TYPE_OPTIONS, ...MORE_TYPE_OPTIONS, CUSTOM_TYPE_OPTION].map((o) => [o.value, o])
);

// "How often" (mock 73A) — the cadence itself, not a one-off window. The old labels ("This week"
// / "Today") described a single period; these describe the repeat, which is what a goal that
// resets every Monday actually is.
//
// §5 — "Once" is the third, and it is not a repeat at all. Noah: "you can only pick Daily or
// Weekly — every goal is forced to recur", which makes "run a half marathon", "read Dune" and
// "1000 push-ups" unexpressible: each is a single target, and both recurring cadences reset the
// counter underneath it. A 'once' goal has one window that opens at creation and never closes, and
// when it is hit it stays hit (migration 0155).
//
// LAST IN THE ROW on purpose. Daily is what most goals are and the first chip is the one people
// take; a one-time target is the deliberate choice, not the default.
const PERSONAL_PERIOD_OPTIONS: { value: ChallengePeriod; label: string; hint: string }[] = [
  { value: 'day', label: 'Daily', hint: 'Resets every night at your midnight.' },
  { value: 'week', label: 'Weekly', hint: 'Resets every Sunday (UTC).' },
  { value: 'once', label: 'Once', hint: 'One target, no reset — it stays done once you hit it.' },
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
      // 🔴 §B — THE STACKING EXPLOIT'S FRONT DOOR. Two identical auto-tracked goals read one number
      // and each bank their own drip (see migration 0148 for the full account). The server refuses
      // it now; this asks first, so the answer arrives as a sentence in the form instead of as a
      // failed insert. The trigger is the enforcement — this is only the helpful half, and a race
      // between two devices still lands on it rather than getting through.
      const clash = await findDuplicateActiveGoal({
        userId: session.user.id,
        type,
        period,
        label: isCustom ? customLabel.trim() : null,
      });
      if (clash) {
        setError(duplicateGoalMessage(clash));
        return;
      }
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
    <>
      <ScrollView style={styles.scrollFlex} contentContainerStyle={styles.container}>
        {/* No campfire step anywhere in here (migration 0059): a goal is yours, and who sees the
            work behind it is picked per lock-in on the done screen, which can post to several
            campfires at once rather than the one this screen used to bind forever. */}
        <Text style={styles.label}>What are you tracking?</Text>
        {/* §F — one dropdown. See METRIC_SELECT_OPTIONS for what this replaces and why. The source
            sentence rides inside each row now (including the gym metric's photo/sets requirement,
            which is the difference between a visit counting and not), so it no longer needs its own
            line under the picker. */}
        <SelectField
          value={type}
          options={METRIC_SELECT_OPTIONS}
          onChange={(next) => {
            const option = METRIC_OPTION_BY_TYPE.get(next);
            if (option) handlePickType(option);
          }}
          title="What are you tracking?"
          accessibilityLabel="What are you tracking"
        />

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
              style={[styles.personalChip, period === option.value && styles.chipSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected: period === option.value }}
              accessibilityHint={option.hint}>
              <Text style={[styles.chipText, period === option.value && styles.chipTextSelected]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
        {/* The cadence is the one field on this form whose consequence is invisible until the next
            morning — a daily goal that resets is indistinguishable at creation from a one-time goal
            that does not. One line saying which, under the chip that is actually selected. */}
        <Text style={styles.cadenceHint}>
          {PERSONAL_PERIOD_OPTIONS.find((o) => o.value === period)?.hint}
        </Text>

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
                  ? // 0149: a count goal is no longer purely hand-logged. If its NAME matches an
                    // exercise, the reps from a gym lock-in roll into it — which is the whole point
                    // of "1000 pushups" being a goal you can actually chase in the gym. Said here
                    // because the old line promised the opposite.
                    `#️⃣ A count you log yourself — and reps logged in a gym session under "${customLabel.trim() || 'this name'}" roll in on their own.`
                  : '✏️ No device measures this one — you log it by hand.'}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton label="Set goal" onPress={handleCreate} loading={saving} />
      </View>

      <FitnessSyncPrompt
        visible={showSyncPrompt}
        onClose={() => {
          setShowSyncPrompt(false);
          doCreate();
        }}
        onSourceConnected={() => setJustConnectedDeviceFitness(true)}
        challengeType={type}
        challengeTitle={`${target || '0'} ${unit} ${period === 'day' ? 'today' : period === 'once' ? 'total' : 'this week'}`}
        challengeSubtitle="Just for you"
      />
    </>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  // Equal-width sides keep the title centred whatever the back glyph measures.
  topSide: {
    width: 24,
    alignItems: 'flex-start',
  },
  topTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  // Sits below the scroller, so it's always on screen and always in the same place.
  footer: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.twelve,
    paddingBottom: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
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
  // NumericTargetField's row — the bar and its unit on one line. The input keeps the flex so a
  // six-figure volume still has room; the unit is a fixed label beside it rather than placeholder
  // text inside it, which would vanish the moment anybody typed.
  //
  // Deliberately NOT the personal form's targetRow/targetInput below. Those are a different
  // control with a different flex, and sharing one style so a tweak to the personal goal silently
  // reflows the challenge bar is the kind of coupling nobody finds until it breaks.
  numTargetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  numTargetInput: {
    flex: 1,
  },
  numTargetUnit: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.muted,
  },
  kindRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  // The Pressable is the flex child; the fill is what paints, so it has to be the full-width box
  // inside it rather than shrink-wrapping the label.
  kindTabPress: {
    flex: 1,
  },
  kindTab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
  kindTabIdle: {
    flex: 1,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  kindTabLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.muted,
  },
  // Near-black on the gradient, not cream — §3's pairing. Cream on ember is the one combination
  // that loses contrast at the amber end of the ramp.
  kindTabLabelActive: {
    color: Colors.onEmber,
  },
  // Matches typesRow/typeTile's filled-card treatment above (SocialChallengeForm) — both forms
  // share one visual language for selectable chips now, not two generations of it.
  // Icon + label on one line so the vector sits where the emoji used to, with the source tag
  // still stacked beneath it.
  chipTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
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
  cadenceHint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: -Spacing.one,
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
    // No fill: Colors.cream here was an opaque flat sheet painted straight over the deep-purple
    // radial (Ember reskin sweep).
    paddingBottom: Spacing.four,
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
  adminNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  adminNoticeText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.muted,
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
    backgroundColor: Colors.cardDark,
    borderColor: Colors.amber,
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
  // mock 98's `.opt.on` — the darker surface with an amber hairline, not a purple fill with a
  // coral one. Shared by every selectable pill/chip on both forms.
  chipSelected: {
    backgroundColor: Colors.cardDark,
    borderColor: Colors.amber,
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
