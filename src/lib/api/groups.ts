import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type {
  DiscoverableGroup,
  Group,
  GoalType,
  LeaderboardRow,
  MyCircleRank,
  UniversityLeaderboardRow,
  WeeklyRecap,
} from '@/types/database';

export type MyGroup = Group & {
  current_streak: number;
  longest_streak: number;
  checked_in_today: boolean;
  chat_muted: boolean;
};

export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_account', {});
  if (error) throw error;
}

export async function deleteGroup(groupId: string): Promise<void> {
  // RPC, not a direct table delete — see delete_group() in schema.sql for why (RLS blocks
  // the cascade across other members' rows otherwise).
  const { error } = await supabase.rpc('delete_group', { p_group_id: groupId });
  if (error) throw error;
}

export async function leaveGroup(groupId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId);
  if (error) throw error;
}

export async function fetchMyGroups(userId: string): Promise<MyGroup[]> {
  const { data: memberships, error } = await supabase
    .from('group_members')
    .select('current_streak, longest_streak, chat_muted, groups(*)')
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
      chat_muted: m.chat_muted,
      checked_in_today: checkedInGroupIds.has((m.groups as unknown as Group).id),
    }));
}

export async function fetchGroup(groupId: string): Promise<Group> {
  const { data, error } = await supabase.from('groups').select('*').eq('id', groupId).single();
  if (error) throw error;
  return data;
}

export async function setChatMuted(groupId: string, muted: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_chat_muted', { p_group_id: groupId, p_muted: muted });
  if (error) throw error;
}

export async function fetchMyStreak(
  groupId: string,
  userId: string
): Promise<{ current_streak: number; longest_streak: number }> {
  const { data, error } = await supabase
    .from('group_members')
    .select('current_streak, longest_streak')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function createGroup(input: {
  name: string;
  emoji: string;
  goalType: GoalType;
  cadence: string;
  isPublic?: boolean;
}): Promise<Group> {
  const { data, error } = await supabase.rpc('create_group_with_owner', {
    p_name: input.name,
    p_emoji: input.emoji,
    p_goal_type: input.goalType,
    p_cadence: input.cadence,
    p_is_public: input.isPublic ?? false,
  });
  if (error) throw error;
  track('circle_created', { group_id: data.id, goal_type: input.goalType, is_public: input.isPublic ?? false });
  return data;
}

export async function joinGroupWithCode(code: string): Promise<Group> {
  const { data, error } = await supabase.rpc('join_group_with_code', { p_code: code });
  if (error) throw error;
  track('circle_joined', { group_id: data.id, via: 'code' });
  return data;
}

export async function joinPublicGroup(groupId: string): Promise<Group> {
  const { data, error } = await supabase.rpc('join_public_group', { p_group_id: groupId });
  if (error) throw error;
  track('circle_joined', { group_id: data.id, via: 'discovery' });
  return data;
}

export async function fetchDiscoverableGroups(goalType?: GoalType): Promise<DiscoverableGroup[]> {
  const { data, error } = await supabase.rpc('get_discoverable_groups', {
    p_goal_type: goalType ?? null,
    p_limit: 20,
  });
  if (error) throw error;
  return data ?? [];
}

export async function fetchUniversityMemberCount(university: string): Promise<number> {
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('university', university);
  if (error) throw error;
  return count ?? 0;
}

export async function fetchLeaderboard(groupId: string): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_group_leaderboard', { p_group_id: groupId });
  if (error) throw error;
  return data ?? [];
}

export async function setMyGoalTarget(groupId: string, goalTarget: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_my_goal_target', {
    p_group_id: groupId,
    p_goal_target: goalTarget,
  });
  if (error) throw error;
}

export async function fetchUniversityLeaderboard(university: string): Promise<UniversityLeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_university_leaderboard', {
    p_university: university,
    p_limit: 50,
  });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMyCircleRanks(): Promise<MyCircleRank[]> {
  const { data, error } = await supabase.rpc('get_my_circle_ranks');
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
