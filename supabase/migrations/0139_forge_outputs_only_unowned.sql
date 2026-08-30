-- 0139 — the Forge outputs ONLY items you do not already own. No dupe, no embers, ever.
--
-- ─────────────────────────── why this is 0139 and not an edit to 0138 ───────────────────────────
--
-- The amendment was written on the understanding that 0138 was committed but unpushed, in which
-- case editing it in place would have been right. It had already been pushed — `supabase db push`
-- applied it to the linked project minutes earlier — so 0138's version is recorded in
-- schema_migrations and will never be re-applied. Editing that file in place would leave the
-- deployed function permanently disagreeing with the migration that claims to have created it, and
-- the disagreement would be invisible: nothing re-reads an applied migration.
--
-- So this is a new file. It restates forge_combine with an IDENTICAL signature — (text, uuid[])
-- returning jsonb — which is the one case where CREATE OR REPLACE is safe without a DROP first.
--
-- Restating a function is normally what the wave rule forbids. It forbids restating SOMEONE ELSE'S
-- function from an older base, which silently reverts their work. This restates the function 0138
-- added one migration ago, from that exact text, changing one block. Everything else below is
-- byte-identical to 0138 on purpose, so a diff of the two files IS the changelog.
--
-- ─────────────────────────── what changes ───────────────────────────
--
-- 0138 rolled the output preferring un-owned items and fell back to the full pool when the caller
-- owned everything at that tier — which handed the combine to economy_grant_cosmetic as a dupe, and
-- a dupe auto-salvages to embers. So three Legendaries could buy 2,000 embers instead of a Mythic.
--
-- Noah's final call: never. The forge outputs an item you do not own or it outputs nothing.
--
--   1. The roll draws from box_droppable_items at the target rarity MINUS what the caller owns.
--      Not "prefer" — that is the whole candidate set. There is no second query.
--
--   2. An empty candidate set is a REJECTION, `tier_complete`, not a salvage. It is raised before a
--      single row is deleted, so a rejected combine costs nothing: the inputs are still there.
--
--   3. A belt-and-braces assertion after the grant. economy_grant_cosmetic still reports whether it
--      salvaged, and it now cannot be true — but READ COMMITTED means a concurrent grant committing
--      between the roll and the grant would be visible to the later statement, and the honest answer
--      to that race is to abort the whole transaction (consuming nothing) rather than to quietly pay
--      embers. That is the one path by which the old behaviour could still occur, and it is closed.
--
-- Everything else is deliberately untouched: the season guarantee in both directions, the input
-- gate, the exact-count and mythic-never-input rules, the single transaction, and the fail-closed
-- posture on an empty allowlist.

