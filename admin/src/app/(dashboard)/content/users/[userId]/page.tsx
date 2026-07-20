import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/require-admin';
import { createClient } from '@/lib/supabase/server';
import { logAdminEvent } from '@/lib/audit';
import type { ChatMessage, CheckIn, Profile } from '@/lib/types';

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId: adminId } = await requireAdmin();
  const supabase = await createClient();
  const { userId } = await params;

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single<Profile>();
  if (!profile) notFound();

  const [{ data: checkIns }, { data: messages }, { data: reports }] = await Promise.all([
    supabase.from('check_ins').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(15),
    supabase
      .from('messages')
      .select('*, groups(name, emoji)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(15),
    supabase
      .from('moderation_reports')
      .select('id, reason, status, category, created_at')
      .eq('reported_user_id', userId)
      .order('created_at', { ascending: false }),
  ]);

  await logAdminEvent(supabase, adminId, 'content_view', 'user', userId, { display_name: profile.display_name });

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-900">{profile.display_name}</h1>
        {profile.handle && <span className="text-sm text-slate-400">@{profile.handle}</span>}
        {profile.is_disabled && (
          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
            Disabled {profile.disabled_at && `· ${new Date(profile.disabled_at).toLocaleDateString()}`}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Joined {new Date(profile.created_at).toLocaleDateString()}
        {profile.university && ` · ${profile.university}`}
      </p>

      {(reports?.length ?? 0) > 0 && (
        <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Reports against this user ({reports?.length})
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            {reports?.map((r) => (
              <li key={r.id} className="text-sm text-amber-900">
                <a href={`/moderation/${r.id}`} className="underline">
                  {r.reason}
                </a>{' '}
                <span className="text-xs text-amber-600">
                  ({r.status}, {new Date(r.created_at).toLocaleDateString()})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent check-ins</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {((checkIns ?? []) as CheckIn[]).map((c) => (
            <li key={c.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
              {c.goal_label || c.goal_type} · {c.caption ?? 'no caption'}
              <span className="ml-2 text-[11px] text-slate-400">{new Date(c.created_at).toLocaleString()}</span>
              {c.removed_at && <span className="ml-2 text-[11px] font-semibold text-red-600">removed</span>}
            </li>
          ))}
          {(checkIns ?? []).length === 0 && <p className="text-sm text-slate-500">No check-ins.</p>}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent messages</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {((messages ?? []) as (ChatMessage & { groups: { name: string; emoji: string } | { name: string; emoji: string }[] })[]).map(
            (m) => {
              const g = Array.isArray(m.groups) ? m.groups[0] : m.groups;
              return (
                <li key={m.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-400">
                    {g?.emoji} {g?.name}:
                  </span>{' '}
                  {m.deleted_at ? <em className="text-slate-400">[deleted]</em> : m.body}
                  <span className="ml-2 text-[11px] text-slate-400">{new Date(m.created_at).toLocaleString()}</span>
                </li>
              );
            }
          )}
          {(messages ?? []).length === 0 && <p className="text-sm text-slate-500">No messages.</p>}
        </ul>
      </section>
    </div>
  );
}
