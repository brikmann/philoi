import Link from 'next/link';
import { requireAdmin } from '@/lib/require-admin';
import { createClient } from '@/lib/supabase/server';
import type { ModerationReport } from '@/lib/types';

// See metrics/page.tsx — Next's fetch Data Cache can serve stale Supabase results here too.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const STATUS_FILTERS = ['open', 'reviewed', 'actioned', 'dismissed', 'all'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const CATEGORY_LABEL: Record<string, string> = {
  csae: 'Child safety / CSAE',
  harassment: 'Harassment',
  spam: 'Spam',
  inappropriate: 'Inappropriate',
  other: 'Other',
};

export default async function ModerationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const supabase = await createClient();

  const { status: rawStatus } = await searchParams;
  const status: StatusFilter = STATUS_FILTERS.includes(rawStatus as StatusFilter)
    ? (rawStatus as StatusFilter)
    : 'open';

  let query = supabase.from('moderation_reports').select('*').order('created_at', { ascending: false });
  if (status === 'open') {
    query = query.in('status', ['pending', 'reviewed']);
  } else if (status !== 'all') {
    query = query.eq('status', status);
  }

  const { data } = await query;
  const reports = (data ?? []) as ModerationReport[];

  // CSAE sorted to the top regardless of timestamp, per the moderation spec.
  reports.sort((a, b) => {
    if (a.category === 'csae' && b.category !== 'csae') return -1;
    if (b.category === 'csae' && a.category !== 'csae') return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Moderation queue</h1>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f}
              href={`/moderation?status=${f}`}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize ${
                status === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {f}
            </Link>
          ))}
        </div>
      </div>

      {reports.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500">No reports in this view.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {reports.map((report) => (
            <li key={report.id}>
              <Link
                href={`/moderation/${report.id}`}
                className={`flex items-center justify-between rounded-lg border p-4 hover:border-slate-400 ${
                  report.category === 'csae' ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                        report.category === 'csae'
                          ? 'bg-red-600 text-white'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {CATEGORY_LABEL[report.category] ?? report.category}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(report.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-800">{report.reason}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  {report.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
