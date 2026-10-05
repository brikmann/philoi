-- 0230 — Rank is a lifetime climb. ⛰
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- Decision (Noah, launch-gating): rank no longer resets or decays. It is a PURE LIFETIME CLIMB on
-- the 0203 multi-year thresholds (Primordial ~2,500 h); the Flame Pass carries all seasonal cadence.
-- The "climb fits one season" ladder-restore that was queued behind this is NOT applied.
--
-- 0190 built the opposite: a live seat, live_rank_xp = universal_score + ladder_offset, moved by
-- two daily crons —
--   · philoi-rank-consistency-week   → run_rank_consistency_sweep(): weekly bonus (+) / decay (−)
--   · philoi-rank-ladder-season-reset → apply_season_ladder_reset(): a 3-division soft reset at
--     every season change. This IS the seasonal rank rollover; it had not fired yet only because
--     every user_ladder_state row is stamped S1 and S1 is still the current season.
-- 0225 then pointed every badge except your own chip at live_rank_xp. Your own chip (get_my_ranks)
-- reads universal_score. So any non-zero offset is a tier the Agora can show and your chip cannot.
--
-- ─────────────────────────────── STATE ON PROD (2026-10-05) ───────────────────────────────
--
-- Decay has never fired: no 'slipped' / 'relegated' / 'season_reset' row exists, no negative
-- offset exists. ONE user carries a positive offset of +862.70 from consistency bonuses, which does
-- not change their tier today (rank index 7 either way) but would lead their chip by a tier the
-- next time their lifetime score sat within 862 XP below a boundary.
--
-- ─────────────────────────────── WHAT CHANGES ───────────────────────────────
--
--   1. rank_consistency → enabled / decay_enabled / season_reset_enabled all false. Both sweeps
--      then return 'disabled' before reading a row. The bonus is frozen too: it is what made
--      live_rank_xp drift from universal_score, and "dormant" means the offset never moves again.
--   2. Both 0190 crons unscheduled. No rank-reset cron remains.
--   3. Every existing offset is folded back to 0 — ONLY where that leaves the shown tier where it
--      is, asserted per user before the write. Each fold is a rank_ladder_events row, so 0190's
--      invariant (sum of xp_delta per user = ladder_offset) still holds.
--   4. A trigger on user_ladder_state refuses any write that lowers ladder_offset (or inserts one
--      below 0). Belt and braces for whoever re-enables 0190 by an UPDATE: rank can no longer move
--      down through this table at all.
--
-- After this, live_rank_xp(u) == universal_score(u) for every user, so the chip, the Agora, every
-- leaderboard and get_user_rank agree by construction.
--
-- NOT touched, on purpose: universal_score; rank_thresholds (0203 stays live); user_rank_state
-- (the peak); the live_rank_xp / ladder_offset / get_my_ladder_status machinery (left in place,
-- dormant); every 0225 body; economy_track_rank_change; the season placement-close jobs.
--
-- NOTE: no explicit begin/commit — the migration runs in its own transaction.


-- ═══════════════════════════════ 1 · CONFIG ═══════════════════════════════

update economy_config
   set value = value || '{"enabled": false, "decay_enabled": false, "season_reset_enabled": false}'::jsonb,
       updated_at = now()
 where key = 'rank_consistency';

-- 0190 inserts this row with `on conflict do nothing`; if it were ever absent, the function's
-- shipped defaults (all true) would apply, so the row must exist for the update to mean anything.
insert into economy_config (key, value)
values ('rank_consistency', '{"enabled": false, "decay_enabled": false, "season_reset_enabled": false}'::jsonb)
on conflict (key) do nothing;


-- ═══════════════════════════════ 2 · CRON ═══════════════════════════════

select cron.unschedule('philoi-rank-consistency-week')
 where exists (select 1 from cron.job where jobname = 'philoi-rank-consistency-week');
