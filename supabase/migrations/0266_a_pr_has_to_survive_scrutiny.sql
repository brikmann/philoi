-- 0266 . A PR HAS TO SURVIVE SCRUTINY — report-only clip verification, disputes, and clip purge.
--
-- Decision (Noah): PR video is REPORT-ONLY. There is no age detection, so a clip is never browsable
-- on a board. A ranked PR shows "✓ clip on file" (0265: video + consent); anyone who thinks it's
-- off can dispute it, which files a moderation_reports row and puts the clip in front of a moderator.
-- Playback access is unchanged (owner, friends, circle-mates — gym-clip-playback-url); a board
-- stranger never gets a watch button.
--
--   1. moderation_reports.reported_workout_set_id + the 'PR dispute' reason.
--   2. dispute_pr(set, note) — one open dispute per person per set, rate-limited. Three different
--      people with open disputes pull the PR without waiting for a moderator.
--   3. pull_workout_set_pr — 'pulled' counts for nothing (0265), the personal_records row it held is
--      recomputed from the owner's remaining sets so the logger's PR detection stays honest, and the
--      clip is purged.
--   4. admin_resolve_report learns the set: removed_content pulls it; dismissed clears 'disputed'
--      once no other dispute on it is open. Rewritten from the live body (pg_get_functiondef,
--      2026-10-24), every other branch unchanged.
--   5. snapshot_reported_content keeps a snapshot of the disputed set, so the report survives the pull.
--   6. Clip hygiene: any clip a set loses — removed, replaced, pulled, or the set deleted — is queued
--      in gym_clip_purges, and the gym-clip-purge edge function deletes it from R2. pg_cron kicks the
--      function every 10 minutes, only when the queue has work. Before this, remove_workout_set_clip
--      nulled the key and left the object in R2 until the bucket's 90-day lifecycle rule.
--
-- LEDGER: apply this file alone (after 0265), then `supabase migration repair --status applied 0266`.
-- Deploy supabase/functions/gym-clip-purge from a clean tree BEFORE applying, or the first cron
-- kick 404s (harmless: the queue just waits).

begin;

-- ──────────────────── 1. the report target ────────────────────
alter table moderation_reports
  add column if not exists reported_workout_set_id uuid references workout_sets (id) on delete set null;
create index if not exists moderation_reports_workout_set_idx
  on moderation_reports (reported_workout_set_id) where reported_workout_set_id is not null;

alter table moderation_reports drop constraint if exists moderation_reports_reason_check;
alter table moderation_reports add constraint moderation_reports_reason_check check (reason = any (array[
  'Spam or misleading', 'Harassment or bullying', 'Inappropriate or offensive content',
  'Child safety / CSAE', 'Other', 'Reported from the Agora', 'PR dispute'
]));

-- ──────────────────── 6. the purge queue (first: everything below enqueues into it) ────────────────────
create table if not exists gym_clip_purges (
  id         bigint generated always as identity primary key,
  object_key text not null,
  queued_at  timestamptz not null default now(),
  purged_at  timestamptz,
  attempts   int not null default 0,
  last_error text
);
alter table gym_clip_purges enable row level security;   -- no policies: service role only
create index if not exists gym_clip_purges_pending_idx on gym_clip_purges (queued_at) where purged_at is null;

create or replace function enqueue_gym_clip_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.video_key is not null and (tg_op = 'DELETE' or new.video_key is distinct from old.video_key) then
    insert into gym_clip_purges (object_key) values (old.video_key);
  end if;
  if old.thumb_key is not null and (tg_op = 'DELETE' or new.thumb_key is distinct from old.thumb_key) then
    insert into gym_clip_purges (object_key) values (old.thumb_key);
  end if;
  return null;
end;
$$;

drop trigger if exists workout_sets_purge_clip on workout_sets;
create trigger workout_sets_purge_clip
  after update of video_key, thumb_key or delete on workout_sets
  for each row execute function enqueue_gym_clip_purge();

