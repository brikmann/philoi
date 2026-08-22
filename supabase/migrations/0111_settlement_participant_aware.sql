-- Handoff B, 0111 — settlement catches up with the 0096 participant model.
--
-- 0096 added challenge_participants with baseline / final_value / final_rank / final_percentile
-- and a comment saying the final figures are "written once at settlement so a result page is a
-- read of what was decided rather than a re-derivation that could drift". Nothing ever wrote
-- them: finalize_social_challenges is still 0034's, from before the table existed. The table
-- being present is not the same as it being used, and three things follow from the gap.
--
-- 1. THE DENOMINATOR IS WRONG. 0034 ranks and pays over `group_members` — every member of the
--    campfire. Since 0096 a group challenge is an invited subset: invite_challenge_members writes
--    participant rows and start_challenge deletes anyone who never answered. So a challenge four
--    people accepted, in a campfire of thirty, settles against thirty — it can essentially never
--    reach "everyone completed", and the placement denominator counts twenty-six people who were
--    never in the race.
--
-- 2. BASELINE IS IGNORED. start_challenge records each participant's metric value at the gun
--    precisely so progress is (now - baseline). 0034 predates it and scores absolute totals, so a
--    challenge credits work done before it started.
--
-- 3. THERE ARE NO STANDINGS TO SHOW. Placements are computed inside the payout subquery and
--    discarded, so a results screen would have to recompute them later against data that has
--    since moved.
--
-- LEGACY IS PRESERVED DELIBERATELY. Every branch below falls back to the exact 0034 behaviour
-- when a challenge has no participant rows. Challenges created before 0096 have none and are
-- mid-flight right now; changing how they pay out after the fact would be rewriting a deal people
-- already entered. New challenges get the participant path. Nothing in the economy changes for
-- anything already running.

-- The accepted field for a challenge, or the legacy whole-campfire set when it has no roster.
-- One definition, because the payout, the completion test and the standings must all agree on who
-- was in the race — three copies of "who counts" is three chances to disagree.
create or replace function challenge_field(p_challenge_id uuid, p_circle_id uuid)
returns table (user_id uuid, baseline numeric)
language sql
security definer
set search_path = public
stable
as $field$
  select p.user_id, p.baseline
  from challenge_participants p
  where p.challenge_id = p_challenge_id and p.state = 'accepted'
  union all
  select gm.user_id, 0::numeric
  from group_members gm
  where gm.group_id = p_circle_id
    and not exists (
      select 1 from challenge_participants p2 where p2.challenge_id = p_challenge_id
    );
$field$;

grant execute on function challenge_field(uuid, uuid) to authenticated;


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
  -- Band, not `status = 'active'`. 0096 widened the vocabulary with 'draft', and a sweep that
  -- tests a literal keeps its old meaning silently when the vocabulary grows.
  for r in select * from social_challenges sc where challenge_is_live(sc.status) and sc.ends_at <= now() loop

    select exists (select 1 from challenge_participants p where p.challenge_id = r.id)
      into v_has_roster;

    if r.mode = 'h2h' then
      if v_has_roster then
        -- Progress since the gun, not lifetime totals: baseline is what start_challenge recorded
        -- at the moment the race began, and the difference is the only figure that describes what
        -- was done DURING it. Evaluated as of ends_at rather than now() so a sweep that runs late
        -- settles the race that was run, not the hours after it.
        select
          coalesce(max(case when p.user_id = r.created_by
            then challenge_metric_value(r.race_metric, p.user_id, r.ends_at) - p.baseline end), 0),
          coalesce(max(case when p.user_id = r.opponent_id
            then challenge_metric_value(r.race_metric, p.user_id, r.ends_at) - p.baseline end), 0)
          into v_my, v_opp
        from challenge_participants p
        where p.challenge_id = r.id and p.state = 'accepted';
      else
        -- 0034's path, unchanged, for duels that predate the roster.
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
                 when v_winner is null then 1                       -- a draw is a shared first
                 when p.user_id = v_winner then 1
                 else 2 end,
               -- Two-person race: the winner takes 1, the loser 0, a draw gives both 1. Same
               -- formula as the group arm below, just with n = 2.
               final_percentile = case
                 when v_winner is null then 1.0
                 when p.user_id = v_winner then 1.0
                 else 0.0 end
         where p.challenge_id = r.id;
      end if;

    else
      -- WHO WAS ACTUALLY IN IT. 0034 counted the whole campfire; since 0096 a group challenge is
      -- an invited subset, so a four-person race inside a thirty-person campfire could never
      -- reach "everyone completed" and paid placement XP to twenty-six non-entrants.
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
                 -- 1.0 for first down to 0.0 for last; a field of one is 1.0 rather than a
                 -- division by zero.
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
        -- written below so an expired challenge can show what happened instead of just vanishing.
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


-- THE RESULTS READ ------------------------------------------------------------------------------
--
-- OUT names are deliberately NOT final_value / final_rank / final_percentile even though those are
-- what the columns are called. Those names would shadow the very columns the body selects, which
-- is the failure that killed get_challenge_watch from 0081 until 0099. Qualifying every reference
-- would also work; picking non-colliding names means a later edit cannot reintroduce it by adding
-- one unqualified reference.

drop function if exists get_challenge_results(uuid);

create function get_challenge_results(p_challenge_id uuid)
returns table (
  member_id uuid,
  member_name text,
  score_value numeric,
  place int,
  percentile numeric,
  awarded_xp int,
  is_winner boolean
)
language plpgsql
security definer
set search_path = public
stable
as $res$
declare
  v_challenge social_challenges;
begin
  select * into v_challenge from social_challenges sc where sc.id = p_challenge_id;
  if v_challenge.id is null then
    raise exception 'Challenge not found.';
  end if;
  if not challenge_is_settled(v_challenge.status) then
    -- Not an access error. A live challenge has no result yet, and returning an empty set here
    -- would let a results screen render "nobody placed" over a race still being run.
    raise exception 'That challenge has not finished yet.';
  end if;
  if not can_watch_challenge(p_challenge_id) then
    raise exception 'You don''t have access to watch this challenge.';
  end if;

  return query
  select
    p.user_id,
    pr.display_name,
    p.final_value,
    p.final_rank,
    p.final_percentile,
    coalesce((
      select sum(b.amount)::int from bonus_xp_awards b
      where b.challenge_id = p_challenge_id and b.user_id = p.user_id
    ), 0),
    v_challenge.winner_id is not null and p.user_id = v_challenge.winner_id
  from challenge_participants p
  join profiles pr on pr.id = p.user_id
  where p.challenge_id = p_challenge_id and p.state = 'accepted'
  -- nulls last so a challenge settled before 0111 (no final_rank written) still lists its field
  -- rather than ordering on nothing.
  order by p.final_rank asc nulls last, pr.display_name asc;
end;
$res$;

grant execute on function get_challenge_results(uuid) to authenticated;
