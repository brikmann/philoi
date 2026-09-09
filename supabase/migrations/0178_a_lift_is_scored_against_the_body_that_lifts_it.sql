-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- A LIFT IS SCORED AGAINST THE BODY THAT LIFTS IT
--
-- DIFFICULTY_SCOPING.md §"Fitness is IPSATIVE" has been the stated ethos since it was written:
-- "a 300 lb squat for a 160 lb lifter is ~1.9× bodyweight → Legendary; the same 300 for a 220 lb
-- lifter is ~1.4× → Rare". The tutorial's Personal-goals card says it out loud — scored against
-- your own bodyweight. Nothing collected a bodyweight, so Cindy had no denominator and the copy
-- was a claim the app could not honour. Height shipped with 0119 for the stride estimate; this is
-- the other half of the same step.
--
-- 🔒 THIS COLUMN CANNOT PAY ANYONE ANYTHING, and that is deliberate. The 🔴 DECISION at the top of
-- DIFFICULTY_SCOPING.md is that a one-off strength PR grants NO box and NO currency, ever —
-- fitness loot comes from consistency goals and discipline-relic rungs, both farm-resistant by
-- construction. Bodyweight exists to make a lift read FAIRLY: the share card, the leaderboard
-- order, ranking effort inside a duel or a consistency challenge, and later the discipline
-- cosmetics. Nothing in compute_challenge_reward, grant_reward, or any settlement path reads it,
-- and nothing added here gives it a way in. The assertion at the foot of this file is what keeps
-- that true rather than merely stated.
--
-- ONE UNIT SERVER-SIDE, ALWAYS KILOGRAMS. `weight_unit` records which unit to SPEAK the number
-- back in — it is a display preference, not a second quantity, so there is no state in which the
-- stored figure means something different depending on a flag.
--
-- Nullable on purpose. Weight is skippable in onboarding and clearable in Settings, and null is a
-- first-class state the prompt handles (ask once, or fall back to the demographic anchors) rather
-- than an error. Someone who will not tell us their weight still gets scoped goals.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- 20/400 kg is the same kind of bound as 0119's `50 < height_cm < 260`: not a plausibility filter,
-- a wrong-field filter. It rejects a height typed into the weight step, which is the mistake two
-- adjacent ruler screens make easy.
alter table profiles add column if not exists weight_kg numeric
  check (weight_kg is null or (weight_kg > 20 and weight_kg < 400));

alter table profiles add column if not exists weight_unit text
  check (weight_unit is null or weight_unit in ('lb', 'kg'));

/**
 * Onboarding / Settings writes the weight. Own row only.
 *
 * A NULL p_weight_kg IS A REAL CALL, not a no-op guard: it is how Settings clears a weight the
 * user no longer wants stored. Skipping the onboarding step does not reach here at all — an
 * untouched picker sitting on its default is not a measurement, and writing it would turn
 * "I skipped" into a claim about the user's body (the same rule handleContinueHeight follows).
 */
