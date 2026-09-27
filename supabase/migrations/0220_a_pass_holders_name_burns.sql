-- 0220 — A Flame Pass holder's name burns, and everyone can see it.
--
-- The burning name (LORE_EMBERFALL §"The burning name", mocks 225/226) renders a pass holder's
-- display name on fire wherever the campus sees it: leaderboards, the podium, the Agora, campfire
-- rosters, profiles. Your OWN status the client already has (get_inventory → pass.owns_premium).
-- Someone ELSE's it cannot read: forge_pass_state is own-rows-only under RLS (0064), correctly —
-- the row also carries pass XP and claim state that are nobody else's business.
--
-- So this adds one read that answers exactly one question for a batch of ids — "which of these own
-- this season's pass" — and returns nothing but the ids. Same shape and posture as
-- get_public_loadouts: SECURITY DEFINER, batched, disabled accounts excluded.
--
-- ─── WHY A NEW FUNCTION, NOT A COLUMN ON get_public_loadouts ───
-- get_public_loadouts returns one row per EQUIPPED SLOT, so a holder wearing nothing would have no
-- row to carry the flag; and changing its return shape means drop-and-recreate under every
-- installed build that calls it. An additive function is invisible to shipped clients.
--
-- ─── WHICH SEASON ───
-- economy_config('season').id — the same binding grant_forge_pass writes and get_inventory reads,
-- so a Season-1 pass stops burning the moment Season 2 is configured, without a code change.
--
-- Grants: authenticated only. `revoke ... from public` alone leaves anon's default EXECUTE in place
-- on Supabase, so anon is revoked by name.
--
-- NOTE: no explicit begin/commit — the migration runs in its own transaction.

create or replace function get_pass_holders(p_user_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select f.user_id
  from forge_pass_state f
  join profiles p on p.id = f.user_id
  where f.user_id = any(p_user_ids)
    and f.owns_premium
    and f.season_id = (select c.value ->> 'id' from economy_config c where c.key = 'season')
    and not p.is_disabled;
$$;

revoke all on function get_pass_holders(uuid[]) from public;
revoke all on function get_pass_holders(uuid[]) from anon;
grant execute on function get_pass_holders(uuid[]) to authenticated;

comment on function get_pass_holders(uuid[]) is
  'Which of these users own the current season''s Flame Pass — ids only. Drives the burning name (0220).';

-- ───────────────────────────── assertions ─────────────────────────────

do $assert$
declare
  v_holder uuid;
  v_non uuid;
  v_got uuid[];
begin
  -- Positive control: someone who owns this season's pass comes back...
  select f.user_id into v_holder
  from forge_pass_state f join profiles p on p.id = f.user_id
  where f.owns_premium and not p.is_disabled
    and f.season_id = (select value ->> 'id' from economy_config where key = 'season')
  limit 1;

  -- ...and someone who does not, doesn't. Both asked in the same call, so the check discriminates:
  -- a body that returned every id it was handed would fail the second half.
  select p.id into v_non
  from profiles p
  where not exists (
    select 1 from forge_pass_state f
    where f.user_id = p.id and f.owns_premium
      and f.season_id = (select value ->> 'id' from economy_config where key = 'season')
  )
  limit 1;

  select array_agg(x) into v_got from get_pass_holders(array_remove(array[v_holder, v_non], null)) x;

  if v_holder is not null and not (v_holder = any(coalesce(v_got, '{}'))) then
    raise exception '0220: pass holder % was not returned', v_holder;
  end if;
  if v_non is not null and v_non = any(coalesce(v_got, '{}')) then
    raise exception '0220: non-holder % was returned', v_non;
  end if;

  if has_function_privilege('anon', 'get_pass_holders(uuid[])', 'execute') then
    raise exception '0220: anon can execute get_pass_holders';
  end if;
  if not has_function_privilege('authenticated', 'get_pass_holders(uuid[])', 'execute') then
    raise exception '0220: authenticated cannot execute get_pass_holders';
  end if;
end;
$assert$;
