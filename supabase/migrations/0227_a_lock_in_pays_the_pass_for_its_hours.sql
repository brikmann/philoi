-- 0227 — A lock-in pays the Emberfall Pass for the hours it took.
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- The Pass only paid discrete achievements: the dailies, weeklies and season milestones top out
-- around 33k XP over the season, and L100 is 85,000 (SEASON_XP_TOTAL in forge-pass.ts). Normal
-- lock-ins did not move the bar, so the Pass could not be finished by doing the thing the app is for.
--
-- ─────────────────────────────── WHAT CHANGES ───────────────────────────────
--
-- 1. THE BASE RATE. Every completed lock-in credits 'lock_in_time' Pass XP =
--    round(250 × credited hours), inside economy_on_lock_in_completed (the lock_in_sessions_economy
--    trigger). The seconds are the ones that trigger already reads since 0188 —
--    check_ins.duration_seconds through ended_check_in_id, pause-aware since 0218 — so rank XP,
--    embers and the Pass all pay for the same time. 1h = 250, which is L1's whole cost.
--      · idempotent per check-in: period_key = the ended check-in's id, and pass_xp_ledger is
--        unique on (user, achievement, period), so a re-fired trigger cannot pay twice;
--      · season-gated: economy_credit_pass_xp_for writes nothing unless season_phase() = 'live';
--      · floored at lock_in_min_seconds (300s), the same floor every Pass achievement uses, so
--        start/stop spam earns nothing;
--      · the rate is economy_config('pass_xp_per_lock_in_hour'), tunable without a migration.
--        LOCK_IN_PASS_XP_PER_HOUR in forge-pass.ts mirrors it for copy only — the Done screen
--        shows the ledger row this trigger wrote (get_lock_in_pass_credit), never a client estimate.
--
-- 2. THE RANK-UP BONUS IS RETIRED. 'season_new_rank' paid a flat 500 once a season however many
--    ranks someone climbed. 0231's rank crate now pays Pass XP per rung (200 → 2,500), scaled to the
--    rung, so a flat 500 beside it would double-pay. The credit is removed here rather than in 0231
--    so no window in the ordered push pays it. Existing 'S1' rows keep their XP.
--
-- 3. get_lock_in_pass_credit(check_in_id) — the Done screen's read: this session's credit, what
--    else the same Stop credited, and the season total it landed in, straight from the ledger.
--
-- Installed builds: a ledger row with an unknown achievement_key is ignored by the old Pass screen
-- (AchievementList builds a Set of keys and only renders ACHIEVEMENTS), and pass_xp is just a
-- bigger number. Nothing an old build reads changes shape.
--
-- NOT changed: get_inventory still returns every S1 ledger row in pass.achievements, so that array
-- now grows by one per lock-in (~80 bytes each). Fine at pilot scale; filter it if it ever matters.

-- ── base check · both bodies restated below are restated from the LIVE prosrc (2026-10-05) ──
do $base$
declare
  v_expect constant jsonb := jsonb_build_object(
    'economy_on_lock_in_completed', 'e7e0c1022dba546fba9990113afcafef',
    'economy_track_rank_change',    '8117478bfac0d7d42543fb54051db8f0'
  );
  v_name text;
  v_live text;
begin
  for v_name in select jsonb_object_keys(v_expect) loop
    -- CR-stripped: economy_track_rank_change was applied from a CRLF checkout.
    select md5(replace(p.prosrc, chr(13), '')) into v_live
    from pg_proc p where p.proname = v_name and p.pronamespace = 'public'::regnamespace;
    if v_live is distinct from v_expect ->> v_name then
      raise exception '0227: live % changed since this file was drafted (md5 %) — rebase onto it', v_name, v_live;
    end if;
  end loop;
end;
$base$;

insert into economy_config (key, value)
values ('pass_xp_per_lock_in_hour', '250'::jsonb)
on conflict (key) do nothing;

