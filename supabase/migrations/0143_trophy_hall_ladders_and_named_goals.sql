-- 0143 — two Globals fixes, both additive.
--
--   §1  get_trophy_hall() learns the discipline ladders, so the profile Hall can finally show a
--       relic that is being EARNED and not only one already granted.
--   §3  goals gains room for more than one named goal per category, so "KP231" can be a Study goal
--       rather than being forced to type='custom' — which is what stranded it from the ladder.
--
-- ─────────────────────────── §1 · why the Hall renders empty ───────────────────────────
--
-- The drafted diagnosis was that 0092's relic query is stale and "never reads the new tables".
-- IT IS NOT. Read it: it selects from cosmetics_owned where cosmetic_key like 'relic-%', and 0119
-- grants every ladder relic through economy_grant_relic, which writes exactly that row. A GRANTED
-- ladder relic has always come back from this function, and every secret relic still does.
--
-- The actual gap is one rung lower down. economy_apply_relic_ladder only grants at tier 1 — below
-- the first threshold it writes relic_progress and nothing else. So a user with 3.3 study hours has
-- a relic_progress row, no cosmetics_owned row, and therefore no relic in the Hall at all. Prod
-- today: 13 relic_progress rows across 5 users, and exactly ONE of them is above tier 0. Twelve
-- rows of real progress the Hall had no way to see, which is what "relics don't populate" looks
-- like from the device.
--
-- The second half of the gap: even the granted ones arrived with no tier and no value, so the Hall
-- could never have drawn "43 / 50 km" next to one.
--
-- So this does two things and removes none of the old behaviour:
--   · every relic/medal row 0092 already returned is still returned, under the same keys;
--   · ladder relics are ENRICHED with family/unit/value/tier/max_tier/next_threshold;
--   · ladder relics with real progress but no grant yet are ADDED, flagged `in_progress`.
--
-- `in_progress` is what keeps the Hall's earned-only rule intact: the featured strip and the
-- "nothing earned yet" test filter on it, so an unearned ladder never poses as a trophy.
--
-- UNEARNED SECRET RELICS STAY INVISIBLE. They are not in relic_ladders and have no relic_progress
-- row, so neither branch below can surface one — the union adds ladder families only. That is the
-- same single mechanism 0092 relied on, not a second rule that could drift out of step with it.

