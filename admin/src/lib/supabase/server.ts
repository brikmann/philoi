import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// User-scoped client: runs under the signed-in admin's own session, so every read/write
// it does is gated by the is_admin()-checked RLS policies added in
// supabase/migrations/0001_admin_dashboard.sql — never the service-role key.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component that can't set cookies — middleware already
            // refreshes the session on every request, so this is safe to ignore.
          }
        },
      },
    }
  );
}
