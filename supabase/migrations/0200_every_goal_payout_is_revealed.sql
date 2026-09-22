-- 0200 — Every goal payout is revealed, and every revealed number is the one that landed.
--
-- DECIDED (Noah, 2026-09-21): a recurring goal KEEPS both of its grants — the ember drip
-- (economy_award_goal_day) AND the grant_reward crate (economy_on_challenge_completed) — and BOTH
-- must be shown. Until now only the drip was.
--
-- WHAT THE REPRO ACTUALLY PAID. The recorded weekly 10,000-step goal (0fcb3dfe…) banked, in the
-- same second: +20 `challenge_win` embers and an Ignition crate from grant_reward, then +12
-- `goal_daily` from the drip. The drip was NOT capped (99 of the 300 weekly goal embers used). The
-- reveal said +12, which was true of the drip — the +20 and the crate were the part nobody saw,
-- because get_unseen_goal_rewards only returned `period = 'once'` receipts (0167). So the wallet
-- moved +32 under a screen that accounted for 12.
--
-- Three changes, each restated from the LIVE body on prod:
--
-- 1. get_unseen_goal_rewards returns recurring receipts too. And it no longer requires
--    completed_at: roll_over_challenges() clears completed_at at the period boundary without
--    touching the receipt, so a weekly goal finished late on Saturday and not yet seen by the
--    Sunday rollover would otherwise vanish from the inbox with its crate unannounced.
--
-- 2. economy_on_challenge_completed RE-ARMS the receipt on every completion. It overwrote
--    reward_payload each time but left reward_seen_at alone, so once week one had been seen every
--    later week's crate was born already "seen" and could never surface. It now clears
--    reward_seen_at alongside writing the new receipt, and stamps the receipt with its own
--    settled_at so the inbox can order it after completed_at is gone.
--
-- 3. economy_award_goal_day_for reports what the reveal needs to animate a TRUE balance:
--      balance               — ember_wallet.balance right after this drip was paid
--      pending_reward_embers — this goal's unseen grant_reward embers (its crate reveal is still to
--                              come, so the drip screen must stop short of them)
--      period, goal_id       — so the headline can say WEEKLY rather than always DAILY
--    The drip screen counts up to (balance - pending_reward_embers); the crate screen then counts
--    the rest up to the live wallet. Across the two, the user watches exactly the wallet delta.
--    Keys added to a jsonb return — not a signature change.
--
-- BACKFILL: every recurring receipt already sitting unseen (4 on prod at authoring) is stamped seen.
-- They are historical — some weeks old — and widening the inbox without this would replay them all
-- at once on the next foreground.

-- ───────────────────────────── 1 · the inbox ─────────────────────────────

create or replace function public.get_unseen_goal_rewards()
 returns table(goal_id uuid, goal_label text, goal_type text, tier text, verified_as text, band text, full_band text, full_box text, settled_at timestamp with time zone, payload jsonb)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then return; end if;

  return query
  select
    c.id,
    c.label,
    c.type,
    c.difficulty_tier,
    c.verifiability,
    c.reward_payload ->> 'band',
    goal_paid_band(c.difficulty_tier, 'vouched'),
    -- ⚠️ THE BAND→CRATE MAPPING, RESTATED. It lives inside grant_reward and nowhere addressable,
    -- and this is a THIRD copy of it, which is worth being uncomfortable about. It is here rather
    -- than in the client for the reason rewardChips already gives — "hephaestus" is a database
    -- value and a screen must never print one — and rather than through
    -- preview_challenge_reward(), which raises on an unknown tier and would turn a foreground poll
    -- into an error for any goal scoped before the config knew its tier. Presentation only: this
    -- names a crate that was NOT paid, on a row whose payment already happened.
    case goal_paid_band(c.difficulty_tier, 'vouched')
      when 'apex'       then 'promethean'
      when 'elite'      then 'hephaestus'
      when 'impressive' then 'hestia'
      when 'notable'    then 'furnace'
      when 'casual'     then 'ignition'
      else null
    end,
    -- 0200 — the receipt carries its own settle time, because a recurring goal's completed_at is
    -- cleared at rollover while its receipt may still be waiting to be seen.
    coalesce((c.reward_payload ->> 'settled_at')::timestamptz, c.completed_at),
    c.reward_payload
  from challenges c
  where c.user_id = auth.uid()
    and c.reward_seen_at is null
    -- No receipt, nothing to reveal. Covers a campfire-minted goal (granted nothing here by
    -- design) and anything completed before 0167, which its backfill stamped.
    and c.reward_payload is not null
    -- 0200 — no period filter and no completed_at filter. Recurring goals' crates are revealed now
    -- (Noah: both grants surface), and a receipt outlives the rollover that clears completed_at.
  order by coalesce((c.reward_payload ->> 'settled_at')::timestamptz, c.completed_at) asc nulls last;
end;
$function$;

