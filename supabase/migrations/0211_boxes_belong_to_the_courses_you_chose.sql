-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0211 · BOXES BELONG TO THE COURSES YOU CHOSE — shipped DARK.
--
-- Spec: CODE_PROMPT 0211 (Noah, 2026-09-24). Builds on 0210's priority_courses.
--
-- The farm risk in grade goals is BOXES (forgeable, resellable), not embers. So once this is switched
-- on, a grade goal on a course that is NOT one of the member's two priority courses for its season
-- pays its earned band's EMBERS and mints no box. Every other completion is untouched.
--
-- ─────────────────────────── 🔴 WHY IT SHIPS OFF ───────────────────────────
--
-- Nobody on prod has nominated a priority course: the UI that does it reaches testers with the next
-- build (OTA is closed). Switched on today, EVERY grade goal would read as non-priority and lose its
-- box — a silent economy cut. So the branch is behind economy_config 'grade_box_gating', inserted
-- here as {"enabled": false}. With it off the trigger takes the pre-0211 path, the same grant_reward
-- call with the same arguments. It is flipped by a one-line config update AFTER the build ships,
-- never in this file, and flipping it back is the undo.
--
-- ─────────────────────────── WHAT THE EMBERS-ONLY ARM PAYS ───────────────────────────
--
-- · The band: preview_challenge_reward's paid_band for the goal's (earned) tier and settled level,
--   which is where the box path's band comes from too (goal_paid_band), and its ember figure
--   reward_bands[paid_band] — the same number grant_reward would have paid alongside the box.
-- · The CAP: goal_rewards.weekly_cap (300). That cap lives only in the daily-goal drip
--   (economy_goal_embers_this_week counts goal_daily + goal_streak), not in grant_reward, so it is
--   applied HERE: the room is the cap minus this week's drip minus this week's embers-only grade
--   payouts. One-directional on purpose — the drip function is not restated, so while the switch
--   is off nothing about the drip can move.
-- · No badge: the elite/apex badge is the box tier's prestige, and this arm is the not-a-box arm.
-- · The ledger reason stays 'challenge_win', the reason grant_reward writes for the same payout.
--
-- ─────────────────────────── WHAT IS NOT HERE ───────────────────────────
--
-- Multi-Mythic box_count is CUT (Noah, 2026-09-24): no grant_reward parameter, no overload.
-- grant_reward, log_challenge_progress and goal_paid_band are untouched (md5-asserted).
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- Refuse to restate over a body that moved since it was read (the sibling-clobber rule).
do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'economy_on_challenge_completed()'::regprocedure)
       <> 'd40f622b7dbed4eaaff658205ab03a1c' then
    raise exception '0211: economy_on_challenge_completed changed since it was read — re-read prosrc before restating';
  end if;
end $$;

-- ─────────────────────────── 1 · the switch ───────────────────────────

