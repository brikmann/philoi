// Moves a PR-backing clip out of the bucket's ~90-day retention lifecycle (r2.ts), so "✓ clip on
// file" on a board never outlives the clip it claims. R2 lifecycle rules filter by key prefix only,
// so the exemption is a prefix: uploads land under clips/ (the rule's prefix), and once the owner
// consents on the "Post this PR?" sheet (mock 295) the clip is copied to pr-clips/ and the set is
// repointed at the copy. Repointing video_key fires 0266's workout_sets_purge_clip trigger, which
// queues the clips/ original for gym-clip-purge — so nothing is left behind, and hard-delete on
// removal / failed review / set delete keeps working on the pr-clips/ key exactly as before.
//
// Two callers, no DB changes:
//   · the owner's JWT + { workoutSetId } — the consent sheet fires this right after consenting;
//   · the service role key, no body — sweeps every consented set still under clips/ (backfill, or
//     a client whose call never landed).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { CopyObjectCommand, DeleteObjectsCommand } from 'npm:@aws-sdk/client-s3@3';
import { corsHeaders } from '../_shared/cors.ts';
import { createR2Client, R2_BUCKET } from '../_shared/r2.ts';

const FROM_PREFIX = 'clips/';
const TO_PREFIX = 'pr-clips/';
const SWEEP_BATCH = 100;

type PinRow = { id: string; video_key: string | null; thumb_key: string | null };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

    // Sweep mode: service role only.
    if (authHeader === `Bearer ${serviceKey}`) {
      const { data: rows, error } = await admin
        .from('workout_sets')
        .select('id, video_key, thumb_key')
        .like('video_key', `${FROM_PREFIX}%`)
        .not('clip_consent_at', 'is', null)
        .limit(SWEEP_BATCH)
        .returns<PinRow[]>();
      if (error) return json({ error: error.message }, 500);
      let pinned = 0;
      const failed: string[] = [];
      for (const row of rows ?? []) {
        try {
          if (await pin(admin, row)) pinned++;
        } catch {
          failed.push(row.id);
        }
      }
      return json({ pinned, failed, more: (rows?.length ?? 0) === SWEEP_BATCH });
    }

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

    // Owner-only, like gym-clip-upload-url — "visible to me" (circle-mate RLS) isn't enough.
    const { data: row } = await userClient
      .from('workout_sets')
      .select('id, video_key, thumb_key, clip_consent_at, workouts!inner(user_id)')
      .eq('id', workoutSetId)
      .maybeSingle<PinRow & { clip_consent_at: string | null; workouts: { user_id: string } }>();
    if (!row) return json({ error: 'Set not found.' }, 404);
    if (row.workouts.user_id !== user.id) return json({ error: 'Not your set.' }, 403);
    // Only a consented clip backs a PR; an unconsented one keeps the normal retention.
    if (!row.clip_consent_at) return json({ pinned: false, reason: 'not consented' });

    return json({ pinned: await pin(admin, row) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

// Copy → repoint (compare-and-set on the old key) → let the purge trigger delete the original.
// Returns false when there was nothing to do. If the set changed under us (clip removed or
// replaced mid-copy), the copies are deleted and the set is left alone.
async function pin(admin: SupabaseClient, row: PinRow): Promise<boolean> {
  if (!row.video_key?.startsWith(FROM_PREFIX)) return false;
  const r2 = createR2Client();
  const moves = [row.video_key, row.thumb_key]
    .filter((k): k is string => !!k && k.startsWith(FROM_PREFIX))
    .map((from) => ({ from, to: TO_PREFIX + from.slice(FROM_PREFIX.length) }));

  for (const m of moves) {
    await r2.send(new CopyObjectCommand({ Bucket: R2_BUCKET, CopySource: `${R2_BUCKET}/${m.from}`, Key: m.to }));
  }
  const newKey = (k: string | null) => moves.find((m) => m.from === k)?.to ?? k;

  const { data: updated, error } = await admin
    .from('workout_sets')
    .update({ video_key: newKey(row.video_key), thumb_key: newKey(row.thumb_key) })
    .eq('id', row.id)
    .eq('video_key', row.video_key)
    .select('id');
  if (error || !updated?.length) {
    await r2.send(new DeleteObjectsCommand({ Bucket: R2_BUCKET, Delete: { Objects: moves.map((m) => ({ Key: m.to })), Quiet: true } }));
    if (error) throw error;
    return false;
  }
  return true;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
