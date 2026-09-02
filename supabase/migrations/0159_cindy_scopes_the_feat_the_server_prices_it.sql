-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 0159 · CINDY SCOPES THE FEAT; THE SERVER PRICES IT. And the honor discount ships in the same
--        migration, because raising the ceiling without it is a mint hole.
--
-- Spec: DIFFICULTY_SCOPING.md (rubric, calibration table, anti-cheese), extending
-- CHALLENGE_CINDY_SCOPING.md §Verification and CHALLENGE_REWARD_ALGO.md.
--
-- ─────────────────────────── WHAT WAS ACTUALLY FLOORED, AND WHERE ───────────────────────────
--
-- The brief said "grant_reward maps everything to the floor box". It does not — and the real
-- mechanism matters, because it is in a different function and it floors far more than custom.
-- Read live from prod before writing a line of this:
--
--   · grant_reward IS ALREADY TIERED. It computes
--         significance = difficulty × log(scope+1) × duration/7 × (1 − placement)
--     and bands it: >=24 apex/promethean, >=12 elite/hephaestus, >=6 impressive/hestia,
--     >=3 notable/furnace, >=1 casual/ignition, else completion/no-box. That five-box ladder is
--     ALREADY the spec's tier→box table, exactly, one for one. Nothing needed to be built for it.
--
--   · THE FLOOR IS THE CALLER. economy_on_challenge_completed — the trigger that fires when any
--     personal goal's completed_at is set — passes a LITERAL difficulty of 1.0:
--
--         perform grant_reward(new.user_id, 'friend_h2h', 1.0,
--                              case when new.period = 'week' then 7 else 1 end, 1, 0.0, true, new.id);
--
--     With scope 1 (log(2)=0.30, floored to 1), duration 1 or 7 (÷7, floored to 1) and placement 0
--     (×1), significance is exactly 1.0 — which lands on the `>= 1` arm and mints casual/ignition.
--     Every completed personal goal, of every type, has always paid an Ignition Crate. Not custom
--     goals specifically: ALL of them. A 10k-step goal and a backflip minted the same crate.
--
--   · THE SECOND FLOOR IS THE DRIP. economy_award_goal_day_for carries the arm the brief names:
--         when v_goal.type = 'custom' then 'easy'
--     resolving to goal_rewards.daily.easy = 12 embers/day. `goal_difficulty.custom` is the
--     {"moderate":0,"ambitious":0} sentinel, and 0085's two `> 0` guards mean it could never have
--     tiered anyway — the CASE arm and the sentinel are two independent statements of one policy.
--
--   · ALREADY DISCOUNTED, and the pattern to copy: economy_on_social_challenge_closed (0145) does
--     honour-based grade races by scaling p_difficulty and ceilinging p_max_band. Both are existing
--     grant_reward parameters. This migration uses the same two knobs rather than inventing a
--     second reward formula, which is why grant_reward itself is left BYTE-UNTOUCHED.
--
--   · NOT PRESENT AT ALL: economy_config.tier_payout, challenges.difficulty_tier,
--     challenges.verifiability, compute_challenge_reward, preview_challenge_reward.
--
-- ─────────────────────────── THE HARD GATE ───────────────────────────
--
-- Raising the ceiling alone reopens the hole the floor was plugging: type "run a marathon", tick
-- it done, collect a Legendary crate. So the discount is in this same file, in goal_paid_band():
--
--     auto            → the scoped band, in full.
--     honor (default) → one band DOWN, and never above 'notable' (Rare / The Furnace).
--
-- The "never above notable" cap is the spec's §anti-cheese minimum, and it is stricter than a bare
-- −1 for exactly the case that matters: a typed marathon scopes Legendary, drops to Epic on the
-- −1, and is then held at Rare by the cap. YOU CANNOT MINT A TOP BOX BY DESCRIBING A HARD THING.
-- You mint it by doing the checkable version, where verifiability = 'auto' and no discount applies.
--
-- WHAT IS DELIBERATELY NOT HERE: the −10% / −20% CURRENCY trim. The band drop already lowers the
-- embers (each band reads its own figure from reward_bands), and the extra percentage would need a
-- p_currency_mult parameter on grant_reward — a signature change to a function with three callers,
-- which is precisely the overload trap MIGRATIONS.md says has reached prod three times. It wants
-- its own migration with the stale signature dropped explicitly. The box discount, which is the
-- part that actually gates minting, is here in full.
--
-- 🔒 THE FIREWALL HOLDS. Cindy proposes a tier; nothing here trusts a client. The columns carry a
-- CHECK constraint over the six names, the payout is re-derived server-side from the stored tier
-- plus economy_config, and preview_challenge_reward GRANTS NOTHING — it is a pure read that exists
-- so the create screen can show the server's own number instead of one Cindy made up.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── §1 · the scoped tier lives on the row ───────────────────────────

