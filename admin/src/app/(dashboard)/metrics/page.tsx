import { requireAdmin } from '@/lib/require-admin';
import { createClient } from '@/lib/supabase/server';
import { StatTile } from '@/components/stat-tile';
import { MetricChart } from '@/components/metric-chart';

// Next's fetch Data Cache can still cache the Supabase REST calls this page makes even
// though the route itself renders dynamically (cookies() usage already forces that) — the
// content browser's dynamic [groupId]/[userId] segments incidentally bust that cache on
// every navigation, but this page hits the exact same query every time, so it was the one
// place stale data actually surfaced (fixed by refresh only after a new session/token).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

type DailySignups = { day: string; signups: number };
type DailyActive = { day: string; dau: number };
type WeeklyActive = { week: string; wau: number };
type Retention = {
  signup_day: string;
  cohort_size: number;
  d1_retention_pct: number | null;
  d7_retention_pct: number | null;
};
type Viral = { total_signups: number; invites_sent: number; invites_accepted: number; viral_coefficient: number };
type TopCircle = { group_id: string; name: string; emoji: string; check_ins_7d: number; member_count: number };
type ByUniversity = { university: string; signups: number; check_ins_7d: number; active_7d: number };
type FunnelStep = { step_order: number; step: string; users: number };
type LastActive = {
  user_id: string;
  display_name: string;
  handle: string | null;
  university: string | null;
  last_active_at: string | null;
};

export default async function MetricsPage() {
  await requireAdmin();
  const supabase = await createClient();

  // Excluded from the raw check_ins count below the same way every analytics_* view
  // excludes them — the founder's own usage, seed/QA accounts, and the public demo
  // circle personas (scripts/seed-demo-circles.js) shouldn't count.
  const { data: excludedProfiles } = await supabase
    .from('profiles')
    .select('id')
    .or('is_admin.eq.true,is_test.eq.true,is_demo.eq.true');
  const excludedIds = (excludedProfiles ?? []).map((p) => p.id as string);

  let checkInsQuery = supabase.from('check_ins').select('id', { count: 'exact', head: true }).is('removed_at', null);
  if (excludedIds.length > 0) {
    checkInsQuery = checkInsQuery.not('user_id', 'in', `(${excludedIds.join(',')})`);
  }

  const [
    { data: signups },
    { data: dau },
    { data: wau },
    { data: retention },
    { data: viralRows },
    { data: topCircles },
    { count: checkInsTotal },
    { data: byUniversity },
    { data: funnel },
    { data: lastActive },
  ] = await Promise.all([
    supabase.from('analytics_daily_signups').select('*').order('day', { ascending: false }).limit(30),
    supabase.from('analytics_daily_active_users').select('*').order('day', { ascending: false }).limit(30),
    supabase.from('analytics_weekly_active_users').select('*').order('week', { ascending: false }).limit(12),
    supabase.from('analytics_retention').select('*').order('signup_day', { ascending: false }).limit(30),
    supabase.from('analytics_viral_coefficient').select('*'),
    supabase.from('analytics_top_circles').select('*').limit(10),
    checkInsQuery,
    supabase.from('analytics_by_university').select('*'),
    supabase.from('analytics_activation_funnel').select('*').order('step_order', { ascending: true }),
    supabase.from('analytics_user_last_active').select('*'),
  ]);

  const viral = (viralRows as Viral[] | null)?.[0];
  const dauSorted = ((dau ?? []) as DailyActive[]).slice().reverse();
  const wauSorted = ((wau ?? []) as WeeklyActive[]).slice().reverse();
  const signupsSorted = ((signups ?? []) as DailySignups[]).slice().reverse();
  const retentionSorted = ((retention ?? []) as Retention[]).slice().reverse();

  const latestDau = dauSorted.at(-1)?.dau ?? 0;
  const latestWau = wauSorted.at(-1)?.wau ?? 0;
  const avgD1 = average(retentionSorted.map((r) => r.d1_retention_pct));
  const avgD7 = average(retentionSorted.map((r) => r.d7_retention_pct));

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Metrics</h1>
      <p className="mt-1 text-xs text-slate-400">
        Every number on this page excludes admin and test accounts.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Total signups" value={String(viral?.total_signups ?? 0)} />
        <StatTile label="DAU (latest day)" value={String(latestDau)} />
        <StatTile label="WAU (latest week)" value={String(latestWau)} />
        <StatTile label="Check-ins" value={String(checkInsTotal ?? 0)} />
        <StatTile label="Avg D1 retention" value={avgD1 !== null ? `${avgD1.toFixed(1)}%` : '—'} />
        <StatTile label="Avg D7 retention" value={avgD7 !== null ? `${avgD7.toFixed(1)}%` : '—'} />
      </div>

      <StatTile
        label="Viral coefficient"
        value={viral ? viral.viral_coefficient.toFixed(3) : '—'}
        sub={viral ? `${viral.invites_accepted} accepted / ${viral.invites_sent} sent` : undefined}
      />

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Signups over time">
          <MetricChart type="line" data={signupsSorted} xKey="day" series={[{ key: 'signups', label: 'Signups' }]} />
        </ChartCard>

        <ChartCard title="DAU / WAU">
          <MetricChart
            type="line"
            data={mergeByDate(dauSorted, wauSorted)}
            xKey="date"
            series={[
              { key: 'dau', label: 'DAU' },
              { key: 'wau', label: 'WAU' },
            ]}
          />
        </ChartCard>

        <ChartCard title="D1 / D7 retention by signup cohort">
          <MetricChart
            type="line"
            data={retentionSorted.map((r) => ({ ...r, signup_day: shortDate(r.signup_day) }))}
            xKey="signup_day"
            series={[
              { key: 'd1_retention_pct', label: 'D1 %' },
              { key: 'd7_retention_pct', label: 'D7 %' },
            ]}
          />
        </ChartCard>

        <ChartCard title="Top circles — check-ins (last 7 days)">
          <MetricChart
            type="bar"
            data={(topCircles as TopCircle[] | null) ?? []}
            xKey="name"
            series={[{ key: 'check_ins_7d', label: 'Check-ins (7d)' }]}
          />
        </ChartCard>

        <ChartCard title="Activation funnel — where people stall">
          <MetricChart
            type="bar"
            data={(funnel as FunnelStep[] | null) ?? []}
            xKey="step"
            series={[{ key: 'users', label: 'Users' }]}
          />
        </ChartCard>

        <UniversityTable rows={(byUniversity as ByUniversity[] | null) ?? []} />
      </section>

      <section className="mt-6">
        <LastActiveTable rows={(lastActive as LastActive[] | null) ?? []} />
      </section>
    </div>
  );
}

