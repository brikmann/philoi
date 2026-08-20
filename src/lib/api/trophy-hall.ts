import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type { HideableKind, PublicCollection, TrophyHall } from '@/types/database';

// §4 + §7 — the Trophy Hall and the Collection browse (migration 0092).
//
// Both take a user id rather than reading "me", because both render on someone else's profile as
// well as your own; the server decides what a visitor sees and returns the same shape either way,
// with `is_owner` saying which of the two you got.

export async function fetchTrophyHall(userId: string): Promise<TrophyHall> {
  const { data, error } = await supabase.rpc('get_trophy_hall', { p_user: userId });
  if (error) throw error;
  return data as TrophyHall;
}

export async function fetchPublicCollection(userId: string): Promise<PublicCollection> {
  const { data, error } = await supabase.rpc('get_public_collection', { p_user: userId });
  if (error) throw error;
  return data as PublicCollection;
}

/**
 * Hide or unhide one trophy, one collection item, one season card, or the duel record.
 *
 * `key` is namespaced by `kind`: a cosmetic_key, a badge_key, a season_id, or the literal 'record'.
 * The server rejects any other kind rather than silently writing a row nothing will ever read.
 */
export async function setProfileItemHidden(kind: HideableKind, key: string, hidden: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_profile_item_hidden', { p_kind: kind, p_key: key, p_hidden: hidden });
  if (error) throw error;
  track('trophy_item_hidden', { kind, hidden });
}

/** The record's shorthand. Draws are excluded from the denominator — see duel_record() in 0092. */
export function winRate(won: number, lost: number): number | null {
  const decided = won + lost;
  if (decided === 0) return null;
  return Math.round((won / decided) * 100);
}
