-- 0132 (#151) — the economy's minting primitives stop being callable by the people they pay.
--
-- ─────────────────────────── the hole ───────────────────────────
--
-- Every economy function in `public` is SECURITY DEFINER and carries EXECUTE for `anon` and
-- `authenticated`. PostgREST exposes exactly that set at /rest/v1/rpc/<name>. So a signed-in user
-- holding nothing but the anon key and their own JWT can call:
--
--   POST /rest/v1/rpc/economy_move_embers
--   { "p_user": "<their own id>", "p_delta": 999999, "p_reason": "challenge_win", "p_ref": null }
--
-- and it works. Measured, not theorised: acting as `authenticated` against the live database,
-- economy_move_embers + grant_reward minted 1,000,499 embers into a real ledger (inside a
-- transaction that was rolled back). grant_reward will also mint the box and the un-buyable
-- prestige badge that the whole "earned, not bought" story rests on.
--
-- This predates the 0119–0131 wave; it is not something that wave introduced. It is adjacent to
-- #144 (claim_pass_level validating reward CONTENT) and strictly worse than it — #144 is about a
-- caller influencing a reward, this is a caller minting one outright with no pretext at all.
--
-- ─────────────────────────── why a revoke is the whole fix ───────────────────────────
--
-- None of these is an RPC. Every one is an internal called by a trigger or by another SECURITY
-- DEFINER function, which runs as its own definer (postgres) and therefore does not consult these
-- grants at all. Checked against the client's 158 rpc() call sites and the edge functions' 6 —
-- not one of the names below appears in either, and the edge functions authenticate with the
-- service role regardless, which this file does not touch.
--
-- The grants are almost certainly not deliberate. Postgres gives PUBLIC execute on a new function
-- by default, and a `grant execute on all functions in schema public` then pins anon and
-- authenticated explicitly — so every economy function written since has inherited a client-facing
-- grant nobody asked for.
--
-- REVOKED FROM PUBLIC TOO, not just the two roles. Revoking from anon/authenticated alone leaves
-- the default PUBLIC grant standing, and both roles are members of PUBLIC — the hole would look
-- closed and stay open.

do $revoke$
declare
  v_fn text;
  v_sig text;
  v_count int := 0;
begin
  foreach v_fn in array array[
    -- The primitives: these move currency and mint goods.
    'economy_move_embers',
    'grant_reward',
    'economy_grant_badge',
    'economy_grant_cosmetic',
    'economy_grant_relic',
    'economy_grant_title',
    'economy_award_lock_in_embers',
    'economy_credit_pass_xp_for',
    'accrue_campfire_xp',
    'claim_pass_tier',
    -- The evaluators: they decide whether a grant happens, so calling one on demand is a way of
    -- asking for the grant repeatedly until it lands.
    'economy_evaluate_relics',
    'evaluate_pass_achievements',
    'economy_roll_rarity',
    'economy_track_rank_change',
    -- The trigger bodies. Reachable as RPCs only by accident of the blanket grant; several take a
    -- trigger context they would not get from PostgREST, but a function that cannot work as an RPC
    -- has no business being offered as one.
    'economy_on_challenge_completed',
    'economy_on_flame_meter_complete',
    'economy_on_goal_day_awarded',
    'economy_on_lock_in_completed',
    'economy_on_session_check_relics',
    'economy_on_social_challenge_closed',
    'close_season_placements'
  ]
  loop
    -- By name, across every overload: grant_reward alone has had three signatures over the life of
    -- this schema, and a revoke that names one argument list silently misses the others.
    for v_sig in
      select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_fn
    loop
      execute format('revoke all on function %s from public, anon, authenticated', v_sig);
      v_count := v_count + 1;
    end loop;
  end loop;

  raise notice 'revoked client EXECUTE on % economy function(s)', v_count;
end;
$revoke$;

-- Proof, in the migration itself: if any of these is still reachable by a signed-in caller after
-- the block above, fail the deploy rather than report success on a hole that is still open.
do $assert$
declare
  v_leaks text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_leaks
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'economy_move_embers', 'grant_reward', 'economy_grant_badge', 'economy_grant_cosmetic',
      'economy_grant_relic', 'economy_grant_title', 'economy_award_lock_in_embers',
      'economy_credit_pass_xp_for', 'accrue_campfire_xp', 'claim_pass_tier',
      'economy_evaluate_relics', 'evaluate_pass_achievements', 'economy_roll_rarity',
      'economy_track_rank_change', 'economy_on_challenge_completed',
      'economy_on_flame_meter_complete', 'economy_on_goal_day_awarded',
      'economy_on_lock_in_completed', 'economy_on_session_check_relics',
      'economy_on_social_challenge_closed', 'close_season_placements'
    )
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');

  if v_leaks is not null then
    raise exception 'still callable by authenticated after revoke: %', v_leaks;
  end if;
end;
$assert$;
