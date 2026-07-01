import { supabase } from '@/lib/supabase';
import type { Group } from '@/types/database';

export async function sendTestNotification(): Promise<void> {
  const { error } = await supabase.rpc('send_test_notification', {});
  if (error) throw error;
}

export async function seedMyDemoCircle(): Promise<Group> {
  const { data, error } = await supabase.rpc('dev_seed_my_demo_circle', {});
  if (error) throw error;
  return data;
}

// Picks any is_demo member already in this circle so "Simulate a friend check-in" doesn't
// need its own friend-picker UI — dev_seed_my_demo_circle() is what actually puts them there.
export async function fetchOneDemoMember(groupId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('group_members')
    .select('user_id, profiles!inner(is_demo)')
    .eq('group_id', groupId)
    .eq('profiles.is_demo', true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.user_id ?? null;
}

export async function simulateFriendCheckIn(groupId: string, fakeUserId: string): Promise<void> {
  const { error } = await supabase.rpc('dev_simulate_friend_checkin', {
    p_group_id: groupId,
    p_fake_user_id: fakeUserId,
  });
  if (error) throw error;
}

export async function resetMyCheckIns(groupId?: string): Promise<void> {
  const { error } = await supabase.rpc('dev_reset_my_checkins', { p_group_id: groupId ?? null });
  if (error) throw error;
}
