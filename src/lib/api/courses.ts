import { supabase } from '@/lib/supabase';
import type { UserCourse } from '@/types/database';

// The member's own courses — the second tap under Studying (0182,
// design-mocks/194-lockin-two-tap.html).
//
// Self-serve by design. There is no course catalog to enroll against and no registrar to
// integrate with, so a member's list is whatever they add. 0182 seeds it from the codes they were
// already typing into goal_detail ("EC120"), deliberately only where the text actually looks like
// a course code — a wrongly-invented course is worse than an absent one, because it becomes
// something they have to go and delete.
//
// Plain table reads rather than RPCs: user_courses carries owner-scoped RLS policies, so
// auth.uid() is the filter and there is nothing an RPC would add except indirection.

/** Live courses, newest last so a just-added one lands at the bottom of the list where it was
 *  added rather than jumping to the top of a list the member has learned the shape of. */
export async function fetchMyCourses(): Promise<UserCourse[]> {
  const { data, error } = await supabase
    .from('user_courses')
    .select('*')
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Adds a course. `code` is optional — a "Custom" entry (reading, job apps, a side project) is a
 * real choice in the mock and carries a title alone.
 *
 * Returns the existing row when the member already has that code live, rather than failing on the
 * unique index: someone re-adding KP390 means "I want KP390", and an error dialog telling them
 * they already have it would be technically true and useless.
 */
export async function addCourse(userId: string, title: string, code?: string | null): Promise<UserCourse> {
  const cleanTitle = title.trim();
  const cleanCode = code?.trim() ? code.trim().toUpperCase() : null;

  if (cleanCode) {
    const { data: existing } = await supabase
      .from('user_courses')
      .select('*')
      .is('archived_at', null)
      .eq('user_id', userId)
      .eq('code', cleanCode)
      .maybeSingle();
    if (existing) return existing;
  }

  const { data, error } = await supabase
    .from('user_courses')
    // user_id is explicit rather than defaulted: the column is NOT NULL with no default, and the
    // RLS insert policy checks it against auth.uid(), so omitting it fails twice over.
    .insert({ user_id: userId, code: cleanCode, title: cleanTitle || cleanCode || 'Custom' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Hides a course without deleting it — past lock-ins still point at this row, and a term ending
 *  must not orphan the sessions done for it. */
export async function archiveCourse(courseId: string): Promise<void> {
  const { error } = await supabase
    .from('user_courses')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', courseId);
  if (error) throw error;
}
