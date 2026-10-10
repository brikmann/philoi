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
/**
 * The three campfire shapes:
 *   · together   — every member clears the SAME bar ("everyone runs 50 km");
 *   · race       — ranked on who did the most, no bar at all (a placement race);
 *   · collective — the campfire POOLS toward one total ("500 km between us"), optionally paying
 *                  whoever contributed most (0240).
 */
export type QaCampfireKind = 'together' | 'race' | 'collective';

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
  /** On a pooled total: pay whoever contributed most ("…and pay the top contributor"). */
  contributorReward?: boolean;
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

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
};
const SPAN_COUNT = `(\\d+|${Object.keys(NUMBER_WORDS).join('|')})`;

/** The last day of the academic term `now` falls in: fall → Dec 31, winter → Apr 30, summer → Aug 31. */
function endOfTerm(now: Date): Date {
  const m = now.getMonth();
  const y = now.getFullYear();
  if (m >= 8) return endOfDay(new Date(y, 11, 31));
  if (m <= 3) return endOfDay(new Date(y, 3, 30));
  return endOfDay(new Date(y, 7, 31));
}

/**
 * `bareSpan`: the open question IS "how long does it run?", so a duration with no preposition — a
 * bare "2 months" — is the answer. Anywhere else a bare duration is too likely to be part of a rate
 * ("3 days a week") to read as the window.
 */
