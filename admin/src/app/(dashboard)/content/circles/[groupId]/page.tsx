import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/require-admin';
import { createClient } from '@/lib/supabase/server';
import { logAdminEvent } from '@/lib/audit';
import type { ChatMessage, CheckIn, Group } from '@/lib/types';

const PHOTO_BUCKET = 'check-in-photos';

type Member = { user_id: string; role: string; display_name: string; handle: string | null };

export default async function CircleDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { userId } = await requireAdmin();
  const supabase = await createClient();
  const { groupId } = await params;

  const { data: group } = await supabase.from('groups').select('*').eq('id', groupId).single<Group>();
  if (!group) notFound();

  const [{ data: memberRows }, { data: messages }] = await Promise.all([
    supabase.from('group_members').select('user_id, role, profiles(display_name, handle)').eq('group_id', groupId),
    supabase.from('messages').select('*').eq('group_id', groupId).order('created_at', { ascending: false }).limit(30),
  ]);

  const members = (memberRows ?? []).map((m) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return {
      user_id: m.user_id,
      role: m.role,
      display_name: profile?.display_name ?? 'unknown',
      handle: profile?.handle ?? null,
    } as Member;
  });

  // check_ins has no group_id anymore (a check-in belongs to a goal, fans out to every
  // circle its owner is in) — read by current member ids instead, same as the mobile
  // app's fetchFeed().
  const memberIds = members.map((m) => m.user_id);
  const { data: checkIns } =
    memberIds.length > 0
      ? await supabase
          .from('check_ins')
          .select('*')
          .in('user_id', memberIds)
          .order('created_at', { ascending: false })
          .limit(20)
      : { data: [] };

  const checkInRows = (checkIns ?? []) as CheckIn[];
  const signedByPath = new Map<string, string>();
  if (checkInRows.length > 0) {
    const { data: signed } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(checkInRows.map((c) => c.photo_url), 60 * 60);
    for (const s of signed ?? []) {
      if (s.signedUrl) signedByPath.set(s.path ?? '', s.signedUrl);
    }
  }

  await logAdminEvent(supabase, userId, 'content_view', 'group', groupId, { name: group.name });

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">
        {group.emoji} {group.name}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {members.length} members · created {new Date(group.created_at).toLocaleDateString()}
      </p>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Members</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {members.map((m) => (
            <li key={m.user_id}>
              <Link
                href={`/content/users/${m.user_id}`}
                className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-slate-100"
              >
                <span>
                  {m.display_name} {m.handle && <span className="text-slate-400">@{m.handle}</span>}
                </span>
                <span className="text-xs text-slate-400">{m.role}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent check-ins</h2>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {checkInRows.map((c) => (
            <div key={c.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              {signedByPath.get(c.photo_url) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={signedByPath.get(c.photo_url)} alt="Check-in" className="h-32 w-full object-cover" />
              )}
              <div className="p-2">
                <p className="text-[11px] font-semibold text-slate-600">{c.goal_label || c.goal_type}</p>
                <p className="truncate text-xs text-slate-500">{c.caption ?? ''}</p>
                <p className="text-[11px] text-slate-400">{new Date(c.created_at).toLocaleString()}</p>
                {c.removed_at && <p className="text-[11px] font-semibold text-red-600">removed</p>}
              </div>
            </div>
          ))}
          {checkInRows.length === 0 && <p className="text-sm text-slate-500">No check-ins yet.</p>}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent messages</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {((messages ?? []) as ChatMessage[]).map((m) => (
            <li key={m.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
              {m.deleted_at ? <em className="text-slate-400">[deleted]</em> : m.body}
              <span className="ml-2 text-[11px] text-slate-400">{new Date(m.created_at).toLocaleString()}</span>
            </li>
          ))}
          {(messages ?? []).length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
        </ul>
      </section>
    </div>
  );
}
