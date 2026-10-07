// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE NEW-CHALLENGE Q&A — the pure half of challenge/create.tsx (mock 265).
//
// Cindy asks what, how much / by when, and who; the user taps a chip or types a sentence. This file
// is everything about that conversation that is not a component: reading a typed sentence into
// answers, deciding which question is still open, and turning the finished answers into the params
// challenge/verdict.tsx already takes.
//
// 🔒 NOTHING HERE PRICES ANYTHING. There is no tier, no XP and no ember figure in this file. The
// tier comes from Cindy (the coach's SCOPING_RULES), and what it pays comes from the server on the
// verdict screen (previewScopedReward). This file only decides WHICH create the verdict's "Lock it
// in" runs, and with what terms — the same createChallenge / createH2HChallenge /
// createGroupChallenge / createPlacementChallenge / hostCampfireChallenge every path already uses.
//
// The parser is deliberately simple. It fills what it can read with confidence and leaves the rest
// for Cindy to ask; a wrong guess here becomes the terms of a real challenge, so a regex that is
// unsure answers nothing.
// ══════════════════════════════════════════════════════════════════════════════════════════════

import type { ChallengeCountMode, ChallengePeriod, ChallengeType, SocialChallengeRaceMetric } from '@/types/database';

/** What is being challenged. The four chips, plus what a sentence can name that a chip does not. */
export type QaWhat = 'study' | 'gym' | 'run' | 'ride' | 'steps' | 'sleep' | 'volume' | 'custom';
export type QaCadence = 'day' | 'week' | 'once';
export type QaWho = 'solo' | 'friend' | 'campfire';
/** A campfire either clears one bar together, or is ranked on who did the most. */
export type QaCampfireKind = 'together' | 'race';

/** Everything one typed sentence can contribute. Every field is optional: absent = not said. */
export type QaParse = {
  what?: QaWhat;
  /** A custom goal's own noun — "pushups", "backflip". */
  customName?: string;
  /** In the unit the user said it in (km, hours, sessions, lb, or the custom noun). */
  target?: number;
  unit?: string;
  cadence?: QaCadence;
  /** "by December" → the last moment of December. */
  deadline?: Date;
  /** "for 2 weeks" → an explicit run length, when no end date was named. */
  windowHours?: number;
  who?: QaWho;
  campfireKind?: QaCampfireKind;
  /** A grade, a mark, a percentage — the one ask this screen hands to Cindy's own chat. */
  grade?: boolean;
};

const HOUR = 3_600_000;
const DAY_HOURS = 24;
const WEEK_HOURS = 168;
/** challenge-span-picker's MAX_SPAN_DAYS, in hours — the server refuses anything longer. */
export const MAX_WINDOW_HOURS = 366 * DAY_HOURS;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Words that follow a number but are not the thing being counted. */
const NOT_A_NOUN = new Set([
  'a', 'an', 'the', 'by', 'in', 'per', 'each', 'every', 'times', 'time', 'x', 'of', 'to', 'for', 'and',
  'day', 'days', 'week', 'weeks', 'wk', 'wks', 'month', 'months', 'year', 'years', 'more', 'or', 'at',
  'through', 'until', 'till', 'before', 'this', 'next', 'total', 'straight', 'in-a-row',
]);

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 0, 0);
  return out;
}

/** The last moment of the named month — this year's if it is still ahead (or current), else next. */
function endOfMonth(monthIndex: number, now: Date): Date {
  const year = monthIndex < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear();
  return endOfDay(new Date(year, monthIndex + 1, 0));
}

