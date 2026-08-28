-- The Agora, the cleanup 0128 left implicit — a removed post's photo stops resolving. (#149)
--
-- 0128 made `agora-photos` a PUBLIC bucket, and argued the case: an Agora photo sits on a card a
-- whole university is entitled to see, in an infinite-scroll list, and signing every image on
-- every page is a round trip per render for content whose audience is already "the public".
--
-- That argument holds only while removal is REAL. A public bucket plus a soft removal is a
-- takedown that doesn't take anything down: the row leaves the feed, the object keeps serving on
-- its direct URL, and the URL is the thing that gets pasted elsewhere. For the moderation case —
-- the reason a takedown exists at all — that is the entire failure. So:
--
--   * removal of an agora_posts row hard-deletes its storage object, on EVERY path;
--   * moderation can actually remove an Agora post, which before this file it could not.
--
-- 0128 is otherwise untouched. The bucket stays public.

-- ───────────────────────────── the storage cascade ─────────────────────────────

/**
 * Storage has no foreign keys, so nothing in Postgres has ever known that `agora_posts.photo_path`
 * owns an object. Three separate paths delete a post — the author (delete_agora_post, 0130),
 * moderation (admin_resolve_report, below), and the profiles cascade when an account is deleted —
 * and a per-path cleanup gets exactly as far as the first path somebody forgets. A row trigger is
 * the only place that catches all three, plus the ad-hoc `delete from agora_posts` a future
 * migration or a console session will eventually run.
 *
 * Deleting the storage.objects row is what makes the path stop resolving: Supabase's storage API
 * resolves `/object/public/agora-photos/<path>` through that row, so once it is gone the URL 404s
 * for everyone holding it, immediately and permanently. That is the property this file is for.
 *
 * It does NOT reclaim the underlying S3 blob — only the storage API can, and reaching it from
 * Postgres means holding a service-role key in the database, which is a much worse trade than the
 * bytes are worth. The blob is unreachable (no row, no key mapping) but it is still billed, so
 * the path is recorded in `agora_photo_orphans` below rather than leaked silently.
 *
 * Guarded on `storage.objects` for the same reason 0128's provisioning block is: a bare Postgres
 * (CI, a local psql) has no storage schema, and this trigger fires on every delete in that
 * environment's tests.
 */
create table if not exists agora_photo_orphans (
  photo_path text primary key,
  deleted_at timestamptz not null default now(),
  /** Set once a sweeper has actually removed the blob through the storage API. */
  reclaimed_at timestamptz
);

comment on table agora_photo_orphans is
  'Storage paths whose storage.objects row was hard-deleted by the agora_posts delete trigger. The object no longer resolves; the S3 blob is still billed until a sweeper reclaims it.';

create index if not exists agora_photo_orphans_unreclaimed_idx
  on agora_photo_orphans (deleted_at) where reclaimed_at is null;

alter table agora_photo_orphans enable row level security;
-- No policy: this is a janitorial ledger, reachable only by the service role. Users have no
-- business enumerating the paths of photos that used to exist.

create or replace function agora_post_photo_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if old.photo_path is null then
    return old;
  end if;

  if to_regclass('storage.objects') is null then
    return old;  -- bare Postgres; nothing to clean up
  end if;

  execute 'delete from storage.objects where bucket_id = $1 and name = $2'
    using 'agora-photos', old.photo_path;

  insert into agora_photo_orphans (photo_path)
  values (old.photo_path)
  on conflict (photo_path) do nothing;

  return old;
end;
$fn$;

drop trigger if exists agora_posts_photo_cleanup on agora_posts;
create trigger agora_posts_photo_cleanup
  after delete on agora_posts
  for each row execute function agora_post_photo_cleanup();

-- ───────────────────────────── moderation can remove an Agora post ─────────────────────────────

/**
 * 0128 and 0129 added `reported_agora_post_id` / `reported_agora_comment_id` to moderation_reports
 * so a reviewer could OPEN the reported thing — but admin_resolve_report's 'removed_content' arm
 * still only knew about messages and check-ins. Resolving an Agora report as 'removed_content'
 * therefore logged a moderation action, flipped the report to 'actioned', and left the post
 * exactly where it was. The reviewer had no way to tell: the dashboard reports success.
 *
 * The two new arms are DELETES, not the soft `removed_at` / `deleted_at` that messages and
 * check-ins take. Those two are conversation rows, where a tombstone preserves the shape of a
 * thread other people are still reading; an Agora post is a standalone card with nothing hanging
 * off it but its own cheers and comments, which cascade. And a soft removal cannot satisfy the
 * reason this file exists — the photo trigger fires on DELETE, because "stops being served" is
 * the only removal a public bucket understands.
 *
 * The evidence trail survives the delete: moderation_actions already keeps (report_id,
 * action_type, target_user_id, notes) for exactly this, and admin_audit keeps every view the
 * reviewer made of the content before acting on it. What is lost is
 * moderation_reports.reported_agora_post_id, which the 0128 FK nulls on delete — the pointer, not
 * the record that it was actioned.
 *
 * Same signature as 0001's, so this is a true replacement and not a second overload.
 */
create or replace function admin_resolve_report(
  p_report_id uuid,
  p_action_type text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_report moderation_reports;
begin
  if not is_admin() then
    raise exception 'Not authorized.';
  end if;

  if p_action_type not in ('removed_content', 'disabled_account', 'reported_to_authorities', 'dismissed', 'warned') then
    raise exception 'Unknown action_type: %', p_action_type;
  end if;

  select * into v_report from moderation_reports where id = p_report_id;
  if v_report.id is null then
    raise exception 'Report not found.';
  end if;

  if p_action_type = 'removed_content' then
    if v_report.reported_message_id is not null then
      update messages set deleted_at = now() where id = v_report.reported_message_id and deleted_at is null;
    elsif v_report.reported_check_in_id is not null then
      update check_ins set removed_at = now() where id = v_report.reported_check_in_id and removed_at is null;
    elsif v_report.reported_agora_post_id is not null then
      -- Fires agora_posts_photo_cleanup; cheers and comments cascade off the post.
      delete from agora_posts where id = v_report.reported_agora_post_id;
    elsif v_report.reported_agora_comment_id is not null then
      delete from agora_comments where id = v_report.reported_agora_comment_id;
    end if;
  elsif p_action_type = 'disabled_account' then
    if v_report.reported_user_id is null then
      raise exception 'This report has no target user to disable.';
    end if;
    perform admin_disable_account(v_report.reported_user_id);
  end if;

  insert into moderation_actions (report_id, action_type, target_user_id, notes)
  values (p_report_id, p_action_type, v_report.reported_user_id, p_notes);

  update moderation_reports
  set status = case when p_action_type = 'dismissed' then 'dismissed' else 'actioned' end
  where id = p_report_id;
end;
$fn$;
