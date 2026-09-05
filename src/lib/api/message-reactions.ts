import { supabase } from '@/lib/supabase';

// MESSAGE REACTIONS (D6, migration 0171) — INSTAGRAM-DM SHAPED, NOT DISCORD-SHAPED.
//
// The one rule this whole module exists to keep: EACH PERSON HOLDS AT MOST ONE REACTION ON A
// MESSAGE. Not a count per emoji — a badge per person. The server enforces it with a primary key
// on (message_id, user_id), so this file never has to reconcile a tally, and a bug here can make
// the UI wrong but can never make the DATA into a count pile.
//
// That is also why there is no `addReaction`/`removeReaction` pair. There is one call, and the
// server decides the verb: a new emoji sets, a different emoji swaps, the SAME emoji clears. The
// two remove affordances the design asks for — tap your own badge on the bubble, or tap your
// highlighted emoji in the tray — are the same call with the emoji you already hold.

export type MessageReaction = {
  message_id: string;
  user_id: string;
  emoji: string;
};

/** Reactions on a campfire's messages, grouped by message id. */
export type ReactionsByMessage = Map<string, MessageReaction[]>;

/**
 * Every reaction in one campfire, grouped by message.
 *
 * Scoped by group rather than by the ids currently on screen, for the same reason the realtime
 * subscription is: the timeline pages, and a per-page fetch would re-request on every scroll and
 * still miss a reaction landing on a message that has scrolled just off. RLS already restricts
 * this to campfires the caller is in and drops rows from people they have blocked.
 */
export async function fetchCampfireReactions(groupId: string): Promise<ReactionsByMessage> {
  const { data, error } = await supabase
    .from('message_reactions')
    .select('message_id, user_id, emoji')
    .eq('group_id', groupId);
  if (error) throw error;

  const byMessage: ReactionsByMessage = new Map();
  for (const row of (data ?? []) as MessageReaction[]) {
    const list = byMessage.get(row.message_id) ?? [];
    list.push(row);
    byMessage.set(row.message_id, list);
  }
  return byMessage;
}

/**
 * Set, swap or clear the caller's single reaction on a message.
 *
 * Pass the emoji they already hold to remove it — that is the toggle, and it is the server's
 * decision rather than this client's, so two devices tapping at once cannot disagree about whether
 * the row should exist.
 *
 * @returns the emoji now held, or null if the reaction was cleared.
 */
export async function setMessageReaction(messageId: string, emoji: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_message_reaction', {
    p_message_id: messageId,
    p_emoji: emoji,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/**
 * Live reactions for one campfire.
 *
 * Rides the same postgres_changes mechanism the message stream uses, filtered on the denormalised
 * `group_id` (which is exactly why migration 0171 carries that column). '*' rather than INSERT:
 * a reaction is as often swapped or removed as added, and an UPDATE or DELETE that never reached
 * the other devices is the "it worked on my phone" class of bug.
 *
 * Removals arrive because 0171 sets REPLICA IDENTITY FULL on the table — without it a DELETE's old
 * record carries only the primary key, no group_id, and this filter would silently drop it.
 */
export function subscribeToReactions(groupId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`message_reactions:${groupId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'message_reactions', filter: `group_id=eq.${groupId}` },
      onChange
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
