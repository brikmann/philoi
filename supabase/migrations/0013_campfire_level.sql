-- Core lock-in loop rebuild, part 2 (PHILOI_UI_SPEC.md §11) — this file is a historical,
-- reviewable snapshot; supabase/schema.sql is the real deploy artifact and carries the
-- identical statements. Run the whole of schema.sql, not this file, against a project.
--
-- Campfire level — a persistent shared XP/level counter per circle, fed by every member's
-- lock-ins. Distinct from get_my_campfire_heat()'s 0-1 ephemeral "activity" gauge (that one
-- drives the living-flame animation's intensity; this one is a permanent, ever-growing
-- counter, never reset).
create table if not exists campfire_levels (
  group_id uuid primary key references groups (id) on delete cascade,
  xp numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table campfire_levels enable row level security;

drop policy if exists "campfire_levels: read if member" on campfire_levels;
create policy "campfire_levels: read if member" on campfire_levels for select using (
  is_group_member(group_id)
);

-- No insert/update/delete policy for regular users — only written by the trigger below.

-- Accrual hooks off check_in_circles, not check_ins directly — check_in_circles already
-- knows exactly which circles a check-in fanned out to (deduped 1 row per check_in x circle
-- via its own PK), and by the time THIS trigger fires, check_ins.xp_earned is guaranteed
-- already finalized: on_check_in_insert (sets xp_earned) and
-- on_check_in_insert_snapshot_circles (populates check_in_circles) are both `after insert on
-- check_ins`, and Postgres fires same-timing triggers in trigger-NAME alphabetical order —
-- "on_check_in_insert" sorts before "on_check_in_insert_snapshot_circles" (strict prefix).
-- If either trigger is ever renamed, re-verify this ordering assumption still holds.
create or replace function accrue_campfire_xp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duration integer;
  v_xp numeric;
begin
  select duration_seconds, xp_earned into v_duration, v_xp
  from check_ins where id = new.check_in_id;

  -- Lock-ins only (per spec: "each lock-in feeds the campfire's shared level"), not old
  -- plain photo check-ins.
  if v_duration is null then
    return new;
  end if;

  insert into campfire_levels (group_id, xp)
  values (new.circle_id, v_xp)
  on conflict (group_id) do update
    set xp = campfire_levels.xp + excluded.xp, updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_check_in_circles_insert_accrue_xp on check_in_circles;
create trigger on_check_in_circles_insert_accrue_xp
  after insert on check_in_circles
  for each row execute function accrue_campfire_xp();

-- Level-from-XP as a closed-form formula, not a seeded threshold table — campfire XP pools
-- many members and can run well past personal rank's 15 steps. Cumulative-XP-for-level
-- curve: xp_for_level(L) = 500 * L^1.6 — placeholder constants, same "tune once there's
-- usage data" status as the original XP-per-hour/rank-threshold curves.
create or replace function campfire_level_for_xp(p_xp numeric)
returns int
language sql
immutable
as $$
  select greatest(1, floor(power(greatest(p_xp, 0) / 500.0, 1.0 / 1.6))::int + 1);
$$;

create or replace function get_campfire_level(p_group_id uuid)
returns table (group_id uuid, xp numeric, level int, xp_into_level numeric, xp_for_next_level numeric)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_xp numeric;
  v_level int;
  v_level_floor numeric;
  v_level_ceil numeric;
begin
  if not is_group_member(p_group_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  select coalesce(cl.xp, 0) into v_xp from campfire_levels cl where cl.group_id = p_group_id;
  v_xp := coalesce(v_xp, 0);
  v_level := campfire_level_for_xp(v_xp);
  v_level_floor := 500 * power(v_level - 1, 1.6);
  v_level_ceil := 500 * power(v_level, 1.6);

  return query select p_group_id, v_xp, v_level, v_xp - v_level_floor, v_level_ceil - v_level_floor;
end;
$$;