select cron.unschedule('philoi-rank-ladder-season-reset')
 where exists (select 1 from cron.job where jobname = 'philoi-rank-ladder-season-reset');


-- ═══════════════════════════════ 3 · FOLD OFFSETS TO ZERO ═══════════════════════════════

alter table rank_ladder_events drop constraint if exists rank_ladder_events_kind_check;
alter table rank_ladder_events add constraint rank_ladder_events_kind_check
  check (kind in ('held', 'missed', 'slipped', 'relegated', 'settling', 'season_reset', 'lifetime_fold'));

do $fold$
declare
  v_u record;
begin
  for v_u in
    select uls.user_id, uls.ladder_offset,
           universal_score(uls.user_id) as us,
           live_rank_xp(uls.user_id)    as live
    from user_ladder_state uls
    where uls.ladder_offset <> 0
  loop
    -- The shown tier must not move. If it would, stop: that user needs a decision, not a script.
    if rank_index_for_score(v_u.us) is distinct from rank_index_for_score(v_u.live) then
      raise exception '0230: folding % offset for % would move the shown tier (% -> %). Decide by hand.',
        v_u.ladder_offset, v_u.user_id, rank_index_for_score(v_u.live), rank_index_for_score(v_u.us);
    end if;

    insert into rank_ladder_events (
      user_id, period_key, season_id, kind, xp_delta, live_before, live_after,
      rank_index_before, rank_index_after
    ) values (
      v_u.user_id, 'lifetime:0230',
      (select ec.value ->> 'id' from economy_config ec where ec.key = 'season'),
      'lifetime_fold', -v_u.ladder_offset, v_u.live, v_u.us,
      rank_index_for_score(v_u.live), rank_index_for_score(v_u.us)
    );

    update user_ladder_state
       set ladder_offset = 0, updated_at = now()
     where user_id = v_u.user_id;
  end loop;
end;
$fold$;


-- ═══════════════════════════════ 4 · NO-DECREASE GUARD ═══════════════════════════════

create or replace function user_ladder_state_never_lowers()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' and new.ladder_offset < 0)
     or (tg_op = 'UPDATE' and new.ladder_offset < old.ladder_offset) then
    raise exception using
      errcode = 'check_violation',
      message = 'rank is a lifetime climb (0230): ladder_offset may not be lowered';
  end if;
  return new;
end;
$$;

drop trigger if exists user_ladder_state_never_lowers on user_ladder_state;
create trigger user_ladder_state_never_lowers
  before insert or update of ladder_offset on user_ladder_state
  for each row execute function user_ladder_state_never_lowers();

revoke execute on function public.user_ladder_state_never_lowers() from public, anon, authenticated;


-- ═══════════════════════════════ 5 · ASSERTED AT DEPLOY ═══════════════════════════════
--
-- Runs against live prod rows. Every write below happens inside a block that is always rolled back
-- by a marker exception. Each "it is off" check is paired with one that would fail if it were on.

do $assert$
declare
  v_cfg      jsonb := rank_consistency_config();
  v_u        uuid;
  v_fresh    uuid;
  v_blocked  boolean;
  v_allowed  boolean;