create or replace function set_my_weight_kg(p_weight_kg numeric, p_weight_unit text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update profiles
     set weight_kg = p_weight_kg,
         -- Keep the last stated preference when the caller does not name one, so clearing a
         -- weight does not silently reset the picker back to pounds for a kg user.
         weight_unit = coalesce(p_weight_unit, weight_unit)
   where id = auth.uid();
end;
$$;

revoke all on function set_my_weight_kg(numeric, text) from public;
grant execute on function set_my_weight_kg(numeric, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- CINDY READS IT
--
-- The context document is the ONLY place per-user data may go: buildSystemPrompt is one cacheable
-- prefix and interpolating a bodyweight into it would drop the fleet's cache hit rate to zero. So
-- the rubric lives in prompt.ts and the number lives here.
--
-- Restated in full because a jsonb_build_object cannot be amended in place. The body below is the
-- live prod prosrc as of this migration (md5 46b2a8c3264b8b54ad5f99c3fcf2dd76, byte-identical to
-- 0101's modulo line endings — diffed before writing, per MIGRATIONS.md) with `body` added and
-- three columns added to the profile select. Nothing else moved.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
drop function if exists get_coach_context();
create or replace function get_coach_context()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_profile record;
  v_rank record;
  v_next record;
  v_xp_rate numeric;
  v_rate_sessions int;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'get_coach_context: not authenticated';
  end if;

  select p.display_name, p.handle, p.university, p.timezone, p.current_streak, p.longest_streak,
         p.embers, p.daily_goal_mode, p.created_at, p.height_cm, p.weight_kg, p.weight_unit
    into v_profile
  from profiles p where p.id = v_user;

  -- ── rank + the ladder math, which is what turns "how far to Hero?" into a number ──
  -- rank_tier_for_score/universal_score are the same pair get_my_ranks uses, called directly so
  -- this reads p_user's rank rather than depending on an auth.uid()-scoped helper.
  select t.tier, t.division, universal_score(v_user) as score
    into v_rank
  from rank_tier_for_score(universal_score(v_user)) t limit 1;

  -- The user's measured XP/hour over 30 days. Mirrors src/lib/api/xp-rate.ts EXACTLY (>= 60s,
  -- non-null duration, not removed) — if these two drift, Cindy and the lock-in pill would quote
  -- different numbers for the same question, which is worse than either being slightly off.
  select coalesce(sum(c.xp_earned), 0) / nullif(sum(c.duration_seconds) / 3600.0, 0), count(*)
    into v_xp_rate, v_rate_sessions
  from check_ins c
  where c.user_id = v_user
    and c.created_at >= now() - interval '30 days'
    and c.removed_at is null
    and c.duration_seconds is not null
    and c.duration_seconds >= 60;

  -- Fewer than 3 timed sessions is not a rate, it's noise (same floor as xp-rate.ts). Null here
  -- makes the model say "once you've got a few sessions logged" instead of inventing a pace.
  if coalesce(v_rate_sessions, 0) < 3 then
    v_xp_rate := null;
  end if;

  select rt.tier, rt.division, rt.cumulative_xp_required
    into v_next
  from rank_thresholds rt
  where rt.cumulative_xp_required > coalesce(v_rank.score, 0)
  order by rt.cumulative_xp_required asc
  limit 1;

  v_result := jsonb_build_object(
    'generated_at', now(),

    'profile', jsonb_build_object(
      'display_name', v_profile.display_name,
      'first_name', split_part(coalesce(v_profile.display_name, ''), ' ', 1),
      'handle', v_profile.handle,
      'university', v_profile.university,
      'timezone', v_profile.timezone,
      'local_time', to_char(now() at time zone coalesce(v_profile.timezone, 'UTC'), 'YYYY-MM-DD HH24:MI (Dy)'),
      'current_streak', v_profile.current_streak,
      'longest_streak', v_profile.longest_streak,
      'embers', v_profile.embers,
      'member_since', v_profile.created_at
    ),

    -- ── THE BODY THE GOAL IS SCORED AGAINST (DIFFICULTY_SCOPING.md "Fitness is IPSATIVE") ──
    -- Self-reported, optional, and the ONLY reason it is here: a load goal has to be read as a
    -- multiple of the person lifting it, or Cindy scores the plates instead of the effort. Null is
    -- a supported state and the prompt says what to do with it -- ask once, or fall back to the
    -- demographic anchors. Never to raw pounds.
    --
    -- 🔒 SCORING ONLY. Nothing downstream of this pays out: fitness loot comes from consistency
    -- goals and relic rungs, and a one-off PR mints no box however good the ratio (the 🔴 DECISION
    -- in DIFFICULTY_SCOPING.md). Weight moves the FLEX -- share card, leaderboard order, and later
    -- the discipline cosmetics -- and nothing in the economy.
    --
    -- BOTH UNITS ARE SHIPPED on purpose. The prompt forbids inventing numbers, and a unit
    -- conversion done in the model's head is exactly the kind of invented number that reads as
    -- authoritative. `weight_unit` is which one to SAY it back in; `weight_lb` is so she never
    -- has to multiply.
    'body', jsonb_build_object(
      'height_cm', v_profile.height_cm,
      'weight_kg', v_profile.weight_kg,
      'weight_lb', case when v_profile.weight_kg is null then null
                        else round(v_profile.weight_kg * 2.2046226218, 1) end,
      'weight_unit', coalesce(v_profile.weight_unit, 'lb')
    ),

    -- ── RANK + THE XP LADDER ──
    -- The whole ladder ships with the context, not just the current rung: "how much to reach
    -- Hero" needs every threshold between here and Hero, and shipping the table is far cheaper
    -- and more reliable than teaching the model to ask for each rung.
    'rank', jsonb_build_object(
      'tier', v_rank.tier,
      'division', v_rank.division,
      'score', round(coalesce(v_rank.score, 0)::numeric, 1),
      'next_tier', v_next.tier,
      'next_division', v_next.division,
      'xp_to_next', case when v_next.cumulative_xp_required is null then null
                        else round((v_next.cumulative_xp_required - coalesce(v_rank.score, 0))::numeric, 0) end,
      'xp_per_hour', case when v_xp_rate is null then null else round(v_xp_rate::numeric, 0) end,
      'xp_rate_sessions', v_rate_sessions,
      'ladder', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'tier', rt.tier, 'division', rt.division, 'cumulative_xp', rt.cumulative_xp_required
               ) order by rt.rank_index), '[]'::jsonb)
        from rank_thresholds rt
      )
    ),

    -- ── SESSIONS: what's happening right now, and the recent shape of their effort ──
    'active_session', (
      select jsonb_build_object(
               'id', s.id, 'goal_type', s.goal_type, 'goal_detail', s.goal_detail,
               'circle_id', s.circle_id, 'started_at', s.started_at,
               'minutes_so_far', round(extract(epoch from (now() - s.started_at)) / 60.0)
             )
      from lock_in_sessions s
      where s.user_id = v_user and s.status = 'active'
      order by s.started_at desc limit 1
    ),

    'recent_sessions', (
      select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
                 'at', c.created_at, 'type', c.goal_type, 'detail', c.goal_detail,
                 'minutes', round(c.duration_seconds / 60.0), 'xp', c.xp_earned
               ) as x
        from check_ins c
        where c.user_id = v_user and c.removed_at is null
          and c.created_at >= now() - interval '14 days'
        order by c.created_at desc limit 25
      ) s
    ),

    -- Rolled up so the model doesn't have to sum 25 rows to answer "how am I doing this week" —
    -- and so it can compare this week against the user's own norm rather than a generic one.
    'effort', jsonb_build_object(
      'today_minutes', (
        select coalesce(round(sum(c.duration_seconds) / 60.0), 0) from check_ins c
        where c.user_id = v_user and c.removed_at is null
          and c.created_at >= date_trunc('day', now() at time zone coalesce(v_profile.timezone, 'UTC'))
      ),
      'week_minutes', (
        select coalesce(round(sum(c.duration_seconds) / 60.0), 0) from check_ins c
        where c.user_id = v_user and c.removed_at is null and c.created_at >= now() - interval '7 days'
      ),
      'prev_week_minutes', (
        select coalesce(round(sum(c.duration_seconds) / 60.0), 0) from check_ins c
        where c.user_id = v_user and c.removed_at is null
          and c.created_at >= now() - interval '14 days' and c.created_at < now() - interval '7 days'
      ),
      'total_hours', (
        select coalesce(round(sum(c.duration_seconds) / 3600.0, 1), 0) from check_ins c
        where c.user_id = v_user and c.removed_at is null
      ),
      'hours_since_last_session', (
        select round(extract(epoch from (now() - max(c.created_at))) / 3600.0, 1) from check_ins c
        where c.user_id = v_user and c.removed_at is null
      ),
      -- By type, so "lock in on classes to reach Hero" can be answered about STUDY specifically
      -- rather than about all effort averaged together.
      'by_type_30d', (
        select coalesce(jsonb_object_agg(t.goal_type, t.minutes), '{}'::jsonb) from (
          select c.goal_type, round(sum(c.duration_seconds) / 60.0) as minutes
          from check_ins c
          where c.user_id = v_user and c.removed_at is null
            and c.created_at >= now() - interval '30 days'
          group by c.goal_type
        ) t
      )
    ),

    -- ── GOALS + CHALLENGES + STANDINGS ──
    'goals', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', g.id, 'type', g.type, 'label', g.label, 'cadence', g.cadence,
               'current_streak', g.current_streak
             )), '[]'::jsonb)
      from goals g where g.user_id = v_user and g.archived_at is null
    ),

    'challenges', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ch.id, 'type', ch.type, 'label', ch.label, 'target', ch.target,
               'unit', ch.unit, 'period', ch.period, 'progress', ch.progress,
               'pct', case when ch.target > 0 then round(100.0 * ch.progress / ch.target) else null end,
               'period_start', ch.period_start, 'completed_at', ch.completed_at
             )), '[]'::jsonb)
      from challenges ch
      where ch.user_id = v_user and ch.completed_at is null
    ),

    -- ── COSMETICS: inventory, what's equipped, and what it would take to unlock the rest ──
    -- The equipped flame is Cindy's own appearance (CINDY_SPEC: "customizing a flame = dressing
    -- up your companion"), so she genuinely needs to know what she's wearing.
    'equipped', (
      select coalesce(jsonb_object_agg(e.slot, e.cosmetic_key), '{}'::jsonb)
      from equipped_loadout e where e.user_id = v_user
    ),
    'owned_cosmetics', (
      select coalesce(jsonb_agg(co.cosmetic_key), '[]'::jsonb)
      from cosmetics_owned co where co.user_id = v_user
    ),

    -- Live progress toward the relic conditions economy_evaluate_relics() actually checks. These
    -- numbers are what make "what do I need to unlock X" a receipt instead of a guess; the
    -- condition TEXT ships from the client catalog, the PROGRESS ships from here.
    'unlock_progress', jsonb_build_object(
      'longest_streak', v_profile.longest_streak,
      'completed_session_hours', (
        select coalesce(round(sum(extract(epoch from (s.last_confirmed_at - s.started_at))) / 3600.0, 1), 0)
        from lock_in_sessions s where s.user_id = v_user and s.status = 'completed'
      ),
      'peak_tier', v_rank.tier,
      'best_season_percentile', (
        select round(min(100.0 * ss.rank / greatest(ss.board_size, 1)), 1)
        from season_standings ss where ss.user_id = v_user
      )
    ),

    -- ── MILESTONES (PROFILE_SPEC §G) — 🔒 zero XP, and the model is told so in the prompt ──
    'milestones', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'kind', m.kind, 'headline', m.headline, 'at', m.created_at
             ) order by m.created_at desc), '[]'::jsonb)
      from (select * from milestones where user_id = v_user order by created_at desc limit 10) m
    ),
    -- The receipts a new milestone would be stamped with, so Cindy can say "backed by your 41h"
    -- BEFORE posting rather than discovering the numbers afterwards.
    'milestone_effort', (
      select jsonb_build_object(
        'hours', coalesce(round(sum(c.duration_seconds) / 3600.0), 0),
        'lockins', count(*),
        'streak', v_profile.current_streak
      )
      from check_ins c where c.user_id = v_user and c.removed_at is null
    ),

    -- ── THE BELL ──
    'notifications', jsonb_build_object(
      'unread', (select count(*) from notification_events n where n.user_id = v_user and n.read_at is null),
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'type', n.type, 'title', n.title, 'body', n.body, 'at', n.created_at,
                 'read', n.read_at is not null
               ) order by n.created_at desc), '[]'::jsonb)
        from (select * from notification_events where user_id = v_user
              order by created_at desc limit 12) n
      )
    ),

    -- ── CAMPFIRES ── membership only. Never other members' private rows: Cindy is scoped to the
    -- caller, and a circle she can name is not a circle she can read into.
    'campfires', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', g.id, 'name', g.name, 'role', gm.role
             )), '[]'::jsonb)
      from group_members gm join groups g on g.id = gm.group_id
      where gm.user_id = v_user
    )
  );

  return v_result;
