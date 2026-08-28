-- 0122 — an H2H draw where both sides actually competed now pays BOTH the winner's reward.
--
-- ─────────────────────────── what was already true ───────────────────────────
--
-- GROUP TIES: correct already, verified rather than assumed. finalize_social_challenges ranks the
-- field with `rank() over (order by ... desc)`, so two members on the same score share a placement
-- (two at 40 km -> both rank 1, the next is rank 3) and placement_multiplier pays off that shared
-- number. The reward trigger goes further and hands every finisher the same completion band
-- regardless of placement, so a group tie could not pay unequally even if it wanted to. NO CHANGE.
--
-- H2H DRAWS: broken, and the comment saying so was deliberate. 0034 wrote "A draw pays nobody" to
-- stop a deliberate tie being the safest way to play a duel, and 0111/0112 carried it forward.
-- The cost is that two people who raced hard to a dead heat get nothing at all — the XP award is
-- skipped, and the reward trigger's whole h2h arm is inside `if new.winner_id is not null`, so no
-- box, no embers, no notification, and no reward_payload for the reveal screen to read.
--
-- The fix keeps the anti-collusion property that mattered: a tie pays only when BOTH sides put a
-- real number on the board. 0 - 0 is still worth nothing, so agreeing to do nothing remains the
-- one tie that cannot be farmed.
--
-- ─────────────────────────── 1 · the sweep ───────────────────────────
--
-- 0112's body verbatim apart from the h2h payout block. Restated in full rather than patched
-- because Postgres has no way to replace part of a function, and 0112's own header explains why
-- the FOR UPDATE on the driving cursor is the idempotency guarantee — that must not be lost in a
-- re-type.
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

      -- CHANGED FROM 0112. A draw used to pay nobody. It now pays BOTH — but only a draw with a
      -- real number on it. `v_my > 0` with `v_my = v_opp` is the whole guard: a 0 - 0 no-show is
      -- still worth nothing, so "agree to both do nothing" is not a payout strategy, while
      -- "we both did 40 km" is a good fight and is paid like one.
      --
      -- winner_id stays NULL on a tie. It is the record of who won, and nobody did; the payout
      -- reads the scores, not that column.
      if v_winner is not null then
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        values (v_winner, r.payout_xp, 'challenge_h2h_winner', r.id);
      elsif v_my = v_opp and v_my > 0 and r.opponent_id is not null then
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        values (r.created_by,  r.payout_xp, 'challenge_h2h_winner', r.id),
               (r.opponent_id, r.payout_xp, 'challenge_h2h_winner', r.id);
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
        -- the same target. rank() — not row_number() — is what makes a group tie share a
        -- placement and therefore share a reward.
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

-- ─────────────────────────── 2 · the reward trigger ───────────────────────────
--
-- 0118's body verbatim apart from the new tie branch on the h2h arm. Everything else — the group
-- arm, the roster/legacy field derivation, the reward_payload writes 0118 added, the campfire
-- notification — is untouched.
--
-- HOW THE TIE IS DETECTED HERE. winner_id is null on a tie, and it is also null on an h2h that
-- expired without either side doing anything. The two are told apart by the SCORES, exactly as
-- the sweep does:
--   · with a roster (every challenge since 0096) — challenge_participants.final_value, which the
--     sweep has just written inside this same transaction.
--   · without one — recomputed with social_challenge_score, the same call the sweep's no-roster
--     branch makes, so the two can never disagree about what the scores were.
-- Both equal AND above zero pays both. Anything else is left exactly as it was: unpaid.
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
  v_a numeric;
  v_b numeric;
  v_a_name text;
  v_b_name text;
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

    elsif new.opponent_id is not null then
      -- NEW IN 0122 — the draw branch.
      select
        max(case when p.user_id = new.created_by  then p.final_value end),
        max(case when p.user_id = new.opponent_id then p.final_value end)
        into v_a, v_b
      from challenge_participants p
      where p.challenge_id = new.id;

      if v_a is null or v_b is null then
        v_a := social_challenge_score(new.created_by,  new.race_metric, new.starts_at, new.ends_at);
        v_b := social_challenge_score(new.opponent_id, new.race_metric, new.starts_at, new.ends_at);
      end if;

      if v_a = v_b and v_a > 0 then
        -- Both get the WINNER's placement (0.0 = first), not the loser's completion band. That is
        -- the whole point: a dead heat is two firsts, not two consolation prizes.
        v_payload := grant_reward(new.created_by, 'friend_h2h', 1.0, v_days, v_scope, 0.0, true, new.id);
        update challenge_participants
           set reward_payload = v_payload
         where challenge_id = new.id and user_id = new.created_by;

        v_payload := grant_reward(new.opponent_id, 'friend_h2h', 1.0, v_days, v_scope, 0.0, true, new.id);
        update challenge_participants
           set reward_payload = v_payload
         where challenge_id = new.id and user_id = new.opponent_id;

        select display_name into v_a_name from profiles where id = new.created_by;
        select display_name into v_b_name from profiles where id = new.opponent_id;

        -- Same event TYPE as a win so it files under Challenges and renders with the win's art;
        -- the payload says `draw`, which is what the reveal screen branches on.
        perform notify_event(
          array[new.created_by], 'challenge_won',
          'Dead even',
          case when v_b_name is not null
               then 'You and ' || v_b_name || ' finished level. You both get the win.'
               else 'You finished level. You both get the win.' end,
          new.opponent_id, new.id,
          '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
          null, null,
          jsonb_build_object('mode', new.mode, 'outcome', 'draw')
        );

        perform notify_event(
          array[new.opponent_id], 'challenge_won',
          'Dead even',
          case when v_a_name is not null
               then 'You and ' || v_a_name || ' finished level. You both get the win.'
               else 'You finished level. You both get the win.' end,
          new.created_by, new.id,
          '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
          null, null,
          jsonb_build_object('mode', new.mode, 'outcome', 'draw')
        );
      end if;
    end if;
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
    -- This is ALSO why a group tie needs no work here — everyone in the field is already paid
    -- identically, tied or not.
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

-- Trigger definition unchanged from 0089/0112/0118 — same NAME and same `of status` clause,
-- restated so re-running this file is idempotent. A second trigger under a different name would
-- not replace it, it would pay every settled challenge twice.
drop trigger if exists social_challenges_economy on social_challenges;
create trigger social_challenges_economy
  after update of status on social_challenges
  for each row execute function economy_on_social_challenge_closed();
