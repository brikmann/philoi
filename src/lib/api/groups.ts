import { supabase } from '@/lib/supabase';
import type { Group, GoalType, LeaderboardRow, WeeklyRecap } from '@/types/database';

export type MyGroup = Group & {
  current_streak: number;
  longest_streak: number;
  checked_in_today: boolean;
};

export async function fetchMyGroups(userId: string): Promise<MyGroup[]> {
  const { data: memberships, error } = await supabase
    .from('group_members')
    .select('current_streak, longest_streak, groups(*)')
    .eq('user_id', userId);
  if (error) throw error;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data: todaysCheckIns, error: checkInsError } = await supabase
    .from('check_ins')
    .select('group_id')
    .eq('user_id', userId)
    .gte('created_at', startOfDay.toISOString());
  if (checkInsError) throw checkInsError;

  const checkedInGroupIds = new Set(todaysCheckIns?.map((c) => c.group_id));

  return (memberships ?? [])
    .filter((m) => m.groups)
    .map((m) => ({
      ...(m.groups as unknown as Group),
      current_streak: m.current_streak,
      longest_streak: m.longest_streak,
      checked_in_today: checkedInGroupIds.has((m.groups as unknown as Group).id),
    }));
}

export async function fetchGroup(groupId: string): Promise<Group> {
  const { data, error } = await supabase.from('groups').select('*').eq('id', groupId).single();
  if (error) throw error;
  return data;
}

export async function createGroup(input: {
  name: string;
  emoji: string;
  goalType: GoalType;
  cadence: string;
}): Promise<Group> {
  const { data, error } = await supabase.rpc('create_group_with_owner', {
    p_name: input.name,
    p_emoji: input.emoji,
    p_goal_type: input.goalType,
    p_cadence: input.cadence,
  });
  if (error) throw error;
  return data;
}

export async function joinGroupWithCode(code: string): Promise<Group> {
  const { data, error } = await supabase.rpc('join_group_with_code', { p_code: code });
  if (error) throw error;
  return data;
}

export async function fetchLeaderboard(groupId: string): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_group_leaderboard', { p_group_id: groupId });
  if (error) throw error;
  return data ?? [];
}

export async function fetchWeeklyRecap(userId: string): Promise<WeeklyRecap[]> {
  const { data, error } = await supabase.rpc('get_weekly_recap', { p_user_id: userId });
  if (error) throw error;
  return data ?? [];
}

export async function fetchInviteLink(groupId: string, joinCode: string) {
  return {
    code: joinCode,
    deepLink: `philoi://join?code=${joinCode}`,
    webLink: `https://getphiloi.com/join/${joinCode}`,
  };
}

export async function ensurePersonalInviteCode(): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_personal_invite', {});
  if (error) throw error;
  return data;
}