create or replace function get_trophy_hall(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_owner boolean := (p_user = auth.uid());
  v_seasons jsonb;
  v_relics jsonb;
  v_badges jsonb;
  v_record jsonb;
  v_record_hidden boolean := false;
  v_stats jsonb;
  v_collection int := 0;
  v_hidden int := 0;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if p_user is null then raise exception 'Missing user.'; end if;

  -- Season placements. One row per (season, university, user) and a user belongs to one school, so
  -- this is one card per completed season. Presence in season_standings IS "completed" — the table
  -- is only ever written by the close job.
  --
  -- Title and medal come from season_reward_grants, which denormalises the display name at grant
  -- time on purpose (0080): a title's copy can be re-themed for a later season and this card has to
  -- keep saying what the person actually won.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'season_id', s.season_id,
             'placement', s.placement,
             'board_size', s.board_size,
             'title', s.title,
             'medal_key', s.medal_key,
             'hidden', s.hidden
           ) order by s.placement asc
         ), '[]'::jsonb) into v_seasons
  from (
    select
      st.season_id,
      st.rank as placement,
      st.board_size,
      (
        select g.name from season_reward_grants g
        where g.user_id = st.user_id and g.season_id = st.season_id and g.kind = 'title'
        order by g.permanent desc limit 1
      ) as title,
      (
        select g.item_key from season_reward_grants g
        where g.user_id = st.user_id and g.season_id = st.season_id and g.kind = 'medal'
        order by g.permanent desc limit 1
      ) as medal_key,
      exists (
        select 1 from profile_hidden_items h
        where h.user_id = st.user_id and h.kind = 'season' and h.item_key = st.season_id
      ) as hidden
    from season_standings st
    where st.user_id = p_user
  ) s
  where v_owner or not s.hidden;

  -- RELICS AND MEDALS. Branch one is 0092's query, left-joined onto the ladder tables so a relic
  -- that rides a ladder carries its standing; branch two is the relics that have progress but have
  -- not been granted yet, which is the population that was missing entirely.
  select coalesce(jsonb_agg(
           jsonb_build_object('key', r.key, 'acquired_at', r.acquired_at,
                              'provenance', r.provenance, 'hidden', r.hidden,
                              'family', r.family, 'unit', r.unit,
                              'value', r.value, 'tier', r.tier,
                              'max_tier', r.max_tier, 'next_threshold', r.next_threshold,
                              'in_progress', r.in_progress)
           order by r.acquired_at desc
         ), '[]'::jsonb) into v_relics
  from (
    select
      c.cosmetic_key as key,
      c.acquired_at,
      c.provenance,
      exists (
        select 1 from profile_hidden_items h
        where h.user_id = c.user_id and h.kind = 'cosmetic' and h.item_key = c.cosmetic_key
      ) as hidden,
      -- Null for every medal and every secret relic: they ride no ladder, and a null family is how
      -- the client tells "trophy" from "rung" without a second list of keys to keep in step.
      rl.family,
      rl.unit,
      rp.value,
      rp.tier,
      array_length(rl.thresholds, 1) as max_tier,
      case
        when rl.family is null then null
        when coalesce(rp.tier, 0) >= array_length(rl.thresholds, 1) then null
        else rl.thresholds[coalesce(rp.tier, 0) + 1]
      end as next_threshold,
      false as in_progress
    from cosmetics_owned c
    left join relic_ladders rl on rl.relic_key = c.cosmetic_key
    left join relic_progress rp on rp.relic_key = c.cosmetic_key and rp.user_id = c.user_id
    where c.user_id = p_user and (c.cosmetic_key like 'relic-%' or c.cosmetic_key like 'medal-%')

    union all

    -- Below rung one: economy_apply_relic_ladder has written progress but never called
    -- economy_grant_relic, so there is no cosmetics_owned row to find. `value > 0` is the filter
    -- that keeps a freshly-seeded 0-of-5 ladder from posing as something the user is working on.
    --
    -- acquired_at is relic_progress.updated_at so the aggregate's ORDER BY still has a real instant
    -- to sort on — it is "last moved", not "earned at", and in_progress says which one it is.
    select
      rl.relic_key,
      rp.updated_at,
      null::text,
      false,
      rl.family,
      rl.unit,
      rp.value,
      rp.tier,
      array_length(rl.thresholds, 1),
      case
        when rp.tier >= array_length(rl.thresholds, 1) then null
        else rl.thresholds[rp.tier + 1]
      end,
      true
    from relic_progress rp
    join relic_ladders rl on rl.relic_key = rp.relic_key
    where rp.user_id = p_user
      and rp.value > 0
      and not exists (
        select 1 from cosmetics_owned c
        where c.user_id = p_user and c.cosmetic_key = rl.relic_key
      )
  ) r
  where v_owner or not r.hidden;

  select coalesce(jsonb_agg(
           jsonb_build_object('key', b.key, 'earned_at', b.earned_at,
                              'provenance', b.provenance, 'hidden', b.hidden)
           order by b.earned_at desc
         ), '[]'::jsonb) into v_badges
  from (
    select
      ob.badge_key as key,
      ob.earned_at,
      ob.provenance,
      exists (
        select 1 from profile_hidden_items h
        where h.user_id = ob.user_id and h.kind = 'badge' and h.item_key = ob.badge_key
      ) as hidden
    from owned_badges ob
    where ob.user_id = p_user
  ) b
  where v_owner or not b.hidden;

  -- The record is hideable as ONE unit (§4 "hide individual items / the record"), so a visitor
  -- gets null rather than a zeroed row — 0-0 would read as "never duelled", which is a different
  -- and false claim.
  select exists (
    select 1 from profile_hidden_items h
    where h.user_id = p_user and h.kind = 'record' and h.item_key = 'record'
  ) into v_record_hidden;

  if v_owner then
    v_record := duel_record(p_user) || jsonb_build_object('hidden', v_record_hidden);
  elsif not v_record_hidden then
    v_record := duel_record(p_user) || jsonb_build_object('hidden', false);
  end if;

  -- What a visitor is NOT being shown, as a count only — "🔒 N hidden by owner" is honest about
  -- the gap without leaking which trophies fill it.
  if not v_owner then
    select count(*) into v_hidden
    from profile_hidden_items h
    where h.user_id = p_user
      and (
        (h.kind = 'season' and exists (select 1 from season_standings st where st.user_id = p_user and st.season_id = h.item_key))
        or (h.kind = 'cosmetic' and exists (select 1 from cosmetics_owned c where c.user_id = p_user and c.cosmetic_key = h.item_key
              and (c.cosmetic_key like 'relic-%' or c.cosmetic_key like 'medal-%')))
        or (h.kind = 'badge' and exists (select 1 from owned_badges ob where ob.user_id = p_user and ob.badge_key = h.item_key))
      );
  end if;

  -- The numbers behind the MILESTONE BADGE GRID (§4). The grid greys out what has not been reached
  -- yet — "a collection to complete" — so it needs the thresholds' inputs, not just the badges
  -- already granted. Streak/lock-in/hours milestones have no grant path and deliberately need one:
  -- they are a VIEW over facts the profile already stores, and minting rows for them would be a
  -- second source of truth that could disagree with the streak on the user's own home screen.
  select jsonb_build_object(
           'current_streak', coalesce(p.current_streak, 0),
           'longest_streak', coalesce(p.longest_streak, 0),
           'campus_verified', coalesce(p.university_email_verified, false),
           'lockin_count', coalesce(ci.lockin_count, 0),
           'total_seconds', coalesce(ci.total_seconds, 0)
         ) into v_stats
  from profiles p
  left join lateral (
    select count(*) as lockin_count, coalesce(sum(c.duration_seconds), 0) as total_seconds
    from check_ins c
    where c.user_id = p.id and c.duration_seconds is not null and c.removed_at is null
  ) ci on true
  where p.id = p_user;

  -- How many items the Collection entry on the profile advertises. Counted here rather than by
  -- calling get_public_collection from the profile screen: the profile needs the NUMBER, and
  -- fetching a whole closet to call .length on it is a round-trip for one integer. Counts only
  -- what this viewer would actually be shown.
  select count(*) into v_collection
  from cosmetics_owned c
  where c.user_id = p_user
    and (
      v_owner or not exists (
        select 1 from profile_hidden_items h
        where h.user_id = c.user_id and h.kind = 'cosmetic' and h.item_key = c.cosmetic_key
      )
    );

  return jsonb_build_object(
    'is_owner', v_owner,
    'seasons', coalesce(v_seasons, '[]'::jsonb),
    'relics', coalesce(v_relics, '[]'::jsonb),
    'badges', coalesce(v_badges, '[]'::jsonb),
    'record', v_record,
    'stats', coalesce(v_stats, '{}'::jsonb),
    'collection_count', coalesce(v_collection, 0),
    'hidden_count', v_hidden
  );