create or replace function forge_combine(p_rarity text, p_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_rarity text := lower(trim(coalesce(p_rarity, '')));
  v_recipe jsonb;
  v_need int;
  v_next text;
  v_ids uuid[];
  v_eligible int;
  v_owned int;
  v_bad_key text;
  v_pick text;
  v_consumed text[];
  v_result jsonb;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  -- Fail closed. An empty allowlist would disable both the input gate and the output pool at once,
  -- which is precisely the state that could mint or eat a season item.
  if not exists (select 1 from box_droppable_items) then
    raise exception 'The Forge is not available yet. (box_droppable_items is empty — run economy_set_droppable_items from the deploy step.)';
  end if;

  -- ── the recipe ──
  v_recipe := (select value from economy_config where key = 'forge_ratios') -> v_rarity;
  if v_recipe is null then
    if v_rarity = 'mythic' then
      raise exception 'Mythic is the top of the ladder — it can be forged, but never forged FROM';
    end if;
    raise exception 'Nothing can be forged from %', coalesce(nullif(v_rarity, ''), 'that');
  end if;
  v_need := (v_recipe ->> 'need')::int;
  v_next := v_recipe ->> 'into';

  -- ── the inputs ──
  select array_agg(distinct id) into v_ids from unnest(coalesce(p_item_ids, '{}'::uuid[])) id;
  v_ids := coalesce(v_ids, '{}'::uuid[]);

  if array_length(v_ids, 1) is distinct from v_need then
    raise exception 'This recipe takes % distinct %s, not %',
      v_need, v_rarity, coalesce(array_length(v_ids, 1), 0);
  end if;

  perform 1 from cosmetics_owned co
  where co.id = any (v_ids) and co.user_id = v_user
  for update;
  get diagnostics v_owned = row_count;

  if v_owned <> v_need then
    raise exception '% of those % items are not in your inventory', v_need - v_owned, v_need;
  end if;

  select count(*) into v_eligible
  from cosmetics_owned co
  join box_droppable_items d
    on d.item_key = co.cosmetic_key and d.rarity = v_rarity
  where co.id = any (v_ids)
    and co.user_id = v_user
    and co.source in ('box', 'paid')
    and co.rarity_override is null;

  if v_eligible <> v_need then
    select co.cosmetic_key into v_bad_key
    from cosmetics_owned co
    where co.id = any (v_ids)
      and co.user_id = v_user
      and (
        co.source not in ('box', 'paid')
        or co.rarity_override is not null
        or not exists (
          select 1 from box_droppable_items d
          where d.item_key = co.cosmetic_key and d.rarity = v_rarity
        )
      )
    limit 1;

    if v_bad_key like 'relic-%' then
      raise exception 'Relics are never forged — % is earned, not fuel', v_bad_key;
    end if;
    raise exception 'Not eligible as % fuel: % (season and Flame Pass items, starter gear and relics stay out of the Forge)',
      v_rarity, coalesce(v_bad_key, 'one of those items');
  end if;

  -- ── the roll: the un-owned subset, and nothing else ──
  --
  -- 🔴 THE CHANGE. This is the entire candidate set, not a first preference with a fallback behind
  -- it. The screen promises "a random Epic you don't own" and this is the line that makes that
  -- literally true rather than usually true.
  select d.item_key into v_pick
  from box_droppable_items d
  where d.rarity = v_next
    and not exists (
      select 1 from cosmetics_owned co
      where co.user_id = v_user and co.cosmetic_key = d.item_key
    )
  order by random()
  limit 1;

  -- Nothing left to forge toward. A REJECTION, raised here — before the delete below — so the
  -- inputs are untouched and the user loses nothing by asking.
  --
  -- `tier_complete` travels in DETAIL rather than in the message, because the client branches on it
  -- and a message is copy: PostgREST surfaces detail as `error.details`, so the screen can say the
  -- right thing without pattern-matching prose that a later edit would break.
  if v_pick is null then
    raise exception 'You already own every % the Forge can make, so there is nothing left to forge toward.', v_next
      using detail = 'tier_complete',
            hint = 'Pick a different reforge path.';
  end if;

  -- ── consume, then grant ──
  select array_agg(co.cosmetic_key) into v_consumed
  from cosmetics_owned co where co.id = any (v_ids) and co.user_id = v_user;

  -- Clear the loadout first (0070): deleting the owned row alone leaves a dangling (user, slot)
  -- pointing at an item the user no longer has — a phantom equipped flame.
  delete from equipped_loadout el
  where el.user_id = v_user and el.cosmetic_key = any (v_consumed);

  delete from cosmetics_owned co where co.id = any (v_ids) and co.user_id = v_user;

  v_result := economy_grant_cosmetic(
    v_user, v_pick, null, v_next, 'box',
    format('Forged from %s x %s', v_need, initcap(v_rarity))
  );

  -- The race, closed. v_pick was un-owned when it was rolled; under READ COMMITTED a grant of that
  -- same key committing between the two statements would be visible here, and economy_grant_cosmetic
  -- would have salvaged it to embers — the one path by which "the Forge paid me embers" could still
  -- happen. Aborting rolls back the deletes too, so the inputs survive and the user can simply try
  -- again. Vanishingly rare and not worth handling gracefully; very much worth not doing silently.
  if coalesce((v_result ->> 'dupe')::boolean, false) then
    raise exception 'The Forge rolled % but you acquired it mid-combine — nothing was consumed, try again.', v_pick
      using detail = 'roll_raced';
  end if;

  return v_result || jsonb_build_object(
    'input_rarity', v_rarity,
    'consumed', v_need,
    'consumed_keys', to_jsonb(v_consumed)
  );
end;
$$;

-- CREATE OR REPLACE preserves the existing ACL, so 0138's revoke/grant still stands. Restated
-- anyway rather than assumed: this function mints goods, and "the grants probably carried over" is
-- not the standard #151 set for economy functions.
revoke all on function forge_combine(text, uuid[]) from public, anon, authenticated;
grant execute on function forge_combine(text, uuid[]) to authenticated;

do $assert_grants$
declare
  v_fn oid := 'public.forge_combine(text,uuid[])'::regprocedure;
begin
  if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'forge_combine is not callable by authenticated — the screen would 404';
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'forge_combine is callable by anon';
  end if;
  if exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'forge_combine still carries the default PUBLIC execute grant';
  end if;
end;
$assert_grants$;

-- The fallback is gone from the deployed source, asserted rather than eyeballed. If a later edit
-- reintroduces a second roll against the full pool, this is what catches it.
do $assert_no_fallback$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'forge_combine';

  if v_src not like '%tier_complete%' then
    raise exception 'forge_combine does not raise tier_complete — the un-owned-only roll did not land';
  end if;
  -- Exactly ONE select against box_droppable_items for the OUTPUT rarity. 0138 had two.
  if (length(v_src) - length(replace(v_src, 'where d.rarity = v_next', ''))) / length('where d.rarity = v_next') <> 1 then
    raise exception 'forge_combine has more than one output roll — the dupe fallback is back';
  end if;
end;
$assert_no_fallback$;
