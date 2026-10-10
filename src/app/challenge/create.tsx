import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { dismissCoachMark } from '@/components/coach-mark';
import { EquippedFlameSvg } from '@/components/flame-icon';
import { BackHeader } from '@/components/ui/back-header';
import { EmberFill } from '@/components/ui/ember-fill';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useCindy } from '@/hooks/use-cindy';
import { useFriends } from '@/hooks/use-friends';
import { useMyGroups } from '@/hooks/use-my-groups';
import { useAuth } from '@/lib/auth/auth-context';
import { duplicateGoalMessage, findDuplicateActiveGoal } from '@/lib/api/challenges';
import { CoachError, extractChallenge, isScopedTier, parseProposedGoals, sendToCindy, type CoachReply } from '@/lib/api/coach';
import {
  customNameFrom,
  EMPTY_ANSWERS,
  findNamed,
  nextStep,
  parseFromExtracted,
  parseQa,
  progressOf,
  scoringPrompt,
  verdictRouteFor,
  whoFits,
  type QaAnswers,
  type QaParse,
  type QaStep,
  type QaWhat,
  type QaWho,
} from '@/lib/challenge-qa';
import { markCoachMarkSeen } from '@/lib/coach-marks';
import type { ChallengePeriod, ChallengeType, DifficultyTier } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// NEW CHALLENGE — a Q&A with Cindy (mock 265), ending on her verdict (mock 263).
//
// This replaced a static form: preset pills, a shape picker, and a payout line the CLIENT wrote —
// "Winner takes +200 XP" — that settlement never read. Now there is one path for every challenge,
// solo goal to campfire race: Cindy asks what, how much / by when, and who; the user taps a chip or
// types a sentence; and at the end SHE scores the tier and the verdict screen shows what the SERVER
// says it pays. Nobody sets a payout anywhere on this route.
//
// ── WHAT THIS SCREEN IS, AND IS NOT ──
//
// A UX layer over the creates that already existed. Every answer lands in challenge-qa.ts's
// verdictRouteFor, which produces the exact params challenge/verdict.tsx already took from Cindy's
// chat — and the verdict's "Lock it in" runs the same createChallenge / createH2HChallenge /
// createGroupChallenge / createPlacementChallenge / hostCampfireChallenge it always did, with p_tier
// passed through and verifiability still derived server-side. There is no create call on this
// screen at all.
//
// ── WHERE THE TIER COMES FROM ──
//
// sendToCindy, the same chat op the Cindy screen uses — so the tier is judged by the coach's own
// SCOPING_RULES (T × A grid, ipsative strength, "tier the leap"), not by a second rubric living in
// the client. She is handed the finished answers as one plain sentence and asked to propose it; this
// screen reads ONLY her tier and rationale off the proposal and ignores the rest of it. The terms
// are the user's, already collected — her proposal re-stating them is not a second source of truth.
// If she asks a question instead of scoring, it is shown in the thread and the user answers her.
// ══════════════════════════════════════════════════════════════════════════════════════════════

type Msg = { id: string; from: 'cindy' | 'me'; text: string };

/**
 * Where the conversation is, beyond what the answers already imply.
 *
 * `asking` is the ordinary state: the open question is nextStep(answers). Everything else is the
 * stretch after the questions run out — scoring, a follow-up from Cindy, or a stop the user has to
 * resolve (a duplicate goal, consent, an error).
 */
type Mode = 'asking' | 'reading' | 'scoring' | 'followup' | 'consent' | 'retry' | 'duplicate' | 'done';

/** The proposals that carry a scoped tier. Anything else (start_session, a milestone) is not one. */
const SCORING_TOOLS = ['create_challenge', 'propose_social_challenge', 'host_campfire_challenge', 'create_goals'];

/** The tier and her reason off a reply, or null when she asked something instead of scoring. */
function verdictFrom(reply: CoachReply): { tier: DifficultyTier; rationale: string; tool: string } | null {
  const action = reply.action;
  if (!action || !SCORING_TOOLS.includes(action.tool)) return null;
  const input = action.input ?? {};
  const tier = isScopedTier(input.difficulty_tier)
    ? input.difficulty_tier
    : action.tool === 'create_goals'
      ? (parseProposedGoals(input)[0]?.tier ?? null)
      : null;
  if (!tier) return null;
  return {
    tier,
    rationale: typeof input.scope_rationale === 'string' ? input.scope_rationale.trim() : '',
    tool: action.tool,
  };
}

const WHAT_CHIPS: { label: string; what: QaWhat }[] = [
  { label: 'Study 📚', what: 'study' },
  { label: 'Gym 🏋️', what: 'gym' },
  { label: 'A run 🏃', what: 'run' },
  { label: 'Something else ✨', what: 'custom' },
];

