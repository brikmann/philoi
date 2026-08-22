// ══════════════════════════════════════════════════════════════════════════════════════════════
// ai-coach — the HTTP door onto the shared coach service (_shared/coach).
//
// Requires, on the Supabase project (never in the app bundle):
//   supabase secrets set ANTHROPIC_API_KEY=...
// Optional, for voice and calendar respectively:
//   supabase secrets set ELEVENLABS_API_KEY=... GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected by the runtime.
//
// 🔒 Two clients, on purpose:
//   · userClient  — the caller's own JWT. Reads context (auth.uid()-scoped) and nothing else.
//   · admin       — service role. Writes the transcript, meters usage, reads the GCal token.
// The admin client NEVER performs a coach action. Actions run on the device under the user's own
// session — see _shared/coach/tools.ts for why that firewall is structural.
// ══════════════════════════════════════════════════════════════════════════════════════════════

import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';
import { runCoach, stripIntent, type CoachSurface } from '../_shared/coach/index.ts';

// ── Rate limits (CINDY_SPEC: the coach is FREE, so the ceiling is a limit, not a paywall) ──
// Generous enough that a real conversation never hits them, low enough to bound a runaway loop.
const LIMITS = { text: 60, bubble: 12 };

/** How long a home bubble stays fresh. Below this we reuse the cached line rather than spend. */
const BUBBLE_TTL_MINUTES = 90;

/** Turns of history to replay into a chat call. Enough for continuity, bounded for cost. */
const HISTORY_TURNS = 16;

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

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const op: string = body.op ?? 'chat';

    // ── Consent gate. Cindy reads a lot of personal data and sends it to a model, so she is off
    // until the user has explicitly agreed. No row = never consented, which fails closed.
    const { data: settings } = await admin
      .from('coach_settings')
      .select('enabled, consented_at, home_bubble_enabled')
      .eq('user_id', user.id)
      .maybeSingle();

    if (op !== 'consent' && (!settings?.consented_at || !settings?.enabled)) {
      return json({ error: 'coach_not_consented' }, 403);
    }

    switch (op) {
      case 'consent':
        return await handleConsent(admin, user.id, body);
      case 'chat':
        return await handleChat(userClient, admin, user.id, body);
      case 'home_bubble':
        return await handleHomeBubble(userClient, admin, user.id, settings, body);
      case 'record_action':
        return await handleRecordAction(admin, user.id, body);
      // Consumed by the Focus Nudge build (APP_BLOCKER_SPEC §C / §C2) — same brain, different
      // surface. Generate at lock-in start, cache to the app group, render synchronously.
      case 'intercept':
      case 'reengagement':
        return await handleGenerated(userClient, admin, user.id, op, body);
      default:
        return json({ error: `Unknown op "${op}".` }, 400);
    }
  } catch (e) {
    console.error('ai-coach failed', e);
    return json({ error: e instanceof Error ? e.message : 'Coach failed.' }, 500);
  }
});

// ───────────────────────────── consent ─────────────────────────────

