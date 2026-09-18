-- 0195 — A dev can buy the Pass before the season opens.
--
-- CODE_PROMPT_android_iap_test.md §4b. The IAP device test must run the real purchase end to end —
-- Shop → Flame Pass → Play sheet (license-tester card) → RevenueCat → webhook → grant — but
-- grant_forge_pass (0074) refuses unless season_phase() = 'live', and Season 1 opens 2026-10-01
-- (0187). Bought today, the charge lands, the webhook 500s, and nothing is granted.
--
-- The only accommodation: a season-gate bypass keyed on the BUYER's profiles.is_dev. It changes
-- nothing about what a purchase grants — only when a dev may make one. Every real user has
-- is_dev = false, so for them grant_forge_pass is exactly 0074's. The client mirrors it (paywall /
-- forge-pass / shop read `phase === 'live' || profile.is_dev`), so non-devs still see Oct 1.
--
-- Plus dev_revoke_forge_pass(): un-owns the Pass and deletes the Level 0 claim so the next real
-- purchase drops the stipend again. It only ever takes away.
--
-- ─────────────────────────────── 🔒 is_dev IS NOT CLIENT-WRITABLE ───────────────────────────────
--
-- profiles carries "profiles: update own" + "profiles: insert own" with no column restriction, and
-- authenticated holds UPDATE/INSERT on every column. A bare new column would be one every user can
-- set on themselves — and then buy a season before it opens. Column-level REVOKE does not help while
-- the table-level grant stands, so a BEFORE INSERT OR UPDATE trigger pins it for client roles:
-- anon/authenticated can never change it; migrations, the SQL editor (postgres) and service_role can.
--
-- (profiles.is_admin has the same exposure today and no such trigger — reported separately, not
-- changed here.)

alter table profiles add column if not exists is_dev boolean not null default false;

create or replace function lock_profile_dev_flag()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.is_dev := false;
    else
      new.is_dev := old.is_dev;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_lock_dev_flag on profiles;
create trigger on_profile_lock_dev_flag
  before insert or update on profiles
  for each row execute function lock_profile_dev_flag();

-- Noah, and only Noah.
update profiles set is_dev = true where id = '2bb0ff4f-7292-4ca5-b746-bdfe8528cf0f' and not is_dev;

-- ── grant_forge_pass: 0074's body, one clause added to the phase check ──
-- Same signature, so the ACL from 0185 (no anon/authenticated EXECUTE) carries over untouched.
create or replace function grant_forge_pass(p_user uuid, p_season text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := coalesce(p_season, season_config() ->> 'id');
begin
  -- The buyer's flag, read here — never the caller's: this runs from the webhook on the service role,
  -- where auth.uid() is null.
  if season_phase() <> 'live'
     and not coalesce((select is_dev from profiles where id = p_user), false) then
    raise exception 'The % season is not open for purchase right now.', v_season;
  end if;

  insert into forge_pass_state (user_id, season_id, owns_premium, premium_granted_at)
  values (p_user, v_season, true, now())
  on conflict (user_id, season_id) do update set owns_premium = true, premium_granted_at = now();

  -- The purchase's receipt, in the same transaction as the entitlement (grant_level_zero_unlock, 0074); it is
  -- idempotent, so a webhook that retries cannot grant the flare twice.
  perform grant_level_zero_unlock(p_user);
end;
$$;

-- ── dev_revoke_forge_pass: back to a clean pre-purchase state ──
-- Self-only (auth.uid()), and refuses unless the caller is a dev. Deliberately leaves the embers and
-- cosmetics the stipend dropped: the ledger is append-only (0064), and a re-dropped cosmetic the user
-- still owns simply salvages. The level-0 claim row is what grant_level_zero_unlock keys on, so
-- deleting it is what lets the next purchase fire the stipend again.
create or replace function dev_revoke_forge_pass()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := season_config() ->> 'id';
  v_owned int;
  v_claims int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  if not coalesce((select is_dev from profiles where id = v_user), false) then
    raise exception 'Dev tools are not enabled for this account';
  end if;

  update forge_pass_state
     set owns_premium = false, premium_granted_at = null
   where user_id = v_user and season_id = v_season and owns_premium;
  get diagnostics v_owned = row_count;

  delete from pass_claims where user_id = v_user and season_id = v_season and tier = 0 and lane = 'premium';
  get diagnostics v_claims = row_count;

  return jsonb_build_object('season_id', v_season, 'revoked_pass', v_owned > 0, 'cleared_level_zero', v_claims > 0);
end;
$$;

-- anon named explicitly: revoking PUBLIC does not reach Supabase's default anon grant (0185).
revoke execute on function public.dev_revoke_forge_pass() from public, anon;
grant execute on function public.dev_revoke_forge_pass() to authenticated;
revoke execute on function public.lock_profile_dev_flag() from public, anon, authenticated;

do $assert$
begin
  if (select count(*) from profiles where is_dev) > 1 then
    raise exception '0195: is_dev should be one account, is %', (select count(*) from profiles where is_dev);
  end if;
  if has_function_privilege('anon', 'public.dev_revoke_forge_pass()', 'execute') then
    raise exception '0195: anon can execute dev_revoke_forge_pass';
  end if;
  -- The restated grant must not have reopened what 0185 closed.
  if has_function_privilege('anon', 'public.grant_forge_pass(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.grant_forge_pass(uuid, text)', 'execute') then
    raise exception '0195: a client role can execute grant_forge_pass';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'grant_forge_pass') <> 1 then
    raise exception '0195: grant_forge_pass has more than one overload';
  end if;
end;
$assert$;
