import { useEffect, useState } from 'react';

import { fetchMyRanks } from '@/lib/api/goals';
import { fetchUserBoardPosition } from '@/lib/api/leaderboard-social';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDistanceKm, formatDurationClock } from '@/lib/format';
import { GOAL_TYPE_META } from '@/lib/goal-types';
import { formatRankTier, nextRank, xpProgressRatio } from '@/lib/rank-tiers';
import { supabase } from '@/lib/supabase';
import type { GoalType, MyRank, RankTierName } from '@/types/database';

// Everything the story sticker prints, gathered from RPCs that already exist (get_my_ranks,
// get_my_program, get_user_board_position) plus the finished session itself. Each fetch fails
// soft: a missing piece hides its line rather than blocking the share, because get_my_program and
// lift_sets ride on migrations (0247/0249) that may not be applied where this build is pointed.

/** The finished session the sticker is about. */
export type StickerSession = {
  checkInId: string;
  goalType: GoalType;
  goalDetail: string | null;
  durationSeconds: number;
  xpEarned: number;
  /** Device-verified distance — set on synced runs only. */
  distanceM?: number | null;
  /** Override for the streak flex; defaults to the profile's current streak. */
  streakDays?: number;
};

export type StickerRank = {
  tier: RankTierName;
  division: number;
  label: string;
  /** The next rung's label, or null at max rank (Primordial). */
  nextLabel: string | null;
  /** 0..1 — xp_into_tier / xp_for_next_tier. */
  ratio: number;
  /** "360 to Gold I", or "Max rank". */
  toNext: string;
};

export type StickerModel = {
  handle: string | null;
  /** The academic program (0247) and the patron it answers to — "Heir of Athena · Philosophy". */
  patron: { key: string; name: string; program: string } | null;
  /** H:MM:SS — the hero. */
  clock: string;
  /** "Deep Work", "Gym", or the session's own detail. */
  goalLabel: string;
  /** The discipline line: "5.2 km · 5:28/km" for a run, "4,200 lb moved" for a gym session. */
  disciplineLine: string | null;
  xpEarned: number;
  rank: StickerRank | null;
  streakDays: number;
  campus: { value: string; label: string; phrase: string } | null;
  /** Gym only — one row per exercise, in the order they were done. Empty for every other session. */
  exercises: StickerExercise[];
};

export type StickerExercise = {
  name: string;
  sets: number;
  /** The best set by estimated 1RM, as the roll-up stores it: "185 lb × 5", or "12 reps" bodyweight. */
  topSet: string;
  /** Any set of this exercise was a personal best when it was banked. */
  isPr: boolean;
};

/** "1:24:06" always — the sticker's hero shows hours even under an hour, so every card has the same
 *  shape and a 0:42:10 reads as a clock rather than as a score. */
function heroClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 3600) return formatDurationClock(s);
  return `0:${formatDurationClock(s).padStart(5, '0')}`;
}

