-- Handoff B, 0110 — a cheer can carry a note, and the watch access gate gets one definition.
--
-- Numbering: 0096-0099 was this handoff's block and is spent; 0100-0109 belongs to the other
-- session (0100 and 0105 landed, the rest are theirs to fill). 0110 is the first number outside
-- both. Two migrations in this project have already been silently rolled back by a duplicated
-- leading number, and the CLI blames the schema_migrations INSERT rather than the collision.

-- 1. THE NOTE ---------------------------------------------------------------------------------
--
-- Nullable, because a bare cheer stays a bare cheer — the button must not grow a required field.
-- Capped and trimmed in the constraint rather than only in the composer: the RPC is the only
-- writer, but the cap is a property of the column, not of whichever client happens to call it.

alter table challenge_cheers add column if not exists note text;
alter table challenge_cheers drop constraint if exists challenge_cheers_note_len;
alter table challenge_cheers add constraint challenge_cheers_note_len
  check (note is null or (length(btrim(note)) between 1 and 140));

-- 2. THE ACCESS GATE, EXTRACTED ---------------------------------------------------------------
--
-- get_challenge_watch (0099) carries this predicate inline. The notes reader below needs exactly
-- the same test — if it were copied, the two would drift, and the copy that drifts is the one
-- that leaks. Returns boolean rather than raising so callers keep their own error messages;
-- false covers both "no such challenge" and "not allowed", which is deliberate. A caller that
-- wants to tell those apart looks the row up itself, as get_challenge_watch does.
--
-- The extra PK lookup this costs get_challenge_watch is one indexed read per call.

