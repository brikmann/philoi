import { supabase } from '@/lib/supabase';
import type { PresenceRow } from '@/types/database';

/**
 * "Locked in now" / "Online" / "Active 7m ago" (mock 273, migration 0245).
 *
 * Like lockin-presence.ts, this client decides nothing about WHO may see what. get_presence applies
 * every gate for the caller — verified campus, the three opt-outs, blocks, friendship, and the
 * reciprocal last-active rule — and hands back fields that are already safe to paint. If a screen
 * wants something this does not return, the thing to add is a field to the RPC, never a second read
 * of lock_in_sessions.
 */
export async function fetchPresence(userIds: string[]): Promise<PresenceRow[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase.rpc('get_presence', { p_user_ids: userIds });
  if (error) throw error;
  return data ?? [];
}

/** "I have the app open." Fired on foreground and every ~60s while active; throttled server-side. */
export async function touchPresence(): Promise<void> {
  const { error } = await supabase.rpc('touch_presence');
  if (error) throw error;
}

export type LiveStatusPrefs = {
  show_live_status?: boolean;
  show_live_activity?: boolean;
  show_last_active?: boolean;
};

/** Settings → Live status. Own row only (profiles' "update own" RLS). */
export async function setLiveStatusPrefs(userId: string, prefs: LiveStatusPrefs): Promise<void> {
  const { error } = await supabase.from('profiles').update(prefs).eq('id', userId);
  if (error) throw error;
}