function UniversityTable({ rows }: { rows: ByUniversity[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-medium text-slate-700">Signups by campus</h2>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="pb-2 font-medium">University</th>
            <th className="pb-2 font-medium text-right">Signups</th>
            <th className="pb-2 font-medium text-right">Active (7d)</th>
            <th className="pb-2 font-medium text-right">Check-ins (7d)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-slate-400">
                No signups yet.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.university}>
              <td className="py-2 text-slate-900">{r.university}</td>
              <td className="py-2 text-right text-slate-700">{r.signups}</td>
              <td className="py-2 text-right text-slate-700">{r.active_7d}</td>
              <td className="py-2 text-right text-slate-700">{r.check_ins_7d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LastActiveTable({ rows }: { rows: LastActive[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-medium text-slate-700">Roster — last active</h2>
      <p className="mt-0.5 text-xs text-slate-400">Stalest first — this is where you'd catch the group going quiet.</p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="pb-2 font-medium">User</th>
            <th className="pb-2 font-medium">University</th>
            <th className="pb-2 font-medium text-right">Last active</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="py-3 text-slate-400">
                No users yet.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.user_id}>
              <td className="py-2 text-slate-900">
                {r.display_name} {r.handle && <span className="text-slate-400">@{r.handle}</span>}
              </td>
              <td className="py-2 text-slate-600">{r.university ?? '—'}</td>
              <td className="py-2 text-right text-slate-700">{daysAgo(r.last_active_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-medium text-slate-700">{title}</h2>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function average(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function daysAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function mergeByDate(dau: DailyActive[], wau: WeeklyActive[]): { date: string; dau?: number; wau?: number }[] {
  const map = new Map<string, { date: string; dau?: number; wau?: number }>();
  for (const d of dau) {
    map.set(d.day, { date: shortDate(d.day), dau: d.dau });
  }
  for (const w of wau) {
    const existing = map.get(w.week);
    if (existing) existing.wau = w.wau;
    else map.set(w.week, { date: shortDate(w.week), wau: w.wau });
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}
