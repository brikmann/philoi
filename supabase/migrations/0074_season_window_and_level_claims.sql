-- Season 1 "Emberfall": the hard date gate, the 85k level curve, and bundle claims.
--
-- Three things land together because they are one change to the same object — what a season IS.
--
-- 1. The season grows a WINDOW (starts_at / ends_at) and the window is enforced, not decorative:
--    the pass cannot be bought outside it and Pass XP does not accrue outside it. Without this the
--    "Season 1 runs Sept 10 → Dec 23" promise lives only in client copy, which means it isn't a
--    promise — it's a suggestion any stale build or direct RPC call can ignore.
-- 2. The curve moves from ~40,000 XP to exactly 85,000 (FORGE_PASS_SEASON1 §"XP curve"), and the
--    vocabulary moves from TIER to LEVEL to stop colliding with the rank ladder's tiers.
-- 3. Claims become bundle-shaped, because a level can hand over more than one reward.

-- NOTE: no explicit begin/commit — `supabase db push` already runs each
-- migration inside a transaction AND records schema_migrations in that same
-- transaction. An explicit commit; here would close the transaction early and
-- strand the migration record, which the CLI reports as a schema_migrations
-- insert failure rather than as the real cause.



-- ───────────────────────────── 1 · the season window ─────────────────────────────
--
-- Sept 10 → Dec 23 2026 is the Laurier + Waterloo Fall term. `claim_window_days` is the grace
-- period after close: the track freezes at ends_at but already-earned rewards stay claimable for a
-- week, so somebody who finished on the last day and didn't open the app that evening doesn't lose
-- what they earned. Freezing progress and confiscating rewards are different decisions.
update economy_config
set value = jsonb_build_object(
  'id', 'S1',
  'name', 'Emberfall',
  'total_levels', 100,
  -- total_tiers kept as a mirror of total_levels purely so an app build older than this migration
  -- keeps rendering its progress bar through the rollout. Nothing new should read it.
  'total_tiers', 100,
  'starts_at', '2026-09-10T00:00:00Z',
  'ends_at', '2026-12-23T00:00:00Z',
  'claim_window_days', 7
)
where key = 'season';

create or replace function season_config()
returns jsonb
language sql
stable
set search_path = public
as $$
  select value from economy_config where key = 'season';
$$;

/**
 * 'upcoming' | 'live' | 'claim-window' | 'closed'. The single source of truth for what the season
 * will currently allow — mirrors seasonPhase() in src/lib/economy/forge-pass.ts.
 */
create or replace function season_phase(p_ts timestamptz default now())
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v jsonb := season_config();
  v_start timestamptz := (v ->> 'starts_at')::timestamptz;
  v_end timestamptz := (v ->> 'ends_at')::timestamptz;
  v_grace int := coalesce((v ->> 'claim_window_days')::int, 0);
begin
  -- A season with no window configured is treated as permanently live. That is the pre-0074
  -- behaviour, and it is the right failure mode: a misconfigured window should not silently
  -- switch the whole economy off.
  if v_start is null or v_end is null then return 'live'; end if;
  if p_ts < v_start then return 'upcoming'; end if;
  if p_ts < v_end then return 'live'; end if;
  if p_ts < v_end + make_interval(days => v_grace) then return 'claim-window'; end if;
  return 'closed';
end;
$$;


-- ───────────────────────────── 2 · the 85,000 XP level curve ─────────────────────────────
--
-- 250 for Level 1 ramping linearly to 1,450 for Level 100. For a linear ramp the total is
-- levels × (first + last) / 2, so 100 × (250 + 1450) / 2 = exactly 85,000 — the season total the
-- spec targets. The spec's "~1,500 late" is the shape; 1,450 is what makes the shape hit the
-- stated total instead of overshooting it by 2,500.
--
-- MUST stay identical to levelCost() in src/lib/economy/forge-pass.ts. The client draws the bar
-- with its copy; this one decides whether a claim is allowed, and a disagreement shows up as a
-- Claim button that errors.
create or replace function economy_level_from_xp(p_xp int)
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  v_remaining int := p_xp;
  v_cost int;
  l int;
