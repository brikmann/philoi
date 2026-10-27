// Drains chat_media_purges (0284): removes every chat photo and file whose message was deleted —
// by its sender, by moderation, or by a cascade (thread, forest, account) — from the private
// `chat-media` bucket. SQL can queue a key but a SQL `delete from storage.objects` only drops the
// metadata row and strands the bytes, so the delete goes through the Storage API here instead.
// pg_cron's kick_chat_media_purge() posts here every 10 minutes when the queue has work.
// Service-role only: the caller must present the service role key, never a user JWT. Modelled on
// gym-clip-purge.
import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'chat-media';
const BATCH = 200;
/** Storage's remove() takes a list; keep each call well inside its limits. */
const REMOVE_CHUNK = 100;
const MAX_ATTEMPTS = 5;

/** `<scope>/<room id>/<uploader id>/<uuid>.<ext>` — the only shape chat_freeze_attachments admits. */
const CHAT_MEDIA_KEY =
  /^(dm|forest)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|pdf|txt|md|docx)$/;

type PurgeRow = { id: number; object_key: string; attempts: number };

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (req.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
    return json({ error: 'Forbidden.' }, 403);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const { data: rows, error } = await admin
    .from('chat_media_purges')
    .select('id, object_key, attempts')
    .lt('attempts', MAX_ATTEMPTS)
    .order('queued_at')
    .limit(BATCH)
    .returns<PurgeRow[]>();
  if (error) return json({ error: error.message }, 500);
  if (!rows?.length) return json({ purged: 0 });

  const safe = rows.filter((r) => CHAT_MEDIA_KEY.test(r.object_key));
  const unsafe = rows.filter((r) => !CHAT_MEDIA_KEY.test(r.object_key));

  // Keyed by row id: one key can be queued twice (deleted, then its row cascaded), and both rows
  // must resolve.
  const failed = new Map<number, string>();
  const keys = [...new Set(safe.map((r) => r.object_key))];
  for (let i = 0; i < keys.length; i += REMOVE_CHUNK) {
    const chunk = keys.slice(i, i + REMOVE_CHUNK);
    // A key already gone is not an error — remove() simply doesn't list it — so it counts as done.
    const { error: removeError } = await admin.storage.from(BUCKET).remove(chunk);
    if (removeError) {
      const inChunk = new Set(chunk);
      for (const r of safe) if (inChunk.has(r.object_key)) failed.set(r.id, removeError.message);
    }
  }
  for (const r of unsafe) failed.set(r.id, 'refused: not a chat-media key');

  const done = rows.filter((r) => !failed.has(r.id)).map((r) => r.id);
  if (done.length) {
    const { error: deleteError } = await admin.from('chat_media_purges').delete().in('id', done);
    if (deleteError) return json({ error: deleteError.message }, 500);
  }
  for (const r of rows.filter((x) => failed.has(x.id))) {
    await admin
      .from('chat_media_purges')
      .update({ attempts: r.attempts + 1, last_error: failed.get(r.id) })
      .eq('id', r.id);
  }

  return json({ purged: done.length, failed: failed.size });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
