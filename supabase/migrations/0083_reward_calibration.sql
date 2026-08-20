-- §B — reward calibration + the personal-goal drip/streak path (CHALLENGE_REWARD_ALGO.md).
--
-- Three things happen here:
--   1. grant_reward's band payouts move OUT of the function body and INTO economy_config, and are
--      recalibrated to the ALGO numbers. §5 says "all amounts are server config, not client
--      constants" — they were neither: they were server constants baked into a function body, so a
--      rebalance meant a migration. Now it's an UPDATE.
--   2. The daily personal-goal drip + streak milestones, which the engine never had.
--   3. The ~300/week earned-ember ceiling from goals.
--
-- WHAT THIS CHANGES FOR EXISTING USERS: the old bands paid 1200/600/300/150/60/25. The ALGO
-- calibration is 500/200/90/45/20/10 — between 2x and 6x lower. That is the intended correction
-- (the old numbers predate the ember economy being priced), but it is a real, visible reduction in
-- what a win pays, and it applies to challenges already in flight. Nothing is clawed back; only
-- payouts made from here are affected.

-- ───────────────────────────── 1. bands as config ─────────────────────────────

insert into economy_config (key, value) values
  ('reward_bands', '{"apex":500,"elite":200,"impressive":90,"notable":45,"casual":20,"completion":10,"unverified":10}')
on conflict (key) do update set value = excluded.value;

-- The goal path's numbers. `daily` is keyed by the same difficulty signal the XP algo uses;
-- `milestones` is keyed by streak length in days, read as "the largest milestone <= streak".
-- `weekly_cap` is the anti-stacking rail: a perfect ambitious week is ~235, so 300 leaves headroom
-- for one goal without letting someone run a dozen in parallel for unbounded embers.
insert into economy_config (key, value) values
  ('goal_rewards', '{"daily":{"easy":12,"moderate":18,"ambitious":25},"milestones":{"3":30,"7":60,"14":150,"30":400},"milestone_box_at":30,"milestone_box_key":"furnace","weekly_cap":300}')
on conflict (key) do update set value = excluded.value;

-- ───────────────────────────── 2. grant_reward reads config ─────────────────────────────