alter table challenges
  add column if not exists difficulty_tier text,
  add column if not exists verifiability text;

alter table social_challenges
  add column if not exists difficulty_tier text,
  add column if not exists verifiability text;

-- NULLABLE, and null means "never scoped". Every goal and challenge written before today keeps
-- that value and therefore keeps its exact current payout — this migration cannot change what an
-- in-flight goal pays out, only what a newly scoped one does.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'challenges_difficulty_tier_valid') then
    alter table challenges add constraint challenges_difficulty_tier_valid
      check (difficulty_tier is null or difficulty_tier in
             ('common','uncommon','rare','epic','legendary','mythic'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'challenges_verifiability_valid') then
    alter table challenges add constraint challenges_verifiability_valid
      check (verifiability is null or verifiability in ('auto','honor'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_challenges_difficulty_tier_valid') then
    alter table social_challenges add constraint social_challenges_difficulty_tier_valid
      check (difficulty_tier is null or difficulty_tier in
             ('common','uncommon','rare','epic','legendary','mythic'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_challenges_verifiability_valid') then
    alter table social_challenges add constraint social_challenges_verifiability_valid
      check (verifiability is null or verifiability in ('auto','honor'));
  end if;
end $$;

comment on column challenges.difficulty_tier is
  '0159 — the ACHIEVEMENT tier Cindy scoped for this feat (DIFFICULTY_SCOPING.md grid). Null on every goal created before scoping existed, which keeps its legacy payout. What is PAID runs through goal_paid_band(), which applies the verifiability discount.';
comment on column challenges.verifiability is
  '0159 — auto (app-tracked, pays the full scoped tier) or honor (self-reported, pays one band down and never above notable). Null is treated as honor: an unscoped claim is not a verified one.';

-- ─────────────────────────── §2 · tier → band → box, as server config ───────────────────────────
--
-- `significance` is the number handed to grant_reward as p_difficulty, chosen so that a goal at
-- scope 1 / placement 0 / duration <= 7 lands exactly on that band's threshold in the ladder
-- grant_reward already had. `band` is then passed as p_max_band so a longer duration cannot push
-- the goal a band ABOVE what it was scoped at — significance picks the band, the cap pins it.
--
-- `drip` is the daily ember trickle for a goal of this tier, and it is deliberately compressed.
insert into economy_config (key, value)
values ('tier_payout', jsonb_build_object(
  'common',    jsonb_build_object('band', 'completion', 'significance', 0.5,  'drip', 12, 'box', null),
  'uncommon',  jsonb_build_object('band', 'casual',     'significance', 1.0,  'drip', 14, 'box', 'ignition'),
  'rare',      jsonb_build_object('band', 'notable',    'significance', 3.0,  'drip', 18, 'box', 'furnace'),
  'epic',      jsonb_build_object('band', 'impressive', 'significance', 6.0,  'drip', 22, 'box', 'hestia'),
  'legendary', jsonb_build_object('band', 'elite',      'significance', 12.0, 'drip', 25, 'box', 'hephaestus'),
  'mythic',    jsonb_build_object('band', 'apex',       'significance', 24.0, 'drip', 25, 'box', 'promethean')
))
on conflict (key) do update set value = excluded.value;

-- ─────────────────────────── the discount, in one place ───────────────────────────

create or replace function goal_paid_band(p_tier text, p_verifiability text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_band text;
  v_down text;
begin
  -- Unscoped: no ceiling at all, which is what every caller passed before this existed.
  if p_tier is null then
    return null;
  end if;

  v_band := v_cfg -> p_tier ->> 'band';
  if v_band is null then
    return null;
  end if;

  -- Auto-tracked pays the scoped tier in full. This is the ONLY path to the top two boxes, and it
  -- is reachable only by doing the thing in a form the app can observe.
  if p_verifiability = 'auto' then
    return v_band;
  end if;

  -- Honor (and null, which is treated as honor): one band down...
  v_down := case v_band
    when 'apex'       then 'elite'
    when 'elite'      then 'impressive'
    when 'impressive' then 'notable'
    when 'notable'    then 'casual'
    when 'casual'     then 'completion'
    else 'completion'
  end;

  -- ...and then held at 'notable' (Rare / The Furnace) however high the scope was. Without this a
  -- typed "ran a marathon" would still land on Epic through the −1 alone.
  if reward_band_rank(v_down) > reward_band_rank('notable') then
    return 'notable';
  end if;
  return v_down;
end;
$$;

comment on function goal_paid_band(text, text) is
  '0159 — the verifiability discount. auto pays the scoped band; honor pays one band down, capped at notable. The single place the anti-cheese rule lives, so the drip, the completion grant and the preview cannot disagree about it.';

-- ─────────────────────────── §2 · the completion grant reads the tier ───────────────────────────

create or replace function economy_on_challenge_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_sig numeric;
  v_cap text;
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;

  -- WAS A LITERAL 1.0 — see the header. That constant is what made every completed goal an
  -- Ignition Crate, and it is also the reason `uncommon` is pinned at significance 1.0 in
  -- tier_payout: an unscoped goal resolves to exactly the number that was hard-coded here, so
  -- nothing in flight changes what it pays.
  v_sig := coalesce((v_cfg -> coalesce(new.difficulty_tier, '') ->> 'significance')::numeric, 1.0);
  v_cap := goal_paid_band(new.difficulty_tier, new.verifiability);

  perform grant_reward(
    new.user_id, 'friend_h2h', v_sig,
    case when new.period = 'week' then 7 else 1 end,
    1, 0.0, true, new.id,
    -- The ceiling is where the honor discount lands. grant_reward lowers the band, the box AND the
    -- badge together when it applies one, so a discounted goal cannot keep an elite badge on a
    -- notable box. Null for an unscoped goal, which is the argument it was already defaulting to.
    v_cap
  );
  perform evaluate_pass_achievements(new.user_id);
  return new;
end;
$$;

-- ─────────────────────────── §2 · the daily drip reads the tier ───────────────────────────
--
-- Rebuilt from prod's OWN prosrc with three targeted edits and nothing else touched — a
-- create-or-replace restated from a migration file would silently revert whatever a sibling branch
-- changed in between, which this repo has been bitten by.

create or replace function economy_award_goal_day_for(
  p_goal_id uuid,
  p_user uuid,
  p_local_day date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $award$
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
      'milestone', 0
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
    'capped', (v_daily + v_milestone) > (v_paid_daily + v_paid_milestone)
  );
end;
$award$;

-- ─────────────────────────── §3 · the honest tease, computed server-side ───────────────────────────

create or replace function preview_challenge_reward(
  p_tier text,
  p_verifiability text default 'honor',
  p_duration_days int default 1,
  p_scope int default 1
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_cfg jsonb := (select value from economy_config where key = 'tier_payout');
  v_bands jsonb := (select value from economy_config where key = 'reward_bands');
  v_full text;
  v_paid text;
  v_sig numeric;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if v_cfg -> p_tier is null then
    raise exception 'Unknown difficulty tier.';
  end if;

  v_full := v_cfg -> p_tier ->> 'band';
  v_paid := goal_paid_band(p_tier, p_verifiability);
  v_sig  := (v_cfg -> p_tier ->> 'significance')::numeric
          * greatest(1, log(greatest(p_scope, 1)::numeric + 1))
          * greatest(1, p_duration_days::numeric / 7);

  -- 🔒 READ ONLY. No economy_move_embers, no loot_boxes insert, no badge. This exists so the create
  -- screen can print the SERVER's figure rather than one Cindy stated — the spec's firewall is that
  -- Cindy proposes a tier and never names an ember number.
  return jsonb_build_object(
    'tier', p_tier,
    'achievement_band', v_full,
    'paid_band', v_paid,
    'discounted', v_paid is distinct from v_full,
    'box', case coalesce(v_paid, v_full)
             when 'apex' then 'promethean' when 'elite' then 'hephaestus'
             when 'impressive' then 'hestia' when 'notable' then 'furnace'
             when 'casual' then 'ignition' else null end,
    'embers', coalesce((v_bands ->> coalesce(v_paid, v_full))::int, 10),
    'drip', (v_cfg -> p_tier ->> 'drip')::int,
    'significance', v_sig,
    'verifiability', coalesce(p_verifiability, 'honor')
  );
end;
$$;

revoke all on function preview_challenge_reward(text, text, int, int) from public;
grant execute on function preview_challenge_reward(text, text, int, int) to authenticated;

-- goal_paid_band is an internal, per 0132's rule that an economy internal is not an RPC. The
-- preview above is the supported way for a client to learn what a tier pays.
revoke all on function goal_paid_band(text, text) from public;
revoke all on function goal_paid_band(text, text) from authenticated;

-- ─────────────────────────── the anti-cheese, asserted at deploy ───────────────────────────
--
-- These are the three worked cases from the spec. They run against the functions this migration
-- just created, so the file cannot land with the gate open.
do $assert$
declare
  v text;
begin
  -- (a) Strava-synced marathon: auto → full Legendary → Hephaestus' Chest.
  v := goal_paid_band('legendary', 'auto');
  if v is distinct from 'elite' then
    raise exception 'anti-cheese: auto legendary should pay elite, got %', coalesce(v, 'null');
  end if;

  -- (b) Typed-done marathon, no proof: honor → −1 is elite→impressive, then the cap holds it at
  --     notable. The Furnace, not Hephaestus' Chest. This is the mint hole staying shut.
  v := goal_paid_band('legendary', 'honor');
  if v is distinct from 'notable' then
    raise exception 'anti-cheese: honor legendary must cap at notable, got %', coalesce(v, 'null');
  end if;

  -- (c) Unvouched backflip: Epic → impressive −1 = notable. The Furnace, per the spec's worked
  --     example. A vouch/clip flips verifiability to auto and restores the Vessel of Hestia.
  v := goal_paid_band('epic', 'honor');
  if v is distinct from 'notable' then
    raise exception 'anti-cheese: honor epic should pay notable, got %', coalesce(v, 'null');
  end if;
  if goal_paid_band('epic', 'auto') is distinct from 'impressive' then
    raise exception 'anti-cheese: auto epic should pay impressive';
  end if;

  -- Mythic cannot be self-granted either, by the same cap.
  if goal_paid_band('mythic', 'honor') is distinct from 'notable' then
    raise exception 'anti-cheese: honor mythic must cap at notable';
  end if;

  -- An unscoped goal keeps its exact previous behaviour: no ceiling, and the significance
  -- coalesce in the trigger falls back to the 1.0 that used to be hard-coded there.
  if goal_paid_band(null, null) is not null then
    raise exception 'unscoped goals must pass a null ceiling';
  end if;
end
$assert$;
