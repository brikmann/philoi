import type { LockinGoalType } from '@/lib/api/social-challenges';
import type { DuelMetric, MetricCatalogRow } from '@/types/house';

// What "Send the challenge ⚔" actually does with the flags — kept apart from the screen so the
// rule is one readable function, and so the UI can say it out loud BEFORE the tap.
//
// THE SEND RULE. A flagged stat becomes a real duel only when the server has a race for it
// (`duel_metric`): XP, lock-in time (optionally gym- or study-only, 0247) or distance. Everything
// else flagged — a streak, a session count, a PR, course challenges — has no race metric yet, so it
// can't be created here; it is handed to Cindy's Q&A with the opponent already filled in. The
// screen shows which is which, because "I flagged three and got one duel" would be a lie by omission.

/** One stat in the compare zone. A catalog row, or a raw 'ex:<slug>:<agg>' exercise key. */
export type CompareStat = {
  key: string;
  label: string;
  emoji: string;
  challengeable: boolean;
  duel_metric: DuelMetric | null;
  duel_goal_type: LockinGoalType | null;
};

export const MAX_COMPARE_STATS = 12;
/** Mock 292's starting five when the link names none. */
export const DEFAULT_STAT_KEYS = ['season_xp', 'study_hours_30d', 'gym_time_30d', 'run_distance_30d', 'day_streak'] as const;
/** A week — the window every duel sent from here runs over, and the one its name promises. */
export const DUEL_WINDOW_HOURS = 168;

export function statFromCatalog(row: MetricCatalogRow): CompareStat {
  return {
    key: row.key,
    label: row.label,
    emoji: row.emoji,
    challengeable: row.challengeable,
    duel_metric: row.duel_metric,
    duel_goal_type: row.duel_goal_type,
  };
}

/** A link's 'ex:weighted_pull_up:e1rm' before versus() has named it: "Weighted pull up". */
export function statFromExerciseKey(key: string): CompareStat | null {
  const [prefix, slug] = key.split(':');
  if (prefix !== 'ex' || !slug) return null;
  const words = slug.replace(/_/g, ' ');
  return {
    key,
    label: words.charAt(0).toUpperCase() + words.slice(1),
    emoji: '🏋️',
    // Matches versus(): an exercise metric is challengeable, but has no race to duel on.
    challengeable: true,
    duel_metric: null,
    duel_goal_type: null,
  };
}

/** The name the duel goes out under — what the opponent reads on the invite. */
export function duelPublicName(stat: CompareStat): string {
  switch (stat.duel_metric) {
    case 'xp':
      return 'Most XP · 7 days';
    case 'distance':
      return 'Most distance run · 7 days';
    case 'lockin_time':
      if (stat.duel_goal_type === 'study') return 'Most study hours · 7 days';
      if (stat.duel_goal_type === 'gym') return 'Most gym time · 7 days';
      return 'Most lock-in hours · 7 days';
    default:
      return `${stat.label.replace(/ · (30d|wk)$/, '')} · 7 days`;
  }
}

export type SendPlan = {
  /** Become real duels on send, one each. */
  duels: CompareStat[];
  /** Flagged, but there is no race for them yet — set up with Cindy instead. */
  cindy: CompareStat[];
};

export function planSend(stats: CompareStat[], flagged: ReadonlySet<string>): SendPlan {
  const picked = stats.filter((s) => s.challengeable && flagged.has(s.key));
  // Two flags that would create the same race (there are none today, but the catalog is data)
  // are one duel, not two identical invites.
  const seen = new Set<string>();
  const duels: CompareStat[] = [];
  for (const s of picked) {
    if (!s.duel_metric) continue;
    const id = `${s.duel_metric}:${s.duel_goal_type ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    duels.push(s);
  }
  return { duels, cindy: picked.filter((s) => !s.duel_metric) };
}

/** "Streak & Study hours", "Streak, Gym time & Study hours". */
export function joinLabels(stats: readonly { label: string }[]): string {
  const names = stats.map((s) => s.label.replace(/ · (30d|wk)$/, ''));
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}
