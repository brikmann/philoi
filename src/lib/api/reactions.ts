import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';

export async function addReaction(checkInId: string, userId: string, emoji: string) {
  const { error } = await supabase.from('reactions').insert({ check_in_id: checkInId, user_id: userId, emoji });
  if (error) throw error;
  track('reaction_added', { check_in_id: checkInId, emoji });
}

export async function removeReaction(checkInId: string, userId: string, emoji: string) {
  const { error } = await supabase
    .from('reactions')
    .delete()
    .eq('check_in_id', checkInId)
    .eq('user_id', userId)
    .eq('emoji', emoji);
  if (error) throw error;
}
