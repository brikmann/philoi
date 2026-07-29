// Pulls the caller's Whoop records for a workout_minutes / strain / sleep_hours challenge's
// window, reduces to the one number that challenge cares about, and logs ONLY that number via the
// existing log_challenge_progress() RPC — never a health export, never another user's data
// (own-data only, §17).
//
// Metric fit (§17): Whoop has NO step count. The three challenge types below are the only ones it
// can measure, and each maps to exactly ONE Whoop collection and ONE scope — a steps or
// run-distance challenge never reaches this function at all.
//
// Token refresh (needs the client secret) happens here, server-side, same as the initial exchange
// in whoop-oauth-exchange — the client never sees a Whoop access or refresh token.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SYNC_NOTE = 'Auto-synced from Whoop';
const API_BASE = 'https://api.prod.whoop.com/developer/v2';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

// Whoop v2 collections cap `limit` at 25 and paginate with next_token. 20 pages = 500 records,
// far past anything a 24h/3-day/1-week challenge window can contain.
const PAGE_LIMIT = 25;
const MAX_PAGES = 20;

type WhoopMetric = {
  /** Whoop v2 collection path this metric reads. */
  path: string;
  /** The single OAuth scope that collection needs — nothing wider is ever requested (§17). */
  scope: string;
  /** Reduces one page of records into the challenge's unit. */
  reduce: (records: WhoopRecord[]) => number;
  /** Decimal places to keep when logging — whole minutes, or 2dp for strain/hours. */
  precision: number;
};

type WhoopRecord = {
  start?: string;
  end?: string;
  nap?: boolean;
  score_state?: string;
  score?: {
    strain?: number;
    stage_summary?: {
      total_light_sleep_time_milli?: number;
      total_slow_wave_sleep_time_milli?: number;
      total_rem_sleep_time_milli?: number;
    };
  };
};

