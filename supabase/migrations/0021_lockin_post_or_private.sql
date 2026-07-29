-- PHILOI_UI_SPEC.md §13's "done" screen: after Stop, the user explicitly chooses "Post to
-- the campfire" or "Keep this one private" — the campfire post is NOT automatic.
--
-- check_ins previously had no circle_id at all (it was dropped in an earlier migration —
-- every check-in fanned out to ALL of the user's circles via snapshot_check_in_circles()).
-- That's fine for old photo check-ins, but wrong for lock-ins now that a session can be solo
-- or tied to one specific campfire (lock_in_sessions.circle_id) — a solo/private lock-in was
-- still broadcasting into every circle the user belongs to. Fixed by adding circle_id back
-- (nullable — null means "not posted anywhere yet"), and only auto-broadcasting to every
-- circle for the OLD non-lock-in check-ins (duration_seconds is null); lock-ins now only ever
-- post via the explicit RPC below, once the user chooses to.

alter table check_ins add column if not exists circle_id uuid references groups (id) on delete set null;

create or replace function snapshot_check_in_circles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.duration_seconds is not null then
    -- Lock-ins: respect circle_id exactly. It's left null at stop time (see
    -- stop_lock_in_session) until the user explicitly posts via post_check_in_to_circle —
    -- this branch mainly guards against a future insert path setting it directly.
    if new.circle_id is not null then
      insert into check_in_circles (check_in_id, circle_id) values (new.id, new.circle_id)
      on conflict do nothing;
    end if;
  else
    -- Legacy/photo-only check-ins (pre-lock-in-rebuild, dev-tools) — unchanged, broadcast to
    -- every circle the user belongs to.
    insert into check_in_circles (check_in_id, circle_id)
    select new.id, gm.group_id
    from group_members gm
    where gm.user_id = new.user_id;
  end if;
  return new;
end;
$$;

-- Explicit "Post to the campfire" action — writes the already-computed lock-in event (with
-- its duration/XP/photos already on the row) into one specific circle's chain. Not a trigger:
-- the user decides this AFTER seeing the done-screen recap, not at Stop time.
create or replace function post_check_in_to_circle(p_check_in_id uuid, p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that circle.';
  end if;

  update check_ins
  set circle_id = p_circle_id
  where id = p_check_in_id and user_id = auth.uid() and circle_id is null;

  if not found then
    raise exception 'Check-in not found, not yours, or already posted.';
  end if;

  insert into check_in_circles (check_in_id, circle_id)
  values (p_check_in_id, p_circle_id)
  on conflict do nothing;
end;
$$;
