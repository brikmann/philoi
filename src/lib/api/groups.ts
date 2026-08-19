import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type {
  CampfirePreview,
  CampfirePrivacy,
  CampfireStats,
  CrossCirclePerson,
  DiscoverableGroup,
  Group,
  GoalType,
  JoinRequest,
  LeaderboardRow,
  MyCircleRank,
  RankTierName,
  UniversityLeaderboardRow,
  UniversityTotal,
  WeeklyRecap,
} from '@/types/database';

export type MyGroup = Group & {
  chat_muted: boolean;
  // Per-user-per-campfire consent to auto-post a synced workout (migration 0038, §17b) —
  // publishing on the user's behalf, so opt-in, default off, never a fire that hasn't agreed.
  auto_post_synced: boolean;
};

// The onboarding university picker's canonical list (PHILOI_UI_SPEC.md §21) — small enough
// (a few dozen schools at most) to fetch once and filter client-side rather than round-trip
// on every keystroke.
export async function fetchUniversities(): Promise<string[]> {
  const { data, error } = await supabase.from('universities').select('name').order('name');
  if (error) throw error;
  return (data ?? []).map((row) => row.name);
}

// Full legal name -> colloquial short name (§Leaderboard punchlist 2, §1: "Laurier"/"Waterloo"
// on the board, full "Wilfrid Laurier University" in profile/settings). Every leaderboard RPC
// still returns the full name (profiles.university itself never changed) — this is a one-time
// lookup the client maps display strings through, same shape as fetchUniversities() above.
export async function fetchUniversityShortNames(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('universities').select('name, short_name');
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((row) => [row.name, row.short_name ?? row.name]));
}

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
    .select('chat_muted, auto_post_synced, groups(*)')
    .eq('user_id', userId);
  if (error) throw error;

  return (memberships ?? [])
    .filter((m) => m.groups)
    .map((m) => ({
      ...(m.groups as unknown as Group),
      chat_muted: m.chat_muted,
      auto_post_synced: m.auto_post_synced,
    }));
}

/** Per-campfire consent toggle for auto-posting synced workouts (§17b) — RPC-gated, not a direct
 * update, same pattern as every other group_members self-flag (chat mute, helper, goal target). */
