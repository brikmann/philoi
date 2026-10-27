import { displayLevelFromXp } from '@/lib/economy/forge-pass';
import { RANK_TIER_ORDER, formatRankTier } from '@/lib/rank-tiers';
import type { ExerciseAgg, ExerciseUnit, MetricUnit } from '@/types/house';

// One wording for every stat value the boards and head-to-head show. Raw values arrive in the
// server's canonical units (seconds, metres, pounds, pass XP); this is the only place they turn
// into words.

function compact(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  return Math.round(n).toLocaleString('en-CA');
}

function hours(seconds: number): string {
  const h = seconds / 3600;
  if (h >= 10) return `${Math.round(h)} h`;
  if (h >= 1) return `${h.toFixed(1)} h`;
  return `${Math.round(seconds / 60)} min`;
}

function km(metres: number): string {
  const k = metres / 1000;
  return k >= 100 ? `${Math.round(k)} km` : `${k.toFixed(1)} km`;
}

/** "128 km", "18.5 h", "14 days", "Level 42", "225 lb". A string, so no glyph — a caller that wants the
 *  streak flame draws an <Icon name="streak"> beside it. */
export function formatMetricValue(unit: MetricUnit, value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  switch (unit) {
    case 'seconds':
      return hours(v);
    case 'metres':
      return km(v);
    case 'lb':
      return `${compact(v)} lb`;
    case 'xp':
      return `${compact(v)} XP`;
    case 'days': {
      const d = Math.round(v);
      return `${d} ${d === 1 ? 'day' : 'days'}`;
    }
    case 'embers':
      return `${compact(v)} embers`;
    case 'pass_xp':
      return `Level ${displayLevelFromXp(v)}`;
    case 'rank': {
      // 0265's rank_ordinal is rankOrdinal(): tier × 3 + (3 − stored division).
      const i = Math.max(0, Math.round(v));
      const tier = RANK_TIER_ORDER[Math.min(Math.floor(i / 3), RANK_TIER_ORDER.length - 1)];
      return formatRankTier(tier, 3 - (i % 3));
    }
    case 'count':
      return compact(v);
  }
}

/** The unit an exercise board's value is in, for formatMetricValue. */
export function exerciseValueUnit(exerciseUnit: ExerciseUnit, agg: ExerciseAgg): MetricUnit {
  if (agg === 'max_reps') return exerciseUnit === 'time' ? 'seconds' : exerciseUnit === 'distance' ? 'metres' : 'count';
  return 'lb';
}

export function aggLabel(agg: ExerciseAgg, unit: ExerciseUnit): string {
  switch (agg) {
    case 'e1rm':
      return 'Best 1RM';
    case 'max_weight':
      return 'Max weight';
    case 'volume':
      return 'Volume';
    case 'max_reps':
      return unit === 'time' ? 'Best time' : unit === 'distance' ? 'Max distance' : 'Max reps';
  }
}

/** Split-bar fill for A (mock 292): a / (a + b), 50/50 when both are zero. */
export function splitShare(a: number, b: number): number {
  const total = a + b;
  return total > 0 ? a / total : 0.5;
}
