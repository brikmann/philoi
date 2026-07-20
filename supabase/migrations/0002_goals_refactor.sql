-- ───────────────────────────── goals refactor ─────────────────────────────
-- Moves goals from circle-level (groups.goal_type/cadence, group_members.current_streak)
-- to user-level (a new `goals` table). Circles keep goal_type/cadence purely as a
-- discovery "theme" tag with zero functional link to goals — they no longer own streaks,
-- and a check-in fans out to every circle its owner belongs to instead of one.
--
-- This file is a historical, reviewable snapshot — supabase/schema.sql is the real
-- deploy artifact and carries the identical statements. Run the whole of schema.sql, not
-- this file, against a project.

-- ── _migrations marker table — this backfill is a genuine one-time data migration, not
-- an idempotent "create if not exists" statement like everything else in this codebase.
-- Guarding on "is `goals` empty" would silently no-op (and permanently orphan streak
-- history) the moment a user creates a brand-new goal before this has run against a given
-- environment — a real risk given DB migration and app rollout aren't atomic. An explicit
-- marker makes the guard correct regardless of ordering. ──
create table if not exists _migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

-- ── goals ──
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  type text not null check (type in ('gym', 'run', 'study', 'social_media', 'custom')),
  label text,
  cadence text not null default '7x/week',
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  -- Soft-archive only, matching the deleted_at/removed_at convention used for
  -- messages/check-ins elsewhere in this file — a hard delete would orphan the
  -- check_ins that reference this goal (see the `on delete restrict` FK below).
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

-- At most one active goal per built-in type per user; unlimited simultaneous `custom`
-- goals since "custom" is a bucket, not an identity (two custom goals can legitimately be
-- unrelated activities, distinguished by label).
create unique index if not exists goals_one_active_per_type
  on goals (user_id, type) where archived_at is null and type <> 'custom';

alter table goals enable row level security;

drop policy if exists "goals: read own" on goals;
create policy "goals: read own" on goals for select using (user_id = auth.uid());

drop policy if exists "goals: insert own" on goals;
create policy "goals: insert own" on goals for insert with check (user_id = auth.uid());

drop policy if exists "goals: update own" on goals;
create policy "goals: update own" on goals for update using (user_id = auth.uid());

-- No delete policy — archive via archived_at instead. A hard delete would orphan any
-- check_ins.goal_id referencing this row; the FK is `on delete restrict` as a backstop.

-- ── is_circle_mate_of — mirrors is_group_member/is_blocked_either_way's SECURITY DEFINER
-- pattern for house-style consistency and to insulate this helper from any future change
-- to group_members' own RLS (group_members is currently symmetric among co-members under
-- plain invoker rights, so this isn't closing a visibility hole today the way
-- is_blocked_either_way does — it's future-proofing plus avoiding double RLS expansion
-- when this is evaluated per-row inside check_ins/reactions/storage policies). ──
create or replace function is_circle_mate_of(p_other_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from group_members gm1
    join group_members gm2 on gm1.group_id = gm2.group_id
    where gm1.user_id = auth.uid() and gm2.user_id = p_other_user_id
  );
$$;

