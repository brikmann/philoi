-- Campfire membership ROLES + the join-requests "id is ambiguous" fix.
-- CAMPFIRE_REDESIGN_SPEC.md §Phase 2 ("no admin privileges") — landed early because the
-- challenge subsystem consumes it to gate start/manage, and because every owner-only RPC below
-- had to be reopened to admins in the same pass anyway.
--
-- THE SHAPE (this is the contract other code reads):
--   group_members.role ∈ ('owner', 'admin', 'member')
--   my_campfire_role(p_group_id)             -> 'owner' | 'admin' | 'member' | null  [client RPC]
--   is_campfire_admin(p_group_id, p_user_id) -> boolean  (true for owner AND admin)  [SQL helper]
-- "Admin" is the CAPABILITY tier: owner is a subset of admin. Anything that asks "may this person
-- manage the campfire?" calls is_campfire_admin(), never `owner_id = auth.uid()`, so promoting
-- someone is a single role write rather than an audit of every gate in the schema.
--
-- DELETE stays owner-only on purpose (delete_group() is untouched here). Deleting a campfire for
-- everyone is irreversible and is the one power a promoted admin should not inherit.

-- ── 1. The role column ──────────────────────────────────────────────────────────────────────
-- Drop by SHAPE, not by name. The original check was declared inline, so its name is whatever
-- Postgres auto-assigned — usually group_members_role_check, but a re-created table can leave a
-- _check1 suffix behind. Dropping the wrong one would leave the old two-value constraint in place
-- and every 'admin' write would fail a check nobody could find.
do $mig$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'group_members'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%role%'
  loop
    execute format('alter table group_members drop constraint %I', v_name);
  end loop;
end
$mig$;

alter table group_members add constraint group_members_role_check
  check (role in ('owner', 'admin', 'member'));

-- Backfill: every campfire's owner should carry role 'owner' on their own membership row. Older
-- rows were inserted as 'member' by join paths that predate this, which would lock the founder
-- out of their own gates the moment those gates start reading role instead of owner_id.
update group_members gm
set role = 'owner'
from groups g
where g.id = gm.group_id and g.owner_id = gm.user_id and gm.role <> 'owner';

-- ── 2. The helpers ──────────────────────────────────────────────────────────────────────────
create or replace function is_campfire_admin(p_group_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
    select 1 from groups g where g.id = p_group_id and g.owner_id = p_user_id
  ) or exists (
    select 1 from group_members gm
    where gm.group_id = p_group_id and gm.user_id = p_user_id and gm.role in ('owner', 'admin')
  );
$fn$;