async function handleConsent(admin: any, userId: string, body: any) {
  const granted = body.granted !== false;
  const { error } = await admin.from('coach_settings').upsert(
    {
      user_id: userId,
      enabled: granted,
      // Null on revoke, so revoking genuinely returns them to the un-consented state rather than
      // leaving a stale timestamp that a later bug could read as "they said yes once".
      consented_at: granted ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  if (error) return json({ error: error.message }, 500);

  // Revoking wipes the transcript. If someone withdraws consent for Cindy to read their life,
  // leaving the record of what she already read would miss the point entirely.
  if (!granted) {
    await admin.from('coach_messages').delete().eq('user_id', userId);
    await admin.from('coach_home_bubble').delete().eq('user_id', userId);
  }

  return json({ ok: true, consented: granted });
}

// ───────────────────────────── chat ─────────────────────────────

async function handleChat(userClient: any, admin: any, userId: string, body: any) {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return json({ error: 'Empty message.' }, 400);
  if (message.length > 2000) return json({ error: 'That message is too long.' }, 400);

  const used = await bump(admin, userId, 'text');
  if (used > LIMITS.text) {
    return json({ error: 'coach_rate_limited', limit: LIMITS.text }, 429);
  }

  // Oldest-first for the model; the table is indexed newest-first, so fetch then reverse.
  const { data: recent } = await admin
    .from('coach_messages')
    .select('role, content')
    .eq('user_id', userId)
    .eq('surface', 'chat')
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS);

  const history = (recent ?? []).reverse().map((m: any) => ({ role: m.role, content: m.content }));

  const result = await runCoach({
    surface: 'chat',
    userId,
    userClient,
    admin,
    message,
    history,
  });

  // Persisted together so a failure between them cannot leave a user turn with no reply (which
  // would then be replayed as history forever, confusing every later call).
  const modality = body.modality === 'voice' ? 'voice' : 'text';
  await admin.from('coach_messages').insert([
    { user_id: userId, role: 'user', content: message, surface: 'chat', modality },
    {
      user_id: userId,
      role: 'assistant',
      content: result.text,
      surface: 'chat',
      modality,
      action: result.action ? { ...result.action, status: 'proposed' } : null,
    },
  ]);

  return json({ text: result.text, action: result.action, usage: result.usage });
}

/**
 * Record what the device actually did with a proposed action.
 *
 * The server is told after the fact precisely because it is not the one acting: the client ran it
 * under the user's own credentials, and this only writes the receipt into the transcript so the
 * next turn knows the session really started (or that the user declined).
 */
async function handleRecordAction(admin: any, userId: string, body: any) {
  const { tool, status, summary } = body;
  if (typeof tool !== 'string' || !['done', 'declined', 'failed'].includes(status)) {
    return json({ error: 'Bad action receipt.' }, 400);
  }

  await admin.from('coach_messages').insert({
    user_id: userId,
    role: 'assistant',
    // The receipt line is the message: it is what the chip renders and what the model reads back
    // as "this happened" on the next turn.
    content: receiptLine(tool, status, typeof summary === 'string' ? summary : tool),
    surface: 'chat',
    action: { tool, summary, status },
  });

  return json({ ok: true });
}

function receiptLine(tool: string, status: string, summary: string): string {
  if (status === 'declined') return `(${summary} — the user declined.)`;
  if (status === 'failed') return `(${summary} — this didn't go through.)`;
  return tool === 'start_session' ? `▶ ${summary} · started` : `✓ ${summary}`;
}

// ───────────────────────────── the home bubble ─────────────────────────────

async function handleHomeBubble(userClient: any, admin: any, userId: string, settings: any, body: any) {
  if (settings?.home_bubble_enabled === false) return json({ bubble: null });

  const { data: cached } = await admin
    .from('coach_home_bubble')
    .select('message, intent, context_digest, dismissed_at, generated_at')
    .eq('user_id', userId)
    .maybeSingle();

  const digest: string | null = typeof body.digest === 'string' ? body.digest : null;

  // Reuse when the message is young AND the world has not moved under it. The digest is computed
  // client-side from the handful of facts that would change the line (streak, today's minutes,
  // whether a session is running) — cheap to compare, and it means a user who locks in gets a
  // fresh bubble immediately instead of yesterday's greeting.
  if (cached && !body.force) {
    const ageMinutes = (Date.now() - new Date(cached.generated_at).getTime()) / 60_000;
    const digestMatches = !digest || !cached.context_digest || digest === cached.context_digest;
    if (ageMinutes < BUBBLE_TTL_MINUTES && digestMatches) {
      if (cached.dismissed_at && new Date(cached.dismissed_at) > new Date(cached.generated_at)) {
        return json({ bubble: null });
      }
      return json({ bubble: { message: cached.message, intent: cached.intent, cached: true } });
    }
  }

  const used = await bump(admin, userId, 'bubble');
  if (used > LIMITS.bubble) {
    // Over the cap, fall back to whatever we last generated rather than showing nothing — a
    // slightly stale warm line beats an empty flame.
    return json({ bubble: cached ? { message: cached.message, intent: cached.intent, cached: true } : null });
  }

  const result = await runCoach({ surface: 'home', userId, userClient, admin });
  const message = stripIntent(result.text);
  if (!message) return json({ bubble: null });

  await admin.from('coach_home_bubble').upsert(
    {
      user_id: userId,
      message,
      intent: result.intent ?? 'checkin',
      context_digest: digest,
      dismissed_at: null,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  return json({ bubble: { message, intent: result.intent ?? 'checkin', cached: false } });
}

// ───────────────────────────── intercept + re-engagement ─────────────────────────────

async function handleGenerated(userClient: any, admin: any, userId: string, op: string, body: any) {
  const used = await bump(admin, userId, 'text');
  if (used > LIMITS.text) return json({ error: 'coach_rate_limited' }, 429);

  const result = await runCoach({
    surface: op as CoachSurface,
    userId,
    userClient,
    admin,
    situation: body.situation,
  });

  // "Say nothing" is a real answer for re-engagement (APP_BLOCKER_SPEC §C2: stay quiet when they
  // are overworked). Returning it explicitly keeps the decision with the model rather than making
  // the scheduler guess from an empty string.
  if (op === 'reengagement' && result.intent === 'skip') {
    return json({ skip: true, message: null, intent: 'skip' });
  }

  const message = stripIntent(result.text);
  await admin.from('coach_messages').insert({
    user_id: userId,
    role: 'assistant',
    content: message,
    surface: op,
    action: result.intent ? { intent: result.intent } : null,
  });

  return json({ skip: false, message, intent: result.intent });
}

// ───────────────────────────── helpers ─────────────────────────────

/** Increment-then-check, so parallel requests cannot each read a stale "0 used" and all proceed. */
async function bump(admin: any, userId: string, kind: 'text' | 'bubble'): Promise<number> {
  const { data, error } = await admin.rpc('coach_bump_usage', { p_user: userId, p_kind: kind, p_amount: 1 });
  // A metering failure must not take the coach down — log it and let the call through rather than
  // denying a user because a counter misbehaved.
  if (error) {
    console.error('coach_bump_usage failed', error);
    return 0;
  }
  return Number(data ?? 0);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
