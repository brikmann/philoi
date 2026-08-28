-- 0127 — settle a placement race, and pay it by the band people actually finished in.
--
-- CODE_PROMPT_challenge_v2 B3, second half. 0126 made placement races creatable and readable; this
-- makes one end. Two functions change, and both are RESTATEMENTS of their current bodies with one
-- new arm spliced in — plpgsql has no way to replace part of a function, and retyping a function
-- that decides what people are paid is how a transcription error becomes a wrong payout. The
-- unchanged arms below were copied verbatim from 0112 (finalize) and 0118 (the reward trigger).
--
-- WHAT SETTLING A PLACEMENT RACE MEANS, AS AGAINST THE OTHER TWO SHAPES:
--   · a duel has a winner and a loser;
--   · a collective goal is all-or-nothing — nobody is paid unless the whole field clears the
--     target, and then each share scales by placement;
--   · a placement race has NO shared target and no one to beat. Everyone is ordered 1..N on one
--     metric, and each racer is paid for the band they finished in. Mock 114: "Scope scales the
--     reward... same percentile bands, hotter rewards as the pool grows."
--
-- THE ONE ORDERING SUBTLETY, WHICH IS THE REAL CONTENT OF THIS FILE.
-- The reward trigger fires ON `update social_challenges set status = 'completed'`. The collective
-- arm runs that flip BEFORE it writes final_rank / final_percentile, so the trigger has no
-- standings to read — which is exactly why 0118 pays every group racer a flat placement figure of
-- 0.75 and calls it, in its own comment, "a guessed rank". For a collective goal that is a
-- defensible default. For a placement race it would delete the shape: the entire point is where
-- you came, and every finisher from 1st to 48th would be paid identically.
--
-- So the placement arm writes the standings FIRST and flips the status second. Same transaction,
-- deliberately different order, and it is what lets the trigger below read a real percentile.
--
-- 🔒 REWARD FIREWALL. grant_reward still decides and moves every reward; nothing here computes a
-- payout. The placement arm hands it a TRUER INPUT (the racer's actual percentile instead of a
-- constant) and captures what it returns, which is the same contract 0118 established. The client
-- continues to derive nothing — it reads reward_payload.
--
-- Depends on 0126 (nothing has shape = 'placement' before it) and on 0125 (whose box_id rides the
-- payload captured below). Forward-only: every arm for a duel or a collective goal is byte-for-byte
-- what it was, so nothing already in flight settles differently.

create or replace function finalize_social_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $fin$
declare
  r record;
  v_my numeric;
  v_opp numeric;
  v_field_count int;
  v_completed_count int;
  v_has_roster boolean;
  v_winner uuid;
