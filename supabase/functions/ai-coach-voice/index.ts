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

/**
 * Hard ceiling on one SPOKEN reply.
 *
 * Was 600, which is the wrong axis to have tuned it on: 600 characters is not an expensive reply,
 * it is a SLOW one. Every character is generated and then synthesised while the user waits in
 * silence, so halving the reply halves both legs of the wait. The real shape comes from
 * SPOKEN_BREVITY in the shared coach (one or two sentences); this is the runaway guard behind it,
 * and it should almost never be the thing that fires.
 */
const MAX_REPLY_CHARS = 300;

/**
 * 🔴 eleven_flash_v2_5 — the REALTIME model (~75ms to first byte), not the expressive one.
 *
 * The default here used to be `eleven_v3_conversational`, under a comment claiming ~280ms. That
 * number belongs to Flash/Turbo; v3 is the high-latency expressive model, and on a reply of a few
 * hundred characters it was costing SECONDS of the 15-20s turn Noah reported. Flash is the model
 * built for exactly this shape of call — short, conversational, spoken back immediately.
 *
 * If Flash reads too flat for her persona, `eleven_turbo_v2_5` is the next step up and still far
 * cheaper in latency than v3 — set ELEVENLABS_TTS_MODEL rather than editing this line, so the
 * trade can be made without a redeploy.
 */
const TTS_MODEL = Deno.env.get('ELEVENLABS_TTS_MODEL') ?? 'eleven_flash_v2_5';
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

    // The consent row and the transcript window are independent reads against the same database,
    // and awaiting them one after the other spent a whole round trip for nothing. Started together;
    // the gate below is still checked before a single token is generated.
    //
    // Reading history for a request that turns out to be unconsented is a wasted query, not a leak:
    // it is this user's own rows either way, and the reply is refused before anything is returned.
    const settingsPromise = admin
      .from('coach_settings')
      .select('enabled, consented_at, voice_enabled')
      .eq('user_id', user.id)
      .maybeSingle();
    const historyPromise = admin
      .from('coach_messages')
      .select('role, content')
      .eq('user_id', user.id)
      .eq('surface', 'chat')
      .order('created_at', { ascending: false })
      .limit(16);

    const { data: settings } = await settingsPromise;
    if (!settings?.consented_at || !settings?.enabled) return json({ error: 'coach_not_consented' }, 403);
    if (settings.voice_enabled === false) return json({ error: 'voice_disabled' }, 403);

    const body = await req.json().catch(() => ({}));
    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    // A probe (empty body) gets this far only when voice IS wired up — that is exactly how the
    // client tells "dark" from "available" without spending a credit. See isVoiceAvailable().
    if (!transcript) return json({ error: 'no_speech' }, 422);
    if (transcript.length > 2000) return json({ error: 'That was too long.' }, 400);

    // ── The same brain as text ──
    const { data: recent } = await historyPromise;
    const history = (recent ?? []).reverse().map((m: any) => ({ role: m.role, content: m.content }));

    const result = await runCoach({
      surface: 'chat',
      userId: user.id,
      userClient,
      admin,
      message: transcript,
      history,
      // Same surface, same transcript, shorter reply. See RunCoachInput.spoken — this is what keeps
      // a voice turn to one or two sentences instead of a paragraph nobody wants read to them.
      spoken: true,
    });

    // Voice turns land in the same transcript as typed ones — one conversation, two ways in, so
    // asking aloud and following up by text carries the thread.
    //
    // NOT AWAITED BEFORE SYNTHESIS. Nothing in the speech step reads these rows, so awaiting the
    // insert first simply parked the user in silence for a round trip. It is awaited before the
    // response returns (below), so the transcript is still on file by the time the client could
    // possibly ask for it — this reorders the wait, it does not drop the write.
    //
    // Promise.resolve() rather than the bare builder: a PostgREST builder is LAZY — it is a thenable
    // that does not issue its request until something awaits it — so leaving it unawaited here would
    // not have started the write at all, and an early return added between this line and the awaits
    // below would silently drop it. Resolving it now fires it immediately and keeps it a real
    // in-flight promise.
    const transcriptWrite = Promise.resolve(
      admin.from('coach_messages').insert([
        { user_id: user.id, role: 'user', content: transcript, surface: 'chat', modality: 'voice' },
        {
          user_id: user.id,
          role: 'assistant',
          content: result.text,
          surface: 'chat',
          modality: 'voice',
          action: result.action ? { ...result.action, status: 'proposed' } : null,
        },
      ])
    );

    // ── Speech out — the only paid step ──
    const spoken = speakable(result.text);
    const spent = await bumpTts(admin, user.id, spoken.length);

    // Over budget still returns the TEXT. Losing her voice for the rest of the day should not
    // mean losing her answer — the reply just arrives silently and the screen shows it.
    if (spent > TTS_CHARS_PER_DAY) {
      await transcriptWrite;
      return json({
        transcript,
        text: result.text,
        action: result.action,
        audio: null,
        voice_capped: true,
      });
    }

    // Synthesis and the transcript write overlap — the wait is whichever is slower, not their sum.
    const [audio] = await Promise.all([speak(elevenKey, voiceId, spoken), transcriptWrite]);

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

/**
 * The part of a reply that actually gets spoken.
 *
 * A bare `.slice(MAX_REPLY_CHARS)` cuts mid-word, and at 300 characters that lands far more often
 * than it did at 600 — the audio would simply stop in the middle of a syllable while the on-screen
 * text carried on, which reads as the connection dropping. So the cut backs up to the last sentence
 * end, and failing that the last space, before falling back to the hard slice.
 *
 * The full text is still returned and still shown; only the spoken half is trimmed.
 */
function speakable(text: string): string {
  const full = text.trim();
  if (full.length <= MAX_REPLY_CHARS) return full;
  const cut = full.slice(0, MAX_REPLY_CHARS);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  // Only honoured past the halfway mark: backing up to a full stop at character 20 would throw away
  // most of the reply to save a clipped word.
  if (sentence > MAX_REPLY_CHARS / 2) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(' ');
  return space > MAX_REPLY_CHARS / 2 ? cut.slice(0, space) : cut;
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