function parseDeadline(t: string, now: Date): { deadline?: Date; windowHours?: number } {
  // "by / through / until / end of December"
  const month = t.match(
    /\b(?:by|through|thru|until|till|before|end of|in|during)\s+(?:the end of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/
  );
  if (month) return { deadline: endOfMonth(MONTHS.indexOf(month[1].slice(0, 3)), now) };

  if (/\b(?:by|before)?\s*the end of the year\b|\bthis year\b/.test(t)) {
    return { deadline: endOfDay(new Date(now.getFullYear(), 11, 31)) };
  }
  if (/\bthis month\b|\bend of the month\b/.test(t)) {
    return { deadline: endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  }
  if (/\bthis week\b|\bby sunday\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    return { deadline: endOfDay(d) };
  }
  if (/\btoday\b|\btonight\b/.test(t)) return { deadline: endOfDay(now) };
  if (/\btomorrow\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { deadline: endOfDay(d) };
  }

  // "in 3 weeks", "for 10 days", "over 2 months", "next 4 weeks"
  const span = t.match(/\b(?:in|for|over|within|next)\s+(?:the next\s+)?(\d+|a|an|one|two|three|four|six)\s+(day|week|month)s?\b/);
  if (span) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, six: 6 };
    const n = words[span[1]] ?? Number(span[1]);
    const unitHours = span[2] === 'day' ? DAY_HOURS : span[2] === 'week' ? WEEK_HOURS : 30 * DAY_HOURS;
    if (n > 0) return { windowHours: n * unitHours };
  }
  return {};
}

function parseNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

/**
 * Read one sentence. `now` is a parameter so a deadline resolves against the same clock the window
 * is later measured from.
 */
export function parseQa(input: string, now: Date = new Date()): QaParse {
  const t = ` ${input.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim()} `;
  const out: QaParse = {};

  // ── grade ── a mark has a course and a pass line, and Cindy's chat already scopes both.
  if (/\b(grade|gpa|marks?|exam|midterm|final exam|test score)\b|\d\s*%/.test(t)) out.grade = true;

  // ── what ──
  const distance = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(km|kms|kilomet\w*|k|mi|miles?)\b/);
  if (/\bsteps?\b/.test(t)) out.what = 'steps';
  else if (/\bsleep/.test(t)) out.what = 'sleep';
  else if (/\b(ride|riding|rode|cycl\w*|bike|biking)\b/.test(t)) out.what = 'ride';
  else if (/\b(volume|lbs?|pounds|kgs?)\b/.test(t) && /\b(lift|lifted|lifting|volume|total)\b/.test(t)) out.what = 'volume';
  else if (
    /\b(run|runs|running|ran|jog\w*|marathon|5k|10k|half|km|kms|kilomet\w*|miles)\b/.test(t) ||
    (distance && distance[2] !== 'k')
  )
    out.what = 'run';
  else if (/\b(study|studying|studied|revision|revise|revising|homework|readings?)\b/.test(t)) out.what = 'study';
  else if (/\b(gym|workouts?|work out|lifting|training|train)\b/.test(t)) out.what = 'gym';

  // ── the number ──
  const perPeriod = t.match(/(\d+)\s*(?:x|×|times|sessions?|visits?|workouts?|days?)\s*(?:a|per|each|every|\/)\s*(week|wk|day)\b/);
  if (perPeriod) {
    out.target = Number(perPeriod[1]);
    out.cadence = perPeriod[2] === 'day' ? 'day' : 'week';
    out.unit = 'sessions';
  }

  if (out.target == null && (out.what === 'run' || out.what === 'ride') && distance) {
    // "5k" on a run is five kilometres, not five thousand.
    const n = parseNumber(distance[1]);
    out.target = /^mi/.test(distance[2]) ? Math.round(n * 1.609 * 10) / 10 : n;
    out.unit = 'km';
  }
  if (out.target == null && /\b(?:a\s+)?(half marathon)\b/.test(t)) {
    out.target = 21.1;
    out.unit = 'km';
  } else if (out.target == null && /\bmarathon\b/.test(t)) {
    out.target = 42.2;
    out.unit = 'km';
  }

  const hours = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(h|hrs?|hours?)\b/);
  const minutes = t.match(/(\d[\d,]*)\s*(min|mins|minutes)\b/);
  if (out.target == null && hours) {
    out.target = parseNumber(hours[1]);
    out.unit = 'hours';
  } else if (out.target == null && minutes) {
    out.target = Math.round((parseNumber(minutes[1]) / 60) * 100) / 100;
    out.unit = 'hours';
  }

  if (out.target == null) {
    // "1000 pushups", "10k steps", "20,000 lb"
    const counted = [...t.matchAll(/(\d[\d,]*(?:\.\d+)?)(k)?\s+([a-z][a-z-]*)/g)].find((m) => !NOT_A_NOUN.has(m[3]));
    if (counted) {
      out.target = parseNumber(counted[1]) * (counted[2] ? 1000 : 1);
      out.unit = counted[3];
      if (!out.what) {
        out.what = 'custom';
        out.customName = counted[3];
      }
    } else {
      // A number that is a duration ("for 2 weeks") is the timeframe, not the target.
      const bare = [...t.matchAll(/(\d[\d,]*(?:\.\d+)?)(k)?\b(\s*(?:days?|weeks?|months?|years?)\b)?/g)].find((m) => !m[3]);
      if (bare) out.target = parseNumber(bare[1]) * (bare[2] ? 1000 : 1);
    }
  }
  if (out.target != null && !(out.target > 0)) delete out.target;

  // "2 hours of guitar", "30 minutes on Spanish" — time spent on something no chip names. Counted in
  // lock-in time against that name (0061), so the name is what matters.
  if (!out.what && out.unit === 'hours') {
    const of = t.match(/\b(?:hours?|hrs?|mins?|minutes)\s+(?:of|on|practi[cs]ing|doing|playing)\s+([a-z][a-z-]*(?: [a-z][a-z-]*)?)/);
    const name = of?.[1].split(' ').filter((w) => !NOT_A_NOUN.has(w) && !/^(every|daily|weekly)$/.test(w)).join(' ');
    if (name) {
      out.what = 'custom';
      out.customName = name;
    }
  }

  // ── cadence ──
  if (!out.cadence) {
    if (/\b(every ?day|daily|a day|per day|each day|a night|every night|nightly)\b/.test(t)) out.cadence = 'day';
    else if (/\b(a week|per week|weekly|each week|every week|\/ ?wk)\b/.test(t)) out.cadence = 'week';
    else if (/\b(in total|total|once|one time|one-time|overall)\b/.test(t)) out.cadence = 'once';
  }

  Object.assign(out, parseDeadline(t, now));

  // ── who ──
  if (/\b(just me|myself|solo|alone|on my own|by myself|personal)\b/.test(t)) out.who = 'solo';
  else if (/\b(campfire|my fire|the fire|group|crew|squad|the house|everyone|all of us|we all)\b/.test(t)) out.who = 'campfire';
  else if (/\b(friends?|vs\.?|versus|against|duel|head to head|1v1)\b/.test(t)) out.who = 'friend';

  if (/\b(most|ranked|leaderboard|who (?:can|gets|does)|winner|first to|race)\b/.test(t)) out.campfireKind = 'race';
  else if (/\b(everyone|all of us|we all|together|same (?:goal|target|bar))\b/.test(t)) out.campfireKind = 'together';

  return out;
}

