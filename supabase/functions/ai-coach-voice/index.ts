// ══════════════════════════════════════════════════════════════════════════════════════════════
// ai-coach-voice — tap-to-talk with Cindy (CINDY_SPEC "🎙 Voice", mock 115 frame 4).
//
// One round trip per spoken turn: audio in → ElevenLabs STT → the SAME Sonnet coach as text →
// ElevenLabs TTS → audio out. The brain is identical to chat; voice is only a different way in
// and out, which is why this delegates to _shared/coach rather than owning any prompt of its own.
//
// 🔑 SHIPS DARK. With no ELEVENLABS_API_KEY set on the project this returns `voice_unavailable`,
// and the client hides the mic entirely. Nothing crashes, nothing half-works — voice simply is
// not there until the secret exists.
//
//   supabase secrets set ELEVENLABS_API_KEY=...
//   supabase secrets set ELEVENLABS_VOICE_ID=...   # pick a warm voice that matches her persona
//
// 💸 Voice minutes cost real money, so this is metered in SECONDS (a long rambling turn costs more
// than ten short ones) against a daily cap. Confirmed free-but-capped rather than premium: text
// stays fully featured either way, so the modality is convenience, never power.
// ══════════════════════════════════════════════════════════════════════════════════════════════

import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';
import { runCoach } from '../_shared/coach/index.ts';

/** Daily spoken-audio budget per user, in seconds. ~10 minutes of talking. */
const VOICE_SECONDS_PER_DAY = 600;

/** A single utterance longer than this is almost certainly a stuck recorder, not a question. */
const MAX_CLIP_SECONDS = 120;

const STT_MODEL = 'scribe_v2';
/** Expressive and realtime (~280ms) — the right trade for a companion rather than a reader. */
const TTS_MODEL = Deno.env.get('ELEVENLABS_TTS_MODEL') ?? 'eleven_v3_conversational';
/** mp3 at 44.1kHz/128kbps — expo-audio plays it directly, no transcoding on device. */
const TTS_FORMAT = 'mp3_44100_128';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const elevenKey = Deno.env.get('ELEVENLABS_API_KEY');
    const voiceId = Deno.env.get('ELEVENLABS_VOICE_ID');
    if (!elevenKey || !voiceId) return json({ error: 'voice_unavailable' }, 503);

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
    const audioBase64: string = body.audio ?? '';
    const mimeType: string = body.mime_type ?? 'audio/m4a';
    const clipSeconds = Math.min(Math.round(Number(body.duration_seconds ?? 0)), MAX_CLIP_SECONDS);
    if (!audioBase64) return json({ error: 'No audio.' }, 400);

    // Metered before the work, so a burst of parallel turns cannot each slip under the cap.
    // Charged on the clip they SPOKE plus a flat estimate for the reply we are about to speak —
    // billing only the input would let a user spend the whole TTS budget invisibly.
    const spent = await bumpVoice(admin, user.id, Math.max(clipSeconds, 1) + 8);
    if (spent > VOICE_SECONDS_PER_DAY) {
      return json({ error: 'voice_rate_limited', limit_seconds: VOICE_SECONDS_PER_DAY }, 429);
    }

    // ── 1. Speech in ──
    const transcript = await transcribe(elevenKey, audioBase64, mimeType);
    if (!transcript) return json({ error: 'no_speech' }, 422);

    // ── 2. The same brain as text ──
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
    // asking by voice and following up by text carries the thread.
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

    // ── 3. Speech out ──
    const audio = await speak(elevenKey, voiceId, result.text);

    return json({
      transcript,
      text: result.text,
      action: result.action,
      audio,
      mime_type: 'audio/mpeg',
    });
  } catch (e) {
    console.error('ai-coach-voice failed', e);
    return json({ error: e instanceof Error ? e.message : 'Voice failed.' }, 500);
  }
});

/** Audio → text. Returns null when the clip held no speech (a mis-tap, a pocket recording). */
async function transcribe(apiKey: string, base64: string, mimeType: string): Promise<string | null> {
  const form = new FormData();
  form.append('model_id', STT_MODEL);
  form.append('file', new Blob([decodeBase64(base64)], { type: mimeType }), 'turn.m4a');

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });
  if (!res.ok) throw new Error(`Speech-to-text failed (${res.status}).`);

  const data = await res.json();
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  return text.length > 0 ? text : null;
}

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

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  // Chunked: String.fromCharCode(...bytes) on a whole mp3 blows the argument limit and throws
  // "Maximum call stack size exceeded" on anything longer than a few seconds of audio.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function bumpVoice(admin: any, userId: string, seconds: number): Promise<number> {
  const { data, error } = await admin.rpc('coach_bump_usage', {
    p_user: userId,
    p_kind: 'voice',
    p_amount: seconds,
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
