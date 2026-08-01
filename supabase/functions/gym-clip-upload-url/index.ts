// Issues a signed PUT URL straight to R2 for a per-set video clip + its poster thumbnail
// (PHILOI_UI_SPEC.md §23) — the client compresses/extracts the thumbnail on-device, uploads the
// bytes directly here (never through the app server), then calls attach_workout_set_clip() to
// persist the references. Quota is checked here (before wasting a presign on a free user who's
// already at their cap) AND again in attach_workout_set_clip (closes the race between two
// in-flight uploads).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PutObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3';
import { corsHeaders } from '../_shared/cors.ts';
import { createR2Client, R2_BUCKET } from '../_shared/r2.ts';

const UPLOAD_URL_TTL_SECONDS = 300;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

    // Same trusted pattern as strava-oauth-exchange — act only on behalf of whoever this JWT
    // belongs to, never an id passed in the request body.
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Not authenticated.' }, 401);

    const { workoutSetId } = await req.json();
    if (typeof workoutSetId !== 'string' || !workoutSetId) return json({ error: 'Missing workoutSetId.' }, 400);

    // Ownership via the auth-scoped client — RLS ("workout_sets: read via workout") already lets
    // owner OR circle-mate SELECT, but an upload URL should only ever go to the actual owner, so
    // that's checked explicitly rather than trusting "visible to me".
    const { data: setRow, error: setError } = await userClient
      .from('workout_sets')
      .select('id, workouts!inner(user_id)')
      .eq('id', workoutSetId)
      .maybeSingle<{ id: string; workouts: { user_id: string } }>();
    if (setError || !setRow) return json({ error: 'Set not found.' }, 404);
    if (setRow.workouts.user_id !== user.id) return json({ error: 'Not your set.' }, 403);

    const { data: quotaRows, error: quotaError } = await userClient.rpc('get_gym_clip_quota');
    if (quotaError) return json({ error: quotaError.message }, 500);
    const quota = quotaRows[0];
    if (quota.tier === 'free' && quota.remaining <= 0) {
      return json({ error: `You've used all ${quota.clip_limit} free clips this month.`, quota }, 403);
    }

    const clipId = crypto.randomUUID();
    const videoKey = `clips/${user.id}/${workoutSetId}/${clipId}.mp4`;
    const thumbKey = `clips/${user.id}/${workoutSetId}/${clipId}_thumb.jpg`;

    const r2 = createR2Client();
    const [videoUploadUrl, thumbUploadUrl] = await Promise.all([
      getSignedUrl(r2, new PutObjectCommand({ Bucket: R2_BUCKET, Key: videoKey, ContentType: 'video/mp4' }), {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
      }),
      getSignedUrl(r2, new PutObjectCommand({ Bucket: R2_BUCKET, Key: thumbKey, ContentType: 'image/jpeg' }), {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
      }),
    ]);

    return json({ videoKey, thumbKey, videoUploadUrl, thumbUploadUrl, quota });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
