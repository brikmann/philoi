import { createBrowserClient } from '@supabase/ssr';

// Browser client — used only by the login page to request a magic link. Anon key only.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