-- Return type and signature are unchanged, so CREATE OR REPLACE is safe here — unlike 0081, where
-- a void -> int change needed a drop first.
create or replace function grant_reward(
  p_user uuid, p_type text, p_difficulty numeric, p_duration_days int,
  p_scope int, p_placement_pct numeric, p_verified boolean, p_ref uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sig numeric;
  v_embers int;
  v_box text;
  v_badge text;
  v_band text;
  v_bands jsonb := (select value from economy_config where key = 'reward_bands');
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
begin
  if not p_verified then
    v_embers := coalesce((v_bands ->> 'unverified')::int, 10);
    perform economy_move_embers(p_user, v_embers, 'challenge_win', p_ref);
    return jsonb_build_object('embers', v_embers, 'box', null, 'badge', null, 'band', 'completion');
  end if;

  -- Significance is UNTOUCHED. The thresholds below still carve the same curve; only what each
  -- band pays has moved, so the relative ordering of "how impressive was this" is preserved.
  v_sig := p_difficulty
         * greatest(1, log(greatest(p_scope, 1)::numeric + 1))
         * greatest(1, p_duration_days::numeric / 7)
         * greatest(0.2, 1 - coalesce(p_placement_pct, 1));

  if    v_sig >= 24 then v_band := 'apex';       v_box := 'promethean';
  elsif v_sig >= 12 then v_band := 'elite';      v_box := 'hephaestus';
  elsif v_sig >= 6  then v_band := 'impressive'; v_box := 'hestia';
  elsif v_sig >= 3  then v_band := 'notable';    v_box := 'furnace';
  elsif v_sig >= 1  then v_band := 'casual';     v_box := 'ignition';
  else                   v_band := 'completion'; v_box := null;
  end if;

  -- coalesce so a malformed/missing config row degrades to the completion floor rather than
  -- writing a NULL delta into the ledger.
  v_embers := coalesce((v_bands ->> v_band)::int, 10);

  perform economy_move_embers(p_user, v_embers, case when p_type = 'season' then 'season_reward' else 'challenge_win' end, p_ref);

  if v_box is not null then
    insert into loot_boxes (user_id, box_key, obtained_via, provenance)
    values (p_user, v_box, case when p_type = 'season' then 'season' else 'challenge' end,
            case when p_type = 'season' then 'Season reward · ' || v_season else 'Challenge reward' end);
  end if;

  -- The prestige half (§5 / 21c): the top two bands mint an UN-BUYABLE earned badge. This is what
  -- the biggest wins are actually for — the embers above are the same currency anyone can buy, so
  -- on their own they'd make a season win feel purchasable.
  if v_band in ('elite', 'apex') then
    v_badge := case
      when p_type = 'season' then 'season-' || v_band || '-' || v_season
      else 'challenge-' || v_band
    end;
    perform economy_grant_badge(
      p_user, v_badge,
      case when p_type = 'season'
        then 'Season ' || v_season || ' · ' || initcap(v_band) || ' finish'
        else initcap(v_band) || ' challenge win'
      end
    );
  end if;

  return jsonb_build_object('embers', v_embers, 'box', v_box, 'badge', v_badge, 'band', v_band, 'significance', v_sig);
end;
$$;

-- ───────────────────────────── 3. the personal-goal drip ─────────────────────────────

-- One row per (goal, user, LOCAL day) that has already paid. This table IS the idempotency
-- guarantee §B asks for: the primary key makes a second award for the same local day a no-op, so
-- the awarding function can be re-run by a retry, a re-sync, or a duplicate Health callback
-- without paying twice.
--
-- local_day is a DATE carrying the user's own calendar day, not a timestamp. The spec's "reset at
-- user-local midnight, not UTC" is only meaningful if the key we dedupe on is the local day —
-- storing UTC and converting on read would put a user in UTC+13 on the wrong day for eleven hours.
create table if not exists goal_day_awards (
  goal_id uuid not null references challenges (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  local_day date not null,
  embers int not null,
  streak_len int not null default 0,
  created_at timestamptz not null default now(),
  primary key (goal_id, user_id, local_day)
);

create index if not exists goal_day_awards_user_day_idx on goal_day_awards (user_id, local_day desc);

alter table goal_day_awards enable row level security;
drop policy if exists goal_day_awards_read_own on goal_day_awards;
create policy goal_day_awards_read_own on goal_day_awards
  for select to authenticated using (user_id = auth.uid());
-- No write policy: economy_award_goal_day is security definer and is the only writer.

-- Embers earned from goals in the last 7 days, off the ledger itself — same reasoning as the
-- lock-in daily cap in 0065: the ledger is the record, so deriving the cap from it means the cap
-- can never drift out of sync with what was actually paid.
create or replace function economy_goal_embers_this_week(p_user uuid)
returns int
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(delta), 0)::int
  from ember_ledger
  where user_id = p_user
    and reason in ('goal_daily', 'goal_streak')
    and created_at >= now() - interval '7 days';
$$;

/**
 * Award one day of a personal goal, plus any streak milestone that day completes.
 *
 * Idempotent on (goal, user, local_day) — the insert below is the guard, so callers do not need
 * to know whether today already paid.
 *
 * p_local_day is passed IN by the caller rather than computed here: the server has no reliable
 * view of the user's timezone (profiles carries no tz column today), and using now() would reset
 * everyone at UTC midnight, which is the exact bug §A3 reports. The client knows its own calendar
 * day; this function only has to make sure a given local day can pay once.
 */
create or replace function economy_award_goal_day(
  p_goal_id uuid,
  p_difficulty text,          -- 'easy' | 'moderate' | 'ambitious'
  p_local_day date,
  p_streak_len int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cfg jsonb := (select value from economy_config where key = 'goal_rewards');
  v_daily int;
  v_milestone int := 0;
  v_milestone_key text;
  v_box text;
  v_room int;
  v_paid_daily int := 0;
  v_paid_milestone int := 0;
  v_inserted int;
begin
  if v_user is null then
    raise exception 'Not signed in.';
  end if;

  -- The goal must be the caller's own. Without this any user could award themselves against
  -- somebody else's goal id, and security definer means RLS would not stop them.
  if not exists (select 1 from challenges c where c.id = p_goal_id and c.user_id = v_user) then
    raise exception 'That goal is not yours.';
  end if;

  -- A future local day would let a client mint tomorrow's drip today, and then again tomorrow.
  -- One day of slack absorbs a user genuinely ahead of the server's UTC date.
  if p_local_day > (now() at time zone 'utc')::date + 1 then
    raise exception 'Goal day is in the future.';
  end if;

  v_daily := coalesce((v_cfg -> 'daily' ->> p_difficulty)::int, (v_cfg -> 'daily' ->> 'easy')::int, 12);

  -- Claim the day FIRST. If this conflicts, the day already paid and we return what it paid
  -- rather than raising — a duplicate call is a retry, not an error.
  insert into goal_day_awards (goal_id, user_id, local_day, embers, streak_len)
  values (p_goal_id, v_user, p_local_day, 0, greatest(p_streak_len, 0))
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

  -- Milestone only on the exact day the streak reaches a listed length, so a 30-day run pays 3, 7,
  -- 14 and 30 once each as it passes them rather than re-paying 7 every day after day seven.
  v_milestone_key := (p_streak_len)::text;
  v_milestone := coalesce((v_cfg -> 'milestones' ->> v_milestone_key)::int, 0);

  -- The weekly ceiling. Applied to the drip and the milestone together, and measured before
  -- either is paid, so a milestone cannot tip a user past the cap.
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
  if p_streak_len = coalesce((v_cfg ->> 'milestone_box_at')::int, 30) and v_paid_milestone > 0 then
    v_box := v_cfg ->> 'milestone_box_key';
    insert into loot_boxes (user_id, box_key, obtained_via, provenance)
    values (v_user, v_box, 'challenge', p_streak_len || '-day goal streak');
  end if;

  update goal_day_awards
     set embers = v_paid_daily + v_paid_milestone
   where goal_id = p_goal_id and user_id = v_user and local_day = p_local_day;

  return jsonb_build_object(
    'already_awarded', false,
    'embers', v_paid_daily,
    'milestone', v_paid_milestone,
    'box', v_box,
    'streak', p_streak_len,
    'capped', (v_daily + v_milestone) > (v_paid_daily + v_paid_milestone)
  );
end;
$$;

revoke all on function economy_award_goal_day(uuid, text, date, int) from public;
grant execute on function economy_award_goal_day(uuid, text, date, int) to authenticated;
