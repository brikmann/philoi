import { supabase } from '@/lib/supabase';

export type CampfireLevel = {
  group_id: string;
  xp: number;
  level: number;
  xp_into_level: number;
  xp_for_next_level: number;
};

// Shared group XP (PHILOI_UI_SPEC.md §6) — distinct from personal rank, accrued from lock-ins
// posted to this campfire (accrue_campfire_xp(), schema.sql). Callable by any member.
export async function fetchCampfireLevel(groupId: string): Promise<CampfireLevel> {
  const { data, error } = await supabase.rpc('get_campfire_level', { p_group_id: groupId });
  if (error) throw error;
  return data[0];
}
