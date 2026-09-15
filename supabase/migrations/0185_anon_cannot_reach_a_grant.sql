-- 0185 — Nobody holding the anon key can reach a grant, and no client can call a sweep.
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- Same class as #151. 0064/0066/0074/0075/0080 wrote `revoke all ... from public, authenticated`
-- on their internal grant functions and never named `anon`. Supabase's default privileges grant
-- EXECUTE on every new public function to anon explicitly, so revoking PUBLIC does not reach it —
-- and the anon key ships inside the app. The Emberfall verify (2026-09-14) proved it end to end:
-- grant_forge_pass as anon minted the Pass, and credit_pass_xp let a caller choose its own XP.
--
-- The verify named six functions. An audit of every SECURITY DEFINER function in public found the
-- class is bigger than that, so this file does not cherry-pick. Three groups:
--
-- ── A · THE CLASS ITSELF ──
-- Functions where anon has EXECUTE and authenticated does not. That ACL shape has exactly one cause
-- (someone revoked `public, authenticated` and forgot anon), and it cannot be deliberate: there is no
-- flow that should be open to a signed-out caller but closed to a signed-in one. Every caller of
-- these is a definer function, pg_cron (runs as postgres) or an edge function on the service role.
-- Revoking anon therefore cannot break a client. Includes grant_iap_purchase — the RevenueCat
-- entitlement grant — and economy_set_droppable_items, notify_push_raw, season_log_grant.
--
-- ── B · UNGUARDED, AND NOTHING ON A DEVICE CALLS THEM ──
-- Open to authenticated AND anon, no auth.uid() check, and no rpc() caller in src/ or
-- supabase/functions/. Their DB callers are all SECURITY DEFINER (so they run as the owner and keep
-- working) or pg_cron. Fully revoked:
--   · delete_storage_prefixes — 🔴 the worst one found. Reads the service_role key out of Vault and
--     issues a Storage DELETE for any bucket + any prefix the caller names. Only delete_my_account
--     should reach it.
--   · credit_pass_xp — the caller picks p_xp. creditPassXp() in src/lib/api/forge-pass.ts has never
--     been imported by a screen (added in 0ac8523, no call site since); the server engine
--     (evaluate_pass_achievements, trigger-driven) is the only legitimate writer.
--   · economy_apply_relic_ladder — sets ANY user's relic value and grants the relic.
--   · seed_default_loadout — grants cosmetics to any user id.
--   · notify_streaks_at_risk / notify_message_batches / notify_stale_lock_ins — push sweeps. The
--     streak one has no dedupe: any caller could buzz every streaking user's phone on a loop.
--   · finalize_social_challenges / start_due_challenges — settle and pay challenges.
--   · recompute_*_streak / recompute_all_streaks / gym_recompute_pr / tick_lockin_presence —
--     recompute-to-truth sweeps; not a theft vector, but a signed-out loop over every profile.
--
-- ── C · CLIENT ECONOMY RPCs: anon only, defense in depth ──
-- These ARE called by the app and are guarded by auth.uid(), so anon already gets 'Not signed in'.
-- Closing anon anyway costs nothing (no economy flow runs signed-out) and means a future edit that
-- loses the guard does not reopen #151. authenticated keeps EXECUTE; it is re-granted explicitly
-- because several carry a PUBLIC grant, and revoking PUBLIC must not take authenticated with it.
--
-- NOT touched, deliberately: admin_* (is_admin()-guarded), dev_* (uid/membership-guarded, and the
-- dev menu is __DEV__-only), the read-only visibility helpers used by RLS, rls_auto_enable
-- (Supabase's event trigger).
--
-- ACLs live per signature and survive CREATE OR REPLACE, but a DROP + CREATE re-applies the default
-- privileges and hands anon EXECUTE back. Any future migration that drops one of these must restate
-- its revoke.

-- ── A ──
revoke execute on function public.agora_attachment_snapshot(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.agora_item_owner(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.campfire_challenge_attach_goal(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.close_season_if_due() from public, anon, authenticated;
revoke execute on function public.close_season_scope(text, text, text) from public, anon, authenticated;
revoke execute on function public.close_season_vs_unis(text) from public, anon, authenticated;
revoke execute on function public.coach_bump_usage(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.credit_count_goals_for_workout_set(check_in_workout_sets) from public, anon, authenticated;
revoke execute on function public.credit_lockin_time_goals_for(check_ins) from public, anon, authenticated;
revoke execute on function public.duel_record(uuid) from public, anon, authenticated;
revoke execute on function public.economy_award_goal_day_for(uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public.economy_set_droppable_items(jsonb) from public, anon, authenticated;
revoke execute on function public.grant_forge_pass(uuid, text) from public, anon, authenticated;
revoke execute on function public.grant_iap_purchase(text, uuid, text, text, integer, boolean, jsonb) from public, anon, authenticated;
revoke execute on function public.grant_level_zero_unlock(uuid) from public, anon, authenticated;
revoke execute on function public.grant_season_placement_rewards(text, boolean) from public, anon, authenticated;
revoke execute on function public.milestone_effort(uuid) from public, anon, authenticated;
revoke execute on function public.notify_push_raw(uuid[], text, text, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.resolve_goal_claim(uuid, text) from public, anon, authenticated;
revoke execute on function public.roll_over_challenges() from public, anon, authenticated;
revoke execute on function public.season_log_grant(text, uuid, text, text, text, text, text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.settle_expired_vouches() from public, anon, authenticated;
revoke execute on function public.settle_team_match(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.snapshot_season_standings(text) from public, anon, authenticated;
-- Named by the verify; already closed to anon in prod, restated so the file is the whole answer.
revoke execute on function public.close_season_placements() from public, anon, authenticated;

-- ── B ──
revoke execute on function public.delete_storage_prefixes(text, text[]) from public, anon, authenticated;
revoke execute on function public.credit_pass_xp(text, integer, text) from public, anon, authenticated;
revoke execute on function public.economy_apply_relic_ladder(uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.seed_default_loadout(uuid) from public, anon, authenticated;
revoke execute on function public.notify_streaks_at_risk() from public, anon, authenticated;
revoke execute on function public.notify_message_batches() from public, anon, authenticated;
revoke execute on function public.notify_stale_lock_ins() from public, anon, authenticated;
revoke execute on function public.finalize_social_challenges() from public, anon, authenticated;
revoke execute on function public.start_due_challenges() from public, anon, authenticated;
revoke execute on function public.recompute_goal_streak(uuid) from public, anon, authenticated;
revoke execute on function public.recompute_streak(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.recompute_user_streak(uuid) from public, anon, authenticated;
revoke execute on function public.recompute_all_streaks() from public, anon, authenticated;
revoke execute on function public.gym_recompute_pr(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.tick_lockin_presence() from public, anon, authenticated;

-- ── C ──
revoke execute on function public.buy_cosmetic(text, text, text) from public, anon;
revoke execute on function public.buy_loot_box(text) from public, anon;
revoke execute on function public.open_loot_box(uuid, jsonb) from public, anon;
revoke execute on function public.salvage_cosmetic(text, text) from public, anon;
revoke execute on function public.claim_pass_level(integer, text, jsonb) from public, anon;
revoke execute on function public.reconcile_my_forge_pass() from public, anon;
revoke execute on function public.get_inventory() from public, anon;
revoke execute on function public.economy_award_goal_day(uuid, date) from public, anon;
revoke execute on function public.credit_lockin_time_goals(uuid) from public, anon;
grant execute on function public.buy_cosmetic(text, text, text) to authenticated;
grant execute on function public.buy_loot_box(text) to authenticated;
grant execute on function public.open_loot_box(uuid, jsonb) to authenticated;
grant execute on function public.salvage_cosmetic(text, text) to authenticated;
grant execute on function public.claim_pass_level(integer, text, jsonb) to authenticated;
grant execute on function public.reconcile_my_forge_pass() to authenticated;
grant execute on function public.get_inventory() to authenticated;
grant execute on function public.economy_award_goal_day(uuid, date) to authenticated;
grant execute on function public.credit_lockin_time_goals(uuid) to authenticated;

-- ─────────────────────────────── ASSERT ───────────────────────────────
do $assert$
declare
  v_sig text;
  v_bad text;
begin
  -- The class invariant. Discriminating: it read 24 before this file.
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_bad is not null then
    raise exception '0185: anon can still execute internal definer functions: %', v_bad;
  end if;

  -- A + B: closed to both client roles.
  foreach v_sig in array array[
    'grant_forge_pass(uuid,text)', 'grant_level_zero_unlock(uuid)', 'grant_iap_purchase(text,uuid,text,text,integer,boolean,jsonb)',
    'close_season_scope(text,text,text)', 'close_season_if_due()', 'close_season_placements()',
    'snapshot_season_standings(text)', 'grant_season_placement_rewards(text,boolean)',
    'credit_pass_xp(text,integer,text)', 'delete_storage_prefixes(text,text[])',
    'economy_apply_relic_ladder(uuid,text,numeric)', 'seed_default_loadout(uuid)',
    'notify_streaks_at_risk()', 'notify_message_batches()', 'notify_stale_lock_ins()',
    'finalize_social_challenges()', 'start_due_challenges()', 'recompute_all_streaks()',
    'recompute_user_streak(uuid)', 'tick_lockin_presence()'
  ] loop
    if has_function_privilege('anon', v_sig::regprocedure, 'EXECUTE')
       or has_function_privilege('authenticated', v_sig::regprocedure, 'EXECUTE') then
      raise exception '0185: % is still callable by a client role', v_sig;
    end if;
  end loop;

  -- C: closed to anon, still open to authenticated (the positive control — a blanket revoke that
  -- broke the shop would fail here, not on a phone).
  foreach v_sig in array array[
    'buy_cosmetic(text,text,text)', 'buy_loot_box(text)', 'open_loot_box(uuid,jsonb)', 'salvage_cosmetic(text,text)',
    'claim_pass_level(integer,text,jsonb)', 'reconcile_my_forge_pass()', 'get_inventory()',
    'economy_award_goal_day(uuid,date)', 'credit_lockin_time_goals(uuid)'
  ] loop
    if has_function_privilege('anon', v_sig::regprocedure, 'EXECUTE') then
      raise exception '0185: anon can still execute %', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig::regprocedure, 'EXECUTE') then
      raise exception '0185: authenticated lost EXECUTE on %', v_sig;
    end if;
  end loop;

  -- The sweeps' real callers still reach them.
  if not has_function_privilege('service_role', 'grant_iap_purchase(text,uuid,text,text,integer,boolean,jsonb)'::regprocedure, 'EXECUTE') then
    raise exception '0185: service_role (revenuecat-webhook) lost grant_iap_purchase';
  end if;
end;
$assert$;