const METRIC_BY_CHALLENGE_TYPE: Record<string, WhoopMetric> = {
  // Duration doesn't depend on Whoop having finished scoring the workout, so PENDING_SCORE still
  // counts — only a workout Whoop has declared unscorable is dropped.
  workout_minutes: {
    path: '/activity/workout',
    scope: 'read:workout',
    precision: 0,
    reduce: (records) =>
      records
        .filter((r) => r.score_state !== 'UNSCORABLE' && r.start && r.end)
        .reduce((sum, r) => sum + (new Date(r.end!).getTime() - new Date(r.start!).getTime()) / 60_000, 0),
  },
  // Day strain (0–21 per physiological cycle) summed across the window. Needs a finished score.
  strain: {
    path: '/cycle',
    scope: 'read:cycles',
    precision: 2,
    reduce: (records) =>
      records
        .filter((r) => r.score_state === 'SCORED' && typeof r.score?.strain === 'number')
        .reduce((sum, r) => sum + (r.score!.strain ?? 0), 0),
  },
  // Actual sleep, not time in bed: light + slow-wave + REM. Naps are excluded so "7 hours of
  // sleep" means a night, which is what anyone setting a sleep challenge means by it.
  sleep_hours: {
    path: '/activity/sleep',
    scope: 'read:sleep',
    precision: 2,
    reduce: (records) =>
      records
        .filter((r) => r.score_state === 'SCORED' && r.nap !== true && r.score?.stage_summary)
        .reduce((sum, r) => {
          const s = r.score!.stage_summary!;
          const milli =
            (s.total_light_sleep_time_milli ?? 0) +
            (s.total_slow_wave_sleep_time_milli ?? 0) +
            (s.total_rem_sleep_time_milli ?? 0);
          return sum + milli / 3_600_000;
        }, 0),
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Not authenticated.' }, 401);

    const { challengeId } = await req.json();
    if (typeof challengeId !== 'string' || !challengeId) return json({ error: 'Missing challengeId.' }, 400);

    // RLS-scoped to the caller's own token, so this can only ever return a challenge they own —
    // no separate ownership check needed beyond that.
    const { data: challenge, error: challengeError } = await userClient
      .from('challenges')
      .select('id, type, period_start, completed_at')
      .eq('id', challengeId)
      .single();
    if (challengeError || !challenge) return json({ error: 'Challenge not found.' }, 404);

    const metric = METRIC_BY_CHALLENGE_TYPE[challenge.type];
    if (!metric || challenge.completed_at) return json({ synced: 0 });

    const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: connection } = await serviceClient
      .from('whoop_connections')
      .select('access_token, refresh_token, expires_at, scopes')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!connection) return json({ synced: 0, error: 'Not connected to Whoop.' });

    // Philoi only ever asks for the scope a challenge's own metric needs, so a member who
    // connected for a workout challenge genuinely has no read:sleep. Say so instead of firing a
    // request Whoop would 403 — the client turns this into a "reconnect to add sleep" prompt.
    if (!connection.scopes.split(/\s+/).includes(metric.scope)) {
      return json({ synced: 0, needsScope: metric.scope });
    }

    let accessToken = connection.access_token;
    if (new Date(connection.expires_at).getTime() < Date.now() + 60_000) {
      const refreshRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: connection.refresh_token,
          client_id: Deno.env.get('WHOOP_CLIENT_ID')!,
          client_secret: Deno.env.get('WHOOP_CLIENT_SECRET')!,
          scope: 'offline',
        }),
      });
      if (!refreshRes.ok) return json({ error: 'Could not refresh Whoop token — reconnect required.' }, 502);
      const refreshData = await refreshRes.json();
      accessToken = refreshData.access_token;
      // Whoop's refresh response echoes `offline` and may not repeat the read: scopes — only
      // overwrite the stored grant when the response actually names one, otherwise a routine
      // refresh would erase our record of what the member consented to.
      const refreshedScopes = typeof refreshData.scope === 'string' ? refreshData.scope : '';
      await serviceClient
        .from('whoop_connections')
        .update({
          access_token: refreshData.access_token,
          refresh_token: refreshData.refresh_token ?? connection.refresh_token,
          expires_at: new Date(Date.now() + Number(refreshData.expires_in ?? 3600) * 1000).toISOString(),
          ...(refreshedScopes.includes('read:') ? { scopes: refreshedScopes } : {}),
        })
        .eq('user_id', user.id);
    }

    const start = new Date(challenge.period_start).toISOString();
    const end = new Date().toISOString();
    let total = 0;
    let nextToken: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ start, end, limit: String(PAGE_LIMIT) });
      if (nextToken) params.set('nextToken', nextToken);
      const res = await fetch(`${API_BASE}${metric.path}?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        if (page === 0) return json({ error: `Whoop returned ${res.status} for ${metric.path}.` }, 502);
        break;
      }
      const body = await res.json();
      const records: WhoopRecord[] = Array.isArray(body?.records) ? body.records : [];
      total += metric.reduce(records);
      nextToken = typeof body?.next_token === 'string' && body.next_token ? body.next_token : null;
      if (!nextToken) break;
    }

    // Delta-tracked so a repeated sync never double-counts: log_challenge_progress() ADDS its
    // amount, so re-submitting the whole window's cumulative total every time would compound.
    // Read back what THIS mechanism already logged (tagged with its own note) and submit only the
    // difference — through the exact same RPC a manual log uses.
    const { data: logs } = await userClient.from('challenge_logs').select('amount').eq('challenge_id', challengeId).eq('note', SYNC_NOTE);
    const alreadySynced = (logs ?? []).reduce((sum: number, row: { amount: number }) => sum + Number(row.amount), 0);
    const factor = 10 ** metric.precision;
    const delta = Math.round((total - alreadySynced) * factor) / factor;
    if (delta <= 0) return json({ synced: 0 });

    const { error: logError } = await userClient.rpc('log_challenge_progress', {
      p_challenge_id: challengeId,
      p_amount: delta,
      p_note: SYNC_NOTE,
    });
    if (logError) return json({ error: logError.message }, 500);

    return json({ synced: delta });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
