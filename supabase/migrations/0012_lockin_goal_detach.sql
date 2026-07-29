-- Core lock-in loop rebuild, part 1 (PHILOI_UI_SPEC.md §12) — this file is a historical,
-- reviewable snapshot; supabase/schema.sql is the real deploy artifact and carries the
-- identical statements, inserted next to the logically-related existing code (not appended
-- at EOF). Run the whole of schema.sql, not this file, against a project.
--
-- Reverses the 0002 goals-refactor's core assumption: goals are no longer persistent
-- per-user records you check into. You pick a goal TYPE + optional free-text detail EACH
-- TIME you lock in — no cadence, no once-a-day cap, no pre-committed goal list. Streak
-- becomes "you locked in at all that day," per user, not per goal.

-- ───────────────────────────── 1a. goal-type taxonomy ─────────────────────────────
-- job_applications/read join the real picker; social_media stays a legal historical value
-- (old rows) but is not offered in the new picker.
alter table goals drop constraint if exists goals_type_check;
alter table goals add constraint goals_type_check
  check (type in ('gym', 'run', 'study', 'social_media', 'custom', 'job_applications', 'read'));

-- ───────────────────────────── 1b. streak moves from goals to profiles ─────────────────────────────
alter table profiles add column if not exists current_streak integer not null default 0;
alter table profiles add column if not exists longest_streak integer not null default 0;

