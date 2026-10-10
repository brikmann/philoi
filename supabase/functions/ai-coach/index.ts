// ══════════════════════════════════════════════════════════════════════════════════════════════
// ai-coach — the HTTP door onto the shared coach service (_shared/coach).
//
// Requires, on the Supabase project (never in the app bundle):
//   supabase secrets set ANTHROPIC_API_KEY=...
// Optional, for voice and calendar respectively:
//   supabase secrets set ELEVENLABS_API_KEY=... GOOGLE_WEB_CLIENT_ID=... GOOGLE_WEB_CLIENT_SECRET=...
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected by the runtime.
//
// 🔒 Two clients, on purpose:
//   · userClient  — the caller's own JWT. Reads context (auth.uid()-scoped) and nothing else.
//   · admin       — service role. Writes the transcript, meters usage, reads the GCal token.
// The admin client NEVER performs a coach action. Actions run on the device under the user's own
// session — see _shared/coach/tools.ts for why that firewall is structural.
// ══════════════════════════════════════════════════════════════════════════════════════════════

import Anthropic from 'npm:@anthropic-ai/sdk@0.71.0';
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
      // The New-Challenge Q&A reads a typed answer into structured terms. Transient: nothing is
      // written to the transcript, so a half-finished challenge never shows up in her chat.
      case 'extract_challenge':
        return await handleExtractChallenge(admin, user.id, body);
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

  // `persist: false` is the New-Challenge Q&A scoring a challenge. Its prompt is an internal
  // sentence ("Score this challenge for me… campfire id <uuid>") that must never land in the
  // visible chat, so the turn is neither written nor replayed from the table — the caller sends
  // the few lines of ITS OWN exchange instead, which is all the context a follow-up needs.
  // Absent (every installed build), the turn persists exactly as it always has.
  const transient = body.persist === false;

  let history: { role: 'user' | 'assistant'; content: string }[];
  if (transient) {
    history = (Array.isArray(body.history) ? body.history : [])
      .filter((t: any) => (t?.role === 'user' || t?.role === 'assistant') && typeof t?.content === 'string')
      .slice(-8)
      .map((t: any) => ({ role: t.role, content: String(t.content).slice(0, 2000) }));
  } else {
    // Oldest-first for the model; the table is indexed newest-first, so fetch then reverse.
    const { data: recent } = await admin
      .from('coach_messages')
      .select('role, content')
      .eq('user_id', userId)
      .eq('surface', 'chat')
      .order('created_at', { ascending: false })
      .limit(HISTORY_TURNS);
    history = (recent ?? []).reverse().map((m: any) => ({ role: m.role, content: m.content }));
  }

  const result = await runCoach({
    surface: 'chat',
    userId,
    userClient,
    admin,
    message,
    history,
  });

  if (transient) return json({ text: result.text, action: result.action, usage: result.usage });

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

// ───────────────────────────── extract_challenge ─────────────────────────────
//
// The New-Challenge Q&A's reader. The client's regex parser stays as the fast path for chips and
// short answers; anything it is unsure of comes here and is read into the SAME fields the Q&A
// collects — "most distance by end of semester, race for the most" is a placement race with no
// target, "500 km cumulatively as a club, pay the top contributor" is a pooled total with a
// contributor payout. Regex cannot hold those, a model can.
//
// 🔒 READS ONLY THE SENTENCE. No user context, no tools, nothing persisted: the output is a
// proposal for the client's answers, which the user still sees and confirms, and the tier is still
// scored separately by her chat op on the verdict path.

const EXTRACT_MODEL = 'claude-sonnet-5';

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'discipline', 'custom_name', 'target', 'unit', 'cadence', 'deadline', 'window_days', 'who', 'mode',
    'contributor_reward', 'is_grade',
  ],
  properties: {
    discipline: nullable({ type: 'string', enum: ['study', 'gym', 'run', 'ride', 'steps', 'sleep', 'volume', 'custom'] }),
    custom_name: nullable({ type: 'string' }),
    target: nullable({ type: 'number' }),
    unit: nullable({ type: 'string', enum: ['km', 'hours', 'sessions', 'lb', 'steps', 'count'] }),
    cadence: nullable({ type: 'string', enum: ['day', 'week', 'once'] }),
    deadline: nullable({ type: 'string' }),
    window_days: nullable({ type: 'integer' }),
    who: nullable({ type: 'string', enum: ['solo', 'friend', 'campfire'] }),
    mode: nullable({ type: 'string', enum: ['solo', 'duel', 'placement', 'together', 'collective'] }),
    contributor_reward: { type: 'boolean' },
    is_grade: { type: 'boolean' },
  },
};