export async function setMyAutoPostSynced(groupId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_my_auto_post_synced', { p_group_id: groupId, p_enabled: enabled });
  if (error) throw error;
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

// Direct table update, not an RPC — "groups: owner can update" RLS already restricts this
// to the circle's owner, and there's no derived/computed state to keep in sync here (unlike
// e.g. set_my_goal_target, which exists specifically to avoid exposing a raw update policy
// on a table with server-computed columns).
export async function updateGroup(groupId: string, input: { name: string; emoji: string }): Promise<Group> {
  const { data, error } = await supabase
    .from('groups')
    .update({ name: input.name, emoji: input.emoji })
    .eq('id', groupId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function createGroup(input: {
  name: string;
  emoji: string;
  goalType: GoalType;
  cadence: string;
  courseCode?: string | null;
  school?: string | null;
  privacy?: CampfirePrivacy;
}): Promise<Group> {
  const { data, error } = await supabase.rpc('create_group_with_owner', {
    p_name: input.name,
    p_emoji: input.emoji,
    p_goal_type: input.goalType,
    p_cadence: input.cadence,
    p_course_code: input.courseCode ?? null,
    p_school: input.school ?? null,
    p_privacy: input.privacy ?? 'open',
  });
  if (error) throw error;
  track('circle_created', {
    group_id: data.id,
    goal_type: input.goalType,
    privacy: input.privacy ?? 'open',
    is_class: Boolean(input.courseCode),
  });
  return data;
}

// Owner-only, editable any time (PHILOI_UI_SPEC.md §14) — transitions have server-side side
// effects (-> open auto-approves pending requests) so this is an RPC, not a direct update.
export async function updateCampfirePrivacy(groupId: string, privacy: CampfirePrivacy): Promise<Group> {
  const { data, error } = await supabase.rpc('update_campfire_privacy', { p_group_id: groupId, p_privacy: privacy });
  if (error) throw error;
  return data;
}

// The house rules behind design-mocks/94 — the join gate (min rank) and the one-line rule. Owner-
// only, gated inside the RPC. Passing null to either clears it.
export async function updateCampfireHouseRules(
  groupId: string,
  input: { minJoinTier: RankTierName | null; houseRule: string | null }
): Promise<Group> {
  const { data, error } = await supabase.rpc('update_campfire_house_rules', {
    p_group_id: groupId,
    p_min_join_tier: input.minJoinTier,
    p_house_rule: input.houseRule,
  });
  if (error) throw error;
  return data;
}

// The member view's stat strip. Returns null for a non-member (the RPC yields no row) rather than
// throwing — the strip is flavour, and a campfire you can't see stats for still opens.
export async function fetchCampfireStats(groupId: string): Promise<CampfireStats | null> {
  const { data, error } = await supabase.rpc('get_campfire_stats', { p_group_id: groupId });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchJoinRequests(groupId: string): Promise<JoinRequest[]> {
  const { data, error } = await supabase.rpc('list_join_requests', { p_group_id: groupId });
  if (error) throw error;
  return data ?? [];
}

export async function approveJoinRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_join_request', { p_request_id: requestId });
  if (error) throw error;
}

export async function denyJoinRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('deny_join_request', { p_request_id: requestId });
  if (error) throw error;
}

export async function approveAllJoinRequests(groupId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_all_join_requests', { p_group_id: groupId });
  if (error) throw error;
}

export async function setMyHelperFlag(groupId: string, isHelper: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_my_helper_flag', { p_group_id: groupId, p_is_helper: isHelper });
  if (error) throw error;
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

// Gated campfires (PHILOI_UI_SPEC.md §10) — pings the owner instead of joining instantly.
export async function requestToJoinGroup(groupId: string): Promise<void> {
  const { error } = await supabase.rpc('request_to_join_group', { p_group_id: groupId });
  if (error) throw error;
  track('circle_join_requested', { group_id: groupId });
}

// The valley's tap-to-preview sheet — works for non-members too (open/gated campfires),
// unlike get_campfire_level which requires membership.
export async function fetchCampfirePreview(groupId: string): Promise<CampfirePreview> {
  const { data, error } = await supabase.rpc('get_campfire_preview', { p_group_id: groupId });
  if (error) throw error;
  if (!data?.[0]) throw new Error('Campfire not found.');
  return data[0];
}

export async function fetchDiscoverableGroups(goalType?: GoalType, search?: string, limit = 20): Promise<DiscoverableGroup[]> {
  const { data, error } = await supabase.rpc('get_discoverable_groups', {
    p_goal_type: goalType ?? null,
    p_limit: limit,
    p_search: search?.trim() || null,
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

// The Leaderboard tab's "Campfires" scope (PHILOI_UI_SPEC.md §15) — everyone across every
// circle the caller is in, deduped by person, ranked by their own XP.
export async function fetchMyCrossCirclePeople(): Promise<CrossCirclePerson[]> {
  const { data, error } = await supabase.rpc('get_my_cross_circle_people');
  if (error) throw error;
  return data ?? [];
}

// The Leaderboard tab's "Vs. unis" scope — campus-vs-campus total XP.
export async function fetchUniversityTotals(): Promise<UniversityTotal[]> {
  const { data, error } = await supabase.rpc('get_university_totals', {});
  if (error) throw error;
  return data ?? [];
}

// Living-flame heat (0-1) per Campfire the caller belongs to — see get_my_campfire_heat()
// in schema.sql. Returned as a map for O(1) lookup per GroupCard rather than an array the
// UI would otherwise re-search on every render.
export async function fetchMyCampfireHeat(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('get_my_campfire_heat');
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((row) => [row.group_id, row.heat]));
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