create or replace function can_watch_challenge(p_challenge_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $can$
declare
  v_challenge social_challenges;
  v_shares_circle boolean;
  v_creator_opted_in boolean;
  v_opponent_opted_in boolean;
  v_is_friend_of_creator boolean;
  v_is_friend_of_opponent boolean;
begin
  select * into v_challenge
  from social_challenges sc
  where sc.id = p_challenge_id
    and (challenge_is_live(sc.status) or challenge_is_settled(sc.status));
  if v_challenge.id is null then
    return false;
  end if;

  select exists (
    select 1 from group_members gm1 join group_members gm2 on gm1.group_id = gm2.group_id
    where gm1.user_id = auth.uid() and gm2.user_id = v_challenge.created_by
  ) into v_shares_circle;

  select exists (
    select 1 from friend_requests fr where fr.status = 'accepted'
      and ((fr.requester_id = auth.uid() and fr.recipient_id = v_challenge.created_by) or (fr.requester_id = v_challenge.created_by and fr.recipient_id = auth.uid()))
  ) into v_is_friend_of_creator;

  select exists (
    select 1 from friend_requests fr where fr.status = 'accepted'
      and ((fr.requester_id = auth.uid() and fr.recipient_id = v_challenge.opponent_id) or (fr.requester_id = v_challenge.opponent_id and fr.recipient_id = auth.uid()))
  ) into v_is_friend_of_opponent;

  select p.watch_opt_in into v_creator_opted_in from profiles p where p.id = v_challenge.created_by;
  select p.watch_opt_in into v_opponent_opted_in from profiles p where p.id = v_challenge.opponent_id;

  return (
    (v_shares_circle and v_challenge.circle_id is not null)
    or (v_is_friend_of_creator and coalesce(v_creator_opted_in, false))
    or (v_is_friend_of_opponent and coalesce(v_opponent_opted_in, false))
    or auth.uid() in (v_challenge.created_by, v_challenge.opponent_id)
  );
end;
$can$;

-- 3. cheer_challenge GAINS THE NOTE -----------------------------------------------------------
--
-- DROP FIRST, and here it is required rather than merely tidy. A defaulted third parameter does
-- not replace the two-argument function, it OVERLOADS it — and then every existing two-argument
-- call becomes "function cheer_challenge(uuid, uuid) is not unique". Clients already in the field
-- send two arguments, so leaving the old one in place would break them the moment this lands.

drop function if exists cheer_challenge(uuid, uuid);
drop function if exists cheer_challenge(uuid, uuid, text);

create function cheer_challenge(p_challenge_id uuid, p_for_user_id uuid, p_note text default null)
returns int
language plpgsql
security definer
set search_path = public
as $cheer$
declare
  v_challenge social_challenges;
  v_inserted int;
  v_count int;
  v_note text;
begin
  -- Band, not the 'active' literal. Same single status as before; it now says out loud that a
  -- draft is not cheerable, which a list written before 'draft' existed could not have said.
  select * into v_challenge
  from social_challenges sc
  where sc.id = p_challenge_id and challenge_is_live(sc.status);
  if v_challenge.id is null then
    -- Also covers a COMPLETED challenge: once it settles the watch screen is read-only, so a
    -- late cheer must not land (punchlist A4 / CHALLENGE_UI_SPEC §58).
    raise exception 'Challenge not found or not active.';
  end if;

  if p_for_user_id not in (v_challenge.created_by, coalesce(v_challenge.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'That person is not in this challenge.';
  end if;

  -- A competitor cheering their own duel is just self-voting; the count is meant to be the room.
  if auth.uid() in (v_challenge.created_by, coalesce(v_challenge.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'You can''t cheer a challenge you''re competing in.';
  end if;

  -- Whitespace-only is not a note. Normalised to null here so the constraint sees either a real
  -- message or nothing, and so the reader never has to render an empty bubble.
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and length(v_note) > 140 then
    raise exception 'Keep it under 140 characters.';
  end if;

  insert into challenge_cheers (challenge_id, spectator_id, for_user_id, note)
  values (p_challenge_id, auth.uid(), p_for_user_id, v_note)
  on conflict (challenge_id, spectator_id) do nothing;

  -- row_count is 0 when the conflict clause swallowed the insert, i.e. this spectator has already
  -- cheered. Silent no-op rather than an exception — the client disables the button, so reaching
  -- here is a double-tap or a stale screen, not something worth erroring at a user.
  --
  -- The note follows the cheer and is NOT editable by calling again. One cheer per challenge was
  -- the whole point of 0081; an editable note would hand back the repeat-tap the cap removed.
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    if p_for_user_id = v_challenge.created_by then
      update social_challenges set created_by_cheers = created_by_cheers + 1 where id = p_challenge_id;
    else
      update social_challenges set opponent_cheers = opponent_cheers + 1 where id = p_challenge_id;
    end if;
  end if;

  -- Hand back the authoritative count for the side that was cheered, so the client renders the
  -- server's number instead of keeping a local optimistic delta it never reconciles.
  select case when p_for_user_id = v_challenge.created_by then created_by_cheers else opponent_cheers end
    into v_count
  from social_challenges where id = p_challenge_id;

  return v_count;
end;
$cheer$;

-- 4. READING THE NOTES -------------------------------------------------------------------------
--
-- Separate from get_challenge_watch on purpose. That RPC is polled; notes are not a per-poll
-- payload, and appending columns to its RETURNS TABLE is exactly what broke it in 0081 (see 0099).
--
-- Every OUT name below is distinct from the columns the body reads — `spectator_id` is the one
-- overlap and it is only ever written as cc.spectator_id. That check is the standing cost of a
-- RETURNS TABLE in this file, not a coincidence to be re-derived after the next outage.

drop function if exists get_challenge_cheer_notes(uuid);

create function get_challenge_cheer_notes(p_challenge_id uuid)
returns table (
  spectator_id uuid,
  spectator_name text,
  backed_user_id uuid,
  note text,
  noted_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $notes$
begin
  if not can_watch_challenge(p_challenge_id) then
    raise exception 'You don''t have access to watch this challenge.';
  end if;

  return query
  select cc.spectator_id, p.display_name, cc.for_user_id, cc.note, cc.created_at
  from challenge_cheers cc
  join profiles p on p.id = cc.spectator_id
  where cc.challenge_id = p_challenge_id and cc.note is not null
  order by cc.created_at desc
  limit 50;
end;
$notes$;

-- 5. get_challenge_watch USES THE SHARED GATE --------------------------------------------------
--
-- Body is 0099's with the inline access block replaced by the helper. The two raises stay
-- distinct: "not found" and "no access" are different things to a caller, and the boolean helper
-- deliberately does not try to carry that difference.

drop function if exists get_challenge_watch(uuid);

create function get_challenge_watch(p_challenge_id uuid)
returns table (
  challenge_id uuid,
  mode text,
  race_metric text,
  target_count int,
  window_hours int,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  created_by uuid,
  created_by_name text,
  created_by_score numeric,
  created_by_live_status text,
  created_by_cheers int,
  opponent_id uuid,
  opponent_name text,
  opponent_score numeric,
  opponent_live_status text,
  opponent_cheers int,
  has_cheered boolean,
  cheered_for uuid
)
language plpgsql
security definer
set search_path = public
stable
as $watch$
declare
  v_challenge social_challenges;
  v_cheered_for uuid;
begin
  -- sc.status, not status: `status` is an OUT column of this function (0099).
  select * into v_challenge
  from social_challenges sc
  where sc.id = p_challenge_id
    and (challenge_is_live(sc.status) or challenge_is_settled(sc.status));
  if v_challenge.id is null then
    raise exception 'Challenge not found or not active.';
  end if;

  if not can_watch_challenge(p_challenge_id) then
    raise exception 'You don''t have access to watch this challenge.';
  end if;

  -- Qualified with the table alias. The RETURNS TABLE above declares `cheered_for`, and an
  -- unqualified reference in the body resolves to THAT output column rather than to the table's
  -- own, which is how a previous RPC in this project silently returned nulls.
  select cc.for_user_id into v_cheered_for
  from challenge_cheers cc
  where cc.challenge_id = p_challenge_id and cc.spectator_id = auth.uid();

  return query
  select
    v_challenge.id,
    v_challenge.mode,
    v_challenge.race_metric,
    v_challenge.target_count,
    v_challenge.window_hours,
    v_challenge.starts_at,
    v_challenge.ends_at,
    v_challenge.status,
    v_challenge.created_by,
    creator.display_name,
    social_challenge_score(v_challenge.created_by, v_challenge.race_metric, v_challenge.starts_at, v_challenge.ends_at),
    live_status(v_challenge.created_by),
    v_challenge.created_by_cheers,
    v_challenge.opponent_id,
    opp.display_name,
    case when v_challenge.opponent_id is not null
      then social_challenge_score(v_challenge.opponent_id, v_challenge.race_metric, v_challenge.starts_at, v_challenge.ends_at)
      else null end,
    case when v_challenge.opponent_id is not null then live_status(v_challenge.opponent_id) else null end,
    v_challenge.opponent_cheers,
    v_cheered_for is not null,
    v_cheered_for
  from profiles creator
  left join profiles opp on opp.id = v_challenge.opponent_id
  where creator.id = v_challenge.created_by;
end;
$watch$;