insert into economy_config (key, value)
values ('grade_box_gating', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;

-- ─────────────────────────── 2 · the branch ───────────────────────────
--
-- ⚠️ RESTATED FROM PROD'S LIVE prosrc (md5 d40f622b…, 0201's body). Added: the v_embers_only
-- decision, its arm, and an `embers_only` key on the receipt when it fires. The else arm is the old
-- grant_reward call, character for character.
create or replace function public.economy_on_challenge_completed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_sig numeric;
  v_cap text;
  v_receipt jsonb;
  v_crate text;
  v_embers int;
  v_what text;
  -- 0211
  v_embers_only boolean := false;
  v_price jsonb;
  v_room int;
  v_paid int;
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;

  -- 0162 — a goal minted BY a campfire challenge is that challenge's counter, not a second prize.
  -- evaluate_pass_achievements still runs: pass progress is a record of what they did, and they
  -- did do it.
  if new.challenge_source_id is not null then
    perform evaluate_pass_achievements(new.user_id);
    return new;
  end if;

  -- WAS A LITERAL 1.0 — see 0159's header. That constant is what made every completed goal an
  -- Ignition Crate, and it is also the reason `uncommon` is pinned at significance 1.0 in
  -- tier_payout: an unscoped goal resolves to exactly the number that was hard-coded here, so
  -- nothing in flight changes what it pays.
  v_sig := coalesce((v_cfg -> coalesce(new.difficulty_tier, '') ->> 'significance')::numeric, 1.0);
  v_cap := goal_paid_band(new.difficulty_tier, new.verifiability);

  -- 0211 — BOXES ONLY FROM PRIORITY COURSES, once the switch is on. A grade goal whose course is not
  -- one of the member's two for the goal's season pays embers only. Anything that is not a grade
  -- goal never enters this test. The season is the one the goal was SET in (0210's stamp), falling
  -- back to the current one for a goal older than the stamp.
  v_embers_only :=
    new.grade_target is not null
    and coalesce((select (value ->> 'enabled')::boolean from economy_config where key = 'grade_box_gating'), false)
    and not exists (
      select 1 from priority_courses pc
       where pc.user_id = new.user_id
         and pc.course_id = new.course_id
         and pc.season_id = coalesce(new.season_id, (select season_id from current_economy_season()))
    );

  if v_embers_only then
    -- The earned band's embers, priced where the box path's band comes from, capped by the goal
    -- economy's weekly ceiling.
    v_price := preview_challenge_reward(new.difficulty_tier, coalesce(new.verifiability, 'honor'),
                                        case when new.period = 'week' then 7 else 1 end, 1);
    v_room := greatest(0,
      coalesce((select (value ->> 'weekly_cap')::int from economy_config where key = 'goal_rewards'), 300)
      - economy_goal_embers_this_week(new.user_id)
      - coalesce((
          select sum((c.reward_payload ->> 'embers')::int)
            from challenges c
           where c.user_id = new.user_id
             and c.id <> new.id
             and (c.reward_payload ->> 'embers_only')::boolean
             and (c.reward_payload ->> 'settled_at')::timestamptz >= now() - interval '7 days'
        ), 0)::int);
    v_paid := least(coalesce((v_price ->> 'embers')::int, 0), v_room);

    if v_paid > 0 then
      perform economy_move_embers(new.user_id, v_paid, 'challenge_win', new.id);
    end if;

    v_receipt := jsonb_build_object(
      'embers', v_paid,
      'box', null,
      'box_id', null,
      'badge', null,
      'band', v_price ->> 'paid_band',
      'embers_only', true,
      -- What the band was worth before the weekly ceiling, so a capped payout can say so.
      'embers_band', coalesce((v_price ->> 'embers')::int, 0)
    );
  else
    -- 0167 — THE RETURN VALUE IS KEPT. Identical call, identical arguments, `perform` → `select into`.
    select grant_reward(
      new.user_id, 'friend_h2h', v_sig,
      case when new.period = 'week' then 7 else 1 end,
      1, 0.0, true, new.id,
      v_cap
    ) into v_receipt;
  end if;

  -- 0167 — the receipt, plus the two facts the reveal needs that grant_reward has no way to know:
  -- WHICH LEVEL the goal settled at, and what tier it was scoped to. `band` inside v_receipt is
  -- already the band actually paid (grant_reward applies v_cap before returning), so the reveal
  -- reads the honest figure without re-pricing anything.
  --
  -- 0200 — and the receipt is RE-ARMED: reward_seen_at goes back to null with every new receipt, so
  -- a recurring goal's second, third, fourth completion can each be revealed. `settled_at` rides
  -- in the payload because rollover clears completed_at and the inbox still has to order this.
  update challenges
     set reward_payload = coalesce(v_receipt, '{}'::jsonb)
                          || jsonb_build_object(
                               'verifiability', new.verifiability,
                               'tier', new.difficulty_tier,
                               'max_band', v_cap,
                               'period', new.period,
                               'settled_at', now()
                             ),
         reward_seen_at = null
   where id = new.id;

  -- 0201 — announce the crate. The display names are a fourth copy of the box catalog (boxes.ts is
  -- the first); presentation only, and an unknown key falls back to a generic word rather than
  -- printing a database value.
  -- A SEARCHED case, not `case x when null`: `null = null` is null, so that arm could never match
  -- and a crate-less receipt would have announced "A crate earned".
  v_crate := case
    when v_receipt ->> 'box' is null          then null
    when v_receipt ->> 'box' = 'kindling'     then 'Kindling'
    when v_receipt ->> 'box' = 'ignition'     then 'Ignition Crate'
    when v_receipt ->> 'box' = 'furnace'      then 'The Furnace'
    when v_receipt ->> 'box' = 'hestia'       then 'Vessel of Hestia'
    when v_receipt ->> 'box' = 'hephaestus'   then 'Hephaestus'' Chest'
    when v_receipt ->> 'box' = 'promethean'   then 'Promethean Vault'
    else 'A crate'
  end;
  v_embers := coalesce((v_receipt ->> 'embers')::int, 0);
  v_what := coalesce(
    nullif(trim(new.label), ''),
    trim(to_char(new.target, 'FM999,999,990.##')) || ' ' || coalesce(new.unit, '')
  );
  if v_crate is not null or v_embers > 0 then
    perform notify_event(
      array[new.user_id], 'reward_ready',
      coalesce(v_crate || ' earned', '+' || v_embers || ' embers earned'),
      'For ' || trim(v_what) ||
        case when v_crate is not null and v_embers > 0 then ' · +' || v_embers || ' embers' else '' end ||
        case when v_crate is not null then '. Open it from your inventory.' else '.' end,
      null, new.id,
      '/inventory', '{}'::jsonb,
      null, null,
      jsonb_build_object('box', v_receipt ->> 'box', 'box_id', v_receipt ->> 'box_id', 'embers', v_embers)
    );
  end if;

  perform evaluate_pass_achievements(new.user_id);
  return new;
end;
$function$;

-- ─────────────────────────── assertions ───────────────────────────
do $assert$
declare
  v_uid uuid;
  v_course_p uuid;
  v_course_n uuid;
  v_out jsonb;
  v_id uuid;
  v_row challenges;
  v_room int;
  v_expect int;
  v_before int;
  v_boxes int;
  v_body text := (select prosrc from pg_proc where oid = 'economy_on_challenge_completed()'::regprocedure);
begin
  -- ── shape ──
  if (select (value ->> 'enabled')::boolean from economy_config where key = 'grade_box_gating') is distinct from false then
    raise exception '0211: the gating switch must ship OFF';
  end if;
  -- The else arm is the old call, verbatim.
  if position($s$select grant_reward(
      new.user_id, 'friend_h2h', v_sig,
      case when new.period = 'week' then 7 else 1 end,
      1, 0.0, true, new.id,
      v_cap
    ) into v_receipt;$s$ in v_body) = 0 then
    raise exception '0211: the box path no longer makes the pre-0211 grant_reward call';
  end if;
  if (select count(*) from pg_proc where proname = 'grant_reward') <> 1
     or (select md5(prosrc) from pg_proc where oid = 'log_challenge_progress(uuid, numeric, text)'::regprocedure) <> '8147740abe646b2526df832a3fb0c916'
     or (select md5(prosrc) from pg_proc where proname = 'goal_paid_band') <> 'a5e926a81aaa52258215dc56faf360e4' then
    raise exception '0211: grant_reward / log_challenge_progress / goal_paid_band moved';
  end if;

  -- ── behaviour, rolled back ──
  select id into v_uid from profiles order by created_at limit 1;
  if v_uid is null then
    raise notice '0211: no profiles, skipping the behavioural assertions';
    return;
  end if;

  begin
    insert into user_courses (user_id, code, title) values (v_uid, 'Z0211P', '0211 priority') returning id into v_course_p;
    insert into user_courses (user_id, code, title) values (v_uid, 'Z0211N', '0211 other') returning id into v_course_n;
    delete from priority_courses where user_id = v_uid;

    perform set_config('philoi.suppress_push', 'on', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);

    -- Six goals: grade (priority / non-priority) and a plain counted goal, once per switch state.
    -- Epic STEM on honour settles at impressive→notable, The Furnace, 45 embers — a real box either way.
    v_out := create_scoped_goals(jsonb_build_array(
      jsonb_build_object('label', '0211 off · other', 'grade_target', 90, 'difficulty_tier', 'epic', 'grade_discipline', 'stem', 'course_id', v_course_n),
      jsonb_build_object('label', '0211 off · plain', 'target', 5, 'unit', 'reps', 'difficulty_tier', 'epic'),
      jsonb_build_object('label', '0211 on · priority', 'grade_target', 90, 'difficulty_tier', 'epic', 'grade_discipline', 'stem', 'course_id', v_course_p, 'priority', true),
      jsonb_build_object('label', '0211 on · plain', 'target', 5, 'unit', 'laps', 'difficulty_tier', 'epic'),
      jsonb_build_object('label', '0211 on · other', 'grade_target', 85, 'difficulty_tier', 'epic', 'grade_discipline', 'stem')));
    if v_out -> 'results' -> 2 ->> 'priority' <> 'nominated' then
      raise exception '0211: setup could not nominate the priority course';
    end if;

    -- ═══ SWITCH OFF — 0211 is inert: a NON-priority grade pass still mints its box ═══
    v_id := (v_out -> 'results' -> 0 ->> 'id')::uuid;
    perform report_goal_grade(v_id, 95);
    select * into v_row from challenges where id = v_id;
    if v_row.reward_payload ->> 'box' is null or v_row.reward_payload ->> 'box_id' is null
       or (v_row.reward_payload ->> 'embers_only') is not null then
      raise exception '0211 OFF: a non-priority grade pass lost its box (%)', v_row.reward_payload;
    end if;
    if not exists (select 1 from loot_boxes where id = (v_row.reward_payload ->> 'box_id')::uuid) then
      raise exception '0211 OFF: the receipt names a box that was never minted';
    end if;

    -- Control, OFF: a plain goal pays its box.
    perform set_config('role', 'postgres', true);
    update challenges set completed_at = now() where id = (v_out -> 'results' -> 1 ->> 'id')::uuid;
    if (select reward_payload ->> 'box' from challenges where id = (v_out -> 'results' -> 1 ->> 'id')::uuid) is null then
      raise exception '0211 OFF: a plain goal lost its box';
    end if;

    -- ═══ SWITCH ON (inside this rolled-back block only) ═══
    update economy_config set value = '{"enabled": true}'::jsonb where key = 'grade_box_gating';
    perform set_config('role', 'authenticated', true);

    -- A PRIORITY grade pass still mints its box.
    v_id := (v_out -> 'results' -> 2 ->> 'id')::uuid;
    perform report_goal_grade(v_id, 95);
    select * into v_row from challenges where id = v_id;
    if v_row.reward_payload ->> 'box' is null or (v_row.reward_payload ->> 'embers_only') is not null then
      raise exception '0211 ON: a priority grade pass lost its box (%)', v_row.reward_payload;
    end if;

    -- A NON-priority grade pass (no course at all — also not a priority) pays embers, no box, capped.
    perform set_config('role', 'postgres', true);
    v_room := greatest(0, 300 - economy_goal_embers_this_week(v_uid));
    v_expect := least(45, v_room);
    v_before := coalesce((select balance from ember_wallet where user_id = v_uid), 0);
    v_boxes := (select count(*) from loot_boxes where user_id = v_uid);
    v_id := (v_out -> 'results' -> 4 ->> 'id')::uuid;
    perform set_config('role', 'authenticated', true);
    perform report_goal_grade(v_id, 90);
    perform set_config('role', 'postgres', true);
    select * into v_row from challenges where id = v_id;
    if v_row.reward_payload ->> 'box' is not null or not (v_row.reward_payload ->> 'embers_only')::boolean then
      raise exception '0211 ON: a non-priority grade pass minted a box (%)', v_row.reward_payload;
    end if;
    if (v_row.reward_payload ->> 'band') <> 'notable' or (v_row.reward_payload ->> 'embers_band')::int <> 45
       or (v_row.reward_payload ->> 'embers')::int <> v_expect then
      raise exception '0211 ON: embers-only paid % of band % (expected %)',
        v_row.reward_payload ->> 'embers', v_row.reward_payload ->> 'band', v_expect;
    end if;
    if coalesce((select balance from ember_wallet where user_id = v_uid), 0) - v_before <> v_expect then
      raise exception '0211 ON: the wallet moved by %, expected %',
        coalesce((select balance from ember_wallet where user_id = v_uid), 0) - v_before, v_expect;
    end if;
    if (select count(*) from loot_boxes where user_id = v_uid) <> v_boxes then
      raise exception '0211 ON: a box was minted on the embers-only path';
    end if;

    -- Control, ON: a plain (non-grade) goal still pays its box — the branch is grade-scoped.
    update challenges set completed_at = now() where id = (v_out -> 'results' -> 3 ->> 'id')::uuid;
    if (select reward_payload ->> 'box' from challenges where id = (v_out -> 'results' -> 3 ->> 'id')::uuid) is null then
      raise exception '0211 ON: a plain goal lost its box — the branch is eating non-grade completions';
    end if;

    raise exception 'philoi_0211_rollback';
  exception
    when others then
      if SQLERRM <> 'philoi_0211_rollback' then
        raise;
      end if;
  end;

  -- The flip above was rolled back with the block.
  if (select (value ->> 'enabled')::boolean from economy_config where key = 'grade_box_gating') is distinct from false then
    raise exception '0211: the switch leaked ON out of the assertion';
  end if;
end
$assert$;
