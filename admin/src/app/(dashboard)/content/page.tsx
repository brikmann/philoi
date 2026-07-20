import Link from 'next/link';
import { requireAdmin } from '@/lib/require-admin';
import { createClient } from '@/lib/supabase/server';
import type { Group, Profile } from '@/lib/types';

export default async function ContentBrowserPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; user?: string }>;
}) {
  await requireAdmin();
  const supabase = await createClient();
  const { q, user } = await searchParams;

  let query = supabase.from('groups').select('*').order('created_at', { ascending: false }).limit(50);
  if (q) query = query.ilike('name', `%${q}%`);
  const { data: groups } = await query;

  let users: Profile[] | null = null;
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .or(`display_name.ilike.%${user}%,handle.ilike.%${user}%`)
      .limit(20);
    users = data as Profile[] | null;
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Content browser</h1>
      <p className="mt-1 text-sm text-slate-500">
        Read-only. Every circle and user you open here is logged to the audit trail.
      </p>

      <form className="mt-4 flex gap-2" action="/content">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search circles by name…"
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white">
          Search
        </button>
      </form>

      <ul className="mt-6 flex flex-col gap-2">
        {(groups as Group[] | null)?.map((g) => (
          <li key={g.id}>
            <Link
              href={`/content/circles/${g.id}`}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-400"
            >
              <span className="text-sm font-medium text-slate-800">
                {g.emoji} {g.name}
              </span>
              <span className="text-xs text-slate-400">{new Date(g.created_at).toLocaleDateString()}</span>
            </Link>
          </li>
        ))}
        {groups?.length === 0 && <p className="text-sm text-slate-500">No circles match.</p>}
      </ul>

      <h2 className="mt-10 text-sm font-semibold text-slate-700">Search users</h2>
      <form className="mt-2 flex gap-2" action="/content">
        <input
          type="text"
          name="user"
          defaultValue={user ?? ''}
          placeholder="Search by name or handle…"
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white">
          Search
        </button>
      </form>

      {users && (
        <ul className="mt-4 flex flex-col gap-2">
          {users.map((u) => (
            <li key={u.id}>
              <Link
                href={`/content/users/${u.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-400"
              >
                <span className="text-sm font-medium text-slate-800">
                  {u.display_name} {u.handle && <span className="text-slate-400">@{u.handle}</span>}
                </span>
                {u.is_disabled && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                    disabled
                  </span>
                )}
              </Link>
            </li>
          ))}
          {users.length === 0 && <p className="text-sm text-slate-500">No users match.</p>}
        </ul>
      )}
    </div>
  );
}