/** Tap-for-the-common-path examples for "how much, and by when". Each is just a sentence the parser reads. */
const SPECIFICS_CHIPS: Record<QaWhat, string[]> = {
  run: ['5 km this week', '50 km this month', '100 km by December'],
  ride: ['50 km this week', '200 km this month'],
  study: ['10 hours a week', '2 hours a day', '40 hours this month'],
  gym: ['3× a week', '4× a week', '20 sessions by December'],
  steps: ['10k a day', '70k a week'],
  sleep: ['8 hours a night', '56 hours a week'],
  volume: ['10,000 lb this week', '50,000 lb this month'],
  custom: ['Every day', '3× a week', 'Once, by next month'],
};

const WHO_CHIPS: { label: string; who: QaWho }[] = [
  { label: 'Just me', who: 'solo' },
  { label: 'Friends', who: 'friend' },
  { label: 'A campfire', who: 'campfire' },
];

const WHEN_SOLO_CHIPS: { label: string; period: ChallengePeriod }[] = [
  { label: 'Every day', period: 'day' },
  { label: 'Every week', period: 'week' },
  { label: 'One target', period: 'once' },
];

const WHEN_SOCIAL_CHIPS: { label: string; hours: number }[] = [
  { label: '1 week', hours: 168 },
  { label: '2 weeks', hours: 336 },
  { label: '1 month', hours: 720 },
  { label: '3 months', hours: 2160 },
];

const WHAT_NAME: Record<QaWhat, string> = {
  study: 'Study time',
  gym: 'Gym',
  run: 'Running',
  ride: 'Riding',
  steps: 'Steps',
  sleep: 'Sleep',
  volume: 'Total weight lifted',
  custom: 'That',
};

/** Cindy's line for each open question. `a` is the state the question is being asked about. */
function questionFor(step: QaStep, a: QaAnswers, ctx: { friendCount: number; groupCount: number }): string {
  switch (step) {
    case 'what':
      return a.opponent
        ? `Let's set one up against ${a.opponent.name}. What are we challenging — study, gym, a run, or something of your own?`
        : "Let's set one up. What are we challenging — study, gym, a run, or something of your own?";
    case 'custom_name':
      return "Love it. What is it? Name it the way you'd log it — “pushups”, “guitar”, “cold plunges”.";
    case 'specifics':
      if (a.campfireKind === 'collective') {
        return a.what === 'run' || a.what === 'ride'
          ? `What's the total ${a.circle?.name ?? 'the campfire'} is pooling toward — and by when?`
          : 'What total are you all pooling toward, and by when?';
      }
      return a.what === 'run' || a.what === 'ride'
        ? 'Nice. How far, and by when?'
        : a.what === 'study'
          ? 'How many hours, and how often?'
          : a.what === 'gym'
            ? 'How often are you going?'
            : 'How much, and by when?';
    case 'who':
      return a.what === 'steps' || a.what === 'sleep'
        ? `${WHAT_NAME[a.what]} is yours to track — no race reads it yet. Just you?`
        : 'Solo, or are you racing people? If it’s a race, who’s in?';
    case 'friend':
      return ctx.friendCount === 0
        ? "You haven't added any friends yet — add some from People, or make it just you or a campfire."
        : 'Who are you taking on? It’s one-on-one.';
    case 'campfire':
      return ctx.groupCount === 0
        ? "You're not in a campfire yet. Join or start one first — or make it just you, or a friend."
        : 'Which campfire?';
    case 'campfire_kind':
      return `How does ${a.circle?.name ?? 'the campfire'} play it — everyone hits the same bar, a race for the most, or one total you all pool toward?`;
    case 'when':
      return a.who === 'solo' ? 'Every day, every week, or one target you hit once?' : 'How long does it run?';
    case 'mismatch':
      return a.what === 'volume'
        ? 'Total weight lifted is a race — it needs someone to race. Friends, or a campfire?'
        : `${WHAT_NAME[a.what ?? 'custom']} can only be your own goal for now — no race reads it yet.`;
    case 'handoff':
      return 'Grades need the course and the pass mark, and that’s a real conversation — let’s do it in my chat. I’ll take it from here.';
    case 'score':
      return '';
  }
}

/**
 * A re-ask for when a typed answer did not move the question on. `attempt` counts the misses on
 * THIS question, so a second miss acknowledges the first rather than repeating it word for word —
 * the same line twice in a row reads as a stuck loop (#5).
 */
function repromptFor(step: QaStep, a: QaAnswers, attempt: number): string {
  const pick = (lines: string[]) => lines[Math.min(attempt, lines.length - 1)];
  switch (step) {
    case 'specifics': {
      const distance = a.what === 'run' || a.what === 'ride';
      if (a.campfireKind === 'collective') {
        return pick([
          distance ? 'I need the total — “500 km by Dec 31”?' : 'I need the total you’re pooling toward — a number and a deadline.',
          distance
            ? 'Still no total — a number like “500 km”. If nobody’s pooling and it’s just most-wins, say “race” instead.'
            : 'Still no number. Try “200 hours by December” — or say “race” if it’s most-wins.',
        ]);
      }
      return pick([
        distance ? 'I didn’t catch a distance — try “20 km by December”.' : 'I didn’t catch a number — try “3× a week” or “40 hours this month”.',
        distance
          ? 'Still not seeing a distance — a number like “100 km”, or say “most wins” for a race.'
          : 'Still no number there. A count and a timeframe works: “10 hours a week”, “20 by June”.',
        'Tap one of the examples above and change it after if you like.',
      ]);
    }
    case 'who':
    case 'friend':
    case 'campfire':
      return pick([
        'Tap one above, or tell me who — a friend’s name or a campfire’s.',
        'I couldn’t match that to a friend or campfire — tap one of them above.',
      ]);
    case 'campfire_kind':
      return pick([
        'Same bar for everyone, most wins, or one shared total?',
        'Tap one above — “Everyone hits it”, “Race for the most”, or “One shared total”.',
      ]);
    case 'when':
      return pick([
        'Give me a timeframe — “2 weeks”, “by December”, “every day”.',
        'Still need a timeframe. “2 months” or “by Dec 31” both work — or tap one above.',
      ]);
    default:
      return pick(['Tell me a little more?', 'Say it another way and I’ll take another run at it.']);
  }
}

