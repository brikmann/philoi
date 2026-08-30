import { formatSessionDuration } from '@/lib/format';
import type { ChallengeShape, SocialChallengeRaceMetric } from '@/types/database';

// ONE PLACE THAT KNOWS WHAT A RACE MEASURES.
//
// 0096 added volume / distance / ai to the metric set and challenge/create.tsx started offering
// them. Every screen that renders a race, though, still carried its own two-branch ternary written
// when the only options were lock-in time and XP:
//
//   social-challenge-card  `isTimeMetric ? 'Most lock-in time' : 'Most XP'`
//   challenge-info         the same ternary again
//   watch/[challengeId]    a RACE_METRIC_LABEL map with exactly two keys, defaulting to "Race"
//
// So a gym VOLUME duel announced itself as "Most XP" and rendered "12000 XP" for twelve thousand
// pounds, on three screens, in three slightly different ways. Three copies of a two-case ternary is
// how a five-case fact goes wrong everywhere at once; this is the fix for the class, not the
// instance.
//
// The SERVER-side twin of this file is challenge_metric_value() in 0096 — that decides what a
// metric is worth, this decides what it is called. Neither derives the other, and they are meant
// to be read together when a metric is added.

type MetricSpec = {
  /** The race, as a headline: "Most lock-in time". */
  label: string;
  /** The race, as a bare noun for mid-sentence use: "the most lock-in time when the clock hits zero". */
  noun: string;
  /** Renders a raw score in that metric's own units. */
  format: (value: number) => string;
};

