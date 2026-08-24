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
  if (isCollective(challenge)) {
    return `Everyone locks in ${challenge.target_count ?? 1}×`;
  }
  return metricLabel(challenge.race_metric);
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
