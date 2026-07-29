import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type { Goal, GoalType, MyRank } from '@/types/database';

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
  const { data, error } = await supabase
    .from('goals')
    .insert({ user_id: input.userId, type: input.type, label: input.label, cadence: input.cadence })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new Error(`You already have an active ${input.type} goal — archive it first to start a new one.`);
    }
    throw error;
  }
  track('goal_created', { goal_type: input.type, cadence: input.cadence });
  return data;
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

export async function fetchMyRanks(): Promise<MyRank[]> {
  const { data, error } = await supabase.rpc('get_my_ranks');
  if (error) throw error;
  return data ?? [];
}