const METRICS: Record<SocialChallengeRaceMetric, MetricSpec> = {
  lockin_time: {
    label: 'Most lock-in time',
    noun: 'lock-in time',
    // Seconds, and formatSessionDuration is what every other lock-in surface uses — the watch
    // screen was printing a bare `${seconds}s`, so a four-hour lead read as "14400s".
    format: (v) => formatSessionDuration(Math.round(v)),
  },
  volume: {
    label: 'Most volume lifted',
    noun: 'volume',
    format: (v) => `${Math.round(v).toLocaleString('en-US')} lb`,
  },
  distance: {
    // challenge_metric_value sums check_ins.distance_m, so the raw figure is METRES.
    label: 'Most distance',
    noun: 'distance',
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`),
  },
  ai: {
    // An AI-parsed goal settles from its own checkpoints rather than a running total (0096), so
    // there is no unit to print — the value is deliberately a bare count of checkpoints met.
    label: 'Custom goal',
    noun: 'progress',
    format: (v) => `${Math.round(v)}`,
  },
  xp: {
    // Retired from creation (it correlates with lock-in time) but still live on in-flight races,
    // which is exactly why it must keep a label rather than fall through to a default.
    label: 'Most XP',
    noun: 'XP',
    format: (v) => `${Math.round(v).toLocaleString('en-US')} XP`,
  },
  grade: {
    // NOT "Most grade". Every other label here describes a race to accumulate the most of
    // something; a grade race is a bar you clear, and the shared bar is the whole reason a grade
    // duel is a race at all rather than two unrelated numbers (0145's constraint says the same in
    // SQL). gradeChallengeLabel() below puts the actual target in front of people.
    label: 'Grade target',
    noun: 'grade',
    // One decimal at most, and never a trailing ".0": a 70 is a 70, and "70.0%" reads like a
    // measurement taken by an instrument rather than a mark somebody was given.
    format: (v) => `${Number(v.toFixed(1))}%`,
  },
};

/**
 * A group challenge leaves race_metric NULL — its target is a count of qualifying lock-ins, not a
 * metric race (0098's insert, and 0111's comment on why settlement hardcodes 'xp' to ORDER that
 * field). Null must therefore never fall back to the XP spec, which is what "Most XP" on a group
 * card came from.
 */
const COLLECTIVE: MetricSpec = {
  label: 'Everyone finishes',
  noun: 'lock-ins',
  format: (v) => `${Math.round(v)}`,
};

export function metricSpec(metric: SocialChallengeRaceMetric | null | undefined): MetricSpec {
  if (!metric) return COLLECTIVE;
  return METRICS[metric] ?? COLLECTIVE;
}

export function metricLabel(metric: SocialChallengeRaceMetric | null | undefined): string {
  return metricSpec(metric).label;
}

export function metricNoun(metric: SocialChallengeRaceMetric | null | undefined): string {
  return metricSpec(metric).noun;
}

export function formatMetricValue(
  metric: SocialChallengeRaceMetric | null | undefined,
  value: number,
): string {
  return metricSpec(metric).format(value);
}

/**
 * What to CALL this challenge.
 *
 * public_name is the v2 field (0096) — "Morning grind", "BU111 grade" — and it is what the spec
 * says the card, the watch screen and the share card are titled with. It was written by create and
 * then read by nothing: get_my_social_challenges never selected it until 0112, so every surface
 * fell back to describing the metric. Falls back to exactly that when there is no name.
 */
export function challengeTitle(challenge: {
  public_name?: string | null;
  race_metric?: SocialChallengeRaceMetric | null;
  shape?: ChallengeShape | null;
  mode?: string;
  target_count?: number | null;
}): string {
  const named = challenge.public_name?.trim();
  if (named) return named;
  // A grade race is named by its BAR, whatever shape it is. Falling through to the collective
  // branch would title "everyone in KP451 hits 70" as "Everyone locks in null×" — its target_count
  // is null by constraint (0145), the same way a placement race's is.
  if (challenge.race_metric === 'grade') return gradeChallengeLabel(challenge);
  // A placement race IS a metric race — it just has no opponent. Falling through to the collective
  // branch would title a semester-long ranked board "Everyone locks in 1×", which describes a
  // target it does not have (its target_count is null by constraint, 0126).
  if (isCollective(challenge) && !isPlacement(challenge)) {
    return `Everyone locks in ${challenge.target_count ?? 1}×`;
  }
  return metricLabel(challenge.race_metric);
}

/** A grade race scores a self-reported mark rather than anything the app can observe (0145). */
export function isGrade(challenge: { race_metric?: SocialChallengeRaceMetric | null }): boolean {
  return challenge.race_metric === 'grade';
}

/**
 * "70% in KP451" — the bar and the course, which is the only pair that means anything.
 *
 * Mock 140's first exchange is Cindy refusing to price the challenge until she has the course code,
 * because "Physiology at one school isn't the same as another". The same reasoning applies to
 * displaying it: a bare "70%" tells you nothing about what was asked of anybody.
 *
 * A placement board has no target — the ranking is the result — so it names the course alone.
 */
export function gradeChallengeLabel(challenge: {
  grade_target?: number | null;
  course_code?: string | null;
  shape?: ChallengeShape | null;
}): string {
  const course = challenge.course_code?.trim();
  if (challenge.grade_target == null) return course ? `${course} · ranked by grade` : 'Ranked by grade';
  const target = formatMetricValue('grade', challenge.grade_target);
  return course ? `${target} in ${course}` : `${target} target`;
}

/**
 * IS THIS A 1v1?
 *
 * `shape` (0096) is the answer and `mode` is the legacy one. Both are consulted because shape is
 * nullable for rows that predate the backfill, and getting this wrong is the spec's 🔴 "a group
 * goal renders as a 1v1 VS card you can watch" — so it is worth one shared predicate rather than
 * an `opponent_id != null` guess repeated per screen.
 */
export function isDuel(challenge: { shape?: ChallengeShape | null; mode?: string }): boolean {
  if (challenge.shape) return challenge.shape === 'duel';
  return challenge.mode === 'h2h';
}

export function isCollective(challenge: { shape?: ChallengeShape | null; mode?: string }): boolean {
  return !isDuel(challenge);
}

/**
 * IS THIS A RANKED BOARD? (mock 114, created for the first time by 0126.)
 *
 * Only `shape` answers this — there is no legacy fallback, and that is correct rather than an
 * oversight: a placement race rides `mode = 'group'` exactly like a collective goal does, so mode
 * cannot distinguish them, and no row predating 0096's backfill can be one because nothing could
 * create one until 0126.
 *
 * Every caller of isCollective() that renders a TARGET — "N / M done", "everyone locks in 5×",
 * the all-or-nothing note — has to exclude this: a placement race has no shared target to miss,
 * only somewhere to place.
 */
export function isPlacement(challenge: { shape?: ChallengeShape | null }): boolean {
  return challenge.shape === 'placement';
}