-- Called by cron. Posts to the edge function only when there is work (pg_net sends after commit).
create or replace function kick_gym_clip_purge()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if not exists (select 1 from gym_clip_purges where purged_at is null and attempts < 5) then
    return;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then
    raise warning 'kick_gym_clip_purge: service_role_key not in Vault';
    return;
  end if;
  perform net.http_post(
    url := 'https://coaqgcquzywadrghzbfj.supabase.co/functions/v1/gym-clip-purge',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;

select cron.unschedule('philoi-gym-clip-purge') where exists (select 1 from cron.job where jobname = 'philoi-gym-clip-purge');
select cron.schedule('philoi-gym-clip-purge', '*/10 * * * *', 'select public.kick_gym_clip_purge()');

-- ──────────────────── 3. pulling a PR ────────────────────
create or replace function pull_workout_set_pr(p_workout_set_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_exercise uuid;
  v_best record;
begin
  select w.user_id, we.exercise_id into v_user, v_exercise
  from workout_sets ws
  join workouts w on w.id = ws.workout_id
  join workout_exercises we on we.id = ws.workout_exercise_id
  where ws.id = p_workout_set_id;
  if v_user is null then
    return;
  end if;

  -- Nulling the keys fires workout_sets_purge_clip, which queues the R2 delete.
  update workout_sets
  set pr_status = 'pulled', is_pr = false,
      video_key = null, thumb_key = null, duration_s = null, resolution = null, uploaded_at = null
  where id = p_workout_set_id;

  -- If this set held the owner's PR for the exercise, hand it to their best remaining set (by the
  -- logger's own ordering: e1rm, then reps), or clear it.
  if exists (select 1 from personal_records where user_id = v_user and exercise_id = v_exercise
             and workout_set_id = p_workout_set_id) then
    select ws.id, coalesce(ws.weight, 0) as weight, ws.reps, gym_e1rm(ws.weight, ws.reps) as e1rm, ws.created_at
    into v_best
    from workout_sets ws
    join workouts w on w.id = ws.workout_id
    join workout_exercises we on we.id = ws.workout_exercise_id
    where w.user_id = v_user and we.exercise_id = v_exercise and ws.pr_status <> 'pulled'
    order by gym_e1rm(ws.weight, ws.reps) desc, ws.reps desc, ws.created_at
    limit 1;

    if v_best.id is null then
      delete from personal_records where user_id = v_user and exercise_id = v_exercise;
    else
      update personal_records
      set weight = v_best.weight, reps = v_best.reps, e1rm = v_best.e1rm,
          workout_set_id = v_best.id, achieved_at = v_best.created_at
      where user_id = v_user and exercise_id = v_exercise;
    end if;
  end if;
end;
$$;

-- ──────────────────── 2. disputing a PR ────────────────────
create or replace function dispute_pr(p_workout_set_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_status text;
  v_private boolean;
  v_report uuid;
  v_disputers int;
  v_recent int;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;

  select w.user_id, ws.pr_status, ws.pr_private into v_owner, v_status, v_private
  from workout_sets ws join workouts w on w.id = ws.workout_id
  where ws.id = p_workout_set_id;
  if v_owner is null or v_private then
    raise exception 'That PR isn''t on a board.';
  end if;
  if v_owner = auth.uid() then
    raise exception 'You can''t dispute your own PR.';
  end if;
  if v_status = 'pulled' then
    raise exception 'That PR has already been pulled.';
  end if;

  select id into v_report from moderation_reports
  where reported_workout_set_id = p_workout_set_id and reporter_id = auth.uid() and status = 'pending';
  if v_report is not null then
    raise exception 'You''ve already disputed this PR — a moderator has it.';
  end if;

  select count(*) into v_recent from moderation_reports
  where reporter_id = auth.uid() and reason = 'PR dispute' and created_at > now() - interval '1 hour';
  perform ugc_assert_rate(v_recent, 10);
  if p_note is not null and btrim(p_note) <> '' then
    perform ugc_assert_clean(p_note);
  end if;

  insert into moderation_reports (reporter_id, reported_user_id, reported_workout_set_id, reason, note)
  values (auth.uid(), v_owner, p_workout_set_id, 'PR dispute', nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  returning id into v_report;

  update workout_sets set pr_status = 'disputed' where id = p_workout_set_id and pr_status = 'ok';

  select count(distinct reporter_id) into v_disputers from moderation_reports
  where reported_workout_set_id = p_workout_set_id and status = 'pending';
  if v_disputers >= 3 then
    perform pull_workout_set_pr(p_workout_set_id);
    return jsonb_build_object('report_id', v_report, 'status', 'pulled', 'disputes', v_disputers);
  end if;

  return jsonb_build_object('report_id', v_report, 'status', 'disputed', 'disputes', v_disputers);
end;
$$;

-- ──────────────────── 4. moderators resolve it ────────────────────
create or replace function admin_resolve_report(p_report_id uuid, p_action_type text, p_notes text default null::text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
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
    elsif v_report.reported_workout_set_id is not null then
      -- 0266 · a failed review pulls the PR (and purges its clip).
      perform pull_workout_set_pr(v_report.reported_workout_set_id);
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

  -- 0266 · a PR whose last open dispute was dismissed is back to clean.
  if p_action_type = 'dismissed' and v_report.reported_workout_set_id is not null
     and not exists (select 1 from moderation_reports
                     where reported_workout_set_id = v_report.reported_workout_set_id and status = 'pending') then
    update workout_sets set pr_status = 'ok' where id = v_report.reported_workout_set_id and pr_status = 'disputed';
  end if;
end;
$function$;

-- ──────────────────── 5. the snapshot ────────────────────
create or replace function snapshot_reported_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.reported_message_id is not null then
    select jsonb_build_object('type', 'message', 'body', body, 'user_id', user_id, 'created_at', created_at),
           group_id
    into new.reported_content_snapshot, new.circle_id
    from messages where id = new.reported_message_id;
  elsif new.reported_check_in_id is not null then
    select jsonb_build_object(
             'type', 'check_in', 'caption', caption, 'photo_url', photo_url, 'user_id', user_id,
             'created_at', created_at, 'goal_type', goal_type, 'goal_label', goal_label, 'goal_detail', goal_detail
           )
    into new.reported_content_snapshot
    from check_ins where id = new.reported_check_in_id;
  elsif new.reported_group_id is not null then
    select jsonb_build_object('type', 'circle', 'name', name, 'owner_id', owner_id, 'created_at', created_at)
    into new.reported_content_snapshot
    from groups where id = new.reported_group_id;
    new.circle_id := coalesce(new.circle_id, new.reported_group_id);
  elsif new.reported_workout_set_id is not null then
    -- 0266 · a disputed PR: what was claimed, and the clip a moderator should open.
    select jsonb_build_object(
             'type', 'workout_set', 'user_id', w.user_id, 'exercise', we.name, 'weight_lb', ws.weight,
             'reps', ws.reps, 'video_key', ws.video_key, 'created_at', ws.created_at
           )
    into new.reported_content_snapshot
    from workout_sets ws
    join workouts w on w.id = ws.workout_id
    join workout_exercises we on we.id = ws.workout_exercise_id
    where ws.id = new.reported_workout_set_id;
  end if;
  return new;
end;
$function$;

-- ──────────────────── grants ────────────────────
revoke all on function dispute_pr(uuid, text) from public, anon;
grant execute on function dispute_pr(uuid, text) to authenticated;
revoke all on function pull_workout_set_pr(uuid) from public, anon, authenticated;
revoke all on function kick_gym_clip_purge() from public, anon, authenticated;
revoke all on function enqueue_gym_clip_purge() from public, anon, authenticated;

-- ──────────────────── assertions ────────────────────
do $assert$
begin
  if not exists (select 1 from cron.job where jobname = 'philoi-gym-clip-purge') then
    raise exception '0266: purge cron not scheduled';
  end if;
  if has_function_privilege('authenticated', 'public.pull_workout_set_pr(uuid)', 'execute')
     or has_function_privilege('anon', 'public.dispute_pr(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.dispute_pr(uuid, text)', 'execute') then
    raise exception '0266: grants are wrong';
  end if;
  if (select prosrc from pg_proc where proname = 'admin_resolve_report') !~ 'reported_agora_comment_id' then
    raise exception '0266: admin_resolve_report lost a branch';
  end if;
end;
$assert$;

commit;
