import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type {
  ActiveChallengeMarker,
  ChallengeWatch,
  GlobalLeaderboardRow,
  GroupChallengeWatchRow,
  LeaderboardSearchResult,
  ProfileRelationship,
  ProfileStats,
} from '@/types/database';

// Client wrappers for migration 0040_parthenon_leaderboard.sql — the Parthenon podium's Global
// scope, search, friend-profile support, and the Watch spectator read (PHILOI_UI_SPEC.md §15/16/18).

// The Leaderboard tab's "Global" scope (§15's 4th tab) — best individuals worldwide, same
// true-rank-pinning shape as fetchUniversityLeaderboard (see lib/api/groups.ts).
export async function fetchGlobalLeaderboard(limit = 50): Promise<GlobalLeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_global_leaderboard', { p_limit: limit });
  if (error) throw error;
  return data ?? [];
}

// The magnifier search (§15) — name or @handle, each result carrying its own live rank/board.
export async function searchLeaderboard(query: string, limit = 20): Promise<LeaderboardSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const { data, error } = await supabase.rpc('search_leaderboard', { p_query: trimmed, p_limit: limit });
  if (error) throw error;
  return data ?? [];
}

// The friend-profile's Add friend / Friends ✓ button state (§18, mock 43) — same relationship
// vocabulary as searchPeople()'s PersonSearchResult, plus 'self'.
export async function fetchRelationshipWith(userId: string): Promise<ProfileRelationship> {
  const { data, error } = await supabase.rpc('get_relationship_with', { p_user_id: userId });
  if (error) throw error;
  return data;
}

// Non-privacy-gated stat row + "Works on" chips for someone else's profile.
export async function fetchProfileStats(userId: string): Promise<ProfileStats> {
  const { data, error } = await supabase.rpc('get_profile_stats', { p_user_id: userId });
  if (error) throw error;
  return data[0];
}

// "#3 on My uni" / "#2,481 on Global" (punchlist 2, §1) — the friend-profile's board position.
export async function fetchUserBoardPosition(userId: string): Promise<{ board: 'My uni' | 'Global'; rank: number } | null> {
  const { data, error } = await supabase.rpc('get_user_board_position', { p_user_id: userId });
  if (error) throw error;
  return data?.[0] ?? null;
}

// The pulsing active-challenge marker (mock 37) — visible on your own fire always, a campfire
// co-member's row, or a friend's row/profile. Returns null when there's no visibility path or
// no active challenge.
export async function fetchActiveChallengeMarker(userId: string): Promise<ActiveChallengeMarker | null> {
  const { data, error } = await supabase.rpc('get_active_challenge_marker', { p_user_id: userId });
  if (error) throw error;
  return data?.[0] ?? null;
}

// The H2H live spectator read (§16) — throws if the caller doesn't have access (campfire
// co-member, or friend + the target's watch_opt_in), matching get_active_challenge_marker's
// can_watch gate but re-checked server-side.
export async function fetchChallengeWatch(challengeId: string): Promise<ChallengeWatch> {
  const { data, error } = await supabase.rpc('get_challenge_watch', { p_challenge_id: challengeId });
  if (error) throw error;
  return data[0];
}

// The group challenge's live per-member leaderboard (§16) — same access gate, campfire-membership shaped.
export async function fetchGroupChallengeWatch(challengeId: string): Promise<GroupChallengeWatchRow[]> {
  const { data, error } = await supabase.rpc('get_group_challenge_watch', { p_challenge_id: challengeId });
  if (error) throw error;
  return data ?? [];
}

// "Let friends watch my live challenges" (§16/§19) — default off.
export async function setMyWatchOptIn(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_my_watch_opt_in', { p_enabled: enabled });
  if (error) throw error;
  track('watch_opt_in_changed', { enabled });
}

// The Watch screen's Cheer action (§16) — H2H only, a live shared count both spectators see.
export async function cheerChallenge(challengeId: string, forUserId: string): Promise<void> {
  const { error } = await supabase.rpc('cheer_challenge', { p_challenge_id: challengeId, p_for_user_id: forUserId });
  if (error) throw error;
  track('challenge_watch_cheered', { challenge_id: challengeId, for_user_id: forUserId });
}
