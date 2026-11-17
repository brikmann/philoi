-- 0302 — THE GYM SPARK §5: the one default gym chat, and everyone in it.
--
-- Built on the LIVE schema (groups / group_members). 0297's join_policy / join_room() are in the
-- repo but not applied in prod, so nothing here touches them.
--
--   1. Seed one campfire, "Laurier Gym", at a FIXED id — the client hard-codes it as GYM_ROOM_ID
--      (src/lib/api/gym-spark.ts) and the Chat tab opens /group/<id> without a lookup.
--   2. Auto-join: AFTER INSERT ON profiles (same shape as profiles_seed_default_loadout) puts every
--      new account in the room. Signup creates the profile from the client (there is no trigger on
--      auth.users), so this fires on that client insert; SECURITY DEFINER gets it past
--      group_members RLS, and an exception handler means it can never fail a signup.
--   3. Backfill every existing non-disabled profile once.
--
-- Choices:
--   • goal_type 'gym'      — in groups_goal_type_check and in every installed client's GoalType.
--   • cadence 'flexible'   — what group/create.tsx and forest-campfire-sheet write today.
--   • privacy 'private'    — not readable through "groups: read if public" and refused by
--                            join_public_group, so it shows up in no discovery list. Members read
--                            it (and its messages) through is_group_member like any campfire.
--   • owner                — 0dafcd2b-… (@brikmnn): no profile has is_admin; this is the only
--                            is_dev account and the earliest one. Falls back to the earliest
--                            is_admin/is_dev profile if that row is absent (another environment).
--   • no member cap exists on groups/group_members, and min_join_tier stays null.
--
-- Pushes: nothing on this path pushes. group_members' only trigger is announce_campfire_join, which
-- inserts a body-NULL 'member_joined' system message (no trigger on owner rows); the messages
-- triggers that can notify (notify_message_mentions ×2) bail on a NULL body before notify_event.
-- No pg_net, no notify_push. The backfill would still drop ~40 simultaneous "joined the room" lines
-- into the chat, so they are removed in the same transaction (a new signup's single join line is
-- kept — that one is real news). Idempotent: re-running inserts nothing and deletes nothing.

-- ── 1 + 3. Seed and backfill ───────────────────────────────────────────────────────────────────
do $$
declare
  v_room  constant uuid := 'a11a0000-0000-4000-8000-000000000001';
  v_owner uuid;
begin
  select id into v_owner from profiles where id = '0dafcd2b-8766-4052-83be-59de4a87fd92';
  if v_owner is null then
    select id into v_owner from profiles
    where (is_admin or is_dev) and not is_disabled
    order by created_at limit 1;
  end if;
  if v_owner is null then
    raise exception '0302 — no owner account for the Laurier Gym room';
  end if;

  insert into groups (id, name, emoji, owner_id, goal_type, cadence, privacy)
  values (v_room, 'Laurier Gym', '🏋️', v_owner, 'gym', 'flexible', 'private')
  on conflict (id) do nothing;

  -- The owner row goes in as whoever owns the room now (on a re-run that is groups.owner_id, which
  -- the owner may in principle have transferred).
  insert into group_members (group_id, user_id, role)
  select g.id, g.owner_id, 'owner' from groups g where g.id = v_room
  on conflict (group_id, user_id) do nothing;

  insert into group_members (group_id, user_id, role)
  select v_room, p.id, 'member'
  from profiles p
  where not p.is_disabled
  on conflict (group_id, user_id) do nothing;

  -- Drop the join lines the backfill just wrote. now() is this transaction's start, so this only
  -- ever matches rows inserted by this very statement block.
  delete from messages m
  where m.group_id = v_room
    and m.system_event = 'member_joined'
    and m.created_at = now();
end;
$$;

-- ── 2. Auto-join on signup ─────────────────────────────────────────────────────────────────────
create function public.join_gym_room_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.is_disabled then
      return null;
    end if;

    insert into group_members (group_id, user_id, role)
    select g.id, new.id, 'member'
    from groups g
    where g.id = 'a11a0000-0000-4000-8000-000000000001'
    on conflict (group_id, user_id) do nothing;
  exception when others then
    -- Signing up must never fail because the gym room did (room deleted, a future constraint…).
    raise warning '0302 — could not auto-join % to the Laurier Gym room: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.join_gym_room_on_signup() from public, anon, authenticated;

create trigger profiles_join_gym_room
  after insert on public.profiles
  for each row execute function public.join_gym_room_on_signup();