const EXTRACT_SYSTEM = `You read one answer from a fitness/study app's "new challenge" conversation into structured fields. Output ONLY what the user actually said or plainly implied; use null for anything not said. Never invent a number.

Fields:
- discipline: run (running, jogging, "distance ran"), ride (cycling), study, gym (sessions/visits), steps, sleep, volume (total weight lifted, in lb), custom (anything else — pushups, guitar, Duolingo).
- custom_name: for custom only, the thing itself as it would be logged ("pushups", "guitar"), lowercase, no timeframe or people.
- target + unit: the number in the user's unit. Distances in km (convert miles ×1.609; "5k" on a run = 5 km). Time in hours. "3x a week" = 3 sessions. Typos like "500kkm" mean 500 km. A placement race ("most wins", "whoever runs the most") has NO target: null.
- cadence: day/week if it repeats per day/week; once for one total.
- deadline: an end date as YYYY-MM-DD when one is named ("by December" = last day of that month, "end of semester" = Dec 31 in fall / Apr 30 in winter / Aug 31 in summer, relative to today).
- window_days: a length instead of a date ("2 months" = 60, "3 weeks" = 21).
- who: solo (just me), friend (vs a person, a duel), campfire (a group, club, "us", "everyone").
- mode: solo; duel (1v1); placement (a group ranked on most, no shared target); together (every member clears the SAME bar each); collective (the group pools toward ONE shared total — "cumulatively", "combined", "as a club", "between us").
- contributor_reward: true only when the user asks to reward the biggest contributor to a shared total.
- is_grade: true for a grade, GPA, mark or exam score.`;

async function handleExtractChallenge(admin: any, userId: string, body: any) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: 'Empty message.' }, 400);
  if (text.length > 600) return json({ error: 'That message is too long.' }, 400);

  const used = await bump(admin, userId, 'text');
  if (used > LIMITS.text) return json({ error: 'coach_rate_limited', limit: LIMITS.text }, 429);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set on this project.' }, 500);

  // What is already settled, and which question is open — so "2 months" answers "when", and a
  // bare "race" answers the campfire question rather than starting a new challenge.
  const today = typeof body.today === 'string' ? body.today.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const step = typeof body.step === 'string' ? body.step.slice(0, 24) : 'what';
  const known = JSON.stringify(body.known ?? {}).slice(0, 800);

  const client = new Anthropic({ apiKey });
  // ⚠️ Cast as in _shared/coach: the pinned SDK (0.71.0) has no type for output_config.
  const response = await client.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACT_SCHEMA } },
    system: [{ type: 'text', text: EXTRACT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `Today is ${today}. The open question is "${step}". Already answered: ${known}\n\nThe user's answer:\n<answer>${text}</answer>`,
      },
    ],
  } as unknown as Anthropic.MessageCreateParamsNonStreaming);

  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
    return json({ goal: null });
  }
  const block = response.content.find((b: any) => b.type === 'text') as { text: string } | undefined;
  try {
    return json({ goal: block ? JSON.parse(block.text) : null });
  } catch {
    return json({ goal: null });
  }
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

  // 1. Resolve the PROPOSAL in place. Without this, reopening the chat would re-render a pending
  // confirm for something already done — and tapping it would run the action a second time.
  const { data: proposal } = await admin
    .from('coach_messages')
    .select('id, action')
    .eq('user_id', userId)
    .eq('role', 'assistant')
    .eq('action->>tool', tool)
    .eq('action->>status', 'proposed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (proposal) {
    await admin
      .from('coach_messages')
      .update({ action: { ...proposal.action, status } })
      .eq('id', proposal.id);
  }

  // 2. Write a receipt row FOR THE MODEL. Only `content` is replayed as history, so without this
  // line the next turn would have no idea whether the session actually started — she would be
  // reduced to guessing at her own last action. Flagged `receipt` so the client filters it out of
  // the transcript: the resolved chip above is what the user sees, and rendering both would say
  // the same thing twice.
  await admin.from('coach_messages').insert({
    user_id: userId,
    role: 'assistant',
    content: receiptLine(tool, status, typeof summary === 'string' ? summary : tool),
    surface: 'chat',
    action: { tool, summary, status, receipt: true },
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