-- ═══════════════════════════════ 1 · the base rate ═══════════════════════════════
-- Restated from LIVE prosrc (0188's body). Edits marked 0227.

create or replace function public.economy_on_lock_in_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_seconds int;
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
  -- 0227
  v_min int := coalesce((select value::int from economy_config where key = 'lock_in_min_seconds'), 300);
  v_rate int := coalesce((select value::int from economy_config where key = 'pass_xp_per_lock_in_hour'), 250);
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  -- 0188: was `last_confirmed_at − started_at`, which is 0 on almost every real session.
  select c.duration_seconds into v_seconds
  from check_ins c
  where c.id = new.ended_check_in_id and c.removed_at is null;
  v_seconds := greatest(0, coalesce(v_seconds, 0));

  perform economy_award_lock_in_embers(new.user_id, v_seconds, new.id);

  -- 0227: the Pass base rate — 250 × credited hours, once per check-in. See the header.
  if v_seconds >= v_min and round(v_seconds * v_rate / 3600.0) > 0 then
    perform economy_credit_pass_xp_for(
      new.user_id, 'lock_in_time', round(v_seconds * v_rate / 3600.0)::int, new.ended_check_in_id::text
    );
  end if;

  perform evaluate_pass_achievements(new.user_id);

  if economy_locked_in_with_friend(new.user_id) then
    perform economy_credit_pass_xp_for(
      new.user_id, 'daily_with_a_friend', 50, to_char(now(), 'YYYY-MM-DD')
    );
  end if;

  return new;
end;
$function$;

-- ═══════════════════════════════ 2 · the rank-up bonus ═══════════════════════════════
-- Restated from LIVE prosrc (0121's body). One edit, marked 0227.

create or replace function public.economy_track_rank_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_score numeric;
  v_index int;
  v_prev int;
  v_from record;
  v_to record;
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
  v_kind text;
  v_reward rank_up_rewards;
  v_div text;
  v_label text;
begin
  v_score := universal_score(new.user_id);
  v_index := rank_index_for_score(v_score);
  if v_index is null then return new; end if;

  select rank_index into v_prev from user_rank_state where user_id = new.user_id;

  insert into user_rank_state (user_id, rank_index) values (new.user_id, v_index)
  on conflict (user_id) do update
    set rank_index = greatest(user_rank_state.rank_index, excluded.rank_index),
        updated_at = now();

  -- First sighting establishes the baseline without claiming a rank-up for the whole history.
  if v_prev is null or v_index <= v_prev then return new; end if;

  select tier, division into v_to   from rank_thresholds where rank_index = v_index;
  select tier, division into v_from from rank_thresholds where rank_index = v_prev;

  insert into rank_up_events (user_id, from_rank_index, to_rank_index,
                              from_tier, from_division, to_tier, to_division, season_id)
  values (new.user_id, v_prev, v_index, v_from.tier, v_from.division,
          v_to.tier, v_to.division, v_season);

  -- 0227: the flat 'season_new_rank' 500 Pass XP that lived here is retired — 0231's rank crate
  -- pays Pass XP per rung instead.

  -- ───────────────── the reward ─────────────────
  v_kind := case
    when v_to.tier = 'primordial' then 'primordial'
    when v_to.tier <> v_from.tier then 'tier'
    else 'division'
  end;

  select * into v_reward from rank_up_rewards where kind = v_kind;
  -- A missing config row must not take the check-in down with it: the rank-up is still recorded
  -- and the XP still credited above, there is simply nothing to pay.
  if v_reward.kind is null then return new; end if;

  -- Primordial carries no division (0063 stores it as 1 purely so the ordinal still sorts above
  -- Immortal I); every other tier is III/II/I, lowest to highest.
  v_div := case when v_to.tier = 'primordial'
                then ''
                else ' ' || (array['', 'I', 'II', 'III'])[v_to.division + 1] end;
  v_label := initcap(v_to.tier) || v_div;

  if v_reward.embers > 0 then
    perform economy_move_embers(new.user_id, v_reward.embers, 'season_reward'::ember_reason, null);
  end if;

  insert into loot_boxes (user_id, box_key, obtained_via, provenance)
  values (new.user_id, v_reward.box_key, 'season'::box_obtained_via,
          'Rank-up reward · ' || v_label);

  -- ───────────────── the bell row + reveal payload ─────────────────
  -- actor_id null for the same reason as 0120's recap: notify_event drops any recipient equal to
  -- the actor, so a self-notification with the user as actor writes nothing at all.
  -- Routed to /inventory because that is where the unopened box now sits — the reveal screen
  -- reads `payload` for what to animate before sending them there.
  perform notify_event(
    array[new.user_id], 'ranked_up',
    '⚔️ You ranked up — ' || v_label,
    case v_kind
      when 'primordial' then 'You reached Primordial. The king himself bows toward your greatness.'
      when 'tier'       then 'A new tier. +' || v_reward.embers || ' embers and a box are waiting.'
      else                   'Up a division. +' || v_reward.embers || ' embers and a box are waiting.'
    end,
    null, null,
    '/inventory', '{}'::jsonb,
    null, 'hexagon',
    jsonb_build_object('embers', v_reward.embers, 'box', v_reward.box_key,
                       'rank', v_label, 'kind', v_kind,
                       'from_rank_index', v_prev, 'to_rank_index', v_index)
  );

  return new;
end;
$function$;

-- ═══════════════════════════════ 3 · the Done screen's read ═══════════════════════════════

-- What THIS lock-in credited to the Pass, and the season total it landed in. Null when nothing was
-- credited (under the floor, season not live), which the Done screen renders as no Pass line.
--
-- bonus_xp: everything else the same Stop credited — achievements it unlocked, a rank-up. All of it
-- is written in stop_lock_in_session's one transaction, so it shares the base row's created_at
-- (now() is the transaction start). Without it the bar would animate from `pass_xp − xp` and start
-- above where the user actually was.
create or replace function public.get_lock_in_pass_credit(p_check_in_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'xp', l.xp,
    'bonus_xp', coalesce((
      select sum(o.xp) from pass_xp_ledger o
      where o.user_id = l.user_id and o.season_id = l.season_id
        and o.created_at = l.created_at and o.id <> l.id
    ), 0),
    'season_id', l.season_id,
    'pass_xp', coalesce(f.pass_xp, 0)
  )
  from pass_xp_ledger l
  left join forge_pass_state f on f.user_id = l.user_id and f.season_id = l.season_id
  where l.user_id = auth.uid()
    and l.achievement_key = 'lock_in_time'
    and l.period_key = p_check_in_id::text;
$$;

revoke all on function public.get_lock_in_pass_credit(uuid) from public, anon;
grant execute on function public.get_lock_in_pass_credit(uuid) to authenticated;

-- ═══════════════════════════════ ASSERT ═══════════════════════════════
do $assert$
begin
  -- Both triggers still call the replaced functions.
  if not exists (
    select 1 from pg_trigger
    where tgname = 'lock_in_sessions_economy' and tgfoid = 'economy_on_lock_in_completed()'::regprocedure
  ) then
    raise exception '0227: lock_in_sessions_economy no longer calls economy_on_lock_in_completed';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'on_check_in_rank_tracking' and tgfoid = 'economy_track_rank_change()'::regprocedure
  ) then
    raise exception '0227: on_check_in_rank_tracking no longer calls economy_track_rank_change';
  end if;

  -- The rate the trigger reads exists and is the one the client copy mirrors.
  if (select value::int from economy_config where key = 'pass_xp_per_lock_in_hour') is distinct from 250 then
    raise exception '0227: pass_xp_per_lock_in_hour is not 250';
  end if;

  -- The read resolves (sql bodies bind at call time) and is not reachable without a session.
  perform get_lock_in_pass_credit(gen_random_uuid());
  if has_function_privilege('anon', 'get_lock_in_pass_credit(uuid)'::regprocedure, 'EXECUTE') then
    raise exception '0227: anon can call get_lock_in_pass_credit';
  end if;
  if has_function_privilege('authenticated', 'economy_credit_pass_xp_for(uuid,text,integer,text)'::regprocedure, 'EXECUTE') then
    raise exception '0227: economy_credit_pass_xp_for is client-callable';
  end if;
end;
$assert$;