-- ───────────────────────────── 2 · re-arm the receipt on every completion ─────────────────────────────

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

  -- 0167 — THE RETURN VALUE IS KEPT. Identical call, identical arguments, `perform` → `select into`.
  select grant_reward(
    new.user_id, 'friend_h2h', v_sig,
    case when new.period = 'week' then 7 else 1 end,
    1, 0.0, true, new.id,
    v_cap
  ) into v_receipt;

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

  perform evaluate_pass_achievements(new.user_id);
  return new;
end;
$function$;

-- ───────────────────────────── 3 · the drip reports the balance it landed on ─────────────────────────────

create or replace function public.economy_award_goal_day_for(p_goal_id uuid, p_user uuid, p_local_day date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user uuid := p_user;
  v_cfg jsonb := (select value from economy_config where key = 'goal_rewards');
  v_diff_cfg jsonb := (select value from economy_config where key = 'goal_difficulty');
  v_tier_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_goal challenges;
  v_scale numeric;
  v_difficulty text;
  v_daily int;
  v_streak int;
  v_milestone int := 0;
  v_box text;
  v_room int;
  v_paid_daily int := 0;
  v_paid_milestone int := 0;
  v_inserted int;
  v_pending int;
begin
  if v_user is null then
    raise exception 'Not signed in.';
  end if;

  -- Ownership. security definer bypasses RLS, so without this any user could award themselves
  -- against somebody else's goal id.
  select * into v_goal from challenges c where c.id = p_goal_id and c.user_id = v_user;
  if v_goal.id is null then
    raise exception 'That goal is not yours.';
  end if;

  -- The goal must actually be complete for the period. Awarding on the caller's say-so would let
  -- one collect the drip without hitting the target at all.
  if v_goal.completed_at is null then
    raise exception 'That goal is not complete.';
  end if;

  -- No future days: otherwise a client mints tomorrow's drip today and again tomorrow. One day of
  -- slack absorbs a user genuinely ahead of the server's UTC date.
  if p_local_day > (now() at time zone 'utc')::date + 1 then
    raise exception 'Goal day is in the future.';
  end if;

  -- 0200 — this goal's crate embers that have NOT been revealed yet. The drip reveal stops short of
  -- them so the crate reveal can count the rest; see the header.
  v_pending := case
    when v_goal.reward_seen_at is null and v_goal.reward_payload is not null
      then coalesce((v_goal.reward_payload ->> 'embers')::int, 0)
    else 0
  end;

  -- ── difficulty, derived ──
  -- A weekly goal's target covers seven days, so compare it against seven times the daily
  -- threshold; that keeps "70k steps a week" and "10k steps a day" reading as equally ambitious.
  v_scale := case when v_goal.period = 'week' then 7 else 1 end;
  v_difficulty := case
    -- 0159 — A SCOPED CUSTOM GOAL READS ITS TIER, NOT THE FLOOR.
    --
    -- The arm below this one is the floor that was here: "custom is free-text and self-defined, so
    -- its target compares to nothing — 'read 10 pages' and 'read 10 books' are both 10." That is
    -- still true of the TARGET, and it is why the threshold ladder underneath cannot tier a custom
    -- goal. What changed is that the goal now carries a tier of its own, scoped from the described
    -- feat rather than derived from its number, so there is finally something to read.
    --
    -- The floor arm stays, and it is not vestigial: every custom goal written before scoping
    -- existed has difficulty_tier null and must keep paying exactly what it paid yesterday.
    when v_goal.type = 'custom' and v_goal.difficulty_tier is not null then v_goal.difficulty_tier
    when v_goal.type = 'custom' then 'easy'
    when (v_diff_cfg -> v_goal.type ->> 'ambitious') is null then 'easy'
    when (v_diff_cfg -> v_goal.type ->> 'ambitious')::numeric > 0
         and v_goal.target >= (v_diff_cfg -> v_goal.type ->> 'ambitious')::numeric * v_scale then 'ambitious'
    when (v_diff_cfg -> v_goal.type ->> 'moderate')::numeric > 0
         and v_goal.target >= (v_diff_cfg -> v_goal.type ->> 'moderate')::numeric * v_scale then 'moderate'
    else 'easy'
  end;

  -- v_difficulty now holds EITHER one of the three legacy levels (easy/moderate/ambitious) or one
  -- of the six tiers, so both vocabularies resolve here and nowhere else. tier_payout is consulted
  -- first because only a tier can appear in it; a legacy level misses and falls through.
  --
  -- THE DRIP IS CAPPED BY DESIGN and the tiers barely spread it (12 → 25 across all six). The
  -- tier's real value is the COMPLETION box, not a bigger daily trickle — a Legendary goal paying
  -- Legendary embers every day for sixteen weeks would blow through the ~300/week ceiling on its
  -- own and turn a prestige feat into an ember faucet (CHALLENGE_REWARD_ALGO §Guardrails).
  v_daily := coalesce(
    (v_tier_cfg -> v_difficulty ->> 'drip')::int,
    (v_cfg -> 'daily' ->> v_difficulty)::int,
    (v_cfg -> 'daily' ->> 'easy')::int,
    12
  );

  -- Claim the day FIRST so the streak count below includes today.
  insert into goal_day_awards (goal_id, user_id, local_day, embers, streak_len)
  values (p_goal_id, v_user, p_local_day, 0, 0)
  on conflict (goal_id, user_id, local_day) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object(
      'already_awarded', true,
      'embers', (select embers from goal_day_awards
                  where goal_id = p_goal_id and user_id = v_user and local_day = p_local_day),
      'milestone', 0,
      'goal_id', p_goal_id,
      'period', v_goal.period
    );
  end if;

  -- ── streak, derived ──
  -- Consecutive awarded days ending at p_local_day. The trick is the row_number: walking the days
  -- backwards, a genuinely unbroken run has (p_local_day - local_day) exactly equal to the row's
  -- zero-based position, and the first day where those diverge is the gap that ends the streak.
  select count(*) into v_streak
  from (
    select
      p_local_day - gda.local_day as gap,
      (row_number() over (order by gda.local_day desc)) - 1 as rn
    from goal_day_awards gda
    where gda.goal_id = p_goal_id
      and gda.user_id = v_user
      and gda.local_day <= p_local_day
  ) t
  where t.gap = t.rn;

  -- Milestone only on the exact day the streak reaches a listed length, so a 30-day run pays 3, 7,
  -- 14 and 30 once each as it passes them rather than re-paying 7 every day after day seven.
  v_milestone := coalesce((v_cfg -> 'milestones' ->> v_streak::text)::int, 0);

  -- The weekly ceiling, applied across drip and milestone together and measured before either is
  -- paid, so a milestone cannot tip a user past the cap.
  v_room := greatest(0, coalesce((v_cfg ->> 'weekly_cap')::int, 300) - economy_goal_embers_this_week(v_user));

  v_paid_daily := least(v_daily, v_room);
  if v_paid_daily > 0 then
    perform economy_move_embers(v_user, v_paid_daily, 'goal_daily', p_goal_id);
    v_room := v_room - v_paid_daily;
  end if;

  v_paid_milestone := least(v_milestone, v_room);
  if v_paid_milestone > 0 then
    perform economy_move_embers(v_user, v_paid_milestone, 'goal_streak', p_goal_id);
  end if;

  -- The 30-day milestone also mints a box. Gated on the milestone actually having been PAID, so a
  -- user who hit the weekly ceiling doesn't silently get the box without the embers.
  if v_streak = coalesce((v_cfg ->> 'milestone_box_at')::int, 30) and v_paid_milestone > 0 then
    v_box := v_cfg ->> 'milestone_box_key';
    insert into loot_boxes (user_id, box_key, obtained_via, provenance)
    values (v_user, v_box, 'challenge', v_streak || '-day goal streak');
  end if;

  update goal_day_awards
     set embers = v_paid_daily + v_paid_milestone,
         streak_len = v_streak
   where goal_id = p_goal_id and user_id = v_user and local_day = p_local_day;

  return jsonb_build_object(
    'already_awarded', false,
    'embers', v_paid_daily,
    'milestone', v_paid_milestone,
    'box', v_box,
    'streak', v_streak,
    'difficulty', v_difficulty,
    'capped', (v_daily + v_milestone) > (v_paid_daily + v_paid_milestone),
    -- 0200 — what the reveal needs to count a TRUE balance, and to name the period.
    'goal_id', p_goal_id,
    'period', v_goal.period,
    'balance', (select balance from ember_wallet where user_id = v_user),
    'pending_reward_embers', v_pending
  );
end;
$function$;

-- ───────────────────────────── backfill ─────────────────────────────

-- Historical recurring receipts that were never revealed. Stamped rather than replayed: they are
-- weeks old in places, and the widened inbox would otherwise open every one of them at once.
update challenges
   set reward_seen_at = now()
 where period <> 'once'
   and reward_payload is not null
   and reward_seen_at is null;

do $assert$
begin
  if (select prosrc from pg_proc where proname = 'get_unseen_goal_rewards') ~ 'c\.period = ''once''' then
    raise exception '0200: get_unseen_goal_rewards still filters to one-time goals';
  end if;
  if (select prosrc from pg_proc where proname = 'economy_on_challenge_completed') !~ 'reward_seen_at = null' then
    raise exception '0200: economy_on_challenge_completed does not re-arm the receipt';
  end if;
  if (select prosrc from pg_proc where proname = 'economy_award_goal_day_for') !~ 'pending_reward_embers' then
    raise exception '0200: economy_award_goal_day_for does not report pending_reward_embers';
  end if;
  if exists (select 1 from challenges where period <> 'once' and reward_payload is not null and reward_seen_at is null) then
    raise exception '0200: historical recurring receipts were not stamped seen';
  end if;
end;
$assert$;
