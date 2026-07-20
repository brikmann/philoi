import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/require-admin';
import { createClient } from '@/lib/supabase/server';
import { logAdminEvent } from '@/lib/audit';
import { ActionButtons } from '@/components/action-buttons';
import type { ChatMessage, ModerationReport, Profile } from '@/lib/types';

const PHOTO_BUCKET = 'check-in-photos';

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { userId } = await requireAdmin();
  const supabase = await createClient();
  const { reportId } = await params;

  const { data: report } = await supabase
    .from('moderation_reports')
    .select('*')
    .eq('id', reportId)
    .single<ModerationReport>();

  if (!report) notFound();

  const [{ data: reporter }, { data: reportedUser }] = await Promise.all([
    report.reporter_id
      ? supabase.from('profiles').select('*').eq('id', report.reporter_id).single<Profile>()
      : Promise.resolve({ data: null }),
    report.reported_user_id
      ? supabase.from('profiles').select('*').eq('id', report.reported_user_id).single<Profile>()
      : Promise.resolve({ data: null }),
  ]);

  let surroundingMessages: ChatMessage[] = [];
  let signedPhotoUrl: string | null = null;

  if (report.reported_message_id) {
    const { data: liveMessage } = await supabase
      .from('messages')
      .select('*')
      .eq('id', report.reported_message_id)
      .maybeSingle<ChatMessage>();

    if (liveMessage) {
      const anchor = liveMessage.created_at;
      const [{ data: before }, { data: after }] = await Promise.all([
        supabase
          .from('messages')
          .select('*')
          .eq('group_id', liveMessage.group_id)
          .lt('created_at', anchor)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('messages')
          .select('*')
          .eq('group_id', liveMessage.group_id)
          .gte('created_at', anchor)
          .order('created_at', { ascending: true })
          .limit(6),
      ]);
      surroundingMessages = [...(before ?? []).reverse(), ...(after ?? [])] as ChatMessage[];
    }
  } else if (report.reported_check_in_id && report.reported_content_snapshot?.type === 'check_in') {
    const { data: signed } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(report.reported_content_snapshot.photo_url, 60 * 60);
    signedPhotoUrl = signed?.signedUrl ?? null;
  }

  await logAdminEvent(supabase, userId, 'content_view', 'report', report.id, {
    category: report.category,
  });

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2">
        {report.category === 'csae' && (
          <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
            Child safety / CSAE
          </span>
        )}
        <span className="text-xs text-slate-400">{new Date(report.created_at).toLocaleString()}</span>
      </div>

      <h1 className="mt-2 text-lg font-semibold text-slate-900">{report.reason}</h1>
      <p className="mt-1 text-sm text-slate-500">
        Reported by {reporter?.display_name ?? 'unknown'}
        {reportedUser && <> · target: {reportedUser.display_name}</>}
      </p>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Reported content
        </h2>

        {report.reported_content_snapshot?.type === 'message' && (
          <div className="mt-3">
            {surroundingMessages.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {surroundingMessages.map((m) => (
                  <li
                    key={m.id}
                    className={`rounded-md px-3 py-2 text-sm ${
                      m.id === report.reported_message_id
                        ? 'border border-red-300 bg-red-50 font-medium text-slate-900'
                        : 'bg-slate-50 text-slate-600'
                    }`}
                  >
                    {m.deleted_at ? <em className="text-slate-400">[deleted]</em> : m.body}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800">
                {report.reported_content_snapshot.body}
                <span className="ml-2 text-xs text-slate-400">(preserved snapshot — message no longer live)</span>
              </p>
            )}
          </div>
        )}

        {report.reported_content_snapshot?.type === 'check_in' && (
          <div className="mt-3 flex gap-4">
            {signedPhotoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={signedPhotoUrl} alt="Reported check-in" className="h-40 w-40 rounded-md object-cover" />
            )}
            {report.reported_content_snapshot.caption && (
              <p className="text-sm text-slate-700">{report.reported_content_snapshot.caption}</p>
            )}
          </div>
        )}

        {report.reported_content_snapshot?.type === 'circle' && (
          <p className="mt-3 text-sm text-slate-700">
            Circle <span className="font-medium">{report.reported_content_snapshot.name}</span> was reported
            directly.
          </p>
        )}

        {!report.reported_content_snapshot && (
          <p className="mt-3 text-sm text-slate-500">No content snapshot — this report targets a profile.</p>
        )}
      </section>

      {report.note && (
        <p className="mt-3 text-sm text-slate-500">
          <span className="font-medium text-slate-700">Reporter note:</span> {report.note}
        </p>
      )}

      <ActionButtons
        reportId={report.id}
        status={report.status}
        isCsae={report.category === 'csae'}
        targetUserId={report.reported_user_id}
      />
    </div>
  );
}