-- Same consecutive-day algorithm as recompute_goal_streak(), scoped to a USER instead of a
-- goal — "locked in at all that day" regardless of which goal_type it was.
create or replace function recompute_user_streak(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dates date[];
  v_streak integer := 0;
  v_longest integer := 0;
  v_expected date := current_date;
  d date;
begin
  select array_agg(distinct (created_at at time zone 'utc')::date order by (created_at at time zone 'utc')::date desc)
  into v_dates
  from check_ins
  where user_id = p_user_id and removed_at is null;

  if v_dates is null then
    update profiles set current_streak = 0 where id = p_user_id;
    return;
  end if;

  if v_dates[1] = current_date or v_dates[1] = current_date - 1 then
    v_expected := v_dates[1];
    foreach d in array v_dates loop
      if d = v_expected then
        v_streak := v_streak + 1;
        v_expected := v_expected - 1;
      else
        exit;
      end if;
    end loop;
  end if;

  v_longest := 1;
  declare
    v_run integer := 1;
    i integer;
  begin
    for i in 2 .. array_length(v_dates, 1) loop
      if v_dates[i] = v_dates[i - 1] - 1 then
        v_run := v_run + 1;
      else
        v_run := 1;
      end if;
      if v_run > v_longest then
        v_longest := v_run;
      end if;
    end loop;
  end;

  update profiles
  set current_streak = v_streak,
      longest_streak = greatest(longest_streak, v_longest, v_streak)
  where id = p_user_id;
end;
$$;

-- Backfill every existing user's new per-user streak once, from their existing check_ins
-- history (deliberately NOT derived from goals.current_streak — the per-goal figures don't
-- combine into "locked in that day at all" without recomputing from raw dates).
do $$
declare
  r record;
begin
  for r in select distinct user_id from check_ins where removed_at is null loop
    perform recompute_user_streak(r.user_id);
  end loop;
end $$;

-- handle_check_in_insert(): same signature (trigger fn, no args) — body-only swap from
-- goals.current_streak to profiles.current_streak.
create or replace function handle_check_in_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_streak integer;
begin
  perform recompute_user_streak(new.user_id);

  select current_streak into v_streak from profiles where id = new.user_id;

  update check_ins
  set xp_earned = (
    case
      when new.duration_seconds is not null then round(new.duration_seconds * 250.0 / 3600)
      else 100
    end
  ) + coalesce(v_streak, 0) * 5
  where id = new.id;

  return new;
end;
$$;

-- notify_streaks_at_risk(): same signature — iterate profiles instead of goals.
create or replace function notify_streaks_at_risk()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select id as user_id, current_streak
    from profiles
    where current_streak > 0
      and not exists (
        select 1 from check_ins ci
        where ci.user_id = profiles.id
          and ci.removed_at is null
          and (ci.created_at at time zone 'utc')::date = current_date
      )
  loop
    perform notify_push(
      array[r.user_id],
      'Streak at risk',
      'Your ' || r.current_streak || '-day streak breaks at midnight — lock in 🔥',
      jsonb_build_object('type', 'streak_risk')
    );
  end loop;
end;
$$;

-- get_my_campfire_heat(): same signature — one row per member (was previously averaged in
-- 3x for a member with 3 goal types, a latent bug this also fixes), reading profiles instead
-- of joining goals.
create or replace function get_my_campfire_heat()
returns table (group_id uuid, heat numeric)
language sql
security definer
set search_path = public
stable
as $$
  select
    gm.group_id,
    least(
      1.0,
      (coalesce(today.today_count, 0)::numeric / greatest(mem.member_count, 1)) * 0.7
      + least(coalesce(streak.avg_streak, 0) / 14.0, 1.0) * 0.3
    ) as heat
  from group_members gm
  join (
    select group_id, count(*) as member_count from group_members group by group_id
  ) mem on mem.group_id = gm.group_id
  left join (
    select gm2.group_id, count(distinct gm2.user_id) as today_count
    from group_members gm2
    join check_ins ci on ci.user_id = gm2.user_id
    where (ci.created_at at time zone 'utc')::date = current_date and ci.removed_at is null
    group by gm2.group_id
  ) today on today.group_id = gm.group_id
  left join (
    select gm3.group_id, avg(p.current_streak) as avg_streak
    from group_members gm3
    join profiles p on p.id = gm3.user_id
    group by gm3.group_id
  ) streak on streak.group_id = gm.group_id
  where gm.user_id = auth.uid();
$$;

-- recompute_goal_streak(p_goal_id) is now unreferenced by the live check-in path — left
-- defined (not dropped) until its remaining dev-tools callers are reworked below.

-- ───────────────────────────── 1c. decouple check_ins / lock_in_sessions from goals ─────────────────────────────
alter table check_ins alter column goal_id drop not null;
alter table check_ins add column if not exists goal_detail text;

-- "Lock in as often as you want, no cap" directly contradicts a one-per-goal-per-day unique
-- index — drop it outright, do not recreate in any form.
drop index if exists check_ins_one_per_day;

-- goal_type/goal_detail now arrive directly on the INSERT (from the RPCs below), never
-- derived from a goals join — nothing left for this BEFORE trigger to snapshot.
drop trigger if exists on_check_in_insert_snapshot_goal on check_ins;

drop policy if exists "check_ins: insert own if goal owned" on check_ins;
create policy "check_ins: insert own if goal owned" on check_ins for insert with check (
  user_id = auth.uid()
  and (goal_id is null or exists (select 1 from goals where id = goal_id and user_id = auth.uid() and archived_at is null))
);

alter table lock_in_sessions alter column goal_id drop not null;
alter table lock_in_sessions add column if not exists goal_type text;
alter table lock_in_sessions add column if not exists goal_detail text;
-- solo-vs-campfire flag: null = solo, set = the one campfire this session is attached to.
-- on delete set null (not cascade) — a deleted circle detaches an in-progress session to
-- solo rather than destroying it.
alter table lock_in_sessions add column if not exists circle_id uuid references groups (id) on delete set null;

-- Backfill goal_type for any still-active/historical session rows before constraining NOT NULL.
update lock_in_sessions ls
set goal_type = g.type, goal_detail = g.label
from goals g
where ls.goal_id = g.id and ls.goal_type is null;

alter table lock_in_sessions alter column goal_type set not null;

drop function if exists start_lock_in_session(uuid);
create function start_lock_in_session(
  p_goal_type text,
  p_goal_detail text default null,
  p_circle_id uuid default null
)
returns lock_in_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session lock_in_sessions;
begin
  if p_circle_id is not null and not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  if exists (select 1 from lock_in_sessions where user_id = auth.uid() and status = 'active') then
    raise exception 'You''re already locked in — stop that session first.';
  end if;

  insert into lock_in_sessions (user_id, goal_type, goal_detail, circle_id)
  values (auth.uid(), p_goal_type, p_goal_detail, p_circle_id)
  returning * into v_session;

  return v_session;
end;
$$;

-- stop_lock_in_session(): same signature — body-only swap, goal_type/goal_detail come
-- straight off the session row instead of goal_id.
create or replace function stop_lock_in_session(
  p_session_id uuid,
  p_photo_urls text[] default null,
  p_caption text default null
)
returns check_ins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session lock_in_sessions;
  v_check_in check_ins;
  v_first_photo text;
  i int;
begin
  select * into v_session from lock_in_sessions
  where id = p_session_id and user_id = auth.uid() and status = 'active';

  if v_session.id is null then
    raise exception 'Session not found or already stopped.';
  end if;

  v_first_photo := case when p_photo_urls is not null and array_length(p_photo_urls, 1) > 0
    then p_photo_urls[1] else null end;

  insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, caption, duration_seconds, status)
  values (
    null, v_session.goal_type, v_session.goal_detail, auth.uid(), v_first_photo, p_caption,
    greatest(extract(epoch from now() - v_session.started_at)::integer, 1),
    'on_time'
  )
  returning * into v_check_in;

  if p_photo_urls is not null then
    for i in 1 .. array_length(p_photo_urls, 1) loop
      insert into check_in_photos (check_in_id, photo_url, position)
      values (v_check_in.id, p_photo_urls[i], i - 1);
    end loop;
  end if;

  update lock_in_sessions
  set status = 'completed', ended_check_in_id = v_check_in.id
  where id = v_session.id;

  select * into v_check_in from check_ins where id = v_check_in.id;

  return v_check_in;
