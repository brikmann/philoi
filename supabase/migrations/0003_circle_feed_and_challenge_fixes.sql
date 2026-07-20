-- ───────────────────────────── point-in-time circle fan-out ─────────────────────────────
-- Bug: a circle's feed was computed live as "every check-in by any CURRENT member," so
-- creating or joining a circle instantly surfaced every existing member's entire check-in
-- history instead of just what happens after you joined. Fix: snapshot which circles a user
-- was actually in at the moment they checked in, and scope each circle's feed to that
-- snapshot instead of live membership overlap. Global visibility (leaderboards, streaks,
-- "is this circle-mate active") is untouched — is_circle_mate_of() and the base check_ins
-- RLS policy stay as-is; only a specific circle's FEED query changes (client-side, see
-- fetchFeed() in src/lib/api/check-ins.ts).
--
-- This file is a historical, reviewable snapshot — supabase/schema.sql is the real
-- deploy artifact and carries the identical statements. Run the whole of schema.sql, not
-- this file, against a project.

create table if not exists check_in_circles (
  check_in_id uuid not null references check_ins (id) on delete cascade,
  circle_id uuid not null references groups (id) on delete cascade,
  posted_at timestamptz not null default now(),
  primary key (check_in_id, circle_id)
);

create index if not exists check_in_circles_circle_idx on check_in_circles (circle_id, posted_at desc);

alter table check_in_circles enable row level security;

drop policy if exists "check_in_circles: read if member" on check_in_circles;
create policy "check_in_circles: read if member" on check_in_circles for select using (
  is_group_member(circle_id)
);

-- No insert/update/delete policy for regular users — populated only by the trigger below
-- (security definer), same server-trusted-write pattern as challenge_feed_events.

create or replace function snapshot_check_in_circles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into check_in_circles (check_in_id, circle_id)
  select new.id, gm.group_id
  from group_members gm
  where gm.user_id = new.user_id;
  return new;
end;
$$;

drop trigger if exists on_check_in_insert_snapshot_circles on check_ins;
create trigger on_check_in_insert_snapshot_circles
  after insert on check_ins
  for each row execute function snapshot_check_in_circles();

-- Backfill existing check-ins using CURRENT membership as a best-effort stand-in for "were
-- they a member at post time" (exact historical join-vs-post ordering isn't recoverable) —
-- this preserves what's already correctly visible today without perpetuating the bug going
-- forward, since every check-in from here on gets a real point-in-time snapshot via the
-- trigger above.
do $$
begin
  if not exists (select 1 from _migrations where name = 'check_in_circles_backfill_v1') then
    insert into check_in_circles (check_in_id, circle_id, posted_at)
    select ci.id, gm.group_id, ci.created_at
    from check_ins ci
    join group_members gm on gm.user_id = ci.user_id
    on conflict (check_in_id, circle_id) do nothing;
    insert into _migrations (name) values ('check_in_circles_backfill_v1');
  end if;
end $$;

-- ───────────────────────────── challenge progress must reach the circle ─────────────────────────────
-- Bug: log_challenge_progress() only wrote a challenge_feed_events row on the one log call
-- that crossed the target — every incremental log before that updated challenges.progress
-- (which the leaderboard already reads live) but never showed up in the circle's feed at
-- all. Every log should post now, not just the one that finishes it.

alter table challenge_feed_events add column if not exists amount numeric;
alter table challenge_feed_events add column if not exists progress numeric;
alter table challenge_feed_events add column if not exists is_completion boolean not null default false;

create or replace function log_challenge_progress(p_challenge_id uuid, p_amount numeric, p_note text default null)
returns table (
  id uuid,
  user_id uuid,
  circle_id uuid,
  type text,
  label text,
  target numeric,
  unit text,
  period text,
  progress numeric,
  visibility text,
  period_start date,
  completed_at timestamptz,
  created_at timestamptz,
  just_completed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge challenges;
  v_was_complete boolean;
  v_group_name text;
  v_poster_name text;
  v_recipient_ids uuid[];
begin
  select * into v_challenge from challenges where challenges.id = p_challenge_id and challenges.user_id = auth.uid();
  if v_challenge.id is null then
    raise exception 'Challenge not found.';
  end if;

  insert into challenge_logs (challenge_id, user_id, amount, note)
  values (p_challenge_id, auth.uid(), p_amount, p_note);

  v_was_complete := v_challenge.completed_at is not null;

  update challenges
  set progress = challenges.progress + p_amount,
      completed_at = case
        when challenges.completed_at is null and challenges.progress + p_amount >= challenges.target then now()
        else challenges.completed_at
      end
  where challenges.id = p_challenge_id
  returning * into v_challenge;

  if v_challenge.circle_id is not null and v_challenge.visibility = 'circle' then
    insert into challenge_feed_events
      (group_id, user_id, challenge_id, challenge_type, challenge_label, target, unit, amount, progress, is_completion)
    values (
      v_challenge.circle_id, auth.uid(), v_challenge.id, v_challenge.type, v_challenge.label, v_challenge.target, v_challenge.unit,
      p_amount, v_challenge.progress, (not v_was_complete and v_challenge.completed_at is not null)
    );

    if not v_was_complete and v_challenge.completed_at is not null then
      select name into v_group_name from groups where groups.id = v_challenge.circle_id;
      select display_name into v_poster_name from profiles where profiles.id = auth.uid();

      select coalesce(array_agg(gm.user_id), '{}')
      into v_recipient_ids
      from group_members gm
      where gm.group_id = v_challenge.circle_id and gm.user_id <> auth.uid();

      if array_length(v_recipient_ids, 1) > 0 then
        perform notify_push(
          v_recipient_ids,
          v_group_name,
          coalesce(v_poster_name, 'Someone') || ' just hit their ' || coalesce(v_challenge.label, v_challenge.type) || ' challenge 🎯',
          jsonb_build_object('type', 'challenge_completed', 'group_id', v_challenge.circle_id)
        );
      end if;
    end if;
  end if;

  return query select
    v_challenge.id, v_challenge.user_id, v_challenge.circle_id, v_challenge.type, v_challenge.label,
    v_challenge.target, v_challenge.unit, v_challenge.period, v_challenge.progress, v_challenge.visibility,
    v_challenge.period_start, v_challenge.completed_at, v_challenge.created_at,
    (not v_was_complete and v_challenge.completed_at is not null);
end;
$$;
