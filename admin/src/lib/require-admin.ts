import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';

// Defense in depth on top of middleware.ts — every server component/route handler that
// touches admin data calls this first, rather than trusting middleware alone to have
// gated the request.
export async function requireAdmin(): Promise<{ userId: string; profile: Profile }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();

  if (!profile || !profile.is_admin) {
    redirect('/not-authorized');
  }

  return { userId: user.id, profile: profile as Profile };
}