function parseDeadline(t: string, now: Date, bareSpan = false): { deadline?: Date; windowHours?: number } {
  if (/\b(?:by\s+)?(?:the\s+)?end of (?:the\s+)?(?:semester|term)\b|\bthis (?:semester|term)\b/.test(t)) {
    return { deadline: endOfTerm(now) };
  }
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

  // "in 3 weeks", "for 10 days", "over 2 months", "next 4 weeks" — and, answering "when", a bare
  // "2 months". Never "3 days a week": that is a rate, and the cadence reader owns it.
  // A bare span needs a real count: "a week" with no preposition is the tail of a rate ("3 days a
  // week"), never a window.
  const notRate = '\\b(?!\\s*(?:a|per|each|every)\\s+(?:day|week))';
  const span =
    t.match(new RegExp(`\\b(?:in|for|over|within|next)\\s+(?:the next\\s+)?${SPAN_COUNT}\\s+(day|week|month)s?${notRate}`)) ??
    (bareSpan
      ? t.match(new RegExp(`(?:^|\\s)(\\d+|${Object.keys(NUMBER_WORDS).filter((w) => w !== 'a' && w !== 'an').join('|')})\\s+(day|week|month)s?${notRate}`))
      : null);
  if (span) {
    const n = NUMBER_WORDS[span[1]] ?? Number(span[1]);
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
export function parseQa(input: string, now: Date = new Date(), opts: { step?: QaStep } = {}): QaParse {
  const t = ` ${input.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim()} `;
  const out: QaParse = {};

  // ── grade ── a mark has a course and a pass line, and Cindy's chat already scopes both.
  if (/\b(grade|gpa|marks?|exam|midterm|final exam|test score)\b|\d\s*%/.test(t)) out.grade = true;

  // ── what ──
  // A distance is a number with a WHOLE distance unit. A bare `k` is not one ("10k steps" is ten
  // thousand steps), and a stray `k` before the unit is a typo, never a multiplier: "500kkm" is
  // 500 km, not 500,000.
  const distance = t.match(/(\d[\d,]*(?:\.\d+)?)\s*k?\s*(km|kms|kilomet\w*|mi|miles?)\b/);
  if (/\bsteps?\b/.test(t)) out.what = 'steps';
  else if (/\bsleep/.test(t)) out.what = 'sleep';
  else if (/\b(ride|riding|rode|cycl\w*|bike|biking)\b/.test(t)) out.what = 'ride';
  else if (/\b(volume|lbs?|pounds|kgs?)\b/.test(t) && /\b(lift|lifted|lifting|volume|total)\b/.test(t)) out.what = 'volume';
  else if (/\b(run|runs|running|ran|jog\w*|marathon|5k|10k|half|km|kms|kilomet\w*|miles|distance)\b/.test(t) || distance)
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
    const n = parseNumber(distance[1]);
    out.target = /^mi/.test(distance[2]) ? Math.round(n * 1.609 * 10) / 10 : n;
    out.unit = 'km';
  }
  if (out.target == null && (out.what === 'run' || out.what === 'ride')) {
    // "a 5k", "10k by June" on a run is five / ten KILOMETRES, not thousands — the race name.
    const race = t.match(/\b(\d{1,3})k\b(?!\s*(?:steps?|lbs?|pounds))/);
    if (race) {
      out.target = Number(race[1]);
      out.unit = 'km';
    }
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

  Object.assign(out, parseDeadline(t, now, opts.step === 'when'));

  // ── who ──
  if (/\b(just me|myself|solo|alone|on my own|by myself|personal)\b/.test(t)) out.who = 'solo';
  else if (/\b(campfire|my fire|the fire|group|crew|squad|club|team|the house|everyone|all of us|we all|between us)\b/.test(t)) out.who = 'campfire';
  else if (/\b(friends?|vs\.?|versus|against|duel|head to head|1v1)\b/.test(t)) out.who = 'friend';

  // ── which campfire shape ──
  // Read in this order because the words overlap: "pay whoever contributes MOST" is a pooled
  // total with a payout, not a race, so the contributor and pooled phrasings are checked before
  // the race words ("most") can claim it.
  const contributor =
    /\bcontribut\w*\b/.test(t) && /\b(top|most|highest|biggest|best|largest)\b/.test(t)
      ? true
      : /\b(?:pay|reward|prize)\s+(?:the\s+|whoever\s+)?(?:top|highest|biggest|best)\b/.test(t);
  const pooled = /\b(cumulative(?:ly)?|combined|collectively|between (?:us|all of us)|as a (?:club|group|team|campfire|house)|pool(?:ed|ing)?|shared (?:goal|total|target)|in total as)\b/.test(t);
  if (contributor) {
    out.campfireKind = 'collective';
    out.contributorReward = true;
  } else if (pooled) {
    out.campfireKind = 'collective';
  } else if (/\b(most|ranked|leaderboard|who (?:can|gets|does)|whoever|winner|first to|race)\b/.test(t)) {
    out.campfireKind = 'race';
  } else if (/\b(everyone|each of us|all of us|we all|together|same (?:goal|target|bar))\b/.test(t)) {
    out.campfireKind = 'together';
  }
  // A pool is a campfire thing by definition — "500 km cumulatively, pay the top contributor"
  // names no campfire, but it cannot be anything else.
  if (out.campfireKind === 'collective' && !out.who) out.who = 'campfire';

  return out;
}

/** Cindy's structured reading of a typed answer (ai-coach `extract_challenge`). Null = not said. */
export type QaExtracted = {
  discipline: QaWhat | null;
  custom_name: string | null;
  target: number | null;
  unit: string | null;
  cadence: QaCadence | null;
  deadline: string | null;
  window_days: number | null;
  who: QaWho | null;
  mode: 'solo' | 'duel' | 'placement' | 'together' | 'collective' | null;
  contributor_reward: boolean;
  is_grade: boolean;
};

/**
 * Cindy's reading as a QaParse, so it merges through exactly the path the regex's does. Anything
 * out of range is dropped rather than trusted: a model's number becomes the terms of a real
 * challenge, so it gets the same "unsure answers nothing" rule as the regex.
 */
export function parseFromExtracted(g: QaExtracted, now: Date = new Date()): QaParse {
  const out: QaParse = {};
  if (g.is_grade) out.grade = true;
  if (g.discipline) out.what = g.discipline;
  if (g.discipline === 'custom' && g.custom_name) out.customName = g.custom_name.trim().slice(0, 40);
  if (typeof g.target === 'number' && g.target > 0 && g.target < 10_000_000) {
    out.target = g.target;
    out.unit = g.unit === 'count' ? (g.custom_name ?? undefined) : (g.unit ?? undefined);
  }
  if (g.cadence) out.cadence = g.cadence;
  if (g.deadline && /^\d{4}-\d{2}-\d{2}$/.test(g.deadline)) {
    const [y, m, d] = g.deadline.split('-').map(Number);
    const at = endOfDay(new Date(y, m - 1, d));
    if (at.getTime() > now.getTime()) out.deadline = at;
  } else if (typeof g.window_days === 'number' && g.window_days > 0) {
    out.windowHours = Math.round(g.window_days) * DAY_HOURS;
  }
  if (g.who) out.who = g.who;
  if (g.mode === 'duel') out.who = 'friend';
  if (g.mode === 'solo') out.who = 'solo';
  if (g.mode === 'placement') out.campfireKind = 'race';
  if (g.mode === 'together') out.campfireKind = 'together';
  if (g.mode === 'collective') {
    out.campfireKind = 'collective';
    if (g.contributor_reward) out.contributorReward = true;
  }
  if (out.campfireKind && !out.who) out.who = 'campfire';
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
  /** A pooled total that pays its top contributor. Meaningless on any other shape. */
  contributorReward: boolean;
  grade: boolean;
};

export const EMPTY_ANSWERS: QaAnswers = {
  contributorReward: false,
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

/**
 * The metrics a placement race can rank on. Anything else raced across a campfire becomes a
 * hosted "first to N" — which, unlike a placement race, needs its N.
 */
function placementRanks(what: QaWhat): boolean {
  return what === 'run' || what === 'ride' || what === 'volume' || what === 'study' || what === 'gym';
}

/**
 * Whether the challenge has a number at all. A race does not: "most distance this semester" IS the
 * challenge, and asking for a target there was bug #1 ("I didn't catch a number"). A duel is a race
 * too — whoever is further along when it ends.
 */
export function needsTarget(a: QaAnswers): boolean {
  if (!a.who) return false;
  if (a.who === 'solo') return true;
  if (a.who === 'friend') return false;
  if (!a.campfireKind) return false;
  if (a.campfireKind === 'race') return !placementRanks(a.what ?? 'custom');
  return true;
}

/**
 * The open question. WHO comes before HOW MUCH: whether a number is needed at all depends on who
 * is in and how they compete, so it cannot be asked first (the old order asked every placement
 * race for a target it would never use).
 */
export function nextStep(a: QaAnswers): QaStep {
  if (a.grade) return 'handoff';
  if (!a.what) return 'what';
  if (a.what === 'custom' && !a.customName) return 'custom_name';
  if (!a.who) return 'who';
  if (!whoFits(a.what, a.who)) return 'mismatch';
  if (a.who === 'friend' && !a.opponent) return 'friend';
  if (a.who === 'campfire' && !a.circle) return 'campfire';
  if (a.who === 'campfire' && !a.campfireKind) return 'campfire_kind';
  if (needsTarget(a) && a.target == null) return 'specifics';
  if (needsWhen(a)) return 'when';
  return 'score';
}

/** For the progress bar: the share of the four mock questions already answered. */
export function progressOf(a: QaAnswers): number {
  const amount = a.target != null || (a.who != null && a.campfireKind != null && !needsTarget(a)) || a.who === 'friend';
  const done = [a.what != null, a.who != null, amount, nextStep(a) === 'score'].filter(Boolean).length;
  return done / 4;
}

// ─────────────────────────────── saying it back ───────────────────────────────

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : String(Math.round(n * 10) / 10);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** A race with no number: "Most km run", "Most study hours". */
function describeMost(a: QaAnswers): string {
  switch (a.what) {
    case 'run':
      return 'Most km run';
    case 'ride':
      return 'Most km ridden';
    case 'study':
      return 'Most study hours';
    case 'gym':
      return 'Most gym time';
    case 'volume':
      return 'Most weight lifted';
    default:
      return `Most ${a.customName ?? 'done'}`;
  }
}

/** The thing itself, without who: "Run 100 km", "Gym 3× a week", "1,000 pushups". */
export function describeWhat(a: QaAnswers): string {
  if (a.target == null && !needsTarget(a) && a.who != null) return describeMost(a);
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

/**
 * A pooled total's metric and raw target, from the discipline. Null when nothing measures it on its
 * own. Every unit is explicit here so no shape can fall through to another one's ("Lift 500 lb").
 */
export function poolOf(
  a: Pick<QaAnswers, 'what' | 'unit'>,
  total: number
): { metric: 'distance' | 'volume' | 'lockin_time'; raw: number; unitLabel: string } | null {
  switch (a.what) {
    case 'run':
    case 'ride':
      return { metric: 'distance', raw: Math.round(total * 1000), unitLabel: 'km' };
    case 'volume':
      return { metric: 'volume', raw: Math.round(total), unitLabel: 'lb' };
    case 'study':
      return { metric: 'lockin_time', raw: Math.round(total * 3600), unitLabel: 'study hours' };
    case 'gym':
      return a.unit === 'hours' ? { metric: 'lockin_time', raw: Math.round(total * 3600), unitLabel: 'gym hours' } : null;
    default:
      return null;
  }
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

  if (a.campfireKind === 'race' && placementRanks(what)) {
    // Ranked 1..N with no shared bar — the server refuses a target on a placement race, and a
    // number the user typed anyway ("race to 100 km") is not what decides it, so it is not named.
    return {
      note: null,
      params: { branch: 'placement', label: `${describeMost(a)}${describeWhen(a)}`.slice(0, 60), metric, windowHours: String(windowHours), ...circle },
    };
  }

  const { total, periods } = campfireTotal(a, now);
  const note =
    periods > 1
      ? `I'll set this as ${fmt(total)} total — the campfire counts one number across the window. Weekly streaks are coming soon.`
      : null;

  if (a.campfireKind === 'collective') {
    // ONE shared total (0240). The metric comes from WHAT was answered, never a default: run/ride
    // is distance in km (bug #2 printed "Lift 500 lb" for a run), lifting is pounds, study and gym
    // time are lock-in seconds. Stored RAW — metres, pounds, seconds — as challenge_metric_value sums.
    const pool = poolOf(a, total);
    if (pool) {
      const reward = a.contributorReward ? ' · top contributor wins' : '';
      return {
        note,
        params: {
          branch: 'pooled',
          label: `${fmt(total)} ${pool.unitLabel} together${describeWhen(a)}${reward}`.slice(0, 60),
          metric: pool.metric,
          target: String(pool.raw),
          rewardTop: a.contributorReward ? '1' : '0',
          windowHours: String(windowHours),
          ...circle,
        },
      };
    }
    // Nothing a server can sum on its own (pushups, gym visits, steps): typed counts are people's
    // word, and a pool of them is cleared for everyone by one entry. Same total, as a bar each.
    const counted = hostedNounOf(a);
    return {
      note: `I can only pool distance, lifting and lock-in time — so it's ${fmt(total)} ${counted} each.`,
      params: {
        branch: 'campfire',
        label: `${fmt(total)} ${counted}${describeWhen(a)}`.slice(0, 60),
        metric: counted,
        target: String(total),
        windowHours: String(windowHours),
        shape: 'everyone_hits_target',
        ...circle,
      },
    };
  }

  if (metric === 'distance' || metric === 'volume') {
    // A measured bar everyone clears (0169). Stored RAW: metres for distance, which is what
    // challenge_metric_value sums — the verdict passes `target` straight to createGroupChallenge.
    const raw = metric === 'distance' ? Math.round(total * 1000) : Math.round(total);
    const name = `${fmt(total)} ${metric === 'distance' ? 'km' : 'lb'} each${describeWhen(a)}`;
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
  const goal = p.branch === 'placement' || p.branch === 'pooled' ? p.label : `${describeWhat(a)}${describeWhen(a)}`;
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
          ? `It's a placement race for ${fire} — the whole campfire ranked on most by the deadline. There is no target.`
          : p.branch === 'pooled'
            ? `It's a shared total for ${fire} — everyone's ${p.metric === 'distance' ? 'distance' : p.metric === 'volume' ? 'weight lifted' : 'lock-in time'} counts toward ONE combined target, not each person's own${a.contributorReward ? ', and the top contributor is paid when it is hit' : ''}.`
            : p.branch === 'collective'
            ? `It's a collective goal for ${fire} — everyone has to hit ${p.label}.`
            : `It's a challenge to host for ${fire} — everyone has to hit ${p.label}, as a total.`;
  return `Score this challenge for me: ${goal}. ${who} Give it a difficulty tier and propose it — I'll confirm it on your verdict screen.`;
}