/**
 * A custom goal's name from a sentence no chip matched — "learn a backflip by March" → "learn a
 * backflip". The timeframe and the who are stripped because they are answers to OTHER questions,
 * and a goal named "backflip by march with Sam" would carry them forever.
 */
export function customNameFrom(input: string): string {
  return input
    .replace(
      /\b(by|through|thru|until|till|before|in|for|over|within|during|this|next|every|each|per|a|with|against|vs\.?)\s+(the\s+)?(end of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|today|tomorrow|tonight|week|month|year|day|\d+\s+(days?|weeks?|months?)|my\b.*|the campfire\b.*|friends?\b.*)[a-z]*\b/gi,
      ''
    )
    .replace(/\b(i want to|i wanna|i'd like to|help me|can you|just me|myself|solo)\b/gi, '')
    // "3x" belongs to the target, which the next question collects.
    .replace(/\b\d+\s*(x|×|times)(?=\s|$)/gi, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/** A name's tokens for loose matching — "Goat 🐐" matches "goat". */
function nameTokens(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The one entry in `list` the sentence names, or null. Matched on the whole name first, then on
 * the first word (a friend called "Sam Lee" is "Sam" in a sentence) — and ONLY when exactly one
 * entry matches: two Sams is a question for the chips, not a coin flip.
 */
export function findNamed<T>(text: string, list: T[], nameOf: (item: T) => string): T | null {
  const t = ` ${nameTokens(text)} `;
  const whole = list.filter((item) => {
    const n = nameTokens(nameOf(item));
    return n.length >= 2 && t.includes(` ${n} `);
  });
  if (whole.length === 1) return whole[0];
  if (whole.length > 1) return null;
  const first = list.filter((item) => {
    const n = nameTokens(nameOf(item)).split(' ')[0] ?? '';
    return n.length >= 3 && t.includes(` ${n} `);
  });
  return first.length === 1 ? first[0] : null;
}

// ─────────────────────────────── the answers, and what is still open ───────────────────────────────

export type QaAnswers = {
  what: QaWhat | null;
  customName: string | null;
  target: number | null;
  unit: string | null;
  cadence: QaCadence | null;
  deadline: Date | null;
  windowHours: number | null;
  who: QaWho | null;
  opponent: { id: string; name: string } | null;
  circle: { id: string; name: string; isAdmin: boolean } | null;
  campfireKind: QaCampfireKind | null;
  grade: boolean;
};

export const EMPTY_ANSWERS: QaAnswers = {
  what: null,
  customName: null,
  target: null,
  unit: null,
  cadence: null,
  deadline: null,
  windowHours: null,
  who: null,
  opponent: null,
  circle: null,
  campfireKind: null,
  grade: false,
};

export type QaStep =
  | 'what'
  | 'custom_name'
  | 'specifics'
  | 'who'
  | 'friend'
  | 'campfire'
  | 'campfire_kind'
  | 'when'
  /** The metric cannot be done with the people chosen — steps against a friend, say. */
  | 'mismatch'
  /** A grade: Cindy's own chat handles courses and pass marks. */
  | 'handoff'
  | 'score';

/** Metrics only a personal goal can track. No race metric reads steps or sleep. */
const SOLO_ONLY: QaWhat[] = ['steps', 'sleep'];
/** And the reverse: total weight lifted is a race metric with no personal-goal type behind it. */
const SOCIAL_ONLY: QaWhat[] = ['volume'];

export function whoFits(what: QaWhat | null, who: QaWho): boolean {
  if (!what) return true;
  if (SOLO_ONLY.includes(what)) return who === 'solo';
  if (SOCIAL_ONLY.includes(what)) return who !== 'solo';
  return true;
}

function needsWhen(a: QaAnswers): boolean {
  if (a.who === 'solo') return a.cadence == null && a.deadline == null;
  return a.deadline == null && a.windowHours == null;
}

export function nextStep(a: QaAnswers): QaStep {
  if (a.grade) return 'handoff';
  if (!a.what) return 'what';
  if (a.what === 'custom' && !a.customName) return 'custom_name';
  if (a.target == null) return 'specifics';
  if (!a.who) return 'who';
  if (!whoFits(a.what, a.who)) return 'mismatch';
  if (a.who === 'friend' && !a.opponent) return 'friend';
  if (a.who === 'campfire' && !a.circle) return 'campfire';
  if (a.who === 'campfire' && !a.campfireKind) return 'campfire_kind';
  if (needsWhen(a)) return 'when';
  return 'score';
}

/** For the progress bar: the share of the four mock questions already answered. */
export function progressOf(a: QaAnswers): number {
  const done = [a.what != null, a.target != null, a.who != null, nextStep(a) === 'score'].filter(Boolean).length;
  return done / 4;
}

// ─────────────────────────────── saying it back ───────────────────────────────

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : String(Math.round(n * 10) / 10);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The thing itself, without who: "Run 100 km", "Gym 3× a week", "1,000 pushups". */
export function describeWhat(a: QaAnswers): string {
  const n = a.target ?? 0;
  const per = a.cadence === 'day' ? ' a day' : a.cadence === 'week' ? ' a week' : '';
  switch (a.what) {
    case 'run':
      return `Run ${fmt(n)} km${per}`;
    case 'ride':
      return `Ride ${fmt(n)} km${per}`;
    case 'study':
      return `Study ${fmt(n)} hours${per}`;
    case 'gym':
      return a.unit === 'hours' ? `${fmt(n)} gym hours${per}` : per ? `Gym ${fmt(n)}×${per}` : `${fmt(n)} gym sessions`;
    case 'steps':
      return `${fmt(n)} steps${per}`;
    case 'sleep':
      return `Sleep ${fmt(n)} hours${per}`;
    case 'volume':
      return `Lift ${fmt(n)} lb${per}`;
    default: {
      const name = a.customName ?? 'it';
      if (n === 1 && (!a.unit || a.unit === name)) return capitalise(name);
      return `${fmt(n)} ${a.unit && a.unit !== 'sessions' ? a.unit : name}${per}`;
    }
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The timeframe as a suffix: " by Dec 31", " · 2 weeks", or nothing. */
export function describeWhen(a: QaAnswers): string {
  if (a.deadline) return ` by ${shortDate(a.deadline)}`;
  if (a.windowHours) {
    const days = Math.round(a.windowHours / DAY_HOURS);
    return days % 7 === 0 ? ` · ${days / 7} week${days === 7 ? '' : 's'}` : ` · ${days} day${days === 1 ? '' : 's'}`;
  }
  return '';
}

// ─────────────────────────────── where it lands ───────────────────────────────

/** The run length a social challenge gets, from its deadline or explicit span. Clamped to the RPCs' range. */
export function windowHoursOf(a: QaAnswers, now: Date = new Date()): number {
  const raw = a.deadline ? (a.deadline.getTime() - now.getTime()) / HOUR : (a.windowHours ?? WEEK_HOURS);
  return Math.min(MAX_WINDOW_HOURS, Math.max(DAY_HOURS, Math.round(raw)));
}

/**
 * A per-period rate as the total a campfire challenge actually counts.
 *
 * The coach's own CAMPFIRE_HOSTING_RULES: "a target is a TOTAL — there are no weekly or daily resets
 * yet". "3× a week through December" is set as 3 × the weeks left, and SAID as that, because a name
 * promising a weekly reset the row does not have is a broken promise to everyone who joins.
 */
export function campfireTotal(a: QaAnswers, now: Date = new Date()): { total: number; periods: number } {
  const per = a.target ?? 0;
  if (a.cadence !== 'day' && a.cadence !== 'week') return { total: per, periods: 1 };
  const periodHours = a.cadence === 'day' ? DAY_HOURS : WEEK_HOURS;
  const periods = Math.max(1, Math.ceil(windowHoursOf(a, now) / periodHours));
  return { total: Math.round(per * periods * 100) / 100, periods };
}

const GOAL_TYPE: Record<Exclude<QaWhat, 'volume'>, ChallengeType> = {
  study: 'study_hours',
  gym: 'gym_visits',
  run: 'run_distance',
  ride: 'ride_distance',
  steps: 'steps',
  sleep: 'sleep_hours',
  custom: 'custom',
};

/** The race metric each "what" rides when people are competing. */
function raceMetricOf(what: QaWhat): SocialChallengeRaceMetric {
  if (what === 'run' || what === 'ride') return 'distance';
  if (what === 'volume') return 'volume';
  return 'lockin_time';
}

/** The plural noun a hosted (counted) campfire challenge names its lock-in type with. */
function hostedNounOf(a: QaAnswers): string {
  if (a.what === 'study') return 'study hours';
  if (a.what === 'gym') return a.unit === 'hours' ? 'gym hours' : 'gym sessions';
  const unit = a.unit && a.unit !== 'sessions' ? a.unit : a.customName;
  return (unit ?? 'reps').slice(0, 30);
}

/**
 * The verdict screen's params for a finished set of answers, minus what only Cindy supplies (the
 * tier, her rationale, her name for it). Every key here is one challenge/verdict.tsx already reads,
 * so this is the same handoff Cindy's chat makes — one door, the same room.
 */
export type VerdictRoute = { params: Record<string, string>; note: string | null };

export function verdictRouteFor(a: QaAnswers, now: Date = new Date()): VerdictRoute {
  const what = a.what ?? 'custom';
  const label = `${describeWhat(a)}${describeWhen(a)}`.slice(0, 60);

  if (a.who === 'solo') {
    const type = GOAL_TYPE[what as Exclude<QaWhat, 'volume'>] ?? 'custom';
    // A custom goal counted in time is fed by lock-ins that carry its name (0061) — which is also
    // what makes it auto-verifiable. Anything else custom is a count the owner logs.
    const countMode: ChallengeCountMode = type === 'custom' && a.unit === 'hours' ? 'lockin_time' : 'manual';
    const period: ChallengePeriod = a.cadence ?? 'once';
    return {
      note: null,
      params: {
        branch: 'solo',
        label: type === 'custom' ? capitalise(a.customName ?? label).slice(0, 60) : label,
        goalType: type,
        target: String(a.target ?? 1),
        unit: type === 'custom' ? (a.unit === 'sessions' ? '' : (a.unit ?? '')) : (a.unit ?? ''),
        period,
        countMode,
      },
    };
  }

  const windowHours = windowHoursOf(a, now);

  if (a.who === 'friend') {
    return {
      note: null,
      params: {
        branch: 'duel',
        label,
        metric: raceMetricOf(what),
        windowHours: String(windowHours),
        opponentId: a.opponent?.id ?? '',
        opponentName: a.opponent?.name ?? '',
      },
    };
  }

  // ── a campfire ──
  const circle = { circleId: a.circle?.id ?? '', circleName: a.circle?.name ?? '' };
  const metric = raceMetricOf(what);

  if (a.campfireKind === 'race' && (metric !== 'lockin_time' || what === 'study' || what === 'gym')) {
    // Ranked 1..N with no shared bar — the server refuses a target on a placement race.
    return {
      note: null,
      params: { branch: 'placement', label, metric, windowHours: String(windowHours), ...circle },
    };
  }

  const { total, periods } = campfireTotal(a, now);
  const note =
    periods > 1
      ? `I'll set this as ${fmt(total)} total — the campfire counts one number across the window. Weekly streaks are coming soon.`
      : null;

  if (metric === 'distance' || metric === 'volume') {
    // A measured bar everyone clears (0169). Stored RAW: metres for distance, which is what
    // challenge_metric_value sums — the verdict passes `target` straight to createGroupChallenge.
    const raw = metric === 'distance' ? Math.round(total * 1000) : Math.round(total);
    const name = metric === 'distance' ? `${fmt(total)} km${describeWhen(a)}` : `${fmt(total)} lb${describeWhen(a)}`;
    return {
      note,
      params: { branch: 'collective', label: name.slice(0, 60), metric, target: String(raw), windowHours: String(windowHours), ...circle },
    };
  }

  // Counted — pushups, gym sessions, study hours. host_campfire_challenge (0162): the noun becomes
  // the lock-in type every member gets. A custom "race" is first-to the same total.
  const noun = hostedNounOf(a);
  return {
    note,
    params: {
      branch: 'campfire',
      label: `${fmt(total)} ${noun}${describeWhen(a)}`.slice(0, 60),
      metric: noun,
      target: String(total),
      windowHours: String(windowHours),
      shape: a.campfireKind === 'race' ? 'first_to' : 'everyone_hits_target',
      ...circle,
    },
  };
}

/**
 * The one sentence Cindy scores. Written out in full rather than replayed from the thread: she
 * judges the WHOLE ask, and the answers are now unambiguous — so she is told them plainly and asked
 * for the one thing only she supplies.
 */
export function scoringPrompt(a: QaAnswers, route: VerdictRoute): string {
  const p = route.params;
  const goal = `${describeWhat(a)}${describeWhen(a)}`;
  // The campfire is named WITH its id. Her hosting rules resolve an id from the user's own
  // campfires by name, and ask when unsure — which here would be a question about something the
  // user already tapped. The shape is named for the same reason: each one maps to one tool.
  const fire = `${a.circle?.name ?? 'my campfire'} (campfire id ${a.circle?.id ?? 'unknown'})`;
  const who =
    a.who === 'solo'
      ? "It's a personal goal, just me."
      : a.who === 'friend'
        ? `It's a duel against ${a.opponent?.name ?? 'a friend'} — whoever is further along when it ends wins.`
        : p.branch === 'placement'
          ? `It's a placement race for ${fire} — the whole campfire ranked on most by the deadline.`
          : p.branch === 'collective'
            ? `It's a collective goal for ${fire} — everyone has to hit ${p.label}.`
            : `It's a challenge to host for ${fire} — everyone has to hit ${p.label}, as a total.`;
  return `Score this challenge for me: ${goal}. ${who} Give it a difficulty tier and propose it — I'll confirm it on your verdict screen.`;
}
