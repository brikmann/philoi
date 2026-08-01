// Issues signed, expiring GET URLs for a set's video clip + poster thumbnail (PHILOI_UI_SPEC.md
// §23) — never a public/unsigned R2 URL, and never through the app server (the client fetches
// straight from R2 with these). Access is owner OR circle-mate (workout_sets' own RLS — same
// rule check_in_workout_sets/photos already use) OR friend (§23: "scope clips to
// campfires/friends only" — friend access isn't part of workout_sets' general RLS, which stays
// circle-scoped for the whole gym feature, so it's re-checked here specifically for video).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { GetObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3';
import { corsHeaders } from '../_shared/cors.ts';
import { createR2Client, R2_BUCKET } from '../_shared/r2.ts';

const PLAYBACK_URL_TTL_SECONDS = 3600;

type SetRow = {
  video_key: string | null;
  thumb_key: string | null;
  duration_s: number | null;
  resolution: string | null;
  workouts: { user_id: string };
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

    const { workoutSetId } = await req.json();
    if (typeof workoutSetId !== 'string' || !workoutSetId) return json({ error: 'Missing workoutSetId.' }, 400);

    const selectClip = 'video_key, thumb_key, duration_s, resolution, workouts!inner(user_id)';

    // Try the caller's own auth-scoped client first — RLS already grants owner/circle-mate
    // access for free, no extra logic needed for either of those two cases.
    const { data: viaRls } = await userClient.from('workout_sets').select(selectClip).eq('id', workoutSetId).maybeSingle<SetRow>();

    let clip = viaRls;
    if (!clip) {
      // Not visible via RLS — fall back to the service client to check the friend path (and to
      // tell "doesn't exist" apart from "exists but you're not a friend").
      const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: raw } = await serviceClient.from('workout_sets').select(selectClip).eq('id', workoutSetId).maybeSingle<SetRow>();
      if (!raw) return json({ error: 'Clip not found.' }, 404);

      const ownerId = raw.workouts.user_id;
      const { data: friendRow } = await serviceClient
        .from('friend_requests')
        .select('id')
        .eq('status', 'accepted')
        .or(`and(requester_id.eq.${user.id},recipient_id.eq.${ownerId}),and(requester_id.eq.${ownerId},recipient_id.eq.${user.id})`)
        .maybeSingle();
      if (!friendRow) return json({ error: "You don't have access to this clip." }, 403);
      clip = raw;
    }

    if (!clip.video_key) return json({ error: 'This set has no clip.' }, 404);

    const r2 = createR2Client();
    const [videoUrl, thumbUrl] = await Promise.all([
      getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: clip.video_key }), { expiresIn: PLAYBACK_URL_TTL_SECONDS }),
      clip.thumb_key
        ? getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: clip.thumb_key }), { expiresIn: PLAYBACK_URL_TTL_SECONDS })
        : Promise.resolve(null),
    ]);

    return json({ videoUrl, thumbUrl, durationS: clip.duration_s, resolution: clip.resolution });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
