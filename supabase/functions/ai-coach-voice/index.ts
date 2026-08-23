// ══════════════════════════════════════════════════════════════════════════════════════════════
// ai-coach-voice — tap-to-talk with Cindy (CINDY_SPEC "Voice — STT-only architecture").
//
// 🔴 THE CHEAP PIPELINE, ON PURPOSE:
//
//     on-device STT (free)  →  Sonnet (the brain we already pay for)  →  ElevenLabs TTS (reply only)
//
// The client transcribes locally with the platform recognizer (iOS Speech / Android
// SpeechRecognizer) and posts TEXT. This function never receives audio and never pays for
// speech-to-text. That keeps a spoken exchange at roughly 1–2¢ instead of the 8–10¢/min of
// ElevenLabs' Conversational-AI agent — which the spec explicitly rules out as the default,
// both on cost and because that path would replace Sonnet with their LLM and lose the persona.
//
// A future premium "Call Cindy" real-time mode can sit alongside this; it is deliberately not
// what ships, and it is not what the free tier runs on.
//
// 🔑 SHIPS DARK. No ELEVENLABS_API_KEY *or* no ANTHROPIC_API_KEY → `voice_unavailable`, and the
// client hides the mic entirely rather than offering one that cannot complete a turn.
//   supabase secrets set ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=...
//
// 💸 Metered in TTS CHARACTERS, because synthesis is the only part of a voice turn that costs
// anything. Free and capped, never paywalled — text stays fully featured either way, so the
// modality is a convenience and never power.
// ══════════════════════════════════════════════════════════════════════════════════════════════

import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';
import { runCoach } from '../_shared/coach/index.ts';

/** Daily synthesis budget per user. ~25k characters is a lot of talking for one day. */
const TTS_CHARS_PER_DAY = 25_000;

/** Hard ceiling on one reply, so a runaway generation cannot drain the day's budget at once. */
const MAX_REPLY_CHARS = 600;

/** Expressive and realtime (~280ms) — the right trade for a companion rather than a reader. */
const TTS_MODEL = Deno.env.get('ELEVENLABS_TTS_MODEL') ?? 'eleven_v3_conversational';
/** mp3 44.1kHz/128kbps — expo-audio plays it directly, no transcoding on device. */
const TTS_FORMAT = 'mp3_44100_128';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const elevenKey = Deno.env.get('ELEVENLABS_API_KEY');
    const voiceId = Deno.env.get('ELEVENLABS_VOICE_ID');
    // The brain counts too. A voice turn is transcript -> Sonnet -> speech, so without
    // ANTHROPIC_API_KEY the ElevenLabs half is wired to nothing: the client would see the mic,
    // let someone talk, and 500 at the brain step every time. Reporting voice_unavailable here
    // means the mic is hidden instead — the same "ships dark" contract the ElevenLabs keys
    // already have, applied to the one key that is not optional.
    const brainKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!elevenKey || !voiceId || !brainKey) return json({ error: 'voice_unavailable' }, 503);

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

    const { data: settings } = await admin
      .from('coach_settings')
      .select('enabled, consented_at, voice_enabled')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!settings?.consented_at || !settings?.enabled) return json({ error: 'coach_not_consented' }, 403);
    if (settings.voice_enabled === false) return json({ error: 'voice_disabled' }, 403);

    const body = await req.json().catch(() => ({}));
    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    // A probe (empty body) gets this far only when voice IS wired up — that is exactly how the
    // client tells "dark" from "available" without spending a credit. See isVoiceAvailable().
    if (!transcript) return json({ error: 'no_speech' }, 422);
    if (transcript.length > 2000) return json({ error: 'That was too long.' }, 400);

    // ── The same brain as text ──
    const { data: recent } = await admin
      .from('coach_messages')
      .select('role, content')
      .eq('user_id', user.id)
      .eq('surface', 'chat')
      .order('created_at', { ascending: false })
      .limit(16);
    const history = (recent ?? []).reverse().map((m: any) => ({ role: m.role, content: m.content }));

    const result = await runCoach({
      surface: 'chat',
      userId: user.id,
      userClient,
      admin,
      message: transcript,
      history,
    });

    // Voice turns land in the same transcript as typed ones — one conversation, two ways in, so
    // asking aloud and following up by text carries the thread.
    await admin.from('coach_messages').insert([
      { user_id: user.id, role: 'user', content: transcript, surface: 'chat', modality: 'voice' },
      {
        user_id: user.id,
        role: 'assistant',
        content: result.text,
        surface: 'chat',
        modality: 'voice',
        action: result.action ? { ...result.action, status: 'proposed' } : null,
      },
    ]);

    // ── Speech out — the only paid step ──
    const spoken = result.text.slice(0, MAX_REPLY_CHARS);
    const spent = await bumpTts(admin, user.id, spoken.length);

    // Over budget still returns the TEXT. Losing her voice for the rest of the day should not
    // mean losing her answer — the reply just arrives silently and the screen shows it.
    if (spent > TTS_CHARS_PER_DAY) {
      return json({
        transcript,
        text: result.text,
        action: result.action,
        audio: null,
        voice_capped: true,
      });
    }

    const audio = await speak(elevenKey, voiceId, spoken);

    return json({
      transcript,
      text: result.text,
      action: result.action,
      audio,
      mime_type: 'audio/mpeg',
      voice_capped: false,
    });
  } catch (e) {
    console.error('ai-coach-voice failed', e);
    return json({ error: e instanceof Error ? e.message : 'Voice failed.' }, 500);
  }
});

/** Text → base64 mp3 in Cindy's voice. */
async function speak(apiKey: string, voiceId: string, text: string): Promise<string> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${TTS_FORMAT}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: TTS_MODEL }),
    }
  );
  if (!res.ok) throw new Error(`Text-to-speech failed (${res.status}).`);

  return encodeBase64(new Uint8Array(await res.arrayBuffer()));
}

function encodeBase64(bytes: Uint8Array): string {
  // Chunked: String.fromCharCode(...bytes) over a whole mp3 blows the argument limit and throws
  // "Maximum call stack size exceeded" on anything past a few seconds of audio.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function bumpTts(admin: any, userId: string, chars: number): Promise<number> {
  const { data, error } = await admin.rpc('coach_bump_usage', {
    p_user: userId,
    p_kind: 'voice',
    p_amount: chars,
  });
  if (error) {
    console.error('coach_bump_usage(voice) failed', error);
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