begin
  -- 1 · Config off, read through the same merge the sweeps use (so a missing row cannot hide).
  if (v_cfg ->> 'enabled')::boolean or (v_cfg ->> 'decay_enabled')::boolean
     or (v_cfg ->> 'season_reset_enabled')::boolean then
    raise exception '0230: rank_consistency is still on: %', v_cfg;
  end if;
  -- Both sweeps short-circuit before touching a row.
  if run_rank_consistency_sweep() <> 'disabled' then
    raise exception '0230: the weekly sweep still runs';
  end if;
  if apply_season_ladder_reset() <> 'disabled' then
    raise exception '0230: the season ladder reset still runs';
  end if;

  -- 2 · No rank cron. Control: the season-close jobs survive, so the unschedule was not too wide.
  if exists (select 1 from cron.job
              where jobname in ('philoi-rank-consistency-week', 'philoi-rank-ladder-season-reset')
                 or command ~* '(run_rank_consistency_sweep|apply_season_ladder_reset)') then
    raise exception '0230: a rank ladder cron is still scheduled';
  end if;
  if not exists (select 1 from cron.job where jobname = 'philoi-season-close') then
    raise exception '0230: philoi-season-close is gone — the unschedule went too wide';
  end if;

  -- 3 · Seat == lifetime for everyone, and the 0190 ledger invariant still holds.
  if exists (select 1 from user_ladder_state where ladder_offset <> 0) then
    raise exception '0230: a non-zero ladder_offset survived the fold';
  end if;
  if exists (
    select 1 from user_ladder_state uls
    where uls.ladder_offset is distinct from
          coalesce((select sum(e.xp_delta) from rank_ladder_events e where e.user_id = uls.user_id), 0)
  ) then
    raise exception '0230: sum(xp_delta) no longer equals ladder_offset for some user';
  end if;
  if exists (
    select 1 from profiles p
    where rank_index_for_score(live_rank_xp(p.id)) is distinct from rank_index_for_score(universal_score(p.id))
  ) then
    raise exception '0230: some user''s seat tier differs from their lifetime tier';
  end if;

  -- 4 · The guard refuses a decrease (UPDATE) and a negative INSERT, and still allows an increase.
  select uls.user_id into v_u from user_ladder_state uls limit 1;
  select p.id into v_fresh from profiles p
   where not exists (select 1 from user_ladder_state uls where uls.user_id = p.id) limit 1;

  if v_u is not null then
    v_blocked := false;
    begin
      begin
        update user_ladder_state set ladder_offset = ladder_offset - 1 where user_id = v_u;
      exception when check_violation then
        v_blocked := true;
      end;
      raise exception using errcode = 'P0001', message = '0230-rollback';
    exception when sqlstate 'P0001' then
      if sqlerrm <> '0230-rollback' then raise; end if;
    end;
    if not v_blocked then
      raise exception '0230: the guard let ladder_offset go down';
    end if;

    -- Positive control: a guard that refused every write would pass the check above too.
    v_allowed := false;
    begin
      update user_ladder_state set ladder_offset = ladder_offset + 1 where user_id = v_u;
      v_allowed := true;
      raise exception using errcode = 'P0001', message = '0230-rollback';
    exception when sqlstate 'P0001' then
      if sqlerrm <> '0230-rollback' then raise; end if;
    end;
    if not v_allowed then
      raise exception '0230: the guard blocks increases too';
    end if;
  else
    raise notice '0230: no user_ladder_state rows — UPDATE guard check skipped';
  end if;

  if v_fresh is not null then
    v_blocked := false;
    begin
      begin
        insert into user_ladder_state (user_id, ladder_offset) values (v_fresh, -1);
      exception when check_violation then
        v_blocked := true;
      end;
      raise exception using errcode = 'P0001', message = '0230-rollback';
    exception when sqlstate 'P0001' then
      if sqlerrm <> '0230-rollback' then raise; end if;
    end;
    if not v_blocked then
      raise exception '0230: the guard let a negative offset be inserted';
    end if;
  end if;

  -- 5 · Untouched: 0203's thresholds. Primordial still sits years out, not one season.
  -- Pinned to the live 0203 apex (Primordial = 625,000 XP on 2026-10-05).
  if (select max(rt.cumulative_xp_required) from rank_thresholds rt) is distinct from 625000 then
    raise exception '0230: rank_thresholds no longer look like the 0203 multi-year ladder (max %)',
      (select max(rt.cumulative_xp_required) from rank_thresholds rt);
  end if;

  raise notice '0230 OK · decay, bonus and season reset off; crons gone; seat == lifetime; offsets can only rise.';
end;
$assert$;