/** "5:28/km". */
function pacePerKm(durationSeconds: number, distanceM: number): string {
  const secPerKm = Math.round(durationSeconds / (distanceM / 1000));
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, '0')}/km`;
}

const UNIVERSITY_SHORT: Record<string, string> = {
  'Wilfrid Laurier University': 'Laurier',
  'Toronto Metropolitan University': 'TMU',
  'University of Toronto': 'UofT',
  "Queen's University": "Queen's",
};

/** "Wilfrid Laurier University" -> "Laurier" — the word people actually say. */
export function shortUniversityName(name: string): string {
  if (UNIVERSITY_SHORT[name]) return UNIVERSITY_SHORT[name];
  const words = name
    .replace(/\b(University|College|Institute|of|The)\b/gi, '')
    .split(/\s+/)
    .filter(Boolean);
  return words[words.length - 1] ?? name;
}

export function buildRank(r: MyRank): StickerRank {
  const up = nextRank(r.tier, r.division);
  const atMax = !up || r.xp_for_next_tier <= 0;
  const remaining = Math.max(0, Math.round(r.xp_for_next_tier - r.xp_into_tier));
  return {
    tier: r.tier,
    division: r.division,
    label: formatRankTier(r.tier, r.division),
    nextLabel: atMax ? null : formatRankTier(up.tier, up.division),
    ratio: xpProgressRatio(r.xp_into_tier, r.xp_for_next_tier),
    toNext: atMax ? 'Max rank' : `${remaining.toLocaleString()} to ${formatRankTier(up.tier, up.division)}`,
  };
}

const LB_PER_KG = 2.20462;

/**
 * Pounds moved in one gym session. The live gym tracker logs in lb (workout_sets.weight, per set);
 * lift_sets (0249) is canonical kg and only consulted when the tracker logged nothing. Bodyweight
 * sets have a null weight and add nothing — the sticker says "moved", and reps alone moved no load.
 */
async function fetchGymVolumeLb(checkInId: string): Promise<number> {
  const { data: workouts } = await supabase.from('workouts').select('id').eq('check_in_id', checkInId);
  const ids = (workouts ?? []).map((w: { id: string }) => w.id);
  if (ids.length > 0) {
    const { data: sets } = await supabase.from('workout_sets').select('weight, reps').in('workout_id', ids);
    const lb = (sets ?? []).reduce(
      (sum: number, s: { weight: number | null; reps: number }) => sum + Number(s.weight ?? 0) * s.reps,
      0
    );
    if (lb > 0) return lb;
  }
  const { data: lifts, error } = await supabase
    .from('lift_sets')
    .select('weight_kg, reps')
    .eq('check_in_id', checkInId)
    .is('removed_at', null);
  if (error || !lifts) return 0;
  const kg = lifts.reduce((sum: number, s: { weight_kg: number; reps: number }) => sum + Number(s.weight_kg) * s.reps, 0);
  return kg * LB_PER_KG;
}

type WorkoutRow = { exercise: string; sets: number; reps: number; weight: number | null; is_pr: boolean | null };

/**
 * The session's exercises — check_in_workout_sets, the per-exercise roll-up stop_lock_in_session
 * writes: set count, the best set by e1RM, and is_pr if any set was a PR (0250). Legacy
 * batch-logged rows carry no PR flag, so they simply never show one.
 */
async function fetchWorkoutRows(checkInId: string): Promise<WorkoutRow[]> {
  const { data, error } = await supabase
    .from('check_in_workout_sets')
    .select('exercise, sets, reps, weight, is_pr')
    .eq('check_in_id', checkInId)
    .order('position');
  if (error) throw error;
  return (data ?? []) as WorkoutRow[];
}

type Fetched = {
  /** The check-in these were fetched for — a session-specific piece is ignored for any other. */
  forCheckIn: string | null;
  rank: MyRank | null;
  patron: StickerModel['patron'];
  board: { board: 'My uni' | 'Global'; rank: number } | null;
  gymVolumeLb: number;
  workout: WorkoutRow[];
};

const EMPTY: Fetched = { forCheckIn: null, rank: null, patron: null, board: null, gymVolumeLb: 0, workout: [] };

export function useStickerModel(session: StickerSession | null): { model: StickerModel | null } {
  const { profile } = useAuth();
  const [fetched, setFetched] = useState<Fetched>(EMPTY);
  const userId = profile?.id ?? null;
  const checkInId = session?.checkInId ?? null;
  const isGym = session?.goalType === 'gym';

  useEffect(() => {
    if (!checkInId) return;
    let cancelled = false;
    const soft = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
    void Promise.all([
      soft(fetchMyRanks().then((rs) => rs.find((r) => r.scope === 'universal') ?? null), null),
      soft(
        Promise.resolve(supabase.rpc('get_my_program')).then(({ data, error }) => {
          const row = error ? null : data?.[0];
          return row ? { key: row.patron_key, name: row.patron_name, program: row.name } : null;
        }),
        null
      ),
      userId ? soft(fetchUserBoardPosition(userId), null) : Promise.resolve(null),
      isGym ? soft(fetchGymVolumeLb(checkInId), 0) : Promise.resolve(0),
      isGym ? soft(fetchWorkoutRows(checkInId), []) : Promise.resolve([]),
    ]).then(([rank, patron, board, gymVolumeLb, workout]) => {
      if (cancelled) return;
      setFetched({ forCheckIn: checkInId, rank, patron, board, gymVolumeLb, workout });
    });
    return () => {
      cancelled = true;
    };
  }, [checkInId, userId, isGym]);

  if (!session) return { model: null };

  const unit = profile?.weight_unit === 'kg' ? 'kg' : 'lb';
  const sameSession = fetched.forCheckIn === session.checkInId;
  let disciplineLine: string | null = null;
  if (session.goalType === 'run' && session.distanceM && session.distanceM > 0) {
    disciplineLine = `${formatDistanceKm(session.distanceM)} · ${pacePerKm(session.durationSeconds, session.distanceM)}`;
  } else if (session.goalType === 'gym' && sameSession && fetched.gymVolumeLb > 0) {
    const amount = unit === 'kg' ? fetched.gymVolumeLb / LB_PER_KG : fetched.gymVolumeLb;
    disciplineLine = `${Math.round(amount).toLocaleString()} ${unit} moved`;
  }

  // The tracker logs in lb; a kg profile sees its own unit, rounded to the plate it would be.
  const exercises: StickerExercise[] =
    session.goalType === 'gym' && sameSession
      ? fetched.workout.map((w) => {
          const weight = w.weight != null && w.weight > 0 ? (unit === 'kg' ? w.weight / LB_PER_KG : Number(w.weight)) : null;
          const shown = weight == null ? null : unit === 'kg' ? Math.round(weight * 2) / 2 : Math.round(weight);
          return {
            name: w.exercise,
            sets: w.sets,
            topSet: shown == null ? `${w.reps} reps` : `${shown.toLocaleString()} ${unit} × ${w.reps}`,
            isPr: w.is_pr === true,
          };
        })
      : [];

  let campus: StickerModel['campus'] = null;
  if (fetched.board) {
    const uni = profile?.university ? shortUniversityName(profile.university) : null;
    const onUni = fetched.board.board === 'My uni' && uni;
    campus = {
      value: `#${fetched.board.rank.toLocaleString()}`,
      label: onUni ? uni.toUpperCase() : 'GLOBAL',
      phrase: onUni ? `#${fetched.board.rank} at ${uni}` : `#${fetched.board.rank.toLocaleString()} global`,
    };
  }

  return {
    model: {
      handle: profile?.handle ?? null,
      patron: fetched.patron,
      clock: heroClock(session.durationSeconds),
      goalLabel: session.goalDetail || GOAL_TYPE_META[session.goalType].label,
      disciplineLine,
      xpEarned: session.xpEarned,
      rank: fetched.rank ? buildRank(fetched.rank) : null,
      streakDays: session.streakDays ?? profile?.current_streak ?? 0,
      campus,
      exercises,
    },
  };
}
