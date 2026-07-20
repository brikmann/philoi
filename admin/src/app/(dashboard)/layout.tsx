import { requireAdmin } from '@/lib/require-admin';
import { createClient } from '@/lib/supabase/server';
import { Nav } from '@/components/nav';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireAdmin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav adminEmail={user?.email ?? profile.display_name} />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