begin
  -- Band, not `status = 'active'` (0111). 0096 widened the vocabulary with 'draft', and a sweep
  -- that tests a literal keeps its old meaning silently when the vocabulary grows.
  for r in
    select * from social_challenges sc
    where challenge_is_live(sc.status) and sc.ends_at <= now()
    for update
  loop

    select exists (select 1 from challenge_participants p where p.challenge_id = r.id)
      into v_has_roster;

    if r.mode = 'h2h' then
      if v_has_roster then
        -- Progress since the gun, not lifetime totals. Evaluated as of ends_at rather than now()
        -- so a sweep that runs late settles the race that was run, not the hours after it.
        select
          coalesce(max(case when p.user_id = r.created_by
            then challenge_metric_value(r.race_metric, p.user_id, r.ends_at) - p.baseline end), 0),
          coalesce(max(case when p.user_id = r.opponent_id
            then challenge_metric_value(r.race_metric, p.user_id, r.ends_at) - p.baseline end), 0)
          into v_my, v_opp
        from challenge_participants p
        where p.challenge_id = r.id and p.state = 'accepted';
      else
        v_my := social_challenge_score(r.created_by, r.race_metric, r.starts_at, r.ends_at);
        v_opp := social_challenge_score(r.opponent_id, r.race_metric, r.starts_at, r.ends_at);
      end if;

      v_winner := case when v_my > v_opp then r.created_by
                       when v_opp > v_my then r.opponent_id
                       else null end;

      update social_challenges set status = 'completed', winner_id = v_winner where id = r.id;

      -- A draw pays nobody, as in 0034. Splitting the pot would make a deliberate tie the safest
      -- way to play a duel.
      if v_winner is not null then
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        values (v_winner, r.payout_xp, 'challenge_h2h_winner', r.id);
      end if;

      if v_has_roster then
        update challenge_participants p
           set final_value = case when p.user_id = r.created_by then v_my else v_opp end,
               final_rank = case
                 when v_winner is null then 1
                 when p.user_id = v_winner then 1
                 else 2 end,
               final_percentile = case
                 when v_winner is null then 1.0
                 when p.user_id = v_winner then 1.0
                 else 0.0 end
         where p.challenge_id = r.id;
      end if;

    elsif r.shape = 'placement' then
      -- ─────────────────── PLACEMENT: everyone is ranked, everyone who raced is paid ───────────────────
      --
      -- The new arm (0127). Sits between the duel and the collective goal because it is neither:
      -- there is no opponent to beat and no target the whole house has to clear — the field is
      -- ordered 1..N on one metric and each racer is paid for where they landed.
      --
      -- NOTE THE STATEMENT ORDER, WHICH IS DELIBERATELY NOT THE COLLECTIVE ARM'S.
      -- The collective arm flips status first and writes final_rank afterwards, so the reward
      -- trigger (which fires ON that status flip) cannot see the standings and pays everybody the
      -- same flat 0.75 placement figure — 0118's own comment admits it is "a guessed rank". A
      -- placement race is ENTIRELY about where you finished, so a flat band would defeat the shape.
      -- Writing the standings BEFORE the flip is what lets economy_on_social_challenge_closed read a
      -- real percentile out of challenge_participants. Same transaction, ordered on purpose.
      --
      -- Scores are net of the baseline and evaluated AS OF ends_at, not now(): a sweep that runs late
      -- must settle the race that was run, not the hours after it. Same expression the live board
      -- uses (0126's watch RPC), so the last thing racers saw and the result they get agree.
      select count(*) into v_field_count from challenge_field(r.id, r.circle_id);

      if v_field_count = 0 then
        -- No field, nothing to rank. 'expired' rather than 'completed' so it is not counted as a
        -- race that happened.
        update social_challenges set status = 'expired' where id = r.id;
      else
        update challenge_participants p
           set final_value = ranked.score,
               final_rank = ranked.placement,
               -- Stored top-is-1.0, matching every other standings writer (0111). The reward path
               -- and the client each invert it for their own convention rather than a second
               -- orientation being stored.
               final_percentile = 1.0 - (ranked.placement - 1)::numeric / greatest(v_field_count - 1, 1)
          from (
            select f.user_id,
                   greatest(challenge_metric_value(r.race_metric, f.user_id, r.ends_at) - f.baseline, 0) as score,
                   rank() over (
                     order by greatest(challenge_metric_value(r.race_metric, f.user_id, r.ends_at) - f.baseline, 0) desc
                   ) as placement
            from challenge_field(r.id, r.circle_id) f
          ) ranked
         where p.challenge_id = r.id and p.user_id = ranked.user_id;

        -- A winner only when exactly one racer holds rank 1 AND actually moved. A 48-person race
        -- where nobody logged anything has 48 racers tied on zero, and crowning whichever the
        -- planner returned first would invent a champion — the same phantom-leader mistake 0097 and
        -- the watch screen's `top > 0` guard were both written about.
        -- One aggregate row always comes back, so v_winner is null on a tie and null on an empty
        -- board without depending on SELECT INTO's no-rows behaviour to say so.
        select case when count(*) = 1 then min(p.user_id) end into v_winner
        from challenge_participants p
        where p.challenge_id = r.id and p.state = 'accepted' and p.final_rank = 1 and p.final_value > 0;

        -- Fires the reward trigger, which now has real standings to read.
        update social_challenges set status = 'completed', winner_id = v_winner where id = r.id;

        -- NOT all-or-nothing. That gate belongs to the collective goal, whose whole premise is the
        -- house passing together; a placement race has no shared target to miss, so it pays out on
        -- the band each racer earned.
        --
        -- final_value > 0 IS the entry test, though. placement_multiplier floors at 1.0, so paying
        -- every row would hand full payout_xp to everyone in a 48-person campfire who never opened
        -- the app — which would make being enrolled, rather than racing, the thing that pays.
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        select p.user_id,
               round(r.payout_xp * placement_multiplier(p.final_rank, v_field_count)),
               'challenge_placement',
               r.id
        from challenge_participants p
        where p.challenge_id = r.id and p.state = 'accepted'
          and p.final_rank is not null and p.final_value > 0;
      end if;

    else
      select count(*) into v_field_count from challenge_field(r.id, r.circle_id);

      select count(*) into v_completed_count
      from challenge_field(r.id, r.circle_id) f
      where (
        select count(*) from check_ins ci
        where ci.user_id = f.user_id and ci.removed_at is null
          and ci.created_at >= r.starts_at and ci.created_at <= r.ends_at
          and check_in_qualifies_for_challenge(ci.id)
      ) >= r.target_count;

      if v_completed_count >= v_field_count and v_field_count > 0 then
        update social_challenges set status = 'completed' where id = r.id;

        -- 'xp' is hardcoded on purpose and is NOT a stale literal: a group challenge leaves
        -- race_metric null (the 0098 insert does not set it), because the target is a count of
        -- check-ins rather than a metric race. XP is what orders the field once everyone has met
        -- the same target.
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        select
          ranked.user_id,
          round(r.payout_xp * placement_multiplier(ranked.placement, v_field_count)),
          'challenge_group_completion',
          r.id
        from (
          select f.user_id,
                 rank() over (order by social_challenge_score(f.user_id, 'xp', r.starts_at, r.ends_at) desc) as placement
          from challenge_field(r.id, r.circle_id) f
        ) ranked;

        if v_has_roster then
          update challenge_participants p
             set final_value = ranked.score,
                 final_rank = ranked.placement,
                 final_percentile = 1.0 - (ranked.placement - 1)::numeric / greatest(v_field_count - 1, 1)
            from (
              select f.user_id,
                     social_challenge_score(f.user_id, 'xp', r.starts_at, r.ends_at) as score,
                     rank() over (order by social_challenge_score(f.user_id, 'xp', r.starts_at, r.ends_at) desc) as placement
              from challenge_field(r.id, r.circle_id) f
            ) ranked
           where p.challenge_id = r.id and p.user_id = ranked.user_id;
        end if;
      else
        -- Nobody is paid when the field did not all finish, as in 0034. The standings are still
        -- written so an expired challenge can show what happened instead of just vanishing.
        update social_challenges set status = 'expired' where id = r.id;

        if v_has_roster then
          update challenge_participants p
             set final_value = ranked.done,
                 final_rank = ranked.placement,
                 final_percentile = 1.0 - (ranked.placement - 1)::numeric / greatest(v_field_count - 1, 1)
            from (
              select f.user_id,
                     (select count(*) from check_ins ci
                       where ci.user_id = f.user_id and ci.removed_at is null
                         and ci.created_at >= r.starts_at and ci.created_at <= r.ends_at
                         and check_in_qualifies_for_challenge(ci.id)) as done,
                     rank() over (order by (select count(*) from check_ins ci
                       where ci.user_id = f.user_id and ci.removed_at is null
                         and ci.created_at >= r.starts_at and ci.created_at <= r.ends_at
                         and check_in_qualifies_for_challenge(ci.id)) desc) as placement
              from challenge_field(r.id, r.circle_id) f
            ) ranked
           where p.challenge_id = r.id and p.user_id = ranked.user_id;
        end if;
      end if;
    end if;
  end loop;
end;
$fin$;

-- ─────────────────────────── the reward trigger learns the shape ───────────────────────────
--
-- Body is 0118's with one arm added. The trigger definition is restated afterwards so re-running
-- this file is idempotent — a second trigger under a different name would not replace the old one,
-- it would pay every settled challenge twice.

create or replace function economy_on_social_challenge_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $econ$
declare
  v_days int;
  v_scope int;
  v_loser uuid;
  v_winner_name text;
  v_loser_name text;
  v_field uuid[];
  v_uid uuid;
  v_payload jsonb;
  -- The per-racer standings row the placement arm reads back (0127).
  v_row record;
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  v_days := greatest(1, ceil(new.window_hours / 24.0)::int);

  if new.mode = 'h2h' then
    v_scope := 1;
    if new.winner_id is not null then
      v_payload := grant_reward(new.winner_id, 'friend_h2h', 1.0, v_days, v_scope, 0.0, true, new.id);
      update challenge_participants
         set reward_payload = v_payload
       where challenge_id = new.id and user_id = new.winner_id;

      -- The loser still finished the thing. Completion band only — placement 1.0 is last place.
      v_loser := case when new.winner_id = new.created_by then new.opponent_id else new.created_by end;
      v_payload := grant_reward(v_loser, 'friend_h2h', 1.0, v_days, v_scope, 1.0, true, new.id);
      update challenge_participants
         set reward_payload = v_payload
       where challenge_id = new.id and user_id = v_loser;

      select display_name into v_winner_name from profiles where id = new.winner_id;
      select display_name into v_loser_name from profiles where id = v_loser;

      -- Two events, not one broadcast: the copy differs, and more importantly the ACTOR differs.
      -- Each side's leading art is the OTHER person's face.
      perform notify_event(
        array[new.winner_id], 'challenge_won',
        'You won',
        case when v_loser_name is not null then 'You beat ' || v_loser_name || '.' else 'You took the challenge.' end,
        v_loser, new.id,
        '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
        null, null,
        jsonb_build_object('mode', new.mode, 'outcome', 'won')
      );

      perform notify_event(
        array[v_loser], 'challenge_lost',
        'Challenge over',
        case when v_winner_name is not null then v_winner_name || ' edged it. Rematch?' else 'Rematch?' end,
        new.winner_id, new.id,
        '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
        null, null,
        jsonb_build_object('mode', new.mode, 'outcome', 'lost')
      );
    end if;
  elsif new.shape = 'placement' then
    -- ─────────────── PLACEMENT: paid by the band actually finished in ───────────────
    --
    -- The collective arm below hands every racer a flat p_placement_pct of 0.75, and 0118's own
    -- comment is candid about why: "Real percentile placement needs the per-member standings 0111
    -- now writes; wiring grant_reward to final_percentile is a reward-tuning change and stays out
    -- of a bugfix pass, so everyone still lands on the completion band rather than being handed a
    -- guessed rank."
    --
    -- For a placement race that guess is not a conservative default, it is the erasure of the
    -- entire shape — mock 114's result screen is a percentile band and a reward scaled to it. So
    -- this arm reads the real figure. It can, because finalize_social_challenges' placement arm
    -- (0127) writes the standings BEFORE the status flip that fires this trigger, unlike the
    -- collective arm.
    --
    -- 🔒 THE FIREWALL IS INTACT. grant_reward is still the only thing that decides or moves a
    -- reward; this passes it a truer input than 0.75 and captures what it returns. Nothing here
    -- computes a payout, and the client still re-derives none of it.
    --
    -- INVERTED: final_percentile is stored top-is-1.0 (0111), grant_reward's p_placement_pct is
    -- top-is-0.0. Passing it through unturned would pay the champion the last-place band — the
    -- same inversion the reveal screen performs for placementTier(), in the other direction.
    if new.circle_id is null then return new; end if;

    select coalesce(array_agg(p.user_id), '{}') into v_field
    from challenge_participants p
    where p.challenge_id = new.id and p.state = 'accepted';

    v_scope := coalesce(array_length(v_field, 1), 0);
    if v_scope = 0 then return new; end if;

    for v_row in
      select p.user_id, p.final_percentile, p.final_value
      from challenge_participants p
      where p.challenge_id = new.id and p.state = 'accepted'
        and p.final_rank is not null and p.final_value > 0
    loop
      -- Scope is the WHOLE field, not just the movers: placing 5th out of 48 is a bigger result
      -- than placing 5th out of 6, and that is exactly what grant_reward's log(scope) term is for.
      v_payload := grant_reward(
        v_row.user_id, 'campfire_group', 1.0, v_days, greatest(v_scope, 1),
        greatest(0, least(1, 1 - coalesce(v_row.final_percentile, 0))),
        true, new.id);
      update challenge_participants p
         set reward_payload = v_payload
       where p.challenge_id = new.id and p.user_id = v_row.user_id;
    end loop;

    -- Every racer is told, including the ones who did not move — their result is a rank, and a
    -- ranked board that only notifies its top half is a leaderboard people stop believing.
    perform notify_event(
      v_field,
      'campfire_settled',
      'Placement race settled',
      'The board is final — see where you landed.',
      null, new.circle_id,
      '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
      null, 'rounded',
      jsonb_build_object('challenge_id', new.id, 'mode', new.mode, 'shape', 'placement')
    );

  else
    if new.circle_id is null then return new; end if;

    if exists (select 1 from challenge_participants p where p.challenge_id = new.id) then
      select coalesce(array_agg(f.user_id), '{}') into v_field
      from challenge_field(new.id, new.circle_id) f;
    else
      select coalesce(array_agg(distinct s.user_id), '{}') into v_field
      from lock_in_sessions s
      join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
      where s.status = 'completed'
        and s.started_at >= new.starts_at
        and s.started_at <= coalesce(new.ends_at, now())
        and extract(epoch from (s.last_confirmed_at - s.started_at))
            >= (select value::int from economy_config where key = 'lock_in_min_seconds');
    end if;

    v_scope := coalesce(array_length(v_field, 1), 0);
    if v_scope = 0 then return new; end if;

    -- Real percentile placement needs the per-member standings 0111 now writes; wiring
    -- grant_reward to final_percentile is a reward-tuning change and stays out of a bugfix pass,
    -- so everyone still lands on the completion band rather than being handed a guessed rank.
    foreach v_uid in array v_field
    loop
      v_payload := grant_reward(v_uid, 'campfire_group', 1.0, v_days, greatest(v_scope, 1), 0.75, true, new.id);
      -- A no-op for a pre-0096 challenge with no roster: v_field was derived from lock-in sessions
      -- there, and the reward is still paid — there is simply no row to record it on, which is
      -- exactly the case get_challenge_reward's empty return already covers.
      update challenge_participants
         set reward_payload = v_payload
       where challenge_id = new.id and user_id = v_uid;
    end loop;

    -- One event to every participant. No actor: a campfire challenge settling is the campfire's
    -- doing, not any one member's, so it leads with the campfire rather than a face.
    perform notify_event(
      v_field,
      'campfire_settled',
      'Campfire challenge settled',
      'Your rewards are ready to collect.',
      null, new.circle_id,
      '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
      null, 'rounded',
      jsonb_build_object('challenge_id', new.id, 'mode', new.mode)
    );
  end if;

  return new;
end;
$econ$;

drop trigger if exists social_challenges_economy on social_challenges;
create trigger social_challenges_economy
  after update of status on social_challenges
  for each row execute function economy_on_social_challenge_closed();
