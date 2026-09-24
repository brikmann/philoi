-- 0212 — every campfire finisher is printed (CODE_PROMPT_campfire_finisher_badge, mock 217).
--
-- When a campfire challenge settles, every racer who opted in walks away with a permanent title
-- naming the campfire and where they finished: "Goat Champion", "Goat 2nd Place Finisher". The
-- winner still takes the box + embers exactly as before; this pays nothing, it only remembers.
--
-- ─── WHY ONE KEY PER CHALLENGE, NOT ONE KEY WITH N STAMPS ───
-- The prompt assumed economy_grant_title upserts on (user, key, stamp). It does not: cosmetics_owned
-- is UNIQUE (user_id, cosmetic_key), and the grant is `on conflict (user_id, cosmetic_key) do
-- nothing`. One shared key would give each person exactly ONE finisher title for life — the second
-- campfire race they ran would silently mint nothing. Widening that constraint is not an option:
-- every grant, equip, salvage and forge path in the schema keys on (user_id, cosmetic_key).
--
-- So the key carries the challenge: `title-campfire-finisher:<challenge_id>`. The client resolves
-- every key with that prefix to ONE catalog template (catalog.ts), so it is still "one key, N
-- labels" from the catalog's point of view. Installed builds that predate the template drop an
-- unknown key rather than render it (loadout.ts / use-inventory skip `getItem() === undefined`), so
-- this ships ahead of the client without breaking anything already on a phone.
--
-- ─── WHERE THE LABEL LIVES ───
-- season_stamp = the frozen label ("Goat 2nd Place Finisher"). It is the column every surface
-- already carries next to a title — the owned grid, the live loadout, get_public_loadouts — so the
-- label reaches other people's screens with no new read. It is snapshotted at grant time from
-- groups.name: renaming the campfire later changes nothing, and deleting it (which cascades the
-- challenge away) leaves the title standing, because cosmetics_owned references neither.
-- provenance = the race it came from, for the item detail sheet.
--
-- ─── WHO GETS ONE ───
-- Every ACCEPTED participant the settlement ranked (final_rank is not null). There is no DNF: a
-- racer who scored zero is still ranked, last, and still printed. The only people with nothing are
-- those who never opted in (invited / declined rows are never ranked). Ties share a place, exactly
-- as rank() wrote them. Requiring final_rank is also what keeps a mutual cancel (status flips to
-- 'completed' with no standings written) from printing anyone.
--
-- Scope: a challenge with a circle_id that is not a 1:1 duel. mode = 'h2h' mints nothing even when
-- it was posted in a campfire — a duel has an opponent, not a field.
--
-- ─── WHEN ───
-- A DEFERRED constraint trigger on the flip to 'completed', not a splice into the settlement
-- bodies. Two reasons:
--   1. The collective arm of finalize_social_challenges flips status BEFORE it writes final_rank
--      (0127's comment spells out why). An ordinary AFTER trigger would read no standings there. A
--      deferred one runs at commit, after every arm — placement, collective, team match — has
--      written its ranks.
--   2. finalize_social_challenges (10.5k) and economy_on_social_challenge_closed (16.7k) are left
--      byte-for-byte alone, so this cannot clobber a sibling branch's edit to either.
-- The trigger swallows its own errors with a WARNING. A cosmetic must never be the reason a race
-- fails to settle — the cron commits a whole batch of challenges in one transaction.
--
-- ─── CAN'T BE SOLD, CAN'T BE FORGED ───
--   · salvage_cosmetic refuses the key (restated below from live prosrc, md5-guarded).
--   · forge_combine needs NO change: inputs must be source in ('box','paid') AND listed in
--     box_droppable_items; outputs are drawn from box_droppable_items. A title granted 'earned'
--     with a per-challenge key can be neither. Asserted below rather than assumed.
--
-- NOTE: no explicit begin/commit — the migration runs in its own transaction.

-- ───────────────────────────── guard: restate only what we read ─────────────────────────────

do $guard$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.oid = 'public.salvage_cosmetic(text, text)'::regprocedure;

  -- The body restated below was copied from live prod on 2026-09-24. If this fails, someone has
  -- changed salvage_cosmetic since — re-read it and splice the finisher refusal into THAT body.
  if v_md5 is distinct from '9b6c60a5d80e04dae0ffb1b4fb485d62' then
    raise exception '0212: salvage_cosmetic changed since it was read (md5 %). Re-restate from live prosrc.', v_md5;
  end if;
end;
$guard$;

-- ───────────────────────────── the label ─────────────────────────────

create or replace function campfire_finisher_title_key(p_challenge_id uuid)
returns text
language sql
immutable
set search_path = public
as $$
  select 'title-campfire-finisher:' || p_challenge_id::text;
$$;

/** "Goat Champion" for 1st, "Goat 2nd Place Finisher" for everyone else. */
create or replace function campfire_finisher_label(p_campfire text, p_place int)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_place = 1 then p_campfire || ' Champion'
    else p_campfire || ' ' || ordinal_suffix(p_place) || ' Place Finisher'
  end;
$$;

-- ───────────────────────────── the mint ─────────────────────────────

/**
 * Prints every ranked, accepted racer of one settled campfire challenge. Idempotent: the key is the
 * challenge, and economy_grant_title is `on conflict do nothing`, so re-running it (or a second
 * settlement flip) grants nobody twice. Returns how many titles were NEWLY printed.
 */
create or replace function mint_campfire_finisher_titles(p_challenge_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
  v_campfire text;
  v_key text := campfire_finisher_title_key(p_challenge_id);
  v_race text;
  v_field int;
  v_before int;
  v_after int;
  r record;
begin
  select * into v_c from social_challenges where id = p_challenge_id;
  if v_c.id is null or v_c.status <> 'completed' or v_c.circle_id is null or v_c.mode = 'h2h' then
    return 0;
  end if;

  select coalesce(nullif(trim(g.name), ''), 'Campfire') into v_campfire from groups g where g.id = v_c.circle_id;
  v_campfire := coalesce(v_campfire, 'Campfire');
  v_race := coalesce(nullif(trim(v_c.public_name), ''), 'Campfire challenge');

  select count(*) into v_field
  from challenge_participants p
  where p.challenge_id = p_challenge_id and p.state = 'accepted' and p.final_rank is not null;

  select count(*) into v_before from cosmetics_owned where cosmetic_key = v_key;

  for r in
    select p.user_id, p.final_rank
    from challenge_participants p
    where p.challenge_id = p_challenge_id and p.state = 'accepted' and p.final_rank is not null
  loop
    perform economy_grant_title(
      r.user_id,
      v_key,
      v_race || ' · ' || v_campfire || ' · ' || ordinal_suffix(r.final_rank) || ' of ' || v_field,
      campfire_finisher_label(v_campfire, r.final_rank),
      -- The champion's reads one notch hotter than the rest of the field (the template is rare).
      case when r.final_rank = 1 then 'epic' else null end
    );
  end loop;

  select count(*) into v_after from cosmetics_owned where cosmetic_key = v_key;
  return v_after - v_before;
end;
$$;

revoke all on function campfire_finisher_title_key(uuid) from public, anon, authenticated;
revoke all on function campfire_finisher_label(text, int) from public, anon, authenticated;
revoke all on function mint_campfire_finisher_titles(uuid) from public, anon, authenticated;

create or replace function on_campfire_challenge_settled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform mint_campfire_finisher_titles(new.id);
  exception when others then
    -- Loud, not fatal: the race still settles and pays. The title can be re-minted by hand with
    -- mint_campfire_finisher_titles(<id>) — it is idempotent.
    raise warning '0212 finisher titles failed for challenge %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

revoke all on function on_campfire_challenge_settled() from public, anon, authenticated;

drop trigger if exists social_challenges_finisher_titles on social_challenges;
create constraint trigger social_challenges_finisher_titles
  after update of status on social_challenges
  deferrable initially deferred
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed'
        and new.circle_id is not null and new.mode <> 'h2h')
  execute function on_campfire_challenge_settled();

-- ───────────────────────────── can't be sold ─────────────────────────────
--
-- Live body (md5 9b6c60a5…) with one refusal added after the starter-item one.

create or replace function salvage_cosmetic(p_key text, p_rarity text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_payout int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  if p_key = any (default_cosmetic_keys()) then
    raise exception 'Starter items are permanent and cannot be sold.';
  end if;

  -- 0212 — a campfire finisher title is the record of a race you ran. It is not currency.
  if p_key like 'title-campfire-finisher:%' then
    raise exception 'Campfire finisher titles are permanent and cannot be sold.';
  end if;

  if not exists (select 1 from cosmetics_owned where user_id = v_user and cosmetic_key = p_key) then
    raise exception 'You do not own this item';
  end if;

  v_payout := ((select value from economy_config where key = 'salvage_embers') ->> p_rarity)::int;
  delete from equipped_loadout where user_id = v_user and cosmetic_key = p_key;
  delete from cosmetics_owned where user_id = v_user and cosmetic_key = p_key;
  perform economy_move_embers(v_user, v_payout, 'salvage', null);
  return jsonb_build_object('embers', v_payout);
end;
$$;

-- ───────────────────────────── backfill ─────────────────────────────
--
-- Campfire races that already settled get their titles too — "every campfire challenge you ever
-- ran". Same function, same idempotency, same rules.

do $backfill$
declare
  v_id uuid;
begin
  for v_id in
    select sc.id from social_challenges sc
    where sc.status = 'completed' and sc.circle_id is not null and sc.mode <> 'h2h'
  loop
    perform mint_campfire_finisher_titles(v_id);
  end loop;
end;
$backfill$;

-- ───────────────────────────── assertions ─────────────────────────────

do $assert$
declare
  v_src text;
begin
  -- The label, both branches and the teens.
  if campfire_finisher_label('Goat', 1) <> 'Goat Champion' then raise exception '0212: 1st label wrong'; end if;
  if campfire_finisher_label('Goat', 2) <> 'Goat 2nd Place Finisher' then raise exception '0212: 2nd label wrong'; end if;
  if campfire_finisher_label('Goat', 3) <> 'Goat 3rd Place Finisher' then raise exception '0212: 3rd label wrong'; end if;
  if campfire_finisher_label('Goat', 11) <> 'Goat 11th Place Finisher' then raise exception '0212: 11th label wrong'; end if;
  if campfire_finisher_label('Goat', 22) <> 'Goat 22nd Place Finisher' then raise exception '0212: 22nd label wrong'; end if;

  -- Never in a box, so never direct-buyable and never a Forge output.
  if exists (select 1 from box_droppable_items where item_key like 'title-campfire-finisher%') then
    raise exception '0212: a finisher title is in box_droppable_items — it would be buyable and forgeable';
  end if;

  -- The grant writes source 'earned', which the Forge input gate (source in box/paid) rejects.
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.economy_grant_title(uuid,text,text,text,text)'::regprocedure;
  if v_src not like '%''earned''%' then
    raise exception '0212: economy_grant_title no longer grants as earned';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.forge_combine(text,uuid[])'::regprocedure;
  if v_src not like '%co.source in (''box'', ''paid'')%' then
    raise exception '0212: forge_combine input gate changed — re-check that earned titles stay out';
  end if;

  -- The sell refusal is live.
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.salvage_cosmetic(text,text)'::regprocedure;
  if v_src not like '%title-campfire-finisher:%' then
    raise exception '0212: salvage_cosmetic does not refuse finisher titles';
  end if;

  -- Nobody but the database can mint one.
  if has_function_privilege('authenticated', 'public.mint_campfire_finisher_titles(uuid)', 'execute')
     or has_function_privilege('anon', 'public.mint_campfire_finisher_titles(uuid)', 'execute') then
    raise exception '0212: mint_campfire_finisher_titles is client-callable';
  end if;

  -- Every finisher title already printed carries its label, as an earned title.
  if exists (
    select 1 from cosmetics_owned
    where cosmetic_key like 'title-campfire-finisher:%'
      and (source <> 'earned' or slot <> 'title' or season_stamp is null)
  ) then
    raise exception '0212: a finisher title was printed without its label or as non-earned';
  end if;
end;
$assert$;
