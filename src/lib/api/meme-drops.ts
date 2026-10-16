// Meme Monday drops (migration 0243). The schedule is a select-only table; buying is one RPC that
// prices the drop and checks its window server-side — the client sends the key and nothing else.

import { track } from '@/lib/analytics';
import type { CatalogItem } from '@/lib/economy/catalog';
import type { MemeDropRow } from '@/lib/economy/meme-drops';
import { supabase } from '@/lib/supabase';

export async function fetchMemeDropSchedule(): Promise<MemeDropRow[]> {
  const { data, error } = await supabase
    .from('meme_drop_schedule')
    .select('item_key, price_embers, unlocks_at, ends_at')
    .order('unlocks_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function buyMemeDrop(item: CatalogItem): Promise<number> {
  const { data, error } = await supabase.rpc('buy_meme_drop', { p_key: item.id });
  if (error) throw error;
  track('cosmetic_bought', { item: item.id, rarity: item.rarity, drop: true });
  return data.spent;
}