type ScoringTurn = { role: 'user' | 'assistant'; content: string };

let msgSeq = 0;
const msg = (from: Msg['from'], text: string): Msg => ({ id: `m${++msgSeq}`, from, text });

export default function CreateChallengeScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { friends } = useFriends();
  const { groups } = useMyGroups();
  const { consented } = useCindy();

  // Every caller that deep-links here still works, read as answers rather than as form state:
  //   - DM ＋, friend profile, people sheet, rematch: opponentId (+ opponentName) → Who = that friend.
  //   - A campfire's "Start a challenge" / FAB / run-again: circleId or groupId → Who = that fire;
  //     `shape` says race (placement) or together (collective) when the caller already knows.
  //   - The verdict's duel branch, for a duel Cindy scored in chat: tier + shape=duel → she has
  //     judged it already, so the only open question is the opponent.
  const params = useLocalSearchParams<{
    mode?: string;
    shape?: string;
    opponentId?: string;
    opponentName?: string;
    circleId?: string;
    groupId?: string;
    tier?: string;
    rationale?: string;
    raceMetric?: string;
    metric?: string;
    publicName?: string;
    label?: string;
    windowHours?: string;
  }>();
  const prefillCircleId = params.circleId ?? params.groupId ?? null;
  /** A duel already scored in Cindy's chat, waiting only on who. */
  const preScored = params.shape === 'duel' && isScopedTier(params.tier) ? params.tier : null;

  const [answers, setAnswers] = useState<QaAnswers>(() => {
    const a: QaAnswers = { ...EMPTY_ANSWERS };
    if (params.opponentId) {
      a.who = 'friend';
      a.opponent = { id: params.opponentId, name: params.opponentName ?? 'them' };
    } else if (prefillCircleId && params.mode !== 'h2h') {
      a.who = 'campfire';
      a.campfireKind = params.shape === 'placement' ? 'race' : params.shape === 'collective' ? 'together' : null;
    }
    return a;
  });
  // people.tsx sends a shared campfire alongside an h2h opponent: "let this campfire watch". The
  // duel create has always taken it as an optional circle; carried through to the verdict unchanged.
  const watchCircleId = params.mode === 'h2h' && prefillCircleId ? prefillCircleId : null;

  const [thread, setThread] = useState<Msg[]>(() => [
    msg(
      'cindy',
      preScored
        ? `I scored this ${preScored.charAt(0).toUpperCase()}${preScored.slice(1)}. Who are you taking on? It’s one-on-one.`
        : questionFor('what', answers, { friendCount: 1, groupCount: 1 })
    ),
  ]);
  const [mode, setMode] = useState<Mode>('asking');
  const [draft, setDraft] = useState('');
  /** The finished verdict params, kept so "See the verdict again" does not re-score. */
  const [lastVerdict, setLastVerdict] = useState<Record<string, string> | null>(null);
  /** Tierless replies in a row — after a "just score it" still comes back without one, see scoreWith. */
  const [tierlessRounds, setTierlessRounds] = useState(0);
  /** A grade ask, verbatim, for the hand-off to Cindy's chat (she scopes courses and pass marks). */
  const [gradeAsk, setGradeAsk] = useState('');
  /** Misses on the open question, so a re-ask never repeats itself word for word (#5). */
  const [misses, setMisses] = useState<{ step: QaStep; n: number }>({ step: 'what', n: 0 });
  /**
   * The scoring exchange, kept HERE rather than in her chat (#9): the scoring turn is transient on
   * the server, so a follow-up question she asks is answered with this as its only context.
   */
  const [scoringThread, setScoringThread] = useState<ScoringTurn[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  // ── THE STRAY COACH MARK (punchlist #10) ──
  //
  // This screen used to anchor `challenge_create` ("Describe any goal — I'll scope it…") on its
  // Ask-Cindy card. The whole screen IS that sentence now, so the tip has nothing left to point at —
  // and a mark raised by the old anchor could outlive the screen as an overlay on whatever came
  // next. It is no longer anchored here, it is marked seen so it can never queue elsewhere, and any
  // copy of it still up is taken down on the way out.
  useEffect(() => {
    void markCoachMarkSeen('challenge_create');
  }, []);
  useFocusEffect(
    useCallback(() => {
      dismissCoachMark('challenge_create');
      return () => dismissCoachMark('challenge_create');
    }, [])
  );

  const ctx = { friendCount: friends.length, groupCount: groups.length };
  const step: QaStep = preScored ? 'friend' : nextStep(answers);

  const say = (...lines: Msg[]) => setThread((prev) => [...prev, ...lines]);

  /** A campfire answer is only taken from someone who can host there; anyone else hears why. */
  function circleAnswer(id: string): { ok: true; circle: NonNullable<QaAnswers['circle']> } | { ok: false; why: string } {
    const g = groups.find((x) => x.id === id);
    if (!g) return { ok: false, why: "I can't find that campfire." };
    const isAdmin = g.role === 'owner' || g.role === 'admin';
    // 🔒 A COURTESY, NOT THE ENFORCEMENT. create_placement_challenge, create_group_challenge and
    // host_campfire_challenge all re-read the role from group_members at write time (0126/0162).
    // Saying it here, before anything is scored, is the difference between a next step and a
    // refusal at the last tap.
    if (!isAdmin) {
      return {
        ok: false,
        why: `Only admins can set a challenge for ${g.name}. Ask an owner to make you one — or race a friend instead.`,
      };
    }
    return { ok: true, circle: { id: g.id, name: g.name, isAdmin } };
  }

  /** Fill what a caller handed us but could not resolve at mount — the campfire list loads later. */
  function withPrefill(a: QaAnswers): QaAnswers {
    if (a.who === 'campfire' && !a.circle && prefillCircleId && !watchCircleId) {
      const c = circleAnswer(prefillCircleId);
      if (c.ok) return { ...a, circle: c.circle };
    }
    return a;
  }

  /** Move on from `a`: ask the next open question, or — when none is left — score it. */
  function proceed(a: QaAnswers, lead: string[] = []) {
    const next = withPrefill(a);
    setAnswers(next);
    const s = nextStep(next);
    if (s === 'score') {
      if (lead.length) say(...lead.map((l) => msg('cindy', l)));
      void startScoring(next);
      return;
    }
    say(...[...lead, questionFor(s, next, ctx)].map((l) => msg('cindy', l)));
  }

  /** Apply one answer: show it as the user's bubble, merge it, move on. */
  function answer(said: string, patch: Partial<QaAnswers>, lead: string[] = []) {
    say(msg('me', said));
    proceed({ ...answers, ...patch }, lead);
  }

  // ─────────────────────────── typed (or chip-as-sentence) answers ───────────────────────────

  /**
   * One typed answer, read. The regex is the fast path — chips are sentences it was written for, and
   * a short answer that cleanly moves the question on needs nothing more. Anything longer, or
   * anything the regex could not place, also goes to Cindy, whose structured reading WINS field by
   * field (#8 / the durable fix): "most distance by end of semester" and "500 km cumulatively, pay
   * the top contributor" are sentences, not patterns. Her failure of any kind leaves the regex's
   * reading standing, so this can only improve an answer.
   */
  async function read(text: string, step: QaStep): Promise<QaParse> {
    const p = parseQa(text, new Date(), { step });
    if (!consented) return p;
    const words = text.trim().split(/\s+/).length;
    const regexMoved = nextStep({ ...answers, ...pickAnswers(p) }) !== step;
    if (words <= 3 && regexMoved) return p;
    setMode('reading');
    const goal = await extractChallenge(text, {
      step,
      today: new Date().toISOString().slice(0, 10),
      known: {
        what: answers.what,
        custom_name: answers.customName,
        target: answers.target,
        unit: answers.unit,
        who: answers.who,
        campfire_kind: answers.campfireKind,
      },
    });
    setMode('asking');
    if (!goal) return p;
    const e = parseFromExtracted(goal);
    const out: QaParse = { ...p };
    for (const [k, v] of Object.entries(e)) {
      if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
    }
    return out;
  }

  async function submitText(raw: string) {
    const text = raw.trim();
    if (!text) return;
    setDraft('');

    if (mode === 'followup' || mode === 'retry') {
      // Cindy asked something; this is the reply to HER. Anything concrete in it (a new number, a
      // new deadline, a different shape) is folded into the answers too, so the terms the verdict
      // creates are the terms the user just gave rather than the ones from before her question.
      say(msg('me', text));
      const p = parseQa(text);
      const merged: QaAnswers = {
        ...answers,
        ...(p.target != null ? { target: p.target, unit: p.unit ?? answers.unit } : {}),
        ...(p.cadence ? { cadence: p.cadence } : {}),
        ...(p.deadline ? { deadline: p.deadline, windowHours: null } : {}),
        ...(p.windowHours ? { windowHours: p.windowHours, deadline: null } : {}),
        ...(answers.who === 'campfire' && p.campfireKind
          ? { campfireKind: p.campfireKind, contributorReward: !!p.contributorReward }
          : {}),
      };
      setAnswers(merged);
      void scoreWith(merged, text, scoringThread);
      return;
    }
    if (mode !== 'asking') return;

    say(msg('me', text));
    const p = await read(text, step);
    const a: QaAnswers = { ...answers };
    const lead: string[] = [];

    if (p.grade) {
      setAnswers({ ...a, grade: true });
      setGradeAsk(text);
      say(msg('cindy', questionFor('handoff', a, ctx)));
      return;
    }

    // Names first, so "race Sam" or "for Goat" is a who, and the name never ends up in a goal title.
    const friend = findNamed(text, friends, (f) => f.display_name);
    const group = findNamed(text, groups, (g) => g.name);
    let stripped = text;
    if (friend) {
      stripped = stripped.replace(new RegExp(`\\b(with|against|vs\\.?|versus|race|racing)?\\s*${escapeRe(friend.display_name.split(' ')[0])}\\b`, 'i'), '');
    }
    if (group) stripped = stripped.replace(new RegExp(`\\b(for|in|with)?\\s*${escapeRe(group.name.replace(/[^\w ]/g, '').trim())}`, 'i'), '');

    // what
    if (!a.what || step === 'what') {
      if (p.what) {
        a.what = p.what;
        if (p.customName) a.customName = p.customName;
      } else if (step === 'what') {
        // Nothing a chip names — so it IS the custom goal, named in the user's own words.
        a.what = 'custom';
        a.customName = customNameFrom(stripped) || null;
      }
    }
    if (step === 'custom_name') a.customName = p.customName ?? (customNameFrom(stripped) || null);

    // how much / when
    if (p.target != null && (a.target == null || step === 'specifics')) {
      a.target = p.target;
      a.unit = p.unit ?? a.unit;
    }
    if (p.cadence) a.cadence = p.cadence;
    if (p.deadline) {
      a.deadline = p.deadline;
      a.windowHours = null;
    } else if (p.windowHours) {
      a.windowHours = p.windowHours;
      a.deadline = null;
    }
    // A custom habit with no number ("Duolingo every day", "learn a backflip by March") is one of
    // it per period, or one in total — a target of 1 is what the user meant.
    if (a.what === 'custom' && a.target == null && (a.cadence || a.deadline || a.windowHours) && step !== 'what') {
      a.target = 1;
    }
    if (a.what === 'custom' && a.target == null && step === 'what' && (p.cadence || p.deadline || p.windowHours)) {
      a.target = 1;
    }

    // who
    if (friend && (!a.who || a.who === 'friend' || step === 'who' || step === 'friend')) {
      a.who = 'friend';
      a.opponent = { id: friend.friend_id, name: friend.display_name };
    } else if (group && (!a.who || a.who === 'campfire' || step === 'who' || step === 'campfire')) {
      const c = circleAnswer(group.id);
      a.who = 'campfire';
      if (c.ok) a.circle = c.circle;
      else lead.push(c.why);
    } else if (p.who && (!a.who || step === 'who')) {
      a.who = p.who;
    }
    if (p.campfireKind && (!a.campfireKind || step === 'campfire_kind')) {
      a.campfireKind = p.campfireKind;
      a.contributorReward = p.campfireKind === 'collective' && !!p.contributorReward;
    }

    if (preScored) {
      if (a.opponent) finishPreScored(a.opponent);
      else say(msg('cindy', repromptFor('friend', a, 0)));
      return;
    }

    // Did the question actually move? If not, Cindy re-asks rather than pretending it did.
    const before = nextStep(withPrefill(answers));
    const after = nextStep(withPrefill(a));
    const changed = JSON.stringify(a) !== JSON.stringify(answers);
    if (!changed || (after === before && lead.length === 0 && step !== 'what' && step !== 'custom_name')) {
      if (changed) setAnswers(a);
      const n = misses.step === step ? misses.n : 0;
      setMisses({ step, n: n + 1 });
      say(msg('cindy', lead[0] ?? repromptFor(step, a, n)));
      return;
    }
    setMisses({ step: after, n: 0 });
    proceed(a, lead);
  }

  // ─────────────────────────── scoring ───────────────────────────

  async function startScoring(a: QaAnswers) {
    // A personal goal that would read the same source as one already running is refused by 0148's
    // trigger. Asked first so it is a sentence from Cindy, not a failed "Lock it in".
    if (a.who === 'solo' && session) {
      const route = verdictRouteFor(a);
      const clash = await findDuplicateActiveGoal({
        userId: session.user.id,
        type: route.params.goalType as ChallengeType,
        period: route.params.period as ChallengePeriod,
        label: route.params.goalType === 'custom' ? route.params.label : null,
      });
      if (clash) {
        setMode('duplicate');
        say(msg('cindy', duplicateGoalMessage(clash)));
        return;
      }
    }
    if (!consented) {
      setMode('consent');
      say(msg('cindy', 'Scoring it needs me switched on — one tap, and you can turn me off any time.'));
      return;
    }
    const route = verdictRouteFor(a);
    // #10 — no "Got it — … Scoring it now…" ticker between the last answer and the verdict: the
    // spinner says it, and the verdict says the rest. A note is a real caveat ("I'll set this as
    // 120 total"), so that one still shows.
    if (route.note) say(msg('cindy', route.note));
    await scoreWith(a, scoringPrompt(a, route), []);
  }

  /** `history` is this scoring exchange so far — passed in, so a call never reads a stale copy. */
  async function scoreWith(a: QaAnswers, message: string, history: ScoringTurn[]) {
    setMode('scoring');
    try {
      // #9 — transient: never written to her chat, so the internal prompt (with its campfire id)
      // cannot surface there later. This exchange is her whole context, carried by the client.
      const reply = await sendToCindy(message, { persist: false, history });
      setScoringThread(
        [
          ...history,
          { role: 'user' as const, content: message },
          { role: 'assistant' as const, content: reply.text || '(proposed it)' },
        ].slice(-8)
      );
      const verdict = verdictFrom(reply);
      // #10 — when she scored it, straight to the verdict; her reasoning is ON the verdict screen.
      // Only a question (no verdict) is said in the thread, because the user has to answer it.
      if (!verdict && reply.text.trim()) say(msg('cindy', reply.text.trim()));
      if (verdict) {
        setTierlessRounds(0);
        openVerdict(a, verdict);
        return;
      }
      // She asked something instead of scoring — that is her call (a vague goal is not scored, a
      // lift needs a bodyweight). The user answers her in the thread. One floor, though: if a
      // "just score it" still comes back without a tier, the challenge starts at the floor the
      // server gives every unscoped challenge rather than looping forever.
      if (tierlessRounds >= 1 && message === JUST_SCORE_IT) {
        setTierlessRounds(0);
        say(msg('cindy', "I'll start it at Uncommon — the floor every challenge gets. You can always ask me to re-judge it."));
        openVerdict(a, { tier: 'uncommon', rationale: '', tool: '' });
        return;
      }
      setTierlessRounds((n) => n + 1);
      if (!reply.text.trim()) say(msg('cindy', 'Tell me a little more and I’ll score it.'));
      setMode('followup');
    } catch (e) {
      if (e instanceof CoachError && e.code === 'not_consented') {
        setMode('consent');
        say(msg('cindy', 'Scoring it needs me switched on — one tap, and you can turn me off any time.'));
        return;
      }
      setMode('retry');
      say(msg('cindy', e instanceof CoachError ? e.message : 'I couldn’t reach the scoring just now.'));
    }
  }

  function openVerdict(a: QaAnswers, v: { tier: DifficultyTier; rationale: string; tool: string }) {
    const route = verdictRouteFor(a);
    const verdictParams: Record<string, string> = {
      ...route.params,
      tier: v.tier,
      rationale: v.rationale,
      ...(route.params.branch === 'duel' && watchCircleId ? { watchCircleId } : {}),
    };
    setLastVerdict(verdictParams);
    setMode('done');
    router.push({ pathname: '/challenge/verdict', params: verdictParams });
  }

  /** The chat-scored duel: Cindy's tier and terms stand; only the opponent was missing. */
  function finishPreScored(opponent: { id: string; name: string }) {
    router.replace({
      pathname: '/challenge/verdict',
      params: {
        branch: 'duel',
        tier: preScored ?? 'uncommon',
        rationale: params.rationale ?? '',
        label: params.publicName ?? params.label ?? 'Challenge',
        metric: params.raceMetric ?? params.metric ?? 'lockin_time',
        windowHours: params.windowHours ?? '168',
        opponentId: opponent.id,
        opponentName: opponent.name,
      },
    });
  }

  function startOver() {
    const fresh: QaAnswers = { ...EMPTY_ANSWERS };
    setAnswers(fresh);
    setMode('asking');
    setLastVerdict(null);
    setTierlessRounds(0);
    say(msg('cindy', questionFor('what', fresh, ctx)));
  }

  // ─────────────────────────── chips for the open question ───────────────────────────

  type Chip = { key: string; label: string; onPress: () => void; selected?: boolean };
  const chips: Chip[] = (() => {
    if (mode === 'scoring' || mode === 'reading') return [];
    if (mode === 'consent') {
      return [
        { key: 'on', label: 'Turn Cindy on', onPress: () => router.push('/cindy') },
        { key: 'go', label: "She's on — score it", onPress: () => { setMode('asking'); void startScoring(answers); } },
      ];
    }
    if (mode === 'retry') return [{ key: 'again', label: 'Try again', onPress: () => { setMode('asking'); void startScoring(answers); } }];
    if (mode === 'followup') return [{ key: 'just', label: 'Just score it', onPress: () => { say(msg('me', 'Just score it')); void scoreWith(answers, JUST_SCORE_IT, scoringThread); } }];
    if (mode === 'duplicate') {
      return [
        { key: 'change', label: 'Change the goal', onPress: () => { setMode('asking'); proceed({ ...answers, what: null, customName: null, target: null, unit: null, cadence: null }); } },
        { key: 'over', label: 'Start over', onPress: startOver },
      ];
    }
    if (mode === 'done') {
      return [
        ...(lastVerdict ? [{ key: 'again', label: 'See the verdict again', onPress: () => router.push({ pathname: '/challenge/verdict', params: lastVerdict }) }] : []),
        { key: 'who', label: 'Change who’s in', onPress: () => { setMode('asking'); proceed({ ...answers, who: null, opponent: null, circle: null, campfireKind: null }); } },
        { key: 'over', label: 'Start over', onPress: startOver },
      ];
    }

    switch (step) {
      case 'what':
        return WHAT_CHIPS.map((c) => ({
          key: c.what,
          label: c.label,
          onPress: () => answer(c.label, { what: c.what, customName: c.what === 'custom' ? null : answers.customName }),
        }));
      case 'custom_name':
        return [];
      case 'specifics':
        return (SPECIFICS_CHIPS[answers.what ?? 'custom'] ?? []).map((s) => ({ key: s, label: s, onPress: () => submitText(s) }));
      case 'who':
        return WHO_CHIPS.filter((c) => whoFits(answers.what, c.who)).map((c) => ({
          key: c.who,
          label: c.label,
          selected: answers.who === c.who,
          onPress: () => answer(c.label, { who: c.who, opponent: null, circle: null }),
        }));
      case 'friend':
        if (friends.length === 0) {
          return WHO_CHIPS.filter((c) => c.who !== 'friend' && whoFits(answers.what, c.who)).map((c) => ({
            key: c.who,
            label: c.label,
            onPress: () => answer(c.label, { who: c.who }),
          }));
        }
        return friends.slice(0, 24).map((f) => ({
          key: f.friend_id,
          label: f.display_name,
          onPress: () => {
            const opponent = { id: f.friend_id, name: f.display_name };
            if (preScored) {
              say(msg('me', f.display_name));
              finishPreScored(opponent);
              return;
            }
            answer(f.display_name, { opponent });
          },
        }));
      case 'campfire':
        if (groups.length === 0) {
          return WHO_CHIPS.filter((c) => c.who !== 'campfire' && whoFits(answers.what, c.who)).map((c) => ({
            key: c.who,
            label: c.label,
            onPress: () => answer(c.label, { who: c.who }),
          }));
        }
        return groups.map((g) => ({
          key: g.id,
          label: `${g.emoji ?? ''} ${g.name}`.trim(),
          onPress: () => {
            const c = circleAnswer(g.id);
            if (c.ok) answer(g.name, { circle: c.circle });
            else say(msg('me', g.name), msg('cindy', c.why));
          },
        }));
      case 'campfire_kind':
        return [
          { key: 'together', label: 'Everyone hits it', onPress: () => answer('Everyone hits it', { campfireKind: 'together', contributorReward: false }) },
          { key: 'race', label: 'Race for the most', onPress: () => answer('Race for the most', { campfireKind: 'race', contributorReward: false }) },
          { key: 'pool', label: 'One shared total', onPress: () => answer('One shared total', { campfireKind: 'collective', contributorReward: false }) },
          {
            key: 'pool-top',
            label: 'Shared total · top contributor wins',
            onPress: () => answer('Shared total — top contributor wins', { campfireKind: 'collective', contributorReward: true }),
          },
          // 0173's team match is its own room — two named teams, a scorekeeper — so this LEAVES
          // rather than becoming an answer (the old form's Team tile, same door).
          {
            key: 'team',
            label: 'Two teams ⚽',
            onPress: () => router.push({ pathname: '/challenge/team-match', params: answers.circle ? { circleId: answers.circle.id } : {} }),
          },
        ];
      case 'when':
        return answers.who === 'solo'
          ? WHEN_SOLO_CHIPS.map((c) => ({ key: c.period, label: c.label, onPress: () => answer(c.label, { cadence: c.period }) }))
          : WHEN_SOCIAL_CHIPS.map((c) => ({
              key: c.label,
              label: c.label,
              onPress: () => answer(c.label, { windowHours: c.hours, deadline: null }),
            }));
      case 'mismatch':
        return [
          ...WHO_CHIPS.filter((c) => whoFits(answers.what, c.who)).map((c) => ({
            key: c.who,
            label: c.who === 'solo' ? 'Make it just me' : c.label,
            onPress: () => answer(c.label, { who: c.who, opponent: null, circle: null }),
          })),
          { key: 'other', label: 'Pick something else', onPress: () => answer('Pick something else', { what: null, customName: null, target: null, unit: null }) },
        ];
      case 'handoff':
        return [
          {
            key: 'cindy',
            label: 'Open Cindy',
            onPress: () => router.replace({ pathname: '/cindy', params: { ask: gradeAsk || 'Help me set up a grade goal. I want ' } }),
          },
          { key: 'over', label: 'Something else', onPress: startOver },
        ];
      default:
        return [];
    }
  })();

  const placeholder =
    mode === 'followup' || mode === 'retry'
      ? 'Answer Cindy…'
      : step === 'custom_name'
        ? 'Name it…'
        : 'Pick above, or just tell me…';
  const inputLocked = mode === 'scoring' || mode === 'reading' || mode === 'done' || mode === 'consent' || mode === 'duplicate' || step === 'handoff';
  const progress = mode === 'done' ? 1 : progressOf(answers);

  return (
    // Its own `‹ New challenge` row (BackHeader) — headerless in _layout.tsx, so no native
    // liquid-glass pill. <Screen> brings the radial ground and the keyboard avoidance.
    <Screen padded={false}>
      <BackHeader title="New challenge" />
      <View style={styles.progressTrack}>
        <EmberFill radius={2} style={[styles.progressFill, { width: `${Math.max(6, Math.round(progress * 100))}%` as `${number}%` }]}>
          <View />
        </EmberFill>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        {thread.map((m, i) =>
          m.from === 'cindy' ? (
            <CindyLine key={m.id} text={m.text} current={i === thread.length - 1 && mode !== 'scoring'} />
          ) : (
            <View key={m.id} style={styles.ans}>
              <Text style={styles.ansText}>{m.text}</Text>
            </View>
          )
        )}

        {mode === 'scoring' || mode === 'reading' ? (
          <View style={styles.thinking}>
            <ActivityIndicator size="small" color={Colors.amber} />
            <Text style={styles.thinkingText}>{mode === 'reading' ? 'Cindy’s reading that…' : 'Cindy’s scoring it…'}</Text>
          </View>
        ) : null}

        {chips.length > 0 ? (
          <View style={styles.chips}>
            {chips.map((c) => (
              <Pressable
                key={c.key}
                onPress={c.onPress}
                style={({ pressed }) => [styles.chip, (c.selected || pressed) && styles.chipSel]}
                accessibilityRole="button">
                <Text style={[styles.chipText, c.selected && styles.chipTextSel]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.foot}>
        <Text style={styles.hint}>
          Cindy <Text style={styles.hintStrong}>scores the tier &amp; stakes the reward</Text> — you never set the payout.
        </Text>
        <View style={styles.inRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            style={styles.input}
            editable={!inputLocked}
            returnKeyType="send"
            onSubmitEditing={() => submitText(draft)}
            accessibilityLabel="Answer Cindy"
          />
          <Pressable
            onPress={() => submitText(draft)}
            disabled={inputLocked || !draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={styles.sendPress}>
            {inputLocked || !draft.trim() ? (
              <View style={[styles.send, styles.sendOff]}>
                <Ionicons name="arrow-up" size={19} color={Colors.disabledText} />
              </View>
            ) : (
              <EmberFill radius={20} style={styles.send}>
                <Ionicons name="arrow-up" size={19} color={Colors.onEmber} />
              </EmberFill>
            )}
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

/** What "Just score it" sends — named so the tierless floor in scoreWith can recognise it. */
const JUST_SCORE_IT = 'Score it exactly as described — pick the tier you would judge it at.';

/** A parse as the answer fields it would set — for asking "would this move the question on?". */
function pickAnswers(p: QaParse): Partial<QaAnswers> {
  const out: Partial<QaAnswers> = {};
  if (p.what) out.what = p.what;
  if (p.customName) out.customName = p.customName;
  if (p.target != null) out.target = p.target;
  if (p.cadence) out.cadence = p.cadence;
  if (p.deadline) out.deadline = p.deadline;
  if (p.windowHours) out.windowHours = p.windowHours;
  if (p.who) out.who = p.who;
  if (p.campfireKind) out.campfireKind = p.campfireKind;
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One Cindy bubble, flame beside it. The open question gets the ember border (mock 265's `.now`). */
function CindyLine({ text, current }: { text: string; current: boolean }) {
  return (
    <View style={styles.cq}>
      <View style={styles.flame}>
        <EquippedFlameSvg width={16} height={20} />
      </View>
      <View style={[styles.qb, current && styles.qbNow]}>
        <Text style={styles.qbText}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  progressTrack: {
    height: 3,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  progressFill: { height: 3 },

  thread: { paddingHorizontal: Spacing.three + 2, paddingTop: Spacing.one, paddingBottom: Spacing.four, gap: Spacing.twelve },
  cq: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  flame: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.plum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qb: {
    maxWidth: '82%',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: Spacing.twelve,
  },
  qbNow: { borderColor: Colors.emberForward },
  qbText: { fontFamily: Fonts.body, fontSize: 13.5, lineHeight: 18.5, color: Colors.ink },

  ans: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
    backgroundColor: Colors.amber,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 4,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  ansText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.onEmber },

  thinking: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingLeft: 39 },
  thinkingText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textTertiary },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingLeft: 39 },
  chip: {
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  chipSel: { backgroundColor: 'rgba(255,140,66,0.16)', borderColor: Colors.emberForward },
  chipText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.soloChipText },
  chipTextSel: { color: Colors.ink },

  foot: { paddingHorizontal: Spacing.three + 2, paddingTop: Spacing.two, paddingBottom: Spacing.three },
  hint: { fontFamily: Fonts.body, fontSize: 10.5, color: Colors.textTertiary, textAlign: 'center', marginBottom: Spacing.two },
  hintStrong: { fontFamily: Fonts.bodyBold, color: Colors.ember },
  inRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  input: { flex: 1, borderRadius: Radius.pill, paddingVertical: 10 },
  sendPress: { width: 40, height: 40 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: Colors.disabledSurface },
});