end;
$$;

grant execute on function get_trophy_hall(uuid) to authenticated;

-- ─────────────────── §3 · a category can hold more than one named goal ───────────────────
--
-- WHAT ACTUALLY BLOCKED "KP231 under Study". Not the client, and not the ladder — the ladder has
-- always been ready for this. economy_evaluate_relics aggregates hours by
-- session_discipline(s.goal_type) and never looks at the goal's label or its id, so a labelled
-- Study lock-in already feeds Socrates' Scroll exactly like an unlabelled one. There is no server
-- work to do on the counting path, and this migration deliberately does none.
--
-- The block was this index, from the era when a goal was a cadence you were held to:
--
--   goals_one_active_per_type  UNIQUE (user_id, type) WHERE archived_at IS NULL AND type <> 'custom'
--
-- One active goal per category. So the only way to hold a SECOND named goal under Study was to file
-- it as type='custom' — and session_discipline('custom') returns null by design (0119 §3: a
-- catch-all is "deliberately unmapped rather than quietly credited to a discipline the user did not
-- pick"). That is the strand: the name forced the type, and the type dropped it off the ladder.
--
-- Replaced with the same guarantee one level finer — unique per (user, type, name):
--
--   · "Study" with no name stays unique, so the plain category goal cannot be duplicated;
--   · "Study / KP231" and "Study / KP232" coexist as first-class Study goals, type='study' intact;
--   · creating "KP231" under Study twice collides instead of duplicating, which is what lets the
--     client group the second attempt onto the existing goal rather than minting a twin.
--
-- Case- and whitespace-insensitive on the name for that last reason: "kp231 " and "KP231" are the
-- same goal to a person, and a picker listing both is the bug this is meant to prevent.
--
-- 'custom' now falls under the index too, where before it was excluded outright. That is a
-- tightening, and an intended one: it stops duplicate same-named customs, which had no guard at
-- all. Unnamed customs are the one case that loses range — one active unnamed custom goal per user
-- instead of many — and an unnamed catch-all goal is not a thing the product asks anyone to hold
-- two of. Verified against prod before writing: zero users hold a colliding (type, name) pair
-- today, and zero custom goals exist at all, so this index builds without touching a single row.
drop index if exists goals_one_active_per_type;

create unique index if not exists goals_one_active_per_type_name
  on goals (user_id, type, (coalesce(lower(btrim(label)), '')))
  where archived_at is null;

comment on index goals_one_active_per_type_name is
  'One active goal per (user, category, name). Supersedes goals_one_active_per_type (0143): a named goal keeps its parent type instead of being forced to custom, which is what kept it off the discipline ladder.';
