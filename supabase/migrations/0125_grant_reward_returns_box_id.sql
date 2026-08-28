-- 0125 — grant_reward says WHICH box it minted, so the result screen can open it.
--
-- CODE_PROMPT_challenge_v2 B4 / ledger item 3, last bullet. ChallengeRewardScreen has an
-- `onOpenBox` prop and renders a real "Open your Hephaestus box" CTA the moment it is passed one.
-- It has never been passed one, because /shop/open needs a loot_boxes row ID and there was no way
-- to recover which row was this challenge's: grant_reward's insert records the user, the box_key
-- and a provenance STRING ('Challenge reward'), and nothing tying it to the challenge that paid it.
-- So the box lands in the inventory and the screen that announced it cannot reach it.
--
-- THE FIX IS ONE `returning`. The prompt offers two routes and prefers this one:
--
--   · (taken) grant_reward returns the new loot_boxes.id in the payload it already returns. The
--     payload is already captured verbatim into challenge_participants.reward_payload by 0118's
--     trigger and already read back verbatim by get_challenge_reward — so the id rides the whole
--     way to the client with no other function touched, no new column, and no second reader.
--   · (rejected) have the client find the latest unopened box of that key. That is a HEURISTIC,
--     and it is wrong in exactly the case that matters: settle two challenges in the same sweep,
--     both paying a Hestia box, and each result screen opens whichever row sorted first. A user
--     could open the same physical box twice from two screens and lose the other.
--
-- A COLUMN ON loot_boxes WAS ALSO CONSIDERED AND NOT TAKEN. grant_reward already carries the
-- challenge as `p_ref`, so `loot_boxes.challenge_id` would be a second home for a fact the return
-- value already conveys, plus a backfill that cannot be done (the link never existed to recover).
-- The id in the payload is sufficient and unambiguous.
--
-- 🔒 THE REWARD FIREWALL IS UNCHANGED AND THIS FILE IS WHY IT STAYS THAT WAY. Nothing about what
-- is paid moves here: same significance curve, same bands, same embers, same box key, same badge.
-- The function reports one more fact about a decision it had already made. The client still
-- derives no figure of its own — it now merely knows which row to hand to /shop/open.
--
-- Body is 0114's, unchanged except for the declared v_box_id, the `returning id into` on the
-- insert, and one more key in the returned object. A restatement rather than a targeted patch
-- because plpgsql has no way to replace one line. Signature is identical, so `create or replace`
-- is correct and no overload is created.
--
-- BACKWARD COMPATIBLE BOTH WAYS. Every payload written before this deploys simply has no 'box_id'
-- key; the client reads it as null and falls back to the pre-B4 behaviour (the box row renders,
-- the Open CTA does not). And the unverified early-return below still carries no box_id, because
-- that branch mints no box.

create or replace function grant_reward(
  p_user uuid, p_type text, p_difficulty numeric, p_duration_days int,
  p_scope int, p_placement_pct numeric, p_verified boolean, p_ref uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sig numeric;
  v_embers int;
  v_box text;
  v_box_id uuid;
  v_badge text;
  v_band text;
  v_bands jsonb := (select value from economy_config where key = 'reward_bands');
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
begin
  if not p_verified then
    v_embers := coalesce((v_bands ->> 'unverified')::int, 10);
    perform economy_move_embers(p_user, v_embers, 'challenge_win', p_ref);
    return jsonb_build_object('embers', v_embers, 'box', null, 'box_id', null, 'badge', null, 'band', 'completion');
  end if;

  -- Significance is UNTOUCHED. The thresholds below still carve the same curve; only what each
  -- band pays has moved, so the relative ordering of "how impressive was this" is preserved.
  v_sig := p_difficulty
         * greatest(1, log(greatest(p_scope, 1)::numeric + 1))
         * greatest(1, p_duration_days::numeric / 7)
         * greatest(0.2, 1 - coalesce(p_placement_pct, 1));

  if    v_sig >= 24 then v_band := 'apex';       v_box := 'promethean';
  elsif v_sig >= 12 then v_band := 'elite';      v_box := 'hephaestus';
  elsif v_sig >= 6  then v_band := 'impressive'; v_box := 'hestia';
  elsif v_sig >= 3  then v_band := 'notable';    v_box := 'furnace';
  elsif v_sig >= 1  then v_band := 'casual';     v_box := 'ignition';
  else                   v_band := 'completion'; v_box := null;
  end if;

  -- coalesce so a malformed/missing config row degrades to the completion floor rather than
  -- writing a NULL delta into the ledger.
  v_embers := coalesce((v_bands ->> v_band)::int, 10);

  perform economy_move_embers(p_user, v_embers, case when p_type = 'season' then 'season_reward' else 'challenge_win' end::ember_reason, p_ref);

  if v_box is not null then
    insert into loot_boxes (user_id, box_key, obtained_via, provenance)
    values (p_user, v_box, case when p_type = 'season' then 'season' else 'challenge' end::box_obtained_via,
            case when p_type = 'season' then 'Season reward · ' || v_season else 'Challenge reward' end)
    returning id into v_box_id;
  end if;

  -- The prestige half (§5 / 21c): the top two bands mint an UN-BUYABLE earned badge. This is what
  -- the biggest wins are actually for — the embers above are the same currency anyone can buy, so
  -- on their own they'd make a season win feel purchasable.
  if v_band in ('elite', 'apex') then
    v_badge := case
      when p_type = 'season' then 'season-' || v_band || '-' || v_season
      else 'challenge-' || v_band
    end;
    perform economy_grant_badge(
      p_user, v_badge,
      case when p_type = 'season'
        then 'Season ' || v_season || ' · ' || initcap(v_band) || ' finish'
        else initcap(v_band) || ' challenge win'
      end
    );
  end if;

  return jsonb_build_object(
    'embers', v_embers,
    'box', v_box,
    -- The row, not just the kind. 'box' names WHAT they won; this names WHICH ONE, and only the
    -- second can be opened.
    'box_id', v_box_id,
    'badge', v_badge,
    'band', v_band,
    'significance', v_sig
  );
end;
$$;
