import { GYM_SPARK } from '@/constants/feature-flags';
import { supabase } from '@/lib/supabase';
import type { GrindAlike, MatchDetail, MatchScope, MatchSettings } from '@/types/social';

// Grind-alikes (0275, CODE_PROMPT_matchmaking.md, mock 299) — non-competitive discovery: people
// whose lock-in habits, goals and field line up with yours, with the reasons shown. Mutual: off =
// you match no one and see no one. Gym Spark (0303): ON by default — every profile has a discoverable
// row and new signups get one by trigger; Settings' "Show me in matching" is the off-switch. No stranger contact is added here — a match
// offers Add friend and Challenge; cheer/message stays mutual-friends-only (0270).

export async function fetchMyMatchSettings(): Promise<MatchSettings> {
  const { data, error } = await supabase.rpc('get_my_match_settings');
  if (error) throw error;
  // Display-only fallback for "no row yet" (nothing writes it back). Gym Spark mirrors 0303's default
  // (discoverable true); the legacy app keeps 0275's opt-in default.
  return (data as MatchSettings | null) ?? { discoverable: GYM_SPARK, match_scope: 'uni', find_me: 'same_uni', show_live: false };
}

export async function setMyMatchSettings(patch: Partial<MatchSettings>): Promise<MatchSettings> {
  const { data, error } = await supabase.rpc('set_my_match_settings', { p_patch: patch });
  if (error) throw error;
  return data as MatchSettings;
}

/** Empty unless you've opted in. `scope` narrows your own search for this call only. */
export async function fetchGrindAlikes(scope?: MatchScope, limit = 20): Promise<GrindAlike[]> {
  const { data, error } = await supabase.rpc('get_grind_alikes', { p_limit: limit, p_scope: scope ?? null });
  if (error) throw error;
  return (data as GrindAlike[] | null) ?? [];
}

/** Null unless the pair is admissible right now (or you're already friends). */
export async function fetchMatchDetail(userId: string): Promise<MatchDetail | null> {
  const { data, error } = await supabase.rpc('get_match_detail', { p_user: userId });
  if (error) throw error;
  return (data as MatchDetail | null) ?? null;
}

export const MATCH_SCOPE_LABELS: Record<MatchScope, string> = {
  program: 'My program',
  uni: 'My uni',
  wider: 'Anywhere',
};

export const FIND_ME_LABELS: Record<MatchSettings['find_me'], string> = {
  everyone: 'Everyone',
  friends_of_friends: 'Friends of friends',
  same_uni: 'Same uni',
};