-- The client-facing read. Returns null when the caller isn't in the campfire at all, so the UI can
-- tell "member" (hide the admin rows) apart from "not a member" (don't render the screen).
create or replace function my_campfire_role(p_group_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $fn$
  select case
    when exists (select 1 from groups g where g.id = p_group_id and g.owner_id = auth.uid()) then 'owner'
    else (
      select gm.role from group_members gm
      where gm.group_id = p_group_id and gm.user_id = auth.uid()
    )
  end;
$fn$;

-- Promote/demote. OWNER-only: an admin who can mint other admins is an admin who cannot be
-- removed. 'owner' is not assignable here — transferring a campfire is a separate act.
create or replace function set_campfire_member_role(p_group_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner_id uuid;
  v_group_name text;
begin
  if p_role not in ('admin', 'member') then
    raise exception 'Role must be admin or member.';
  end if;

  select g.owner_id into v_owner_id from groups g where g.id = p_group_id;
  if v_owner_id is null then
    raise exception 'Campfire not found.';
  end if;
  if v_owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can change roles.';
  end if;
  if p_user_id = v_owner_id then
    raise exception 'The owner''s own role cannot be changed.';
  end if;

  update group_members gm
  set role = p_role
  where gm.group_id = p_group_id and gm.user_id = p_user_id;

  if not found then
    raise exception 'That person is not in this campfire.';
  end if;

  -- Being handed the keys is worth telling someone about (NOTIFICATIONS_SPEC "Campfires"); being
  -- quietly demoted is not, so only the promotion notifies.
  if p_role = 'admin' then
    select g.name into v_group_name from groups g where g.id = p_group_id;
    perform notify_push(
      array[p_user_id],
      v_group_name,
      'You can now manage ' || coalesce(v_group_name, 'this campfire') || '.',
      jsonb_build_object('type', 'campfire_admin_granted', 'group_id', p_group_id)
    );
  end if;
end;
$fn$;

-- ── 3. Join requests: the "column reference \"id\" is ambiguous" fix ─────────────────────────
-- THE BUG. list_join_requests() declares RETURNS TABLE (id uuid, ...), which creates a plpgsql
-- OUT variable literally named `id`. The body then ran:
--     select owner_id into v_owner_id from groups where id = p_group_id;
-- and Postgres cannot tell whether that bare `id` means groups.id or the OUT variable, so the
-- whole call aborts with 42702 before a single row is read. Every statement in a RETURNS TABLE
-- body below is now alias-qualified (g.id, r.id) so no bare column can collide with an output
-- name again. Same class of bug as the watch `status` one.
--
-- Signature and return shape are unchanged, so `create or replace` is safe here; a changed shape
-- would need a drop first (Postgres refuses to replace a function's return type in place).
create or replace function list_join_requests(p_group_id uuid)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  handle text,
  university text,
  shared_circle_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
begin
  if not exists (select 1 from groups g where g.id = p_group_id) then
    raise exception 'Campfire not found.';
  end if;
  if not is_campfire_admin(p_group_id, auth.uid()) then
    raise exception 'Only admins can view join requests.';
  end if;

  return query
  select
    r.id,
    r.user_id,
    p.display_name,
    p.handle,
    p.university,
    (
      select g2.name from group_members gm1
      join group_members gm2 on gm1.group_id = gm2.group_id
      join groups g2 on g2.id = gm1.group_id
      where gm1.user_id = r.user_id and gm2.user_id = auth.uid() and gm1.group_id <> p_group_id
      limit 1
    ) as shared_circle_name,
    r.created_at
  from group_join_requests r
  join profiles p on p.id = r.user_id
  where r.group_id = p_group_id and r.status = 'pending'
  order by r.created_at asc;
end;
$fn$;

-- ── 4. Approve / deny, reopened from owner-only to admins ───────────────────────────────────
create or replace function approve_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_req group_join_requests;
  v_group_name text;
begin
  select * into v_req from group_join_requests r
  where r.id = p_request_id and r.status = 'pending';
  if v_req.id is null then
    return; -- already handled or gone — approve_all's loop snapshot can race a single approve/deny
  end if;

  if not is_campfire_admin(v_req.group_id, auth.uid()) then
    raise exception 'Only admins can approve join requests.';
  end if;
  select g.name into v_group_name from groups g where g.id = v_req.group_id;

  insert into group_members (group_id, user_id, role)
  values (v_req.group_id, v_req.user_id, 'member')
  on conflict (group_id, user_id) do nothing;

  update group_join_requests r set status = 'approved' where r.id = v_req.id;

  perform notify_push(
    array[v_req.user_id],
    v_group_name,
    'You''re in 🔥 ' || coalesce(v_group_name, 'the campfire'),
    jsonb_build_object('type', 'join_request_approved', 'group_id', v_req.group_id)
  );
end;
$fn$;

create or replace function deny_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_group_id uuid;
begin
  select r.group_id into v_group_id
  from group_join_requests r
  where r.id = p_request_id and r.status = 'pending';

  if v_group_id is null then
    return;
  end if;
  if not is_campfire_admin(v_group_id, auth.uid()) then
    raise exception 'Only admins can deny join requests.';
  end if;

  update group_join_requests r set status = 'denied' where r.id = p_request_id;
end;
$fn$;

create or replace function approve_all_join_requests(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_req_id uuid;
begin
  if not is_campfire_admin(p_group_id, auth.uid()) then
    raise exception 'Only admins can approve join requests.';
  end if;

  for v_req_id in
    select r.id from group_join_requests r where r.group_id = p_group_id and r.status = 'pending'
  loop
    perform approve_join_request(v_req_id);
  end loop;
end;
$fn$;

-- ── 5. Campfire edit, reopened from owner-only to admins ────────────────────────────────────
-- The `groups` RLS update policy is still owner-only, so an admin's edit has to travel through a
-- security-definer RPC rather than a direct table update. update_campfire_privacy() and
-- update_campfire_house_rules() already are RPCs; update_campfire_details() is the new one that
-- covers name/emoji, which the edit screen previously wrote straight to the table.
create or replace function update_campfire_details(p_group_id uuid, p_name text, p_emoji text)
returns groups
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_group groups;
begin
  if not is_campfire_admin(p_group_id, auth.uid()) then
    raise exception 'Only admins can edit this campfire.';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Give your campfire a name.';
  end if;

  update groups g
  set name = btrim(p_name), emoji = coalesce(p_emoji, g.emoji)
  where g.id = p_group_id
  returning g.* into v_group;

  if v_group.id is null then
    raise exception 'Campfire not found.';
  end if;
  return v_group;
end;
$fn$;

create or replace function update_campfire_privacy(p_group_id uuid, p_privacy text)
returns groups
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_group groups;
  v_req_id uuid;
begin
  if p_privacy not in ('open', 'gated', 'private') then
    raise exception 'Invalid campfire privacy.';
  end if;
  if not is_campfire_admin(p_group_id, auth.uid()) then
    raise exception 'Only admins can change campfire privacy.';
  end if;

  update groups g set privacy = p_privacy where g.id = p_group_id returning g.* into v_group;
  if v_group.id is null then
    raise exception 'Campfire not found.';
  end if;

  if p_privacy = 'open' then
    for v_req_id in
      select r.id from group_join_requests r where r.group_id = p_group_id and r.status = 'pending'
    loop
      perform approve_join_request(v_req_id);
    end loop;
  end if;

  return v_group;
end;
$fn$;

create or replace function update_campfire_house_rules(
  p_group_id uuid,
  p_min_join_tier text,
  p_house_rule text
)
returns groups
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_group groups;
begin
  if not is_campfire_admin(p_group_id, auth.uid()) then
    raise exception 'Only admins can change the house rules.';
  end if;

  update groups g
  set min_join_tier = nullif(p_min_join_tier, ''),
      house_rule = nullif(btrim(coalesce(p_house_rule, '')), '')
  where g.id = p_group_id
  returning g.* into v_group;

  if v_group.id is null then
    raise exception 'Campfire not found.';
  end if;
  return v_group;
end;
$fn$;

-- ── 6. The roster, with roles ───────────────────────────────────────────────────────────────
-- Everything else in this migration decides what a role LETS you do; this is the read that lets
-- anyone see who holds one, and the owner's members screen the promote/demote control hangs off.
-- Without it the role model would be real but unreachable — nobody could hand out the keys.
--
-- Members-only, because a campfire's roster is not public. Every column alias-qualified, for the
-- same RETURNS TABLE reason documented in §3.
create or replace function list_campfire_members(p_group_id uuid)
returns table (
  user_id uuid,
  display_name text,
  handle text,
  avatar_url text,
  role text,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
begin
  if not is_group_member(p_group_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  return query
  select
    gm.user_id,
    p.display_name,
    p.handle,
    p.avatar_url,
    gm.role,
    gm.joined_at
  from group_members gm
  join profiles p on p.id = gm.user_id
  where gm.group_id = p_group_id
  -- Owner, then admins, then members; alphabetical inside each band.
  order by case gm.role when 'owner' then 0 when 'admin' then 1 else 2 end, p.display_name asc;
end;
$fn$;
