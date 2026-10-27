// Signed, expiring GET URLs for the videos on a page of Agora posts (migration 0279) — poster
// frame and clip, never an unsigned R2 URL.
//
// ACCESS IS DECIDED IN SQL, AS THE CALLER. agora_video_sources runs with the caller's JWT and
// returns keys only for posts get_agora_item would show them — the visibility dial, the forest and
// campfire gates, and blocks both ways. A post the caller can't open simply isn't in the result, so
// this function never has to know what the rule is. Batched (one call per feed page, ≤ 30 posts).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { GetObjectCommand } from 'npm:@aws-sdk/client-s3@3';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3';
import { corsHeaders } from '../_shared/cors.ts';
import { createR2Client, R2_BUCKET } from '../_shared/r2.ts';

const PLAYBACK_URL_TTL_SECONDS = 3600;
const MAX_POSTS = 30;
const UUID = /^[0-9a-f-]{36}$/i;

type Source = { post_id: string; video_key: string; poster_key: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { postIds } = await req.json();
    if (!Array.isArray(postIds)) return json({ error: 'Missing postIds.' }, 400);
    const ids = [...new Set(postIds.filter((id): id is string => typeof id === 'string' && UUID.test(id)))].slice(0, MAX_POSTS);
    if (ids.length === 0) return json({ sources: {} });

    const { data, error } = await userClient.rpc('agora_video_sources', { p_post_ids: ids });
    if (error) return json({ error: error.message }, error.code === '42501' ? 403 : 500);

    const r2 = createR2Client();
    const sign = (key: string) =>
      getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: PLAYBACK_URL_TTL_SECONDS });

    const rows = (data ?? []) as Source[];
    const signed = await Promise.all(
      rows.map(async (r) => {
        const [videoUrl, posterUrl] = await Promise.all([sign(r.video_key), sign(r.poster_key)]);
        return [r.post_id, { videoUrl, posterUrl }] as const;
      }),
    );

    return json({
      sources: Object.fromEntries(signed),
      expiresAt: new Date(Date.now() + PLAYBACK_URL_TTL_SECONDS * 1000).toISOString(),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
