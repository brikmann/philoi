-- 0119 — the relic feeder. Recatalogues economy_evaluate_relics() to ITEM_CATALOG §4a/§4a-2/§4a-3,
-- adds the four discipline ladders as tracked PROGRESS (not just grants), adds Atlas' Burden and
-- Zeus' Bolt, gives walking a way into the Distance ladder, and widens the trigger so a day with
-- no lock-in still re-evaluates.
--
-- WHY THIS EXISTS: 0090 grants a catalog that no longer exists. It still checks Hestia's
-- Hearthstone (retired), Icarus at Gold (catalog says Hero), Prometheus at top 1% (catalog says
-- top 10% AND a referral) and Athena over a calendar month (catalog says 6 consecutive weeks).
-- Zeus' Bolt, Atlas' Burden and every discipline ladder have no evaluation logic at all — relics
-- could be earned, but nothing fed their progress. See LOGIC_AUDIT_2026-08.md §1.
--
-- ─────────────────────────── corrections to the drafted prompt ───────────────────────────
-- CODE_PROMPT_logic_fixes.md's 0119 draft was written against a schema that does not exist. Three
-- of its assumptions are wrong and are corrected here:
--
--   1. `check_ins` has NO `type` or `value` column. 'steps' is a CHALLENGES type (0035/0115), not
--      a check-in type. There is no persisted step count anywhere: syncStepsFromDevice reads the
--      pedometer live and logs a DELTA into challenge_logs, and only while a steps challenge is
--      running. So a "steps -> distance_m on check_ins insert" trigger would never fire, and
--      walking would still never reach the ladder. `user_step_days` below is the missing store.
--   2. The gym tables are `workouts / workout_exercises / workout_sets` (0037), not `gym_sets`,
--      and workout_sets has no path to `exercises` of its own — the exercise lives on
--      workout_exercises, which also carries the denormalised `name` the draft went looking for.
--   3. `session_discipline(session_id)` does not exist. A session's discipline is
--      `lock_in_sessions.goal_type` (0012). Mapped below rather than invented.
--
-- Two further deliberate departures from the draft, both to match the CURRENT ITEM_CATALOG:
--   · The ladders are FIVE NAMED RELICS on THREE ladders (§4a-2), not one relic per rung. Each
--     relic is granted ONCE and its rarity is raised through cosmetics_owned.rarity_override —
--     the column 0066 added for exactly this, and which collection.tsx / use-inventory.ts already
--     prefer over the catalog rarity. That is what makes "one showcase item that upgrades its
--     tier" render with no client change.
--   · Hours is per-discipline (Study · Deep Work · Meditate are three separate relics on the same
--     4-rung ladder), not one combined Hours ladder.

-- ───────────────────────── 0 · the index the evaluator needs to exist ─────────────────────────
--
-- lock_in_sessions has only a PARTIAL index, on (status, last_confirmed_at) WHERE status='active'
-- (0007) — built for the "who is locked in right now" presence query. Every relic branch that
-- reads hours filters on (user_id, status='completed'), which that index cannot serve, so each one
-- is a sequential scan of the whole table.
--
-- 0090 paid that cost twice per completed session and it never showed. This migration makes the
-- evaluator run on every check-in as well, and adds the discipline ladders — so without this the
-- change would turn one seq scan per lock-in into several per check-in, on the hottest write path
-- in the app. The index goes FIRST so nothing below is ever the version that ran without it.
create index if not exists lock_in_sessions_user_status_idx
  on lock_in_sessions (user_id, status);

-- ───────────────────────────── 1 · height, for the stride estimate ─────────────────────────────
--
-- Nullable. Nobody has entered a height yet, so the fallback below is what every existing user
-- gets until the onboarding step (design-mocks/128) collects one. 260 cm is above the tallest
-- recorded human — the check is there to reject a weight typed into the wrong field.
alter table profiles add column if not exists height_cm numeric
  check (height_cm is null or (height_cm > 50 and height_cm < 260));