end;
$$;

revoke all on function get_coach_context() from public;
grant execute on function get_coach_context() to authenticated;
-- ───────────────────────────── the assertions ─────────────────────────────
-- Reachable in the state this migration actually meets (MIGRATIONS.md §"Assertions must be
-- reachable"): every check below runs against the post-DDL schema, and each one fails under the
-- bug it is written to catch rather than passing vacuously.
do $assert$
declare
  v_ctx_overloads int;
  v_weight_overloads int;
  v_src text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'weight_kg'
  ) then
    raise exception 'weight_kg did not land on profiles';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'weight_unit'
  ) then
    raise exception 'weight_unit did not land on profiles';
  end if;

  -- One name, one row (MIGRATIONS.md §"Appending a parameter is not a replacement"). Neither
  -- function gained a parameter here, and this is the cheap proof of that rather than a claim
  -- about it.
  select count(*) into v_ctx_overloads
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_coach_context';
  if v_ctx_overloads <> 1 then
    raise exception 'get_coach_context has % overloads, expected 1', v_ctx_overloads;
  end if;

  select count(*) into v_weight_overloads
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'set_my_weight_kg';
  if v_weight_overloads <> 1 then
    raise exception 'set_my_weight_kg has % overloads, expected 1', v_weight_overloads;
  end if;

  -- The whole point of the migration: the context document must actually carry the key. This is
  -- a positive control rather than a green check that would also be green under the bug — no
  -- prior version of this function mentions `body`, so it fails if the restatement above
  -- silently landed the OLD text.
  select p.prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_coach_context';
  if position('''body'', jsonb_build_object' in v_src) = 0 then
    raise exception 'get_coach_context was replaced without the body block';
  end if;
  if position('p.weight_kg' in v_src) = 0 then
    raise exception 'get_coach_context does not select weight_kg — body would be all nulls';
  end if;

  -- 🔒 The firewall, asserted rather than asserted-in-a-comment. If a settlement or grant path
  -- has learned to read bodyweight, the 🔴 DECISION ("one-off PRs pay no box") stopped being true
  -- and this is where it stopped.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('compute_challenge_reward', 'grant_reward', 'settle_challenge')
      and p.prosrc like '%weight_kg%'
  ) then
    raise exception 'a reward path reads weight_kg — fitness PRs must not mint loot';
  end if;
end;
$assert$;
