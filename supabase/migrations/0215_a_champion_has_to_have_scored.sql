-- 0215 — a champion has to have scored. Corrective follow-up to 0212.
--
-- 0212's mint labels every final_rank = 1 racer "<Campfire> Champion" (epic). But settlement ranks
-- the field with rank() over the score, so a race where NOBODY scored ties the whole field at 1 —
-- and every racer walked away a Champion. finalize_social_challenges already knows this: it only
-- names a winner when `final_rank = 1 and final_value > 0`. The mint never asked.
--
-- Now it asks the same question. A rank-1 racer on zero gets "<Campfire> Finisher" at the default
-- rarity, and the provenance reads "no winner" instead of "1st of N". Every other case — a real
-- champion, a shared first on a positive score, "2nd Place Finisher", a zero-scorer ranked below
-- someone who did score — prints exactly what it printed before.
--
-- Checked on prod before writing: one settled campfire race, three finisher titles, one Champion,
-- on a positive score. Nothing minted wrongly yet, so there is nothing to re-label — this only
-- closes the door. (A zero-score Champion minted before this applies would keep its stamp; the
-- key is per challenge and the grant is on-conflict-do-nothing, so a re-mint cannot fix it.)
--
-- The decision lives in campfire_finisher_stamp(), a pure function, so the assertion below can
-- exercise it directly — including the positive control — instead of trusting a restated loop.
--
-- mint_campfire_finisher_titles is restated from live prosrc (md5-guarded); the only changes are
-- the final_value read and the three lines that call the stamp.
--
-- NOT fixed here, noted for whoever picks it up: notify_challenge_status_change has the same
-- blind spot — it pushes "You won" to every final_rank = 1 racer, so an all-zero race tells the
-- whole field they won. That predates 0212 and is a separate body.
--
-- NOTE: no explicit begin/commit — the migration runs in its own transaction.

do $guard$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5 from pg_proc p
  where p.oid = 'public.mint_campfire_finisher_titles(uuid)'::regprocedure;

  -- 0212's body, as live on 2026-09-24.
  if v_md5 is distinct from 'd8e55b58ed5fa1debc86943ba02749a6' then
    raise exception '0215: mint_campfire_finisher_titles changed since it was read (md5 %). Re-restate from live prosrc.', v_md5;
  end if;
end;
$guard$;

-- ───────────────────────────── the stamp ─────────────────────────────

/** Label, provenance place-text and rarity for one racer. Champion needs 1st AND a score > 0. */
create function campfire_finisher_stamp(p_campfire text, p_place int, p_value numeric, p_field int)
returns table (label text, place_text text, rarity text)
language sql
immutable
set search_path = public
as $$
  select
    case
      when p_place = 1 and coalesce(p_value, 0) <= 0 then p_campfire || ' Finisher'
      else campfire_finisher_label(p_campfire, p_place)
    end,
    case
      when p_place = 1 and coalesce(p_value, 0) <= 0 then 'no winner'
      else ordinal_suffix(p_place) || ' of ' || p_field
    end,
    -- The champion's reads one notch hotter than the rest of the field (the template is rare).
    case when p_place = 1 and coalesce(p_value, 0) > 0 then 'epic' else null end;
$$;

revoke all on function campfire_finisher_stamp(text, int, numeric, int) from public, anon, authenticated;

-- ───────────────────────────── the mint ─────────────────────────────

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
  s record;
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
    select p.user_id, p.final_rank, p.final_value
    from challenge_participants p
    where p.challenge_id = p_challenge_id and p.state = 'accepted' and p.final_rank is not null
  loop
    -- 0215 · the stamp decides label and rarity; Champion needs a score > 0.
    select * into s from campfire_finisher_stamp(v_campfire, r.final_rank, r.final_value, v_field);
    perform economy_grant_title(
      r.user_id,
      v_key,
      v_race || ' · ' || v_campfire || ' · ' || s.place_text,
      s.label,
      s.rarity
    );
  end loop;

  select count(*) into v_after from cosmetics_owned where cosmetic_key = v_key;
  return v_after - v_before;
end;
$$;

-- create or replace keeps 0212's ACL on the mint; restated anyway so the file stands on its own.
revoke all on function mint_campfire_finisher_titles(uuid) from public, anon, authenticated;

-- ───────────────────────────── assertions ─────────────────────────────

do $assert$
declare
  s record;
begin
  -- The bug: 1st on zero is NOT a champion.
  select * into s from campfire_finisher_stamp('Goat', 1, 0, 4);
  if s.label <> 'Goat Finisher' or s.rarity is not null or s.place_text <> 'no winner' then
    raise exception '0215: all-zero first still stamps as %/%/%', s.label, s.rarity, s.place_text;
  end if;
  select * into s from campfire_finisher_stamp('Goat', 1, null, 4);
  if s.label <> 'Goat Finisher' then
    raise exception '0215: null-score first stamps as %', s.label;
  end if;

  -- Positive control: a real winner is still the Champion, epic, "1st of N".
  select * into s from campfire_finisher_stamp('Goat', 1, 12.5, 4);
  if s.label <> 'Goat Champion' or s.rarity is distinct from 'epic' or s.place_text <> '1st of 4' then
    raise exception '0215: a scoring winner stamps as %/%/%', s.label, s.rarity, s.place_text;
  end if;

  -- Unchanged below first, on any score.
  select * into s from campfire_finisher_stamp('Goat', 2, 0, 4);
  if s.label <> campfire_finisher_label('Goat', 2) or s.rarity is not null or s.place_text <> '2nd of 4' then
    raise exception '0215: 2nd place stamps as %/%/%', s.label, s.rarity, s.place_text;
  end if;

  if (select count(*) from pg_proc where proname = 'mint_campfire_finisher_titles' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '0215: expected exactly one mint_campfire_finisher_titles overload';
  end if;
  if (select prosrc from pg_proc where oid = 'public.mint_campfire_finisher_titles(uuid)'::regprocedure) !~ 'campfire_finisher_stamp' then
    raise exception '0215: the mint did not pick up the stamp';
  end if;
  if has_function_privilege('authenticated', 'public.mint_campfire_finisher_titles(uuid)', 'execute')
     or has_function_privilege('anon', 'public.campfire_finisher_stamp(text, integer, numeric, integer)', 'execute') then
    raise exception '0215: a finisher function is callable from the client';
  end if;
end;
$assert$;