end;
$$;

-- notify_stale_lock_ins(): same signature — auto-finalize insert reads goal_type/goal_detail
-- straight off the session row (no join needed, they're columns now).
create or replace function notify_stale_lock_ins()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_check_in check_ins;
begin
  for r in
    select id, user_id from lock_in_sessions
    where status = 'active'
      and reminder_sent_at is null
      and last_confirmed_at < now() - interval '1 hour'
  loop
    perform notify_push(
      array[r.user_id],
      'Still locked in?',
      'Your session''s been going a while — tap to keep it going.',
      jsonb_build_object('type', 'lockin_still_here', 'session_id', r.id),
      'accountability'
    );
    update lock_in_sessions set reminder_sent_at = now() where id = r.id;
  end loop;

  for r in
    select * from lock_in_sessions
    where status = 'active'
      and reminder_sent_at is not null
      and reminder_sent_at < now() - interval '20 minutes'
  loop
    insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, duration_seconds, status)
    values (
      null, r.goal_type, r.goal_detail, r.user_id, null,
      greatest(extract(epoch from r.last_confirmed_at - r.started_at)::integer, 1),
      'on_time'
    )
    returning * into v_check_in;

    update lock_in_sessions
    set status = 'abandoned', ended_check_in_id = v_check_in.id
    where id = r.id;
  end loop;
end;
$$;

-- notify_group_of_check_in(): prefer goal_detail, drop the now-frequently-null goal_id from
-- the push payload.
create or replace function notify_group_of_check_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poster_name text;
  v_recipient_ids uuid[];
begin
  select display_name into v_poster_name from profiles where id = new.user_id;

  select coalesce(array_agg(distinct gm2.user_id), '{}')
  into v_recipient_ids
  from group_members gm1
  join group_members gm2 on gm1.group_id = gm2.group_id
  where gm1.user_id = new.user_id and gm2.user_id <> new.user_id;

  if array_length(v_recipient_ids, 1) > 0 then
    perform notify_push(
      v_recipient_ids,
      coalesce(new.goal_detail, new.goal_label, initcap(new.goal_type)),
      coalesce(v_poster_name, 'Someone') || ' just checked in 🔥',
      jsonb_build_object('type', 'check_in', 'goal_type', new.goal_type)
    );
  end if;

  return new;
end;
$$;

-- snapshot_reported_content(): add goal_detail alongside the existing goal_type/goal_label.
create or replace function snapshot_reported_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  end if;
  return new;
end;
$$;

