-- Removes the "solo" social-challenge mode (h2h and group stay) — a solo goal that the
-- campfire can see is already covered by the lock-in flow's own "with the campfire" toggle
-- (PHILOI_UI_SPEC.md §12), so a third, separate solo-challenge concept was redundant. No
-- 'solo' rows existed yet (verified live before writing this migration), so this is a clean
-- narrowing, not a data migration.

drop function if exists create_solo_challenge(uuid, text, int, int);
drop function if exists complete_solo_challenge(uuid);

alter table social_challenges drop constraint if exists social_challenges_mode_check;
alter table social_challenges add constraint social_challenges_mode_check check (mode in ('h2h', 'group'));

alter table social_challenges drop column if exists goal_label;

-- Body-only change (same signature) — drops the solo branch, which can no longer occur.
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
          where ci.user_id = gm.user_id and ci.duration_seconds is not null and ci.removed_at is null
            and ci.created_at >= r.starts_at and ci.created_at <= r.ends_at
        ) >= r.target_count;

      if v_completed_count >= v_member_count and v_member_count > 0 then
        update social_challenges set status = 'completed' where id = r.id;
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        select user_id, r.payout_xp, 'challenge_group_completion', r.id from group_members where group_id = r.circle_id;
      else
        update social_challenges set status = 'expired' where id = r.id;
      end if;
    end if;
  end loop;
end;
$$;

-- Return shape unchanged (goal_label was already nullable in the SELECT, just always null
-- now) — but drop first anyway since the underlying column it referenced is gone.
drop function if exists get_my_social_challenges();

create function get_my_social_challenges()
returns table (
  id uuid,
  circle_id uuid,
  circle_name text,
  circle_emoji text,
  created_by uuid,
  created_by_name text,
  mode text,
  opponent_id uuid,
  opponent_name text,
  race_metric text,
  my_score numeric,
  opponent_score numeric,
  target_count int,
  member_count int,
  completed_count int,
  window_hours int,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  winner_id uuid,
  payout_xp int,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  select
    sc.id,
    sc.circle_id,
    g.name as circle_name,
    g.emoji as circle_emoji,
    sc.created_by,
    creator.display_name as created_by_name,
    sc.mode,
    sc.opponent_id,
    opp.display_name as opponent_name,
    sc.race_metric,
    case when sc.mode = 'h2h' and sc.status != 'pending'
      then social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.opponent_id else sc.created_by end,
        sc.race_metric, sc.starts_at, sc.ends_at)
      else null end as my_score,
    case when sc.mode = 'h2h' and sc.status != 'pending'
      then social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.created_by else sc.opponent_id end,
        sc.race_metric, sc.starts_at, sc.ends_at)
      else null end as opponent_score,
    sc.target_count,
    case when sc.mode = 'group' then (select count(*)::int from group_members where group_id = sc.circle_id) else null end as member_count,
    case when sc.mode = 'group' then (
      select count(*)::int from group_members gm
      where gm.group_id = sc.circle_id
        and (
          select count(*) from check_ins ci
          where ci.user_id = gm.user_id and ci.duration_seconds is not null and ci.removed_at is null
            and ci.created_at >= sc.starts_at and ci.created_at <= coalesce(sc.ends_at, now())
        ) >= sc.target_count
    ) else null end as completed_count,
    sc.window_hours,
    sc.starts_at,
    sc.ends_at,
    sc.status,
    sc.winner_id,
    sc.payout_xp,
    sc.created_at
  from social_challenges sc
  join groups g on g.id = sc.circle_id
  join profiles creator on creator.id = sc.created_by
  left join profiles opp on opp.id = sc.opponent_id
  where (is_group_member(sc.circle_id) or sc.created_by = auth.uid() or sc.opponent_id = auth.uid())
    and sc.status != 'declined'
  order by
    (sc.status = 'pending' and sc.opponent_id = auth.uid()) desc,
    sc.created_at desc;
end;
$$;
