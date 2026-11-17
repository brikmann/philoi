-- 0303 — Gym Spark v2 §3: matching is automatic. Every account is matchable by default; the
-- off-switch lives in Settings ("Show me in matching" → set_my_match_settings({discoverable:false})).
--
-- 0275 shipped matching opt-in (discoverable default false, and a missing row = not matchable).
-- This reverses that default — a product decision (Noah, 2026-11-17, CODE_PROMPT v2) — while
-- keeping every OTHER 0275 guard as is: match_scope 'uni', find_me 'same_uni', show_live false.
--
--   1. match_settings.discoverable defaults TRUE.
--   2. Backfill: every profile with no match_settings row gets one (discoverable true). An existing
--      row is never touched — an explicit "off" stays off. (At authoring time prod had 2 rows,
--      both already on, and 0 off; 41 profiles.)
--   3. New signups get their row from an AFTER INSERT trigger on profiles. It swallows its own
--      errors: signing up must never fail because matching did.
--
-- No function is restated (grind_alike_rows / get_my_match_settings / set_my_match_settings stay
-- exactly as 0275/0295 left them): with a row for every profile, their coalesce(…, false) fallbacks
-- for a missing row are never reached. Additive only. Sends no pushes, writes no messages.

alter table public.match_settings alter column discoverable set default true;

insert into public.match_settings (user_id)
select p.id
from public.profiles p
where not exists (select 1 from public.match_settings ms where ms.user_id = p.id)
on conflict (user_id) do nothing;

create function public.match_settings_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into match_settings (user_id) values (new.id)
    on conflict (user_id) do nothing;
  exception when others then
    raise warning '0303 — could not create match_settings for %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.match_settings_on_signup() from public, anon, authenticated;

create trigger profiles_match_settings_on_signup
  after insert on public.profiles
  for each row execute function public.match_settings_on_signup();

-- ── Verify ──────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'match_settings' and column_name = 'discoverable') <> 'true' then
    raise exception '0303: discoverable must default on';
  end if;
  if exists (select 1 from public.profiles p
             where not exists (select 1 from public.match_settings ms where ms.user_id = p.id)) then
    raise exception '0303: a profile is still missing its match_settings row';
  end if;
end;
$$;
