-- 0196 — No client can promote itself.
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- profiles carries "profiles: update own" (using id = auth.uid(), no column restriction) and
-- authenticated holds table-level UPDATE, which confers it on EVERY column. The only BEFORE UPDATE
-- guard, lock_profile_moderation_fields (0001), pins is_disabled/disabled_at and nothing else. So a
-- patched client could send `update profiles set is_admin = true where id = <self>` and get it:
-- is_admin() then opens every moderation policy in 0001 — read any message, any check-in, any
-- campfire, and admin_disable_account on anyone. Same class as #151 and 0185: the boundary was the
-- UI, and the UI is not a boundary.
--
-- 0195 added is_dev with a trigger of its own, because is_dev decides who may buy a season before it
-- opens. This file folds that trigger into ONE guard covering both flags, rather than stacking a
-- second trigger on the same table — two triggers pinning two columns is how the next privileged
-- column gets forgotten.
--
-- Loud, not silent: 0195's version quietly reset the value, which leaves a caller believing it
-- worked. A self-promotion attempt is not a mistake to paper over, so this raises.
--
-- ── WHAT IS NOT HERE, AND WHY ──
-- `revoke update (is_admin, is_dev) on profiles from anon, authenticated` was considered as a second
-- layer. It is a NO-OP here: Postgres privileges are additive, and the table-level UPDATE grant these
-- roles already hold confers update on every column. A column-level REVOKE subtracts nothing from it.
-- Making it real would mean revoking table-level UPDATE and re-granting column by column — after
-- which every future `alter table profiles add column` silently lands with no client grant and breaks
-- the app's next write. A guard that must be re-earned on every schema change is worse than the
-- trigger, so the trigger is the whole fix.

do $guard$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_dev'
  ) then
    raise exception '0196 applies after 0195 — profiles.is_dev does not exist yet';
  end if;
end;
$guard$;

-- Privileged-caller detection is 0195's, unchanged: anon/authenticated are the roles a device can
-- reach. A SECURITY DEFINER function runs as its owner (postgres), pg_cron runs as postgres, and the
-- service role is service_role — none of them are in that list, so every server-side path still
-- writes these columns freely.
create or replace function lock_profile_privilege_flags()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_admin, false) or coalesce(new.is_dev, false) then
      raise exception 'A profile cannot be created with is_admin or is_dev set'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- `is distinct from`, not `<>`: a client that PATCHes the whole row back (same values, nulls
  -- included) is a legitimate edit and must not trip this. Only an actual change raises.
  if new.is_admin is distinct from old.is_admin or new.is_dev is distinct from old.is_dev then
    raise exception 'is_admin and is_dev cannot be changed from a client'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- 0195's is_dev-only trigger, replaced rather than joined.
drop trigger if exists on_profile_lock_dev_flag on profiles;
drop function if exists lock_profile_dev_flag();

drop trigger if exists on_profile_lock_privilege_flags on profiles;
create trigger on_profile_lock_privilege_flags
  before insert or update on profiles
  for each row execute function lock_profile_privilege_flags();

revoke execute on function public.lock_profile_privilege_flags() from public, anon, authenticated;

do $assert$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname = 'on_profile_lock_privilege_flags'
       and not tgisinternal
  ) then
    raise exception '0196: the privilege-flag trigger is not installed';
  end if;

  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass and tgname = 'on_profile_lock_dev_flag'
  ) then
    raise exception '0196: 0195''s is_dev trigger is still attached';
  end if;

  -- 0001's moderation pin is a separate trigger on the same table and must survive this.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass and tgname = 'on_profile_update_lock_moderation'
  ) then
    raise exception '0196: the moderation-field trigger went missing';
  end if;

  if (select count(*) from profiles where is_admin) <> 0 then
    raise exception '0196: expected no admin accounts, found %', (select count(*) from profiles where is_admin);
  end if;
end;
$assert$;
