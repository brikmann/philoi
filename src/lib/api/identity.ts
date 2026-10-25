import { supabase } from '@/lib/supabase';
import type { DisciplineMixRow, IdentityPatch, ProfileIdentity } from '@/types/social';

// The identity profile (0272, CODE_PROMPT_identity_profile.md, mock 283). Identity fields live in
// profile_identity behind their own visibility dial — never on profiles, which is world-readable —
// so every read goes through these RPCs and the server decides what this viewer gets.

/** Header + identity fields + momentum strip (streak · rank + weekly trend · recent win). */
export async function fetchProfileIdentity(userId: string): Promise<ProfileIdentity | null> {
  const { data, error } = await supabase.rpc('get_profile_identity', { p_user: userId });
  if (error) throw error;
  return (data as ProfileIdentity | null) ?? null;
}

/** What they actually lock in on, computed from check-ins. Empty when the dial hides it. */
export async function fetchDisciplineMix(
  userId: string,
  window: 'season' | '30d' | 'all' = 'season'
): Promise<DisciplineMixRow[]> {
  const { data, error } = await supabase.rpc('get_discipline_mix', { p_user: userId, p_window: window });
  if (error) throw error;
  return (data as DisciplineMixRow[] | null) ?? [];
}

/** Saves only the keys in the patch. Free text runs the server's UGC filter. */
export async function setMyIdentity(patch: IdentityPatch): Promise<void> {
  const { error } = await supabase.rpc('set_my_identity', { p_patch: patch });
  if (error) throw error;
}

export const DISCIPLINE_LABELS: Record<DisciplineMixRow['bucket'], string> = {
  study: 'Study',
  deep_work: 'Deep work',
  gym: 'Gym',
  run: 'Run',
  other: 'Other',
};