begin
  for l in 1..100 loop
    v_cost := round(250 + ((l - 1) * 1200.0) / 99);
    if v_remaining < v_cost then return l - 1; end if;
    v_remaining := v_remaining - v_cost;
  end loop;
  return 100;
end;
$$;

-- The old name kept as a thin alias. An app build that predates this migration still calls
-- economy_tier_from_xp through claim_pass_tier, and during the rollout both must agree on the
-- SAME curve — leaving the old 40k body in place would have let an old client believe it had
-- reached a level the server would then refuse to pay out.
create or replace function economy_tier_from_xp(p_xp int)
returns int
language sql
immutable
set search_path = public
as $$
  select economy_level_from_xp(p_xp);
$$;


-- ───────────────────────── 3 · the Level 0 instant unlock ─────────────────────────
--
-- Buying the pass grants the marquee flare, the season flame and 1,000 embers immediately
-- (FORGE_PASS_SEASON1 §"Level 0"). It is deliberately NOT a milestone reward: a $9.99 purchase
-- whose headline item is 25 levels away is a promise, and this one has to be a receipt.
--
-- Recorded as a claim at level 0 so it is idempotent for free — re-running it for someone who
-- already bought in does nothing. Defined before grant_forge_pass because that function calls it.
create or replace function grant_level_zero_unlock(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := season_config() ->> 'id';
begin
  insert into pass_claims (user_id, season_id, tier, lane) values (p_user, v_season, 0, 'premium')
  on conflict do nothing;
  if not found then return; end if;

  perform economy_grant_cosmetic(p_user, 'flare-emberfall-ascendant', 'flare', 'mythic', 'forge_pass', 'Forge Pass · Level 0');
  perform economy_grant_cosmetic(p_user, 'flame-forge', 'flame', 'legendary', 'forge_pass', 'Forge Pass · Level 0');
  perform economy_move_embers(p_user, 1000, 'forge_pass', null);
end;
$$;

revoke all on function grant_level_zero_unlock(uuid) from public, authenticated;


-- ───────────────────────────── 4 · gate purchase + XP accrual ─────────────────────────────

-- Buying the pass outside the window is refused outright. grant_forge_pass is service-role only
-- (it's what the RevenueCat webhook will call), so this is the last line before entitlement.
create or replace function grant_forge_pass(p_user uuid, p_season text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := coalesce(p_season, season_config() ->> 'id');
begin
  if season_phase() <> 'live' then
    raise exception 'The % season is not open for purchase right now.', v_season;
  end if;

  insert into forge_pass_state (user_id, season_id, owns_premium, premium_granted_at)
  values (p_user, v_season, true, now())
  on conflict (user_id, season_id) do update set owns_premium = true, premium_granted_at = now();

  -- The purchase's receipt, in the same transaction as the entitlement. Defined below; it is
  -- idempotent, so a webhook that retries cannot grant the flare twice.
  perform grant_level_zero_unlock(p_user);
end;
$$;

revoke all on function grant_forge_pass(uuid, text) from public, authenticated;

-- XP accrual stops at the boundary too. This is the one that actually protects the season's
-- meaning: without it, XP earned in August would already have banked levels before the season
-- opened, and December 24th's lock-ins would keep climbing a track that is supposed to be frozen.
create or replace function economy_credit_pass_xp_for(
  p_user uuid, p_achievement text, p_xp int, p_period text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := season_config() ->> 'id';
begin
  if season_phase() <> 'live' then return; end if;

  insert into forge_pass_state (user_id, season_id) values (p_user, v_season)
  on conflict (user_id, season_id) do nothing;

  insert into pass_xp_ledger (user_id, season_id, achievement_key, xp, period_key)
  values (p_user, v_season, p_achievement, p_xp, p_period)
  on conflict (user_id, achievement_key, period_key) do nothing;

  if found then
    update forge_pass_state set pass_xp = pass_xp + p_xp
    where user_id = p_user and season_id = v_season;
  end if;
end;
$$;


-- ───────────────────────────── 5 · bundle claims ─────────────────────────────

/**
 * Claim every reward a level's lane carries, in one transaction.
 *
 * The old claim_pass_tier took ONE reward. That could not express L50 premium (a Mythic halo AND
 * the Emberfall Strike sting) or L100 (a medal AND a title): pass_claims is unique on
 * (user, season, tier, lane), so calling it twice for one level granted the first reward and threw
 * a duplicate-key error on the second — half a level, no way to ask for the rest.
 *
 * Everything the caller could lie about is re-derived here: the level reached comes from stored XP,
 * lane ownership from forge_pass_state, and the season phase from the configured window. The
 * rewards array is the only thing taken on trust, and it is validated shape-wise below.
 */
create or replace function claim_pass_level(p_level int, p_lane text, p_rewards jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := season_config() ->> 'id';
  v_state forge_pass_state;
  v_phase text := season_phase();
  v_reward jsonb;
  v_kind text;
  v_granted int := 0;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  if p_lane not in ('free', 'premium') then
    raise exception 'Unknown lane %', p_lane;
  end if;

  if jsonb_typeof(p_rewards) <> 'array' or jsonb_array_length(p_rewards) = 0 then
    raise exception 'No rewards to claim';
  end if;

  -- Claims survive the freeze for the grace window, then stop. 'upcoming' can't happen in practice
  -- (there'd be no XP) but is refused explicitly rather than left to fall through.
  if v_phase = 'closed' then
    raise exception 'The % season has closed and its rewards have expired.', v_season;
  elsif v_phase = 'upcoming' then
    raise exception 'The % season has not started yet.', v_season;
  end if;

  select * into v_state from forge_pass_state where user_id = v_user and season_id = v_season;
  if v_state.user_id is null then raise exception 'No Pass progress this season yet'; end if;

  if p_lane = 'premium' and not v_state.owns_premium then
    raise exception 'The Premium track needs this season''s Forge Pass';
  end if;

  if p_level > economy_level_from_xp(v_state.pass_xp) then
    raise exception 'You have not reached level % yet', p_level;
  end if;

  -- The claim row goes in FIRST and its unique index is what makes this idempotent: a double-tapped
  -- Claim button raises here, before a single reward is granted, rather than paying out twice.
  insert into pass_claims (user_id, season_id, tier, lane) values (v_user, v_season, p_level, p_lane);

  for v_reward in select * from jsonb_array_elements(p_rewards) loop
    v_kind := v_reward ->> 'kind';
    if v_kind = 'embers' then
      perform economy_move_embers(v_user, (v_reward ->> 'embers')::int, 'forge_pass', null);
    elsif v_kind = 'box' then
      insert into loot_boxes (user_id, box_key, obtained_via, provenance)
      values (v_user, v_reward ->> 'box_key', 'forge_pass', 'Forge Pass · level ' || p_level);
    elsif v_kind = 'item' then
      perform economy_grant_cosmetic(
        v_user, v_reward ->> 'item_key', v_reward ->> 'item_slot', v_reward ->> 'item_rarity',
        'forge_pass', 'Forge Pass · level ' || p_level
      );
    elsif v_kind = 'badge' then
      insert into owned_badges (user_id, badge_key, source, provenance)
      values (v_user, v_reward ->> 'item_key', 'forge_pass', 'Forge Pass · level ' || p_level)
      on conflict do nothing;
    else
      raise exception 'Unknown reward kind %', v_kind;
    end if;
    v_granted := v_granted + 1;
  end loop;

  return jsonb_build_object('level', p_level, 'lane', p_lane, 'granted', v_granted);
end;
$$;



