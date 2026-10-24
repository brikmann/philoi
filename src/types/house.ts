// Row shapes for the house identity + stat library + head-to-head RPCs (0264–0266). Registered in
// database.ts' Functions map; kept here so the bundle's types read in one place.

/** get_my_program / get_programs_for_university (0257, widened 0264). */
export type ProgramRow = {
  program_id: string;
  name: string;
  program_key: string;
  patron_key: string;
  patron_name: string;
  patron_attribute: string;
  patron_title: string | null;
  program_abbrev: string | null;
  program_lore: string | null;
};

export type MyProgramRow = ProgramRow & { university: string };

/** get_identity_badges (0264) — what sits beside a name: house · program · school. */
export type IdentityBadge = {
  user_id: string;
  university: string | null;
  program_name: string | null;
  program_abbrev: string | null;
  patron_key: string | null;
  patron_name: string | null;
  patron_title: string | null;
};

export type MetricWindow = 'week' | '30d' | 'season' | 'all';
export type MetricUnit = 'xp' | 'rank' | 'days' | 'count' | 'seconds' | 'metres' | 'lb' | 'embers' | 'pass_xp';
export type DuelMetric = 'xp' | 'lockin_time' | 'distance';
export type MetricScope = 'global' | 'my_uni' | 'my_program' | 'friends';

/** metric_catalog (0265) — the 26-stat library (mock 293). */
export type MetricCatalogRow = {
  key: string;
  group_key: string;
  group_label: string;
  label: string;
  emoji: string;
  metric: string;
  metric_window: MetricWindow;
  unit: MetricUnit;
  challengeable: boolean;
  duel_metric: DuelMetric | null;
  duel_goal_type: 'gym' | 'study' | null;
  fitness: boolean;
  sort: number;
};

/** get_metric_leaderboard (0265). `verified` is null for anything but an exercise metric. */
export type MetricLeaderboardRow = {
  user_id: string;
  handle: string | null;
  display_name: string;
  avatar_url: string | null;
  is_pro: boolean;
  value: number;
  verified: boolean | null;
  tier: string;
  division: number;
  rank: number;
  is_me: boolean;
  university: string | null;
  patron_key: string | null;
  program_abbrev: string | null;
  /** Exercise boards only: the set behind the number — what "⚑ Dispute this PR" targets. */
  pr_set_id: string | null;
};

/** versus (0265) — one row per stat asked for, in order. */
export type VersusRow = {
  metric_key: string;
  label: string;
  emoji: string;
  unit: MetricUnit;
  a_value: number;
  b_value: number;
  leader: 'a' | 'b' | 'tie';
  challengeable: boolean;
  duel_metric: DuelMetric | null;
  duel_goal_type: 'gym' | 'study' | null;
};

export type ExerciseUnit = 'weight' | 'reps' | 'time' | 'distance';
export type ExerciseAgg = 'e1rm' | 'max_weight' | 'max_reps' | 'volume';

/** search_exercise_library (0265). exercise_id is the row the caller can log against, or null. */
export type ExerciseLibraryRow = {
  slug: string;
  name: string;
  muscle_group: string | null;
  unit: ExerciseUnit;
  lifters: number;
  exercise_id: string | null;
  is_builtin: boolean;
};

export type DisputeResult = { report_id: string; status: 'disputed' | 'pulled'; disputes: number };
