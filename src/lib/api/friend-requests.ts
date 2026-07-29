import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';

// The real friend graph (PHILOI_UI_SPEC.md §4b/§16, design-mocks/34/35) — a friend is an
// explicit mutual add (send -> accept/decline), not campfire co-membership. See migration
// 0031_real_friend_graph.sql for the state machine this wraps: none -> requested/incoming ->
// friends, or back to none via decline/cancel.

export type Relationship = 'none' | 'requested' | 'incoming' | 'friends';

export type PersonSearchResult = {
  user_id: string;
  display_name: string;
  handle: string | null;
  university: string | null;
  avatar_url: string | null;
  relationship: Relationship;
  mutual_circle_name: string | null;
};

export type SuggestedPerson = {
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  mutual_circle_name: string | null;
};

export type PendingFriendRequest = {
  request_user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  direction: 'incoming' | 'sent';
  mutual_count: number;
  mutual_circle_name: string | null;
};

export async function searchPeople(query: string, limit = 20): Promise<PersonSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const { data, error } = await supabase.rpc('search_people', { p_query: trimmed, p_limit: limit });
  if (error) throw error;
  return data ?? [];
}

export async function fetchSuggestedPeople(limit = 10): Promise<SuggestedPerson[]> {
  const { data, error } = await supabase.rpc('suggested_people', { p_limit: limit });
  if (error) throw error;
  return data ?? [];
}

export async function fetchPendingFriendRequests(): Promise<PendingFriendRequest[]> {
  const { data, error } = await supabase.rpc('get_pending_friend_requests');
  if (error) throw error;
  return data ?? [];
}

export async function sendFriendRequest(userId: string): Promise<void> {
  const { error } = await supabase.rpc('send_friend_request', { p_user_id: userId });
  if (error) throw error;
  track('friend_request_sent', { to_user_id: userId });
}

export async function respondFriendRequest(userId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_friend_request', { p_user_id: userId, p_accept: accept });
  if (error) throw error;
  track(accept ? 'friend_request_accepted' : 'friend_request_declined', { from_user_id: userId });
}

export async function cancelFriendRequest(userId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_friend_request', { p_user_id: userId });
  if (error) throw error;
  track('friend_request_cancelled', { to_user_id: userId });
}