-- ── check_ins: add goal columns (nullable for now — set NOT NULL only after the backfill
-- below has run and been verified). goal_type/goal_label are denormalized snapshots of
-- the goal at insert time (same pattern as moderation's snapshot_reported_content()) so
-- rendering a circle-mate's feed item never needs a cross-user read of their goals row. ──
alter table check_ins add column if not exists goal_id uuid references goals (id) on delete restrict;
alter table check_ins add column if not exists goal_type text;
alter table check_ins add column if not exists goal_label text;

create or replace function snapshot_check_in_goal()
returns trigger
language plpgsql
as $$
begin
  if new.goal_id is not null then
    select type, label into new.goal_type, new.goal_label from goals where id = new.goal_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_check_in_insert_snapshot_goal on check_ins;
create trigger on_check_in_insert_snapshot_goal
  before insert on check_ins
  for each row execute function snapshot_check_in_goal();

-- ── backfill: merge each user's same-theme circle-memberships into one goal, recomputing
-- the streak from the UNION of check-in dates across the merged circles (not max() of the
-- individual streaks — max() undercounts real activity whenever a user alternated which
-- circle they logged a given day's check-in into; union is the only approach that credits
-- consecutive days correctly regardless of which circle carried which day). Custom-themed
-- circles are NOT merged with each other — "custom" has no shared identity to key a merge
-- on, so each becomes its own goal (see goals_one_active_per_type's exemption above). ──
create or replace function _backfill_goals_from_circles()
returns void
language plpgsql
as $$
declare
  r record;
  v_goal_id uuid;
  v_label text;
  v_cadence text;
  v_dates date[];
  v_streak integer;
  v_longest integer;
  v_expected date;
  v_run integer;
  d date;
  i integer;
begin
  -- Built-in types: one merged goal per (user_id, goal_type). Driven off check_ins itself
  -- (joined to groups, which every check_ins row still references thanks to the
  -- on-delete-cascade FK) rather than current group_members rows — a user who checked in
  -- and later left that circle has no group_members row anymore, but their check_ins rows
  -- still exist and must still be backfilled.
  for r in
    select ci.user_id, g.goal_type, array_agg(distinct g.id) as source_group_ids
    from check_ins ci
    join groups g on g.id = ci.group_id
    where g.goal_type <> 'custom'
    group by ci.user_id, g.goal_type
  loop
    -- Best-effort label: only recoverable if the user is still a member somewhere (goal_target
    -- lived on group_members, which is gone once they leave — that history isn't recoverable).
    select gm2.goal_target into v_label
    from group_members gm2
    where gm2.user_id = r.user_id and gm2.group_id = any (r.source_group_ids) and gm2.goal_target is not null
    order by gm2.joined_at asc limit 1;

    select g2.cadence into v_cadence
    from groups g2
    where g2.id = any (r.source_group_ids)
    order by g2.created_at asc limit 1;

    insert into goals (user_id, type, label, cadence)
    values (r.user_id, r.goal_type, v_label, coalesce(v_cadence, '7x/week'))
    returning id into v_goal_id;

    update check_ins
    set goal_id = v_goal_id
    where user_id = r.user_id and group_id = any (r.source_group_ids);

    update check_ins set goal_type = r.goal_type, goal_label = v_label where goal_id = v_goal_id;

    -- Recompute streak fresh from the merged date set (not greatest()-guarded — that
    -- guard only makes sense for incremental single-row updates, not a from-scratch
    -- backfill over a merged history).
    select array_agg(distinct (created_at at time zone 'utc')::date order by (created_at at time zone 'utc')::date desc)
    into v_dates
    from check_ins where goal_id = v_goal_id;

    v_streak := 0;
    v_longest := 0;
    if v_dates is not null then
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
      v_run := 1;
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
      v_longest := greatest(v_longest, v_streak);
    end if;

    update goals set current_streak = v_streak, longest_streak = v_longest where id = v_goal_id;
  end loop;

  -- Custom-themed circles: one goal per (user_id, circle) — no merging. Same fix as
  -- above: driven off check_ins, not current group_members, so a since-departed member's
  -- check-ins still get a goal. goal_target is a best-effort left join (null if they left).
  for r in
    select distinct
      ci.user_id,
      g.id as group_id,
      g.name as group_name,
      (
        select gm2.goal_target from group_members gm2
        where gm2.group_id = g.id and gm2.user_id = ci.user_id
      ) as goal_target
    from check_ins ci
    join groups g on g.id = ci.group_id
    where g.goal_type = 'custom'
  loop
    v_label := coalesce(r.goal_target, r.group_name);

    insert into goals (user_id, type, label, cadence)
    select r.user_id, 'custom', v_label, g3.cadence from groups g3 where g3.id = r.group_id
    returning id into v_goal_id;

    update check_ins
    set goal_id = v_goal_id, goal_type = 'custom', goal_label = v_label
    where user_id = r.user_id and group_id = r.group_id;

    select array_agg(distinct (created_at at time zone 'utc')::date order by (created_at at time zone 'utc')::date desc)
    into v_dates
    from check_ins where goal_id = v_goal_id;

    v_streak := 0;
    v_longest := 0;
    if v_dates is not null then
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
      v_run := 1;
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
      v_longest := greatest(v_longest, v_streak);
    end if;

    update goals set current_streak = v_streak, longest_streak = v_longest where id = v_goal_id;
  end loop;

  -- Catch-all: any check_ins still unassigned at this point reference a group_id that no
  -- longer joins to a row in groups (e.g. a circle deleted before check_ins.group_id had
  -- today's on-delete-cascade FK, leaving a dangling reference) — there's no goal_type/label
  -- left to recover for these, so bucket them into one fallback custom goal per user rather
  -- than leaving them unbackfilled and failing the hard-stop assertion below.
  for r in
    select distinct user_id from check_ins where goal_id is null
  loop
    insert into goals (user_id, type, label)
    values (r.user_id, 'custom', 'Legacy check-ins')
    returning id into v_goal_id;

    update check_ins
    set goal_id = v_goal_id, goal_type = 'custom', goal_label = 'Legacy check-ins'
    where user_id = r.user_id and goal_id is null;

    select array_agg(distinct (created_at at time zone 'utc')::date order by (created_at at time zone 'utc')::date desc)
    into v_dates
    from check_ins where goal_id = v_goal_id;

    v_streak := 0;
    v_longest := 0;
    if v_dates is not null then
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
      v_run := 1;
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
      v_longest := greatest(v_longest, v_streak);
    end if;

    update goals set current_streak = v_streak, longest_streak = v_longest where id = v_goal_id;
  end loop;
end;
$$;

do $$
begin
  if not exists (select 1 from _migrations where name = 'goals_backfill_v1') then
    perform _backfill_goals_from_circles();
    insert into _migrations (name) values ('goals_backfill_v1');
  end if;
end $$;

drop function if exists _backfill_goals_from_circles();

-- Hard-stop rather than silently proceeding — every check_ins row must have a goal_id
-- before the NOT NULL constraint and the new unique index below.
do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans from check_ins where goal_id is null;
  if v_orphans > 0 then
    raise exception 'goals_backfill_v1: % check_ins rows have no goal_id — aborting before DDL', v_orphans;
  end if;
end $$;

-- Under the old per-circle model, checking in the same day to two different circles that
-- share a theme (e.g. two separate "gym" circles) produced two legitimate rows (different
-- group_id). After merging same-theme circles into one goal, those rows now collide on
-- the same (goal_id, user_id, day) and would violate the new per-goal uniqueness index
-- below. Soft-remove (never delete — this is real photo content) every row but the
-- earliest per colliding day; naturally a no-op on every re-run once resolved once, and a
-- no-op on a fresh project with no legacy check-ins.
with duplicates as (
  select id,
    row_number() over (
      partition by goal_id, user_id, ((created_at at time zone 'utc')::date)
      order by created_at asc
    ) as rn
  from check_ins
  where removed_at is null
)
update check_ins
set removed_at = now()
where id in (select id from duplicates where rn > 1);

-- ── finalize check_ins: goal_id required, drop group_id, replace the daily-uniqueness
-- index (was per-circle, now per-goal). ──
alter table check_ins alter column goal_id set not null;
alter table check_ins alter column goal_type set not null;

-- Partial (where removed_at is null) — a soft-removed row (moderation, or the dedup pass
-- just above) must not collide with a legitimate check-in that reuses the same day/goal.
drop index if exists check_ins_one_per_day;
create unique index if not exists check_ins_one_per_day
  on check_ins (goal_id, user_id, ((created_at at time zone 'utc')::date))
  where removed_at is null;

drop index if exists check_ins_group_created_idx;
drop index if exists check_ins_user_group_idx;
create index if not exists check_ins_goal_created_idx on check_ins (goal_id, created_at desc);
create index if not exists check_ins_user_created_idx on check_ins (user_id, created_at desc);

drop policy if exists "check_ins: read if member" on check_ins;
drop policy if exists "check_ins: admin read" on check_ins;
create policy "check_ins: read if circle-mate" on check_ins for select using (
  user_id = auth.uid() or is_circle_mate_of(user_id) or is_admin()
);

drop policy if exists "check_ins: insert own if member" on check_ins;
create policy "check_ins: insert own if goal owned" on check_ins for insert with check (
  user_id = auth.uid()
  and exists (select 1 from goals where id = goal_id and user_id = auth.uid() and archived_at is null)
);

-- Note: check_ins.group_id itself isn't dropped here yet — analytics_top_circles (view)
-- and both reactions policies immediately below still reference it, and Postgres tracks
-- those as hard dependencies (unlike a function body, which isn't dependency-checked
-- until it runs). It's dropped at the very end of this section, once every dependent
-- view/policy has been redefined without it.

-- ── reactions RLS fix — check_ins.group_id is gone, so "read/insert if member" becomes
-- "if you're the check-in's owner or a circle-mate of theirs" (reactions were already
-- keyed by check_in_id, not group_id, so no table change is needed here). ──
drop policy if exists "reactions: read if member" on reactions;
create policy "reactions: read if member" on reactions for select using (
  exists (
    select 1 from check_ins
    where check_ins.id = reactions.check_in_id
      and (check_ins.user_id = auth.uid() or is_circle_mate_of(check_ins.user_id))
  )
);

drop policy if exists "reactions: insert own if member" on reactions;
create policy "reactions: insert own if member" on reactions for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from check_ins
    where check_ins.id = reactions.check_in_id
      and (check_ins.user_id = auth.uid() or is_circle_mate_of(check_ins.user_id))
  )
);

-- ── storage: check-in-photos moves from {group_id}/{user_id}/{file} to {user_id}/{file}
-- — a photo isn't scoped to one circle anymore. ──
drop policy if exists "check-in-photos: read if member" on storage.objects;
create policy "check-in-photos: read if member" on storage.objects for select
  using (
    bucket_id = 'check-in-photos'
    and (
      ((storage.foldername(name))[1])::uuid = auth.uid()
      or is_circle_mate_of(((storage.foldername(name))[1])::uuid)
    )
  );

drop policy if exists "check-in-photos: upload own if member" on storage.objects;
create policy "check-in-photos: upload own" on storage.objects for insert
  with check (
    bucket_id = 'check-in-photos'
    and ((storage.foldername(name))[1])::uuid = auth.uid()
  );

drop policy if exists "check-in-photos: admin read" on storage.objects;
create policy "check-in-photos: admin read" on storage.objects for select
  using (bucket_id = 'check-in-photos' and is_admin());

-- ── recompute_streak -> recompute_goal_streak: same consecutive-day algorithm, now
-- scoped to a goal (which already implies a user) instead of (group, user). ──
create or replace function recompute_goal_streak(p_goal_id uuid)
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
  where goal_id = p_goal_id;

  if v_dates is null then
    update goals set current_streak = 0 where id = p_goal_id;
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

  update goals
  set current_streak = v_streak,
      longest_streak = greatest(longest_streak, v_longest, v_streak)
  where id = p_goal_id;
end;
$$;

create or replace function handle_check_in_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform recompute_goal_streak(new.goal_id);
  return new;
end;
$$;

-- ── snapshot_reported_content: the check-in branch selected check_ins.group_id into
-- new.circle_id — that column is gone, and a reported check-in no longer has one circle
-- to attribute it to anyway (it fans out to every circle its owner belongs to). Leave
-- circle_id as whatever the reporter explicitly supplied (report.tsx's circleId param);
-- snapshot the goal instead. ──
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
             'created_at', created_at, 'goal_type', goal_type, 'goal_label', goal_label
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

-- ── notify_group_of_check_in: recipients become every circle-mate of the poster (no
-- single group_id to key off anymore); body references the goal instead of a circle. ──
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
      coalesce(new.goal_label, initcap(new.goal_type)),
      coalesce(v_poster_name, 'Someone') || ' just checked in 🔥',
      jsonb_build_object('type', 'check_in', 'goal_id', new.goal_id)
    );
  end if;

  return new;
end;
$$;

-- ── notify_streaks_at_risk: simpler now — iterate goals directly, no group_members/
-- groups join needed since a goal already has exactly one owner. ──
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
    select id, user_id, coalesce(label, initcap(type)) as label, current_streak
    from goals
    where archived_at is null
      and current_streak > 0
      and not exists (
        select 1 from check_ins ci
        where ci.goal_id = goals.id
          and (ci.created_at at time zone 'utc')::date = current_date
      )
  loop
    perform notify_push(
      array[r.user_id],
      r.label,
      'Your ' || r.current_streak || '-day streak breaks at midnight — lock in 🔥',
      jsonb_build_object('type', 'streak_risk', 'goal_id', r.id)
    );
  end loop;
end;
$$;

-- ── get_weekly_recap: drop the group_id filter — every circle a user's in now correctly
-- shows the same per-user weekly check-in count (a view over the same real activity, not
-- a separate copy — see the "one goal = one streak, counted once" rule). ──
create or replace function get_weekly_recap(p_user_id uuid)
returns table (
  group_id uuid,
  group_name text,
  check_ins_this_week bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    g.id as group_id,
    g.name as group_name,
    (
      select count(*) from check_ins ci
      where ci.user_id = p_user_id and ci.created_at >= date_trunc('week', now())
    ) as check_ins_this_week
  from group_members gm
  join groups g on g.id = gm.group_id
  where gm.user_id = p_user_id and p_user_id = auth.uid();
$$;

-- ── analytics_top_circles: join check_ins through group_members instead of a direct
-- group_id column (gone). Per-circle counts now reflect a member's full check-in
-- activity across every circle they're in, not circle-specific activity — expected for
-- an internal analytics view, not a leaderboard. ──
create or replace view analytics_top_circles as
select
  g.id as group_id,
  g.name,
  g.emoji,
  count(ci.id) filter (where ci.created_at >= now() - interval '7 days' and ci.removed_at is null) as check_ins_7d,
  count(ci.id) filter (where ci.removed_at is null) as check_ins_total,
  count(distinct gm.user_id) as member_count
from groups g
left join group_members gm on gm.group_id = g.id
left join check_ins ci on ci.user_id = gm.user_id
group by g.id, g.name, g.emoji
order by check_ins_7d desc;

-- ── scoring backbone — computed on demand (matches this file's existing preference for
-- live-computed views/RPCs over running-total ledgers, e.g. the analytics_* views). ──
create or replace function domain_score(p_user_id uuid, p_type text)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(
    g.current_streak * 5
    + least((
        select count(*) from check_ins ci
        where ci.goal_id = g.id and ci.created_at >= now() - interval '30 days'
      ), 30) * 2
    + g.longest_streak * 1
  ), 0)
  from goals g
  where g.user_id = p_user_id and g.type = p_type and g.archived_at is null;
$$;

create or replace function universal_score(p_user_id uuid)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(domain_score(p_user_id, t.type)), 0)
  from (select distinct type from goals where user_id = p_user_id and archived_at is null) t;
$$;

-- Bronze/Silver/Gold/Platinum/Diamond x I/II/III, inline threshold logic rather than a
-- lookup table — tuning a threshold later is a one-line function edit, not a data
-- migration. Bands are a starting point for a beta with no usage data yet; expect to
-- retune once real score distributions exist.
create or replace function rank_tier_for_score(p_score numeric)
returns table (tier text, division int)
language sql
immutable
as $$
  select
    case
      when p_score >= 1100 then 'diamond' when p_score >= 920 then 'diamond' when p_score >= 760 then 'diamond'
      when p_score >= 620 then 'platinum' when p_score >= 500 then 'platinum' when p_score >= 400 then 'platinum'
      when p_score >= 320 then 'gold' when p_score >= 250 then 'gold' when p_score >= 190 then 'gold'
      when p_score >= 140 then 'silver' when p_score >= 100 then 'silver' when p_score >= 70 then 'silver'
      when p_score >= 40 then 'bronze' when p_score >= 20 then 'bronze' else 'bronze'
    end as tier,
    case
      when p_score >= 1100 then 1 when p_score >= 920 then 2 when p_score >= 760 then 3
      when p_score >= 620 then 1 when p_score >= 500 then 2 when p_score >= 400 then 3
      when p_score >= 320 then 1 when p_score >= 250 then 2 when p_score >= 190 then 3
      when p_score >= 140 then 1 when p_score >= 100 then 2 when p_score >= 70 then 3
      when p_score >= 40 then 1 when p_score >= 20 then 2 else 3
    end as division;
$$;

create or replace function get_my_ranks()
returns table (
  scope text,
  goal_type text,
  score numeric,
  tier text,
  division int
)
language sql
security definer
set search_path = public
stable
as $$
  select 'universal', null::text, s.score, t.tier, t.division
  from (select universal_score(auth.uid()) as score) s
  cross join lateral rank_tier_for_score(s.score) t
  union all
  select 'domain', g.type, s.score, t.tier, t.division
  from (select distinct type from goals where user_id = auth.uid() and archived_at is null) g
  cross join lateral (select domain_score(auth.uid(), g.type) as score) s
  cross join lateral rank_tier_for_score(s.score) t;
$$;

-- ── leaderboard RPCs re-ranked by universal_score — a circle has no single shared goal
-- anymore, so ranking by one goal's streak doesn't make sense; universal_score is the
-- domain-agnostic "how consistent is this person" signal the product doc asks for. ──
drop function if exists get_group_leaderboard(uuid);

create function get_group_leaderboard(p_group_id uuid)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  score numeric,
  tier text,
  division int,
  check_ins_this_week bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    gm.user_id,
    p.handle,
    p.display_name,
    p.avatar_url,
    p.is_pro,
    s.score,
    t.tier,
    t.division,
    coalesce((
      select count(*) from check_ins ci
      where ci.user_id = gm.user_id and ci.created_at >= date_trunc('week', now())
    ), 0) as check_ins_this_week
  from group_members gm
  join profiles p on p.id = gm.user_id
  cross join lateral (select universal_score(gm.user_id) as score) s
  cross join lateral rank_tier_for_score(s.score) t
  where gm.group_id = p_group_id and is_group_member(p_group_id)
  order by s.score desc, check_ins_this_week desc, p.display_name asc;
$$;

-- Dropped first: CREATE OR REPLACE can't change an existing function's RETURNS TABLE columns
-- (this function originally returned best_streak instead of score/tier/division).
drop function if exists get_university_leaderboard(text, int);

create function get_university_leaderboard(p_university text, p_limit int default 50)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  score numeric,
  tier text,
  division int,
  check_ins_this_week bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id as user_id,
    p.handle,
    p.display_name,
    p.avatar_url,
    p.is_pro,
    s.score,
    t.tier,
    t.division,
    coalesce((
      select count(*) from check_ins ci
      where ci.user_id = p.id and ci.created_at >= date_trunc('week', now())
    ), 0) as check_ins_this_week
  from profiles p
  cross join lateral (select universal_score(p.id) as score) s
  cross join lateral rank_tier_for_score(s.score) t
  where p.university = p_university
  order by s.score desc, check_ins_this_week desc, p.display_name asc
  limit p_limit;
$$;

-- Dropped first: CREATE OR REPLACE can't change an existing function's RETURNS TABLE columns
-- (this function originally returned current_streak instead of score/tier/division).
drop function if exists get_my_circle_ranks();

create function get_my_circle_ranks()
returns table (
  group_id uuid,
  group_name text,
  group_emoji text,
  my_rank bigint,
  member_count bigint,
  score numeric,
  tier text,
  division int,
  check_ins_this_week bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with weekly as (
    select
      gm.group_id,
      gm.user_id,
      (select universal_score(gm.user_id)) as score,
      coalesce((
        select count(*) from check_ins ci
        where ci.user_id = gm.user_id and ci.created_at >= date_trunc('week', now())
      ), 0) as check_ins_this_week
    from group_members gm
    where is_group_member(gm.group_id)
  ),
  ranked as (
    select
      w.*,
      rank() over (partition by w.group_id order by w.score desc, w.check_ins_this_week desc) as rnk,
      count(*) over (partition by w.group_id) as member_count
    from weekly w
  )
  select
    g.id as group_id,
    g.name as group_name,
    g.emoji as group_emoji,
    r.rnk as my_rank,
    r.member_count,
    r.score,
    t.tier,
    t.division,
    r.check_ins_this_week
  from ranked r
  join groups g on g.id = r.group_id
  cross join lateral rank_tier_for_score(r.score) t
  where r.user_id = auth.uid()
  order by g.name;
$$;

-- ── dev tools: rework to target a demo goal instead of inserting bare check_ins rows
-- against a group_id. ──
create or replace function dev_seed_my_demo_circle()
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_fake_id uuid;
  v_goal_id uuid;
  v_day integer;
  v_found boolean := false;
begin
  insert into groups (name, emoji, owner_id, goal_type, cadence, is_public)
  values ('Dev Test Circle', '🧪', auth.uid(), 'gym', '7x/week', false)
  returning * into v_group;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'owner');

  for v_fake_id in select id from profiles where is_demo = true limit 3 loop
    v_found := true;
    insert into group_members (group_id, user_id, role)
    values (v_group.id, v_fake_id, 'member')
    on conflict (group_id, user_id) do nothing;

    insert into goals (user_id, type, label)
    values (v_fake_id, 'gym', 'Gym')
    on conflict (user_id, type) where archived_at is null and type <> 'custom' do nothing;

    select id into v_goal_id from goals where user_id = v_fake_id and type = 'gym' and archived_at is null;

    for v_day in 0..2 loop
      insert into check_ins (goal_id, user_id, photo_url, status, created_at)
      values (
        v_goal_id, v_fake_id, 'dev-tools/placeholder.jpg', 'on_time',
        now() - (v_day || ' days')::interval
      );
    end loop;

    perform recompute_goal_streak(v_goal_id);
  end loop;

  if not v_found then
    raise notice 'No is_demo profiles exist yet — run `npm run seed:demo` (scripts/seed-demo-circles.js), then call dev_seed_my_demo_circle() again to actually populate members.';
  end if;

  return v_group;
end;
$$;

drop function if exists dev_simulate_friend_checkin(uuid, uuid);

create or replace function dev_simulate_friend_checkin(p_group_id uuid, p_fake_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal_id uuid;
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

  insert into goals (user_id, type, label)
  values (p_fake_user_id, 'gym', 'Gym')
  on conflict (user_id, type) where archived_at is null and type <> 'custom' do nothing;

  select id into v_goal_id from goals where user_id = p_fake_user_id and type = 'gym' and archived_at is null;

  insert into check_ins (goal_id, user_id, photo_url, status)
  values (v_goal_id, p_fake_user_id, 'dev-tools/placeholder.jpg', 'on_time');
end;
$$;

drop function if exists dev_reset_my_checkins(uuid);

create or replace function dev_reset_my_checkins(p_goal_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select id from goals
    where user_id = auth.uid() and (p_goal_id is null or id = p_goal_id)
  loop
    delete from check_ins where user_id = auth.uid() and goal_id = r.id;
    perform recompute_goal_streak(r.id);
  end loop;
end;
$$;

-- ── delete_my_account: Storage path parsing must match the new {user_id}/{file} layout
-- (was {group_id}/{user_id}/{file}, foldername[2]) — otherwise account deletion silently
-- stops finding (and deleting) anyone's check-in photos from Storage. ──
create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_photo_paths text[];
begin
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  select coalesce(array_agg(name), '{}')
  into v_photo_paths
  from storage.objects
  where bucket_id = 'check-in-photos' and (storage.foldername(name))[1] = v_user_id::text;

  perform delete_storage_prefixes('check-in-photos', v_photo_paths);

  delete from groups where owner_id = v_user_id;
  delete from group_members where user_id = v_user_id;
  delete from reactions where user_id = v_user_id;
  delete from check_ins where user_id = v_user_id;
  delete from goals where user_id = v_user_id;
  delete from messages where user_id = v_user_id;
  delete from invites where inviter_id = v_user_id;
  delete from events where user_id = v_user_id;
  delete from profiles where id = v_user_id;

  delete from auth.users where id = v_user_id;
end;
$$;

-- Now safe to drop — analytics_top_circles and both reactions policies were redefined
-- without referencing it earlier in this section.
alter table check_ins drop column if exists group_id;

-- ── retire group_members.goal_target — superseded by goals.label. ──
drop function if exists set_my_goal_target(uuid, text);
alter table group_members drop column if exists goal_target;
alter table group_members drop column if exists current_streak;
alter table group_members drop column if exists longest_streak;
