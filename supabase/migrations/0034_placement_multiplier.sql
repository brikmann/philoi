-- Percentile placement multiplier (CODE_BUILD_PROMPTS.md reward-design rules, "PLACEMENT
-- MULTIPLIER (group challenges) — do it right"). A group challenge stays "all or nothing" as
-- the completion gate (unchanged — nobody earns anything if the group as a whole misses
-- target_count), but once it succeeds, each member's SHARE of payout_xp now scales with how
-- they placed among the group by verified total, instead of everyone getting the identical flat
-- amount. Ranking is by the qualifying XP total (social_challenge_score, already floor-gated by
-- migration 0033) — never "fastest to goal," which would just reward whoever happened to hit
-- target_count first, not who actually put in more verified effort.

-- Best tier a participant qualifies for among percentile tiers (scale to any board size) and
-- absolute-rank caps (only when that rank is a STRICTER cut than the top-10% line — otherwise a
-- small campfire's "top 10" is meaningless and this correctly degrades to percentile tiers
-- alone; e.g. rank 1 of 10 is already top-10%, so the #1 elite cap only kicks in past 10 people).
create or replace function placement_multiplier(p_rank int, p_total int)
returns numeric
language sql
security definer
set search_path = public
immutable
as $$
  select greatest(
    case
      when p_rank <= ceil(p_total * 0.10) then 1.5
      when p_rank <= ceil(p_total * 0.25) then 1.3
      when p_rank <= ceil(p_total * 0.50) then 1.1
      else 1.0
    end,
    case when p_rank = 1 and p_total > 10 then 3.0 end,
    case when p_rank <= 2 and p_total > 20 then 2.5 end,
    case when p_rank <= 3 and p_total > 30 then 2.3 end,
    case when p_rank <= 10 and p_total > 100 then 2.0 end
  );
$$;

-- Body-only change (same signature) — the group-success branch now ranks members by verified
-- XP total and scales each one's payout by placement_multiplier() instead of a flat award.
create or replace function finalize_social_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_my numeric;
  v_opp numeric;
  v_member_count int;
  v_completed_count int;
begin
  for r in select * from social_challenges where status = 'active' and ends_at <= now() loop
    if r.mode = 'h2h' then
      v_my := social_challenge_score(r.created_by, r.race_metric, r.starts_at, r.ends_at);
      v_opp := social_challenge_score(r.opponent_id, r.race_metric, r.starts_at, r.ends_at);
      update social_challenges
      set status = 'completed', winner_id = case when v_my > v_opp then r.created_by when v_opp > v_my then r.opponent_id else null end
      where id = r.id;
      if v_my != v_opp then
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        values (case when v_my > v_opp then r.created_by else r.opponent_id end, r.payout_xp, 'challenge_h2h_winner', r.id);
      end if;
    else
      select count(*) into v_member_count from group_members where group_id = r.circle_id;
      select count(*) into v_completed_count
      from group_members gm
      where gm.group_id = r.circle_id
        and (
          select count(*) from check_ins ci
          where ci.user_id = gm.user_id and ci.removed_at is null
            and ci.created_at >= r.starts_at and ci.created_at <= r.ends_at
            and check_in_qualifies_for_challenge(ci.id)
        ) >= r.target_count;

      if v_completed_count >= v_member_count and v_member_count > 0 then
        update social_challenges set status = 'completed' where id = r.id;
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        select
          ranked.user_id,
          round(r.payout_xp * placement_multiplier(ranked.placement, v_member_count)),
          'challenge_group_completion',
          r.id
        from (
          select
            gm.user_id,
            rank() over (order by social_challenge_score(gm.user_id, 'xp', r.starts_at, r.ends_at) desc) as placement
          from group_members gm
          where gm.group_id = r.circle_id
        ) ranked;
      else
        update social_challenges set status = 'expired' where id = r.id;
      end if;
    end if;
  end loop;
end;
$$;
