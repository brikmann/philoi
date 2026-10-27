// Drains gym_clip_purges (0266, 0279): deletes every gym clip and thumbnail a workout set has lost —
// removed, replaced, pulled after a failed PR review, or the set deleted — from R2. SQL can queue a
// key but cannot reach R2, so pg_cron's kick_gym_clip_purge() posts here every 10 minutes when the
// queue has work. Service-role only: the caller must present the service role key, never a user JWT.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { DeleteObjectsCommand } from 'npm:@aws-sdk/client-s3@3';
import { createR2Client, R2_BUCKET } from '../_shared/r2.ts';

const BATCH = 200;
const MAX_ATTEMPTS = 5;

type PurgeRow = { id: number; object_key: string; attempts: number };

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (req.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
    return json({ error: 'Forbidden.' }, 403);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const { data: rows, error } = await admin
    .from('gym_clip_purges')
    .select('id, object_key, attempts')
    .is('purged_at', null)
    .lt('attempts', MAX_ATTEMPTS)
    .order('queued_at')
    .limit(BATCH)
    .returns<PurgeRow[]>();
  if (error) return json({ error: error.message }, 500);
  if (!rows?.length) return json({ purged: 0 });

  // Only ever touch keys under clips/ (what gym-clip-upload-url writes) or pr-clips/ (where
  // gym-clip-pin moves a PR-backing clip, outside the retention rule).
  // agora/ is an Agora post's video + poster (0279, agora-video-upload-url), queued when its
  // agora_video_uploads row goes — post deleted, taken down, account deleted, or never posted.
  const isClipKey = (k: string) => k.startsWith('clips/') || k.startsWith('pr-clips/') || k.startsWith('agora/');
  const safe = rows.filter((r) => isClipKey(r.object_key));
  const unsafe = rows.filter((r) => !isClipKey(r.object_key));

  const failed = new Map<string, string>();
  if (safe.length) {
    try {
      const out = await createR2Client().send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: { Objects: safe.map((r) => ({ Key: r.object_key })), Quiet: true },
        }),
      );
      for (const e of out.Errors ?? []) if (e.Key) failed.set(e.Key, e.Message ?? 'delete failed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'R2 unreachable';
      for (const r of safe) failed.set(r.object_key, msg);
    }
  }
  for (const r of unsafe) failed.set(r.object_key, 'refused: key outside clips/, pr-clips/ and agora/');

  const now = new Date().toISOString();
  const done = rows.filter((r) => !failed.has(r.object_key)).map((r) => r.id);
  if (done.length) await admin.from('gym_clip_purges').update({ purged_at: now }).in('id', done);
  for (const r of rows.filter((x) => failed.has(x.object_key))) {
    await admin
      .from('gym_clip_purges')
      .update({ attempts: r.attempts + 1, last_error: failed.get(r.object_key) })
      .eq('id', r.id);
  }

  return json({ purged: done.length, failed: failed.size });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
