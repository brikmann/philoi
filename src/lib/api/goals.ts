import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type { Goal, GoalType, MyRank, RankUpReward } from '@/types/database';

export async function fetchMyGoals(userId: string): Promise<Goal[]> {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createGoal(input: {
  userId: string;
  type: GoalType;
  label: string | null;
  cadence: string;
}): Promise<Goal> {
  // The name is normalised before it is sent so the collision below is the SAME comparison the
  // index makes — `goals_one_active_per_type_name` is unique on lower(btrim(label)) (migration
  // 0143). Trimming here and not there would let "KP231 " insert cleanly and then fail, and
  // trimming there and not here would make the recovery below miss the row it just collided with.
  const label = input.label?.trim() || null;

  const { data, error } = await supabase
    .from('goals')
    .insert({ user_id: input.userId, type: input.type, label, cadence: input.cadence })
    .select('*')
    .single();

  if (error) {
    // 🐛 GROUP, DON'T DUPLICATE. Until 0143 this index was (user_id, type) and this branch said
    // "you already have an active study goal — archive it first", because one goal per category was
    // the rule. That rule is what forced a second named goal to be filed as type='custom', and
    // session_discipline('custom') is null by design — so the name silently cost the goal its place
    // on the discipline ladder. See 0143 §3.
    //
    // Now the collision means something narrower and friendlier: this exact name already exists
    // under this exact category. The goal the user asked for is already there, so hand it back
    // rather than raising — "create KP231 under Study" twice should land on one Study goal, not an
    // error and not a twin.
    if (error.code === '23505') {
      const existing = await findGoal(input.userId, input.type, label);
      if (existing) return existing;
    }
    throw error;
  }

  track('goal_created', { goal_type: input.type, cadence: input.cadence, named: label !== null });
  return data;
}

/**
 * The active goal under one category with one name, or null.
 *
 * `label` null means the category's own unnamed goal ("Study"), which is a different row from
 * "Study / KP231" and must not match it — hence `is('label', null)` rather than an equality test
 * against null, which in SQL matches nothing.
 *
 * Matched case-insensitively on a trimmed name for the same reason the index is: "kp231" and
 * "KP231" are one goal to the person who typed them.
 */
export async function findGoal(userId: string, type: GoalType, label: string | null): Promise<Goal | null> {
  let q = supabase.from('goals').select('*').eq('user_id', userId).eq('type', type).is('archived_at', null);
  q = label === null ? q.is('label', null) : q.ilike('label', label.trim());
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function updateGoalLabel(goalId: string, label: string | null): Promise<void> {
  const { error } = await supabase
    .from('goals')
    .update({ label: label?.trim() || null })
    .eq('id', goalId);
  if (error) throw error;
}

export async function archiveGoal(goalId: string, goalType: GoalType): Promise<void> {
  const { error } = await supabase.from('goals').update({ archived_at: new Date().toISOString() }).eq('id', goalId);
  if (error) throw error;
  track('goal_archived', { type: goalType });
}

/**
 * What the user's most recent rank-up paid.
 *
 * Best-effort by design: the celebration is the point, and a failed read must never stop it
 * playing. Null just means the reward line is omitted — which is exactly what every rank-up did
 * before 0142 anyway.
 */
export async function fetchLastRankUpReward(): Promise<RankUpReward | null> {
  const { data, error } = await supabase.rpc('get_my_last_rank_up_reward');
  if (error) return null;
  return (data as RankUpReward[] | null)?.[0] ?? null;
}

export async function fetchMyRanks(): Promise<MyRank[]> {
  const { data, error } = await supabase.rpc('get_my_ranks');
  if (error) throw error;
  return data ?? [];
}