-- ───────────────────────────── 1d. scoring drops the goals join ─────────────────────────────
-- check_ins.goal_type is already denormalized on every row — these joins were always
-- avoidable, and are now required to avoid since a check-in may have no goal_id at all.
create or replace function domain_score(p_user_id uuid, p_type text)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(ci.xp_earned), 0)
  from check_ins ci
  where ci.user_id = p_user_id and ci.goal_type = p_type and ci.removed_at is null;
$$;

create or replace function universal_score(p_user_id uuid)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(domain_score(p_user_id, t.type)), 0)
  from (select distinct goal_type as type from check_ins where user_id = p_user_id) t;
$$;

-- get_my_ranks(): return shape unchanged (still scope/goal_type/score/tier/division/
-- xp_into_tier/xp_for_next_tier) — the existing drop-first guard from the earlier
-- return-shape fix stays in place (harmless no-op here); only the domain-enumeration
-- subquery changes, from goals to check_ins.
drop function if exists get_my_ranks();
create or replace function get_my_ranks()
returns table (
  scope text,
  goal_type text,
  score numeric,
  tier text,
  division int,
  xp_into_tier numeric,
  xp_for_next_tier numeric
)
language sql
security definer
set search_path = public
stable
as $$
  with ranked as (
    select 'universal'::text as scope, null::text as goal_type, s.score
    from (select universal_score(auth.uid()) as score) s
    union all
    select 'domain', g.type, domain_score(auth.uid(), g.type)
    from (select distinct goal_type as type from check_ins where user_id = auth.uid()) g
  )
  select
    r.scope,
    r.goal_type,
    r.score,
    t.tier,
    t.division,
    r.score - lo.cumulative_xp_required as xp_into_tier,
    coalesce(hi.cumulative_xp_required, lo.cumulative_xp_required) - lo.cumulative_xp_required as xp_for_next_tier
  from ranked r
  cross join lateral rank_tier_for_score(r.score) t
  join rank_thresholds lo on lo.tier = t.tier and lo.division = t.division
  left join rank_thresholds hi on hi.rank_index = lo.rank_index + 1
  order by r.scope desc, r.goal_type;
$$;

-- ───────────────────────────── 1e. dev-tools rework ─────────────────────────────
create or replace function dev_simulate_friend_checkin(p_group_id uuid, p_fake_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_group_member(p_group_id) then
    raise exception 'Not a member of that circle.';
  end if;

  if not exists (
    select 1 from profiles where id = p_fake_user_id and is_demo = true
  ) then
    raise exception 'dev_simulate_friend_checkin only works with is_demo profiles.';
  end if;

  if not exists (
    select 1 from group_members where group_id = p_group_id and user_id = p_fake_user_id
  ) then
    insert into group_members (group_id, user_id, role) values (p_group_id, p_fake_user_id, 'member');
  end if;

  insert into check_ins (user_id, goal_type, photo_url, status)
  values (p_fake_user_id, 'gym', 'dev-tools/placeholder.jpg', 'on_time');

  perform recompute_user_streak(p_fake_user_id);
end;
$$;

drop function if exists dev_reset_my_checkins(uuid);
create function dev_reset_my_checkins(p_goal_type text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from check_ins
  where user_id = auth.uid() and (p_goal_type is null or goal_type = p_goal_type);

  perform recompute_user_streak(auth.uid());
end;
$$;

-- ───────────────────────────── 1f. rank tiers: add Legend ─────────────────────────────
-- Above Diamond (PHILOI_UI_SPEC.md §11) — singular, no divisions, division stored as 1
-- purely so rank_ordinal-style arithmetic elsewhere still orders it above Diamond I.
-- Continues the existing documented curve (step(i) = round(200 * 1.3^i)): step 14 = 7875,
-- + Diamond I's 25582 = 33457. rank_tier_for_score() needs no change — it already picks the
-- highest threshold <= score generically off this table.
insert into rank_thresholds (rank_index, tier, division, cumulative_xp_required) values
  (15, 'legend', 1, 33457)
on conflict (rank_index) do update set
  tier = excluded.tier, division = excluded.division, cumulative_xp_required = excluded.cumulative_xp_required;