-- 0.42 x height is the standard walking-stride estimate; 0.75 m is the adult-average fallback
-- (Noah's locked decision). Deliberately a function rather than a stored stride column: a height
-- correction must re-price every future day, and there is nothing to backfill.
create or replace function stride_m_for(p_user uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce((select p.height_cm / 100.0 * 0.42 from profiles p where p.id = p_user), 0.75);
$$;

/** Onboarding / profile writes the height. Own row only. */
create or replace function set_my_height_cm(p_height_cm numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update profiles set height_cm = p_height_cm where id = auth.uid();
end;
$$;

grant execute on function set_my_height_cm(numeric) to authenticated;

-- ───────────────────────────── 2 · steps get somewhere to live ─────────────────────────────
--
-- ONE ROW PER USER PER LOCAL DAY, not an append-only log. The device is asked "how many steps on
-- this date" and answers with a running total that only grows, so the natural write is an upsert
-- that takes the LARGER of the two: a re-sync at 9pm supersedes the one at noon, and a re-sync
-- from a second device that saw fewer steps cannot subtract. That makes the client's sync
-- idempotent without it having to track what it already sent — which is the problem the
-- challenge_logs delta-tracking in fitness-challenge-sync.ts exists to work around, and the
-- reason that path was never usable as a lifetime total.
--
-- `day` is the DEVICE's local date, passed in by the client, for the same reason 0084 rolls daily
-- goals at local midnight: a UTC day boundary counts yesterday evening's walk as today's west of
-- Greenwich and loses the morning east of it.
create table if not exists user_step_days (
  user_id uuid not null references profiles (id) on delete cascade,
  day date not null,
  steps int not null check (steps >= 0),
  source text not null default 'device'
    check (source in ('device', 'healthkit', 'health_connect', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create index if not exists user_step_days_user_idx on user_step_days (user_id, day desc);

alter table user_step_days enable row level security;
drop policy if exists user_step_days_read_own on user_step_days;
create policy user_step_days_read_own on user_step_days
  for select to authenticated using (user_id = auth.uid());
-- No insert/update policy: record_step_days() is the only writer, so a client cannot post a
-- million steps for a day it did not walk by writing the table directly.

/**
 * Record one or more days of steps for the caller.
 *
 * p_days is [{"day":"2026-08-27","steps":8412}, ...] — a batch, because the client syncs a
 * trailing window in one round trip rather than a call per day.
 *
 * NEVER DECREASES. See the table comment: greatest() is what makes a re-sync safe.
 * A future date is dropped rather than raising — a device with a wrong clock should not be able
 * to fail the whole batch, and tomorrow's row would only distort the ladder.
 */
create or replace function record_step_days(p_days jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_n int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  if jsonb_typeof(p_days) <> 'array' then raise exception 'p_days must be an array'; end if;

  insert into user_step_days (user_id, day, steps, source, updated_at)
  select v_user,
         (d ->> 'day')::date,
         greatest((d ->> 'steps')::int, 0),
         coalesce(d ->> 'source', 'device'),
         now()
  from jsonb_array_elements(p_days) d
  where (d ->> 'day') is not null
    and (d ->> 'steps') is not null
    and (d ->> 'day')::date <= (now() + interval '1 day')::date
  on conflict (user_id, day) do update
    set steps = greatest(user_step_days.steps, excluded.steps),
        source = excluded.source,
        updated_at = now();

  get diagnostics v_n = row_count;

  -- Walking is the only thing that moves the Distance ladder for a user with no Strava, so the
  -- ladder has to be re-read here or it would only ever update on their next lock-in.
  if v_n > 0 then perform economy_evaluate_relics(v_user); end if;
  return v_n;
end;
$$;

grant execute on function record_step_days(jsonb) to authenticated;

-- ───────────────────────────── 3 · what a session counts toward ─────────────────────────────
--
-- goal_type -> discipline family. `run` feeds Distance through check_ins.distance_m rather than
-- hours, so it maps to null here; `custom` is a catch-all and is deliberately unmapped rather
-- than quietly credited to a discipline the user did not pick.
--
-- 'deep_work' and 'meditate' are NOT current GoalType values (src/lib/goal-types.ts stops at
-- gym · run · study · job_applications · read · social_media · custom). They are mapped anyway so
-- Daedalus' Blueprint and Oracle's Stillness start accruing the moment those types are added,
-- with no migration. Until then Daedalus rides `job_applications` alone (the only focused-making
-- type that exists today) and Oracle's Stillness stays at zero — flagged in the handoff as a
-- product gap, not silently fudged by folding meditation into something else.
create or replace function session_discipline(p_goal_type text)
returns text
language sql
immutable
as $$
  select case p_goal_type
    when 'study' then 'study'
    when 'read' then 'study'                 -- §4a-2: "Reading counts as study."
    when 'deep_work' then 'deep_work'
    when 'job_applications' then 'deep_work' -- focused desk work; the only current type that fits
    when 'meditate' then 'meditate'
    else null
  end;
$$;

-- ───────────────────────────── 4 · the ladders, as data ─────────────────────────────
--
-- A TABLE rather than array literals inside the evaluator, for the same reason 0090 put the drop
-- allowlist in one: thresholds are explicitly "tunable" in §4a-2, and retuning should be an
-- UPDATE, not a migration that rewrites a 200-line function body.
--
-- Rung count differs per ladder by design (§4a-2 "Ceilings, by design"): Gym reaches Mythic over
-- five rungs (the only ladder that mints an Ω), Movement four, Hours caps at Legendary.
create table if not exists relic_ladders (
  family text primary key,
  relic_key text not null unique,
  unit text not null,
  thresholds numeric[] not null,
  rarities text[] not null,
  check (array_length(thresholds, 1) = array_length(rarities, 1))
);

alter table relic_ladders enable row level security;
drop policy if exists relic_ladders_read on relic_ladders;
-- Readable: unlike the §4a ancient relics, ladder thresholds are SHOWN ("the tap sheet shows the
-- next threshold"). Only the secret relics stay hidden.
create policy relic_ladders_read on relic_ladders for select to authenticated using (true);

insert into relic_ladders (family, relic_key, unit, thresholds, rarities) values
  ('volume',    'relic-hercules-might',       'lb', array[10000,25000,50000,100000,250000],
                                                    array['uncommon','rare','epic','legendary','mythic']),
  ('distance',  'relic-pheidippides-sandals', 'km', array[50,100,250,414],
                                                    array['rare','epic','legendary','mythic']),
  ('study',     'relic-socrates-scroll',      'h',  array[10,25,50,100],
                                                    array['uncommon','rare','epic','legendary']),
  ('deep_work', 'relic-daedalus-blueprint',   'h',  array[10,25,50,100],
                                                    array['uncommon','rare','epic','legendary']),
  ('meditate',  'relic-oracles-stillness',    'h',  array[10,25,50,100],
                                                    array['uncommon','rare','epic','legendary'])
on conflict (family) do update set
  relic_key  = excluded.relic_key,
  unit       = excluded.unit,
  thresholds = excluded.thresholds,
  rarities   = excluded.rarities;

-- The progress itself. THIS is what LOGIC_AUDIT §1 means by "nothing feeds their progress" — the
-- relic could be granted, but there was nowhere to record 43 of 50 km. One row per user per
-- ladder relic; `tier` is a high-water mark and never falls, so a deleted check-in cannot take a
-- rung back off someone.
create table if not exists relic_progress (
  user_id uuid not null references profiles (id) on delete cascade,
  relic_key text not null,
  family text not null,
  value numeric not null default 0,
  tier int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, relic_key)
);

create index if not exists relic_progress_user_idx on relic_progress (user_id);

alter table relic_progress enable row level security;
drop policy if exists relic_progress_read_own on relic_progress;
create policy relic_progress_read_own on relic_progress
  for select to authenticated using (user_id = auth.uid());

-- ───────────────────────────── 5 · per-relic display names ─────────────────────────────
--
-- The catalog lives in the client bundle on purpose (0064) and this does NOT mirror it — it is a
-- dozen names, needed server-side because a push notification's TITLE is composed here, and
-- "Relic earned" is what 0090 has been sending for every one of them (LOGIC_AUDIT §4). Falls back
-- to the key so a relic added to the catalog before this map still notifies rather than raising.
--
-- Declared BEFORE economy_apply_relic_ladder, which calls it.
create or replace function relic_display_name(p_key text)
returns text
language sql
immutable
as $$
  select case p_key
    when 'relic-athenas-aegis'        then 'Athena''s Aegis'
    when 'relic-anvil-of-hephaestus'  then 'Anvil of Hephaestus'
    when 'relic-icarus-feather'       then 'Icarus'' Feather'
    when 'relic-prometheus-shard'     then 'Prometheus'' Shard'
    when 'relic-zeus-bolt'            then 'Zeus'' Bolt'
    when 'relic-atlas-burden'         then 'Atlas'' Burden'
    when 'relic-hercules-might'       then 'Hercules'' Might'
    when 'relic-pheidippides-sandals' then 'Pheidippides'' Sandals'
    when 'relic-socrates-scroll'      then 'Socrates'' Scroll'
    when 'relic-daedalus-blueprint'   then 'Daedalus'' Blueprint'
    when 'relic-oracles-stillness'    then 'Oracle''s Stillness'
    when 'relic-crown-of-olympus'     then 'Crown of Olympus'
    when 'relic-hestias-hearthstone'  then 'Hestia''s Hearthstone'
    else p_key
  end;
$$;

/**
 * Fold one ladder's lifetime value into relic_progress, granting and upgrading as rungs fall.
 *
 * Returns the tier now held (0 = below the first rung).
 *
 * THREE THINGS HAPPEN ON A RUNG, and only on a rung that is genuinely new:
 *   1. first rung  — the relic is granted through economy_grant_relic (0090), which is idempotent
 *      and fires its own bell row.
 *   2. every rung  — cosmetics_owned.rarity_override is raised to that rung's rarity, which is
 *      how the tile's glow moves from green to red without a second inventory item existing.
 *   3. rungs 2+    — a bell row of its own, because economy_grant_relic only speaks on the grant.
 *
 * `value` is written on EVERY call even when no rung falls: the whole point is that the tap sheet
 * can show 43 / 50 km.
 */
create or replace function economy_apply_relic_ladder(p_user uuid, p_family text, p_value numeric)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ladder relic_ladders;
  v_tier int := 0;
  v_prev int := 0;
  v_i int;
  v_rarity text;
  -- §4a-2's rung glyphs, paired with the Roman numeral the catalog tables use. Colour is rarity,
  -- letter is rung, and they are independent — so a maxed Movement relic reads red + δ while a
  -- maxed Gym relic reads red + Ω, and copy that said only "Mythic" would lose that distinction.
  v_greek text[] := array['α', 'β', 'γ', 'δ', 'Ω'];
  v_roman text[] := array['I', 'II', 'III', 'IV', 'V'];
  v_name text;
  v_threshold text;
  v_rung text;
begin
  select * into v_ladder from relic_ladders where family = p_family;
  if v_ladder.family is null then return 0; end if;

  for v_i in 1 .. array_length(v_ladder.thresholds, 1) loop
    if p_value >= v_ladder.thresholds[v_i] then v_tier := v_i; end if;
  end loop;

  select coalesce(rp.tier, 0) into v_prev
  from relic_progress rp
  where rp.user_id = p_user and rp.relic_key = v_ladder.relic_key;
  v_prev := coalesce(v_prev, 0);

  insert into relic_progress (user_id, relic_key, family, value, tier, updated_at)
  values (p_user, v_ladder.relic_key, p_family, p_value, v_tier, now())
  on conflict (user_id, relic_key) do update
    set value = excluded.value,
        -- greatest(): a rung already reached is never revoked, even if the underlying total
        -- somehow falls (a removed check-in, a deleted workout).
        tier = greatest(relic_progress.tier, excluded.tier),
        updated_at = now();

  if v_tier <= v_prev then return greatest(v_prev, v_tier); end if;

  v_rarity := v_ladder.rarities[v_tier];
  v_name := relic_display_name(v_ladder.relic_key);
  -- Every threshold in the ladder table is a whole number (10,000 lb · 414 km · 100 h), so this
  -- is the integer mask deliberately: 'D99' would render "10,000.00 lb" in a push notification.
  v_threshold := trim(to_char(v_ladder.thresholds[v_tier], 'FM999G999G999'));
  v_rung := format('%s %s', v_roman[v_tier], v_greek[v_tier]);

  if v_prev = 0 then
    perform economy_grant_relic(p_user, v_ladder.relic_key, v_rarity,
      format('Tier %s — %s %s. The ladder has begun.', v_rung, v_threshold, v_ladder.unit));
  else
    perform notify_event(
      array[p_user], 'reward_ready',
      format('%s upgraded', v_name),
      format('Tier %s — %s %s. The relic burns hotter.', v_rung, v_threshold, v_ladder.unit),
      null, null,
      '/inventory', '{}'::jsonb,
      null, 'rounded',
      jsonb_build_object('relic', v_ladder.relic_key, 'rarity', v_rarity,
                         'tier', v_tier, 'family', p_family)
    );
  end if;

  -- The tile's colour. Applied AFTER the grant so the first rung sets it too.
  update cosmetics_owned
     set rarity_override = v_rarity
   where user_id = p_user and cosmetic_key = v_ladder.relic_key;

  return v_tier;
end;
$$;

-- ───────────────────────────── 6 · the referral gate ─────────────────────────────
--
-- ⚠️ THERE IS NO REFERRAL SYSTEM. Grepped every migration: nothing attributes a signup to an
-- inviter, and there is no invite code on profiles. §4a's Prometheus' Shard needs BOTH a top-10%
-- season finish AND a referral, so it ships DORMANT rather than half-defined — a stub that always
-- says false is the only honest reading of "did they refer someone" when nothing records it.
--
-- This deliberately makes Prometheus HARDER than 0090 did (top 1% alone used to grant it).
-- Already-owned copies are untouched; only new grants stop. Replacing this function's body is all
-- that is needed once referrals land.
create or replace function has_successful_referral(p_user uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select false;
$$;

comment on function has_successful_referral(uuid) is
  'STUB — always false. No referral system exists (LOGIC_AUDIT §1, CODE_PROMPT_logic_fixes "Referral blocker"). Prometheus'' Shard cannot grant until this is implemented. Replace the body; nothing else changes.';

-- ───────────────────────────── 7 · the recatalogued evaluator ─────────────────────────────
--
-- Replaces 0090's body wholesale. Hestia is GONE from the grant path (§4a: "RETIRED") — already
-- owned copies stay owned, they simply stop being minted.
create or replace function economy_evaluate_relics(p_user uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_granted int := 0;
  v_hours numeric;
  v_tier text;
  v_pos int;
  v_weeks int;
  v_top10 boolean;
  v_volume numeric;
  v_km numeric;
  v_bench numeric;
  v_squat numeric;
  v_dead numeric;
  v_disc record;
  v_maxed int;
begin
  if p_user is null then return 0; end if;

  -- ── ANVIL OF HEPHAESTUS · legendary · 500 cumulative hours (unchanged from 0090) ──
  -- last_confirmed_at, not now(): 0033's anti-farming rule credits only up to the last heartbeat,
  -- so a timer left running overnight cannot buy this.
  select coalesce(sum(extract(epoch from (s.last_confirmed_at - s.started_at)) / 3600.0), 0)
    into v_hours
  from lock_in_sessions s
  where s.user_id = p_user and s.status = 'completed';

  if v_hours >= 500 then
    if economy_grant_relic(p_user, 'relic-anvil-of-hephaestus', 'legendary',
      '500 hours, forged. The work did not fill time — it made you the weapon.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── ICARUS' FEATHER · legendary · reach HERO (was Gold in 0090) ──
  select t.tier into v_tier from rank_tier_for_score(universal_score(p_user)) t limit 1;
  v_pos := array_position(
    array['bronze','silver','gold','platinum','diamond','hero','titan','olympian','immortal','primordial'],
    v_tier);

  if coalesce(v_pos, 0) >= 6 then
    if economy_grant_relic(p_user, 'relic-icarus-feather', 'legendary',
      'You climbed to Hero — flew close to the sun and ascended past what was thought possible.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── ZEUS' BOLT · mythic · reach PRIMORDIAL (new — had no evaluation at all) ──
  if v_tier = 'primordial' then
    if economy_grant_relic(p_user, 'relic-zeus-bolt', 'mythic',
      'You reached Primordial. The king himself bows toward your greatness.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── ATHENA'S AEGIS · epic · 6 CONSECUTIVE weeks with a session (was: a dead-day-free month) ──
  --
  -- The gaps-and-islands trick: subtract each row's ordinal (in weeks) from its week, and every
  -- run of consecutive weeks collapses to one constant. The largest group is the longest streak.
  -- date_trunc('week') is ISO (Monday-anchored), which is what §4a means by "no dead week".
  with wk as (
    select distinct date_trunc('week', s.started_at)::date as d
    from lock_in_sessions s
    where s.user_id = p_user and s.status = 'completed'
  ), grouped as (
    -- make_interval(weeks => n) rather than `n * interval '1 week'`: row_number() is a bigint, and
    -- multiplying one by an interval only works through an implicit cast to double precision.
    -- Spelling it out means this cannot break on a stricter planner.
    select d, d - make_interval(weeks => (row_number() over (order by d))::int) as grp from wk
  )
  select coalesce(max(cnt), 0) into v_weeks
  from (select count(*) as cnt from grouped group by grp) s;

  if v_weeks >= 6 then
    if economy_grant_relic(p_user, 'relic-athenas-aegis', 'epic',
      'Six weeks unbroken, without a gap. Athena guards the standard that is never set down.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── PROMETHEUS' SHARD · mythic · top-10% season finish AND a referral ──
  -- Cannot grant today: has_successful_referral() is a documented stub (§6 above). The top-10%
  -- half is still evaluated so that the moment referrals land, everyone who already qualified is
  -- granted on their next check-in with no backfill.
  select exists (
    select 1 from season_standings s
    where s.user_id = p_user
      and s.rank::numeric / greatest(s.board_size, 1) <= 0.10
  ) into v_top10;

  if v_top10 and has_successful_referral(p_user) then
    if economy_grant_relic(p_user, 'relic-prometheus-shard', 'mythic',
      'You reached the top and brought someone into the fire. Mastery that spreads.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── ATLAS' BURDEN · mythic · the 1000 lb club (new) ──
  --
  -- §4a-3: the MAX within each family, never the sum of its variations — an incline and a flat
  -- bench must not both count. Matching is on the exercise NAME because that is the only thing
  -- 0037 records about what a lift IS; `exercises` carries a muscle_group but no movement family.
  --   · squat excludes 'split squat' (a unilateral accessory, not a squat pattern) and
  --     'squat jump' / 'squat thrust'; RDLs and deficit pulls DO count as deadlifts per §4a-3
  --     ("any variation").
  --   · weight is treated as POUNDS. workout_sets has no unit column and the gym logger shows
  --     none, so lb is the only convention available — and it is §4a-3's own. Flagged in the
  --     handoff: someone logging kg would need 2,205 lb of true load to trip this.
  select coalesce(max(coalesce(ws.weight, 0)), 0) into v_bench
  from workout_sets ws
  join workout_exercises we on we.id = ws.workout_exercise_id
  join workouts w on w.id = ws.workout_id
  where w.user_id = p_user and we.name ilike '%bench%';

  select coalesce(max(coalesce(ws.weight, 0)), 0) into v_squat
  from workout_sets ws
  join workout_exercises we on we.id = ws.workout_exercise_id
  join workouts w on w.id = ws.workout_id
  where w.user_id = p_user
    and we.name ilike '%squat%'
    and we.name not ilike '%split%'
    and we.name not ilike '%jump%'
    and we.name not ilike '%thrust%';

  select coalesce(max(coalesce(ws.weight, 0)), 0) into v_dead
  from workout_sets ws
  join workout_exercises we on we.id = ws.workout_exercise_id
  join workouts w on w.id = ws.workout_id
  where w.user_id = p_user and (we.name ilike '%deadlift%' or we.name ilike '%rdl%');

  if v_bench + v_squat + v_dead >= 1000 then
    if economy_grant_relic(p_user, 'relic-atlas-burden', 'mythic',
      'A thousand pounds across the three great lifts. Atlas nods in approval.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── DISCIPLINE LADDER · VOLUME (Hercules' Might) ──
  -- Every set ever logged, weight x reps. Bodyweight sets carry a null weight and contribute 0,
  -- which is correct for a "total lifted" metric.
  select coalesce(sum(coalesce(ws.weight, 0) * ws.reps), 0) into v_volume
  from workout_sets ws
  join workouts w on w.id = ws.workout_id
  where w.user_id = p_user;

  perform economy_apply_relic_ladder(p_user, 'volume', v_volume);

  -- ── DISCIPLINE LADDER · DISTANCE (Pheidippides' Sandals) ──
  -- §4a-2: "total distance MOVED — walking counts". Two sources, summed:
  --   · check_ins.distance_m — GPS distance from a Strava run/ride (0038). Removed check-ins are
  --     excluded, as they are from every other metric in the system.
  --   · user_step_days x stride — the walking half, which had no path in before this migration.
  -- A Strava run whose steps ALSO reached the health store is counted twice. Accepted: this is an
  -- estimate ladder, both sources under-report in the other direction (a phone left on a desk
  -- during a run records neither), and de-duping would need per-activity time windows the step
  -- store deliberately does not keep. Flagged in the handoff as a tuning question, not a defect.
  select
    coalesce((select sum(ci.distance_m) from check_ins ci
              where ci.user_id = p_user and ci.removed_at is null), 0)
    + coalesce((select sum(sd.steps) * stride_m_for(p_user) from user_step_days sd
                where sd.user_id = p_user), 0)
  into v_km;
  v_km := v_km / 1000.0;

  perform economy_apply_relic_ladder(p_user, 'distance', v_km);

  -- ── DISCIPLINE LADDERS · HOURS, one per discipline ──
  -- Socrates' Scroll (study) · Daedalus' Blueprint (deep work) · Oracle's Stillness (meditate).
  --
  -- ONE grouped pass, not one query per family. This function now runs on every check-in (§8), and
  -- a query per hours-ladder would be three more scans of lock_in_sessions on top of the two the
  -- Anvil and Aegis branches already cost.
  --
  -- A discipline with no hours simply gets no row, which costs nothing: get_my_relic_progress
  -- LEFT JOINs from relic_ladders, so all five ladders still report, the untouched ones at 0.
  for v_disc in
    select session_discipline(s.goal_type) as family,
           sum(extract(epoch from (s.last_confirmed_at - s.started_at)) / 3600.0) as hours
    from lock_in_sessions s
    where s.user_id = p_user
      and s.status = 'completed'
      and session_discipline(s.goal_type) is not null
    group by 1
  loop
    perform economy_apply_relic_ladder(p_user, v_disc.family, v_disc.hours);
  end loop;

  -- ── CROWN OF OLYMPUS · mythic · top rung of every discipline ladder (§4a-2 capstone) ──
  select count(*) into v_maxed
  from relic_progress rp
  join relic_ladders rl on rl.relic_key = rp.relic_key
  where rp.user_id = p_user and rp.tier >= array_length(rl.thresholds, 1);

  if v_maxed >= (select count(*) from relic_ladders) then
    if economy_grant_relic(p_user, 'relic-crown-of-olympus', 'mythic',
      'Master of no single art, but of the discipline beneath all of them. Olympus has a seat for that.')
    then v_granted := v_granted + 1; end if;
  end if;

  return v_granted;
end;
$$;

grant execute on function economy_evaluate_relics(uuid) to authenticated;

-- ───────────────────────────── 8 · widen the trigger ─────────────────────────────
--
-- 0090 evaluates only on a lock-in session flipping to 'completed'. LOGIC_AUDIT §1's "trigger
-- blind spot": a pure fitness day — a Strava ride arriving by webhook, a walk synced into
-- user_step_days — creates a check_ins row and no session, so the Distance ladder never moved.
--
-- The lock_in_sessions trigger from 0090 stays exactly as it is; this ADDS the check_ins arm.
-- Both are cheap: every branch of the evaluator either exits on an already-owned relic or runs a
-- single indexed aggregate.
create or replace function economy_on_checkin_check_relics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform economy_evaluate_relics(new.user_id);
  return new;
end;
$$;

-- NAMED `on_check_in_relics`, NOT `check_ins_relics`, AND THAT IS LOAD-BEARING. Postgres fires
-- same-timing row triggers in NAME order, and `handle_check_in_insert` (trigger `on_check_in_insert`)
-- is the AFTER INSERT that writes xp_earned — which universal_score sums, which is what the
-- Icarus and Zeus branches read. A name sorting before it (`check_ins_relics` would) evaluates the
-- rank as of the PREVIOUS check-in, so the check-in that actually crossed into Hero would not
-- grant the Feather until the one after it. 'on_check_in_insert' < 'on_check_in_relics', so this
-- runs second and reads the XP the same statement just wrote.
drop trigger if exists check_ins_relics on check_ins;
drop trigger if exists on_check_in_relics on check_ins;
create trigger on_check_in_relics
  after insert on check_ins
  for each row execute function economy_on_checkin_check_relics();

/**
 * The Trophy Hall's ladder read: where each discipline relic stands and what the next rung costs.
 *
 * SEPARATE from get_trophy_hall rather than folded into it. get_trophy_hall is a 200-line function
 * other branches may also be touching this cycle, and a jsonb-shape change there is a merge
 * conflict for no gain — the hall already lists the relic keys; this answers "how far along" for
 * each of them.
 *
 * `next_threshold` is null at the top rung, which is how the client renders "maxed" without a
 * separate flag. Every ladder is returned even with no progress row, so the UI can show the full
 * set of five with zeroes rather than an empty list.
 */
create or replace function get_my_relic_progress()
returns table (
  relic_key text,
  family text,
  unit text,
  value numeric,
  tier int,
  max_tier int,
  rarity text,
  next_threshold numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rl.relic_key,
    rl.family,
    rl.unit,
    coalesce(rp.value, 0) as value,
    coalesce(rp.tier, 0) as tier,
    array_length(rl.thresholds, 1) as max_tier,
    case when coalesce(rp.tier, 0) = 0 then null else rl.rarities[rp.tier] end as rarity,
    case when coalesce(rp.tier, 0) >= array_length(rl.thresholds, 1)
         then null
         else rl.thresholds[coalesce(rp.tier, 0) + 1] end as next_threshold
  from relic_ladders rl
  left join relic_progress rp
    on rp.relic_key = rl.relic_key and rp.user_id = auth.uid()
  order by rl.family;
$$;

grant execute on function get_my_relic_progress() to authenticated;
