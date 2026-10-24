-- 0263 — the challenge reads carry lockin_goal_type, so a gym race is labelled "Most gym time".
--
-- 0247 made a lockin_time race count only its own kind (gym or study) and stored that scope on
-- social_challenges.lockin_goal_type, but neither read the app renders challenges from returns it:
-- get_my_social_challenges (cards, challenge info, manage sheet) and get_challenge_watch (the watch
-- screen). So every gym race was labelled with the generic "Most lock-in time" — read by Noah as
-- "most overall time" — even though it was scored on gym lock-ins only.
--
-- Both functions RETURN TABLE, so adding an output column changes the return type: CREATE OR
-- REPLACE cannot do it, they are dropped and recreated (see MIGRATIONS.md). Bodies are the LIVE
-- prod bodies (pg_get_functiondef, 2026-10-24) with exactly one column appended to each — not
-- restated from an older migration. Installed builds ignore the extra column.
--
-- Grants are restored to what prod held before the drop: EXECUTE for PUBLIC, anon, authenticated
-- and service_role on both (a recreated function gets PUBLIC by default; the rest are explicit).

drop function if exists public.get_my_social_challenges();
drop function if exists public.get_challenge_watch(uuid);

CREATE FUNCTION public.get_my_social_challenges()
 RETURNS TABLE(id uuid, circle_id uuid, circle_name text, circle_emoji text, created_by uuid, created_by_name text, mode text, opponent_id uuid, opponent_name text, race_metric text, my_score numeric, opponent_score numeric, target_count integer, member_count integer, completed_count integer, window_hours integer, starts_at timestamp with time zone, ends_at timestamp with time zone, status text, winner_id uuid, payout_xp integer, created_at timestamp with time zone, public_name text, shape text, invited_count integer, accepted_count integer, my_state text, grade_target numeric, course_code text, my_reported_value numeric, my_final_rank integer, my_final_percentile numeric, my_awarded_xp integer, my_reward_payload jsonb, difficulty_tier text, verifiability text, target_value numeric, pooled boolean, reward_top_contributor boolean, lockin_goal_type text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- VIEWER-RELATIVE, and that is the whole contract of the pair: "my" is whoever is asking, so
    -- the opponent of a duel sees the same race from their own side without the client swapping
    -- anything. A grade race reads from the roster instead of the clock — there is nothing
    -- accumulating to window.
    case
      when sc.mode <> 'h2h' or challenge_is_awaiting(sc.status) then null
      when sc.race_metric = 'grade' then (
        select p.reported_value from challenge_participants p
        where p.challenge_id = sc.id
          and p.user_id = case when auth.uid() = sc.opponent_id then sc.opponent_id else sc.created_by end)
      else social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.opponent_id else sc.created_by end,
        sc.race_metric, sc.starts_at, sc.ends_at, sc.lockin_goal_type)
    end as my_score,
    case
      when sc.mode <> 'h2h' or challenge_is_awaiting(sc.status) then null
      when sc.race_metric = 'grade' then (
        select p.reported_value from challenge_participants p
        where p.challenge_id = sc.id
          and p.user_id = case when auth.uid() = sc.opponent_id then sc.created_by else sc.opponent_id end)
      else social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.created_by else sc.opponent_id end,
        sc.race_metric, sc.starts_at, sc.ends_at, sc.lockin_goal_type)
    end as opponent_score,
    sc.target_count,
    -- THE FIELD, not the campfire (0112). Was `count(*) from group_members` — the same denominator
    -- 0111 removed from settlement, and the reason a subset race read "2 / 30 done" on its card.
    case when sc.mode = 'group'
      then (select count(*)::int from challenge_field(sc.id, sc.circle_id)) else null end as member_count,
    -- Routed through challenge_racer_completed so the card's "N / M done" and the sweep's
    -- all-or-nothing gate ask the same question. They were two spellings of one rule, which is how
    -- a card can say everyone finished while the sweep expires the challenge.
    case when sc.mode = 'group' then (
      select count(*)::int from challenge_field(sc.id, sc.circle_id) f
      where challenge_racer_completed(sc.id, f.user_id)
    ) else null end as completed_count,
    sc.window_hours,
    sc.starts_at,
    sc.ends_at,
    sc.status,
    sc.winner_id,
    sc.payout_xp,
    sc.created_at,
    sc.public_name,
    sc.shape,
    (select count(*)::int from challenge_participants cp where cp.challenge_id = sc.id and cp.state = 'invited') as invited_count,
    (select count(*)::int from challenge_participants cp where cp.challenge_id = sc.id and cp.state = 'accepted') as accepted_count,
    (select cp.state from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_state,
    sc.grade_target,
    sc.course_code,
    (select cp.reported_value from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_reported_value,
    (select cp.final_rank from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_final_rank,
    (select cp.final_percentile from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_final_percentile,
    -- Unfiltered by status on purpose: bonus_xp_awards only ever holds settled awards, so gating
    -- this on challenge_is_settled would add a condition that can never change the answer while
    -- giving a future reader the impression that it can.
    (select coalesce(sum(b.amount), 0)::int from bonus_xp_awards b
      where b.challenge_id = sc.id and b.user_id = auth.uid()) as my_awarded_xp,
    (select cp.reward_payload from challenge_participants cp
      where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_reward_payload,
    sc.difficulty_tier,
    sc.verifiability,
    -- 0241 · the client could not tell a pooled total (or any measured bar) from a counted one
    -- without these, and rendered "0/1".
    sc.target_value,
    sc.pooled,
    sc.reward_top_contributor,
    -- 0263 · which lock-ins a lockin_time race counts, so the label can say "Most gym time".
    sc.lockin_goal_type
  from social_challenges sc
  -- left join: an h2h challenge with nobody watching has a null circle_id — an inner join here
  -- would silently drop it out of the result set entirely (migration 0032).
  left join groups g on g.id = sc.circle_id
  join profiles creator on creator.id = sc.created_by
  left join profiles opp on opp.id = sc.opponent_id
  where (
    (sc.mode = 'group' and is_group_member(sc.circle_id))
    or sc.created_by = auth.uid()
    or sc.opponent_id = auth.uid()
  )
    and sc.status != 'declined'
    -- A DRAFT IS PRIVATE UNTIL SOMEONE IS INVITED (0097).
    and (not challenge_is_draft(sc.status) or sc.created_by = auth.uid())
  order by
    (challenge_is_awaiting(sc.status) and sc.opponent_id = auth.uid()) desc,
    sc.created_at desc;
end;
$function$;

CREATE FUNCTION public.get_challenge_watch(p_challenge_id uuid)
 RETURNS TABLE(challenge_id uuid, mode text, race_metric text, target_count integer, window_hours integer, starts_at timestamp with time zone, ends_at timestamp with time zone, status text, created_by uuid, created_by_name text, created_by_score numeric, created_by_live_status text, created_by_cheers integer, opponent_id uuid, opponent_name text, opponent_score numeric, opponent_live_status text, opponent_cheers integer, has_cheered boolean, cheered_for uuid, lockin_goal_type text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    social_challenge_score(v_challenge.created_by, v_challenge.race_metric, v_challenge.starts_at, v_challenge.ends_at, v_challenge.lockin_goal_type),
    live_status(v_challenge.created_by),
    v_challenge.created_by_cheers,
    v_challenge.opponent_id,
    opp.display_name,
    case when v_challenge.opponent_id is not null
      then social_challenge_score(v_challenge.opponent_id, v_challenge.race_metric, v_challenge.starts_at, v_challenge.ends_at, v_challenge.lockin_goal_type)
      else null end,
    case when v_challenge.opponent_id is not null then live_status(v_challenge.opponent_id) else null end,
    v_challenge.opponent_cheers,
    v_cheered_for is not null,
    v_cheered_for,
    -- 0263 · see get_my_social_challenges.
    v_challenge.lockin_goal_type
  from profiles creator
  left join profiles opp on opp.id = v_challenge.opponent_id
  where creator.id = v_challenge.created_by;
end;
$function$;

grant execute on function public.get_my_social_challenges() to anon, authenticated, service_role;
grant execute on function public.get_challenge_watch(uuid) to anon, authenticated, service_role;

-- ─────────────────────────── self-check ───────────────────────────

do $assert$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'get_my_social_challenges'
                    and 'lockin_goal_type' = any (p.proargnames)) then
    raise exception '0263: get_my_social_challenges does not return lockin_goal_type';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'get_challenge_watch'
                    and 'lockin_goal_type' = any (p.proargnames)) then
    raise exception '0263: get_challenge_watch does not return lockin_goal_type';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('get_my_social_challenges', 'get_challenge_watch')) <> 2 then
    raise exception '0263: expected exactly one of each function';
  end if;
  if not has_function_privilege('authenticated', 'public.get_my_social_challenges()', 'execute')
     or not has_function_privilege('authenticated', 'public.get_challenge_watch(uuid)', 'execute') then
    raise exception '0263: authenticated lost execute';
  end if;
end;
$assert$;
