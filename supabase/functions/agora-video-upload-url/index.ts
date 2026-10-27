// Signs the R2 PUTs for one Agora video + its poster frame (migration 0279), and writes the
// agora_video_uploads ledger row that makes the key postable. The client compresses and extracts
// the poster on-device, PUTs the bytes straight to R2 with these URLs, then sends the key in
// create_agora_post's p_attachments — where agora_attachment_snapshot accepts it only if this
// function issued it to the same user and no post has claimed it yet.
//
// THE LIMITS LIVE HERE, not only in the composer: ≤ 60s, ≤ 50 MB, and a cap on clips uploaded but
// never posted. The byte count is SIGNED into the PUT (Content-Length), so the upload must be the
// size declared — a client can't ask for a 5 MB URL and send 5 GB.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PutObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3';
import { corsHeaders } from '../_shared/cors.ts';
import { createR2Client, R2_BUCKET } from '../_shared/r2.ts';

const UPLOAD_URL_TTL_SECONDS = 600;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_POSTER_BYTES = 2 * 1024 * 1024;
const MAX_DURATION_S = 60.5;
/** Uploads signed but not posted in the last day. The composer needs one per post; 10 is retries. */
const MAX_UNCLAIMED_PER_DAY = 10;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

    // Act only for whoever this JWT belongs to — same pattern as gym-clip-upload-url.
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Not authenticated.' }, 401);

    const { bytes, posterBytes, durationS, width, height } = await req.json();
    if (!Number.isInteger(bytes) || bytes <= 0) return json({ error: 'Missing video size.' }, 400);
    if (!Number.isInteger(posterBytes) || posterBytes <= 0) return json({ error: 'Missing poster size.' }, 400);
    if (typeof durationS !== 'number' || !(durationS > 0)) return json({ error: 'Missing video length.' }, 400);
    if (durationS > MAX_DURATION_S) return json({ error: 'Videos can be up to 60 seconds.' }, 413);
    if (bytes > MAX_VIDEO_BYTES) return json({ error: 'That video is too large (50 MB max).' }, 413);
    if (posterBytes > MAX_POSTER_BYTES) return json({ error: 'Poster frame too large.' }, 413);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error: countError } = await admin
      .from('agora_video_uploads')
      .select('video_key', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('post_id', null)
      .gte('issued_at', since);
    if (countError) return json({ error: countError.message }, 500);
    if ((count ?? 0) >= MAX_UNCLAIMED_PER_DAY) {
      return json({ error: 'Too many unposted videos today. Try again tomorrow.' }, 429);
    }

    const clipId = crypto.randomUUID();
    const videoKey = `agora/${user.id}/${clipId}.mp4`;
    const posterKey = `agora/${user.id}/${clipId}_poster.jpg`;

    // Ledger first: a signed URL with no row would be an upload nothing can post OR sweep.
    const { error: insertError } = await admin.from('agora_video_uploads').insert({
      video_key: videoKey,
      poster_key: posterKey,
      user_id: user.id,
      bytes,
      duration_s: Math.round(durationS * 10) / 10,
      width: Number.isInteger(width) && width > 0 ? width : null,
      height: Number.isInteger(height) && height > 0 ? height : null,
    });
    if (insertError) return json({ error: insertError.message }, 500);

    const r2 = createR2Client();
    // Content-Length is signed, so R2 refuses a PUT of any other size.
    const signable = { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-length']) };
    const [videoUploadUrl, posterUploadUrl] = await Promise.all([
      getSignedUrl(
        r2,
        new PutObjectCommand({ Bucket: R2_BUCKET, Key: videoKey, ContentType: 'video/mp4', ContentLength: bytes }),
        signable,
      ),
      getSignedUrl(
        r2,
        new PutObjectCommand({ Bucket: R2_BUCKET, Key: posterKey, ContentType: 'image/jpeg', ContentLength: posterBytes }),
        signable,
      ),
    ]);

    return json({ videoKey, posterKey, videoUploadUrl, posterUploadUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
