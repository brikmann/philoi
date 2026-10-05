-- 0232 — The Flame Pass overflows into prestige.
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- 0227 made a lock-in pay the Pass for its hours, so L100 (85,000 XP) is now reachable by doing the
-- thing the app is for — and someone who keeps going past it had nothing left to climb. Pass XP
-- already keeps accruing past 85,000 (economy_credit_pass_xp_for never capped it; only
-- economy_level_from_xp stops at 100). This turns that overflow into PRESTIGE: the only prestige in
-- the game, and season-scoped.
--
--   prestige = floor((pass_xp − 85,000) / 9,000)        when pass_xp ≥ 94,000, else 0
--
-- 9,000 XP is ~36 hours of lock-in beyond a full pass at 0227's 250/h, so each level is a trophy.
-- The most cracked realistic season (~190k pass XP) lands at +11; nobody reaches +60.
--
-- ─────────────────────────────── WHAT CHANGES ───────────────────────────────
--
-- 1. economy_config('pass_prestige') — the level size and every payout, tunable without a
--    migration. PRESTIGE_LEVEL_XP in forge-pass.ts mirrors level_xp for drawing the bar only.
--
-- 2. claim_pass_prestige(n) — each prestige level is claimable once, (user, season, n), like a
--    pass level. The SERVER decides the rewards (0221's rule: nothing a claim carries is trusted),
--    and every level pays:
--      · 2,000 embers, and
--      · a Promethean Vault — a guaranteed MYTHIC box (pity 'every 3' is not what guarantees it;
--        the box is simply the mythic tier),
--    plus a milestone exclusive at +1 / +3 / +5 / +10 (flame · embers · aura · crown). Exclusives
--    are source='earned' (salvage refuses them, 0213) and stamped "+N PRESTIGE · S1".
--    Lane-free: prestige is effort, and money never buys standing.
--
-- 3. get_pass_prestige() — the pass screen's read: prestige, claims, and the reward table.
--
-- 4. THE PRESTIGE BOX at season close. close_season_prestige(season) runs from the placement-close
--    cron (0075/0187): advisory-locked → snapshot (season_prestige_finals) → grant → mark closed
--    (season_prestige_closures). Anyone finishing at +1 or higher gets, scaled to final prestige p:
--      · (1 + p / 3) Promethean Vaults         · 1,000 × min(p, 10) embers
--      · the Emberfall Prestige medal, stamped "+p PRESTIGE · LEVEL 100+p · S1" (permanent)
--    Not gated on a verified university like the campus board: prestige is the track, not a board.
--    Logged to season_reward_grants (scope 'prestige') so the season card lists it.
--
--    "Prestige Box" is a BUNDLE of existing boxes, not a new box_key. An installed build looks up
--    BOXES[box_key] for every unopened box, and an unknown key there is a crash OTA cannot fix.
--
-- 5. close_season_placements is restated to call (4) — BEFORE its own closure check, so a
--    placement close that already ran cannot stop the prestige close from running.
--
-- 6. Five catalog items (catalog.ts EMBERFALL_PRESTIGE) into cosmetic_rarity; none into
--    box_droppable_items, asserted below.
--
-- Installed builds: nothing they read changes shape. get_inventory is untouched (the prestige claim
-- rows live in their own table), and the new cosmetics resolve to undefined on an old catalog,
-- which every consumer already skips.

-- ── prerequisite · 0227 (the base rate) must be live ──
do $pre$
begin
  if not exists (select 1 from economy_config where key = 'pass_xp_per_lock_in_hour') then
    raise exception '0232: the Pass base rate (0227) is not applied — prestige needs it live first';
  end if;
end;
$pre$;

-- ── base check · close_season_placements is restated from the LIVE prosrc (2026-10-05, 0187's body) ──
do $base$
declare
  v_live text;
begin
  select md5(replace(p.prosrc, chr(13), '')) into v_live
  from pg_proc p where p.oid = 'public.close_season_placements()'::regprocedure;
  if v_live is distinct from 'd42dd37c9f1f286a2d6b86f9250523f3' then
    raise exception '0232: live close_season_placements changed since this file was drafted (md5 %) — rebase onto it', v_live;
  end if;
end;
$base$;

-- ═══════════════════════════════ 1 · the config ═══════════════════════════════

insert into economy_config (key, value) values ('pass_prestige', jsonb_build_object(
  'base_xp', 85000,
  'level_xp', 9000,
  'per_level', jsonb_build_object('embers', 2000, 'box_key', 'promethean'),
  'exclusives', jsonb_build_object(
    '1',  jsonb_build_object('item_key', 'flame-s1-prestige',      'item_slot', 'flame',    'item_rarity', 'legendary'),
    '3',  jsonb_build_object('item_key', 'particle-s1-prestige',   'item_slot', 'particle', 'item_rarity', 'legendary'),
    '5',  jsonb_build_object('item_key', 'flare-s1-prestige',      'item_slot', 'flare',    'item_rarity', 'legendary'),
    '10', jsonb_build_object('item_key', 'halo-s1-prestige-crown', 'item_slot', 'halo',     'item_rarity', 'mythic')
  ),
  'capstone', jsonb_build_object(
    'box_key', 'promethean', 'boxes_base', 1, 'boxes_every', 3,
    'embers_per_prestige', 1000, 'embers_prestige_cap', 10,
    'medal_key', 'medal-s1-prestige', 'medal_rarity', 'legendary'
  )
))
on conflict (key) do nothing;

-- ═══════════════════════════════ 2 · the tables ═══════════════════════════════

create table if not exists pass_prestige_claims (
  user_id uuid not null references profiles (id) on delete cascade,
  season_id text not null,
  prestige int not null check (prestige >= 1),
  claimed_at timestamptz not null default now(),
  primary key (user_id, season_id, prestige)
);

alter table pass_prestige_claims enable row level security;
drop policy if exists pass_prestige_claims_read_own on pass_prestige_claims;
create policy pass_prestige_claims_read_own on pass_prestige_claims
  for select to authenticated using (user_id = auth.uid());

-- The close's frozen record: where each prestiged account finished. Like season_standings, it
-- outlives the season and is what the medal's stamp was struck from.
create table if not exists season_prestige_finals (
  season_id text not null,
  user_id uuid not null references profiles (id) on delete cascade,
  pass_xp int not null,
  prestige int not null check (prestige >= 1),
  captured_at timestamptz not null default now(),
  primary key (season_id, user_id)
);

alter table season_prestige_finals enable row level security;
drop policy if exists season_prestige_finals_read on season_prestige_finals;
create policy season_prestige_finals_read on season_prestige_finals
  for select to authenticated using (true);

create table if not exists season_prestige_closures (
  season_id text primary key,
  closed_at timestamptz not null default now(),
  granted int not null default 0
);

alter table season_prestige_closures enable row level security;
-- No policy: closure bookkeeping belongs to no client.

-- ═══════════════════════════════ 3 · the counter ═══════════════════════════════

-- The ONE definition of prestige. MUST match prestigeFromXp() in src/lib/economy/forge-pass.ts.
create or replace function pass_prestige_from_xp(p_xp int)
returns int
language sql
stable
set search_path = public
as $$
  select greatest(0, floor(
    (coalesce(p_xp, 0) - (c.value ->> 'base_xp')::int)::numeric / nullif((c.value ->> 'level_xp')::int, 0)
  )::int)
  from economy_config c where c.key = 'pass_prestige';
$$;

-- What prestige level n pays, off the config — the claim and the read both use it, so the screen
-- cannot promise what the claim will not grant.
create or replace function pass_prestige_rewards(p_n int)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_array(
    jsonb_build_object('kind', 'embers', 'embers', (c.value -> 'per_level' ->> 'embers')::int),
    jsonb_build_object('kind', 'box', 'box_key', c.value -> 'per_level' ->> 'box_key')
  ) || case
    when c.value -> 'exclusives' ? p_n::text
      then jsonb_build_array(jsonb_build_object('kind', 'item') || (c.value -> 'exclusives' -> p_n::text))
    else '[]'::jsonb
  end
  from economy_config c where c.key = 'pass_prestige';
$$;

-- ═══════════════════════════════ 4 · the claim ═══════════════════════════════

create or replace function claim_pass_prestige(p_prestige int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := season_config() ->> 'id';
  v_phase text := season_phase();
  v_xp int;
  v_rewards jsonb;
  v_reward jsonb;
  v_kind text;
  v_provenance text;
  v_grant jsonb;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  -- Same window as a level claim: through the claim week, then gone.
  if v_phase = 'closed' then
    raise exception 'The % season has closed and its rewards have expired.', v_season;
  elsif v_phase = 'upcoming' then
    raise exception 'The % season has not started yet.', v_season;
  end if;

  select pass_xp into v_xp from forge_pass_state where user_id = v_user and season_id = v_season;
  if v_xp is null then raise exception 'No Pass progress this season yet'; end if;

  if p_prestige is null or p_prestige < 1 or p_prestige > pass_prestige_from_xp(v_xp) then
    raise exception 'You have not reached prestige +% yet', p_prestige;
  end if;

  -- The claim row first: its key is what makes this pay once.
  insert into pass_prestige_claims (user_id, season_id, prestige) values (v_user, v_season, p_prestige)
  on conflict do nothing;
  if not found then raise exception 'Prestige +% is already claimed', p_prestige; end if;

  v_rewards := pass_prestige_rewards(p_prestige);
  v_provenance := 'Flame Pass · Prestige +' || p_prestige || ' · ' || v_season;

  for v_reward in select * from jsonb_array_elements(v_rewards) loop
    v_kind := v_reward ->> 'kind';
    if v_kind = 'embers' then
      perform economy_move_embers(v_user, (v_reward ->> 'embers')::int, 'forge_pass', null);
    elsif v_kind = 'box' then
      insert into loot_boxes (user_id, box_key, obtained_via, provenance)
      values (v_user, v_reward ->> 'box_key', 'forge_pass', v_provenance);
    elsif v_kind = 'item' then
      v_grant := economy_grant_cosmetic(
        v_user, v_reward ->> 'item_key', v_reward ->> 'item_slot', v_reward ->> 'item_rarity',
        'earned', v_provenance
      );
      if not (v_grant ->> 'dupe')::boolean then
        update cosmetics_owned set season_stamp = '+' || p_prestige || ' PRESTIGE · ' || v_season
        where user_id = v_user and cosmetic_key = v_reward ->> 'item_key';
      end if;
    else
      raise exception 'Unknown prestige reward kind %', v_kind;
    end if;
  end loop;

  return jsonb_build_object('prestige', p_prestige, 'season_id', v_season, 'rewards', v_rewards);
end;
$$;

revoke all on function claim_pass_prestige(int) from public, anon;
grant execute on function claim_pass_prestige(int) to authenticated;

-- ═══════════════════════════════ 5 · the read ═══════════════════════════════

create or replace function get_pass_prestige()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := season_config() ->> 'id';
  v_cfg jsonb := (select value from economy_config where key = 'pass_prestige');
  v_xp int;
  v_prestige int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  v_xp := coalesce((select pass_xp from forge_pass_state where user_id = v_user and season_id = v_season), 0);
  v_prestige := pass_prestige_from_xp(v_xp);

  return jsonb_build_object(
    'season_id', v_season,
    'pass_xp', v_xp,
    'prestige', v_prestige,
    'base_xp', (v_cfg ->> 'base_xp')::int,
    'level_xp', (v_cfg ->> 'level_xp')::int,
    'claimed', coalesce((
      select jsonb_agg(c.prestige order by c.prestige)
      from pass_prestige_claims c where c.user_id = v_user and c.season_id = v_season
    ), '[]'::jsonb),
    -- The track: every level reached plus the next, and every milestone — enough to draw the
    -- rewards ahead without the client inventing them.
    'track', (
      select jsonb_agg(jsonb_build_object('prestige', n, 'rewards', pass_prestige_rewards(n)) order by n)
      from (
        select generate_series(1, greatest(v_prestige + 1, 1)) as n
        union
        select k::int from jsonb_object_keys(v_cfg -> 'exclusives') k
      ) s
    ),
    'final', (
      select jsonb_build_object('prestige', f.prestige, 'pass_xp', f.pass_xp)
      from season_prestige_finals f where f.season_id = v_season and f.user_id = v_user
    )
  );
end;
$$;

revoke all on function get_pass_prestige() from public, anon;
grant execute on function get_pass_prestige() to authenticated;

-- ═══════════════════════════════ 6 · the close ═══════════════════════════════

create or replace function close_season_prestige(p_season text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := coalesce(p_season, season_config() ->> 'id');
  v_cfg jsonb := (select value -> 'capstone' from economy_config where key = 'pass_prestige');
  v_boxes int;
  v_embers int;
  v_granted int := 0;
  v_stamp text;
  r record;
begin
  -- XP still moves while the season is live; the snapshot is only final after it.
  if season_phase() in ('upcoming', 'live') then return 0; end if;

  -- Serialize BEFORE the check (0187's pattern) — held to commit, so a second run sees the closure.
  perform pg_advisory_xact_lock(hashtext('philoi.season_prestige'), hashtext(v_season));
  if exists (select 1 from season_prestige_closures where season_id = v_season) then return 0; end if;

  -- ── snapshot ──
  insert into season_prestige_finals (season_id, user_id, pass_xp, prestige)
  select v_season, f.user_id, f.pass_xp, pass_prestige_from_xp(f.pass_xp)
  from forge_pass_state f
  join profiles p on p.id = f.user_id
  where f.season_id = v_season
    and not p.is_demo and not p.is_disabled
    and pass_prestige_from_xp(f.pass_xp) >= 1
  on conflict (season_id, user_id) do nothing;

  -- ── grant ──
  for r in select * from season_prestige_finals where season_id = v_season order by prestige desc loop
    v_boxes := (v_cfg ->> 'boxes_base')::int + r.prestige / (v_cfg ->> 'boxes_every')::int;
    v_embers := (v_cfg ->> 'embers_per_prestige')::int * least(r.prestige, (v_cfg ->> 'embers_prestige_cap')::int);
    v_stamp := '+' || r.prestige || ' PRESTIGE · LEVEL ' || (100 + r.prestige) || ' · ' || v_season;

    insert into loot_boxes (user_id, box_key, obtained_via, provenance)
    select r.user_id, v_cfg ->> 'box_key', 'season', 'Prestige Box · ' || v_season || ' · +' || r.prestige
    from generate_series(1, v_boxes);
    perform economy_move_embers(r.user_id, v_embers, 'season_reward', null);

    perform economy_grant_cosmetic(r.user_id, v_cfg ->> 'medal_key', null, v_cfg ->> 'medal_rarity', 'earned',
                                   'Season ' || v_season || ' · Prestige +' || r.prestige);
    update cosmetics_owned set season_stamp = v_stamp
    where user_id = r.user_id and cosmetic_key = v_cfg ->> 'medal_key';

    perform season_log_grant(v_season, r.user_id, 'prestige', '+' || r.prestige, 'medal', v_cfg ->> 'medal_key',
                             'Emberfall Prestige', v_cfg ->> 'medal_rarity', true, null);
    perform season_log_grant(v_season, r.user_id, 'prestige', '+' || r.prestige, 'box', v_cfg ->> 'box_key',
                             'Promethean Vault', 'mythic', false, v_boxes);
    perform season_log_grant(v_season, r.user_id, 'prestige', '+' || r.prestige, 'embers', 'embers',
                             'Embers', null, false, v_embers);
    v_granted := v_granted + 1;
  end loop;

  -- ── mark closed ──
  insert into season_prestige_closures (season_id, granted) values (v_season, v_granted)
  on conflict (season_id) do nothing;

  return v_granted;
end;
$$;

revoke all on function close_season_prestige(text) from public, anon, authenticated;
revoke all on function pass_prestige_rewards(int) from public, anon, authenticated;

-- 0187's body, plus the prestige close. It goes BEFORE the placement closure check: that check
-- returns early forever once the board has paid, and the prestige close keeps its own ledger.
create or replace function close_season_placements()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := season_config() ->> 'id';
begin
  if season_phase() in ('upcoming', 'live') then return; end if;

  -- 0232: the Prestige Box. Idempotent and advisory-locked on its own key.
  perform close_season_prestige(v_season);

  -- 0187: serialize BEFORE the check. Held to commit, so the second run's check sees the closure.
  perform pg_advisory_xact_lock(hashtext('philoi.season_placements'), hashtext(v_season));
  if exists (select 1 from season_placement_closures where season_id = v_season) then return; end if;

  perform snapshot_season_standings(v_season);
  perform grant_season_placement_rewards(v_season, false);
end;
$$;

-- ═══════════════════════════════ 7 · the catalog ═══════════════════════════════
-- Generated by `node scripts/check-cosmetic-rarity.js --print-seed`. Do not hand-edit.
-- Against 0223: + the five EMBERFALL_PRESTIGE items, + 0231's RANK_SET (catalog.ts at drafting).

insert into cosmetic_rarity (cosmetic_key, rarity) values
  ('audio-base-hearth-hum', 'common'),
  ('audio-deep-space-sub-bass', 'legendary'),
  ('audio-edm-pulse', 'rare'),
  ('audio-heavy-bonfire-crackle', 'uncommon'),
  ('audio-lofi-lullaby', 'epic'),
  ('audio-midnight-thunder', 'rare'),
  ('audio-monastery-drone', 'epic'),
  ('banner-ashfall', 'legendary'),
  ('banner-ashfall-ridge', 'epic'),
  ('banner-base-hearth', 'common'),
  ('banner-emberfall-mythic', 'legendary'),
  ('banner-emberfall-night', 'epic'),
  ('banner-obsidian-colosseum', 'legendary'),
  ('banner-the-great-forge', 'legendary'),
  ('card-base-hearth', 'common'),
  ('card-brushed-steel', 'uncommon'),
  ('card-carbon-fiber', 'rare'),
  ('card-cracked-magma', 'epic'),
  ('card-emberfall', 'epic'),
  ('card-emberfall-mythic', 'legendary'),
  ('card-emberfall-sovereign', 'mythic'),
  ('card-forged-bronze', 'uncommon'),
  ('card-golden-anvil', 'legendary'),
  ('card-marble-of-olympus', 'epic'),
  ('card-obsidian-mesh', 'rare'),
  ('card-plasma-grid', 'epic'),
  ('flame-base-ember', 'common'),
  ('flame-cosmic-purple', 'legendary'),
  ('flame-electric-cyan', 'rare'),
  ('flame-emberfall', 'epic'),
  ('flame-forge', 'legendary'),
  ('flame-lime-volt', 'rare'),
  ('flame-molten-copper', 'rare'),
  ('flame-neutron-starfire', 'legendary'),
  ('flame-rank-diamond', 'epic'),
  ('flame-rank-divine', 'legendary'),
  ('flame-rank-gold', 'rare'),
  ('flame-rank-hero', 'legendary'),
  ('flame-rank-immortal', 'mythic'),
  ('flame-rank-platinum', 'epic'),
  ('flame-rank-primordial', 'mythic'),
  ('flame-rank-silver', 'rare'),
  ('flame-rank-titan', 'legendary'),
  ('flame-s1-prestige', 'legendary'),
  ('flame-solar-flare', 'epic'),
  ('flame-stormforge', 'mythic'),
  ('flame-toxic-green', 'epic'),
  ('flare-acid-rain', 'legendary'),
  ('flare-asgardian-valor', 'legendary'),
  ('flare-emberfall-ascendant', 'legendary'),
  ('flare-inferno', 'mythic'),
  ('flare-s1-prestige', 'legendary'),
  ('flare-solar', 'epic'),
  ('flare-void-plasma', 'legendary'),
  ('flare-void-purple-aura', 'legendary'),
  ('flare-white-incandescence', 'epic'),
  ('flare-zeus-wrath', 'mythic'),
  ('halo-base-ring', 'common'),
  ('halo-copper-ring', 'uncommon'),
  ('halo-diamond-prism', 'epic'),
  ('halo-ember-halo', 'uncommon'),
  ('halo-emberfall', 'epic'),
  ('halo-emberfall-mythic', 'legendary'),
  ('halo-glowing-amber', 'rare'),
  ('halo-hades', 'mythic'),
  ('halo-inferno-flare', 'legendary'),
  ('halo-s1-prestige-crown', 'mythic'),
  ('halo-sakura', 'epic'),
  ('medal-campus-sovereign', 'legendary'),
  ('medal-emberfall-centurion', 'legendary'),
  ('medal-emberfall-champion', 'legendary'),
  ('medal-emberfall-crown', 'mythic'),
  ('medal-emberfall-participant', 'common'),
  ('medal-s1-podium-1', 'mythic'),
  ('medal-s1-podium-2', 'legendary'),
  ('medal-s1-podium-3', 'legendary'),
  ('medal-s1-prestige', 'legendary'),
  ('medal-s1-top-1', 'legendary'),
  ('medal-s1-top-10', 'epic'),
  ('medal-s1-top-25', 'common'),
  ('medal-s1-top-5', 'epic'),
  ('medal-s1-top-50', 'common'),
  ('medal-unbroken-season', 'legendary'),
  ('particle-base-spark', 'common'),
  ('particle-ember-swarm', 'epic'),
  ('particle-emberfall-ascendant', 'epic'),
  ('particle-falling-ash', 'epic'),
  ('particle-floating-sparks', 'epic'),
  ('particle-lightning-tendrils', 'legendary'),
  ('particle-s1-prestige', 'legendary'),
  ('particle-solar-flares', 'legendary'),
  ('particle-void-smoke', 'legendary'),
  ('relic-anvil-of-hephaestus', 'legendary'),
  ('relic-athenas-aegis', 'epic'),
  ('relic-atlas-burden', 'mythic'),
  ('relic-crown-of-olympus', 'mythic'),
  ('relic-daedalus-blueprint', 'uncommon'),
  ('relic-emberfall', 'mythic'),
  ('relic-hercules-might', 'uncommon'),
  ('relic-hestias-hearthstone', 'epic'),
  ('relic-icarus-feather', 'legendary'),
  ('relic-pheidippides-sandals', 'rare'),
  ('relic-prometheus-shard', 'mythic'),
  ('relic-socrates-scroll', 'uncommon'),
  ('relic-zeus-bolt', 'mythic'),
  ('sfx-campfire-spark', 'common'),
  ('sfx-ember-settle', 'common'),
  ('sfx-emberfall-strike', 'legendary'),
  ('sfx-heavy-anvil-slam', 'rare'),
  ('sfx-jet-engine-ignition', 'epic'),
  ('sfx-olympian-foghorn', 'legendary'),
  ('sfx-sub-bass-drop', 'rare'),
  ('title-ascended', 'mythic'),
  ('title-ascended-global', 'mythic'),
  ('title-ash-sovereign', 'epic'),
  ('title-ash-walker', 'rare'),
  ('title-ashborne', 'epic'),
  ('title-base-kindling', 'common'),
  ('title-built-different', 'uncommon'),
  ('title-campfire-champion', 'epic'),
  ('title-campfire-finisher', 'rare'),
  ('title-champions-of-academia', 'epic'),
  ('title-cracked', 'rare'),
  ('title-demigod', 'legendary'),
  ('title-dialed-in', 'legendary'),
  ('title-early-bird', 'rare'),
  ('title-elite-ember', 'epic'),
  ('title-ember-stoker', 'common'),
  ('title-emberfall-ascendant', 'epic'),
  ('title-emberfall-champion', 'mythic'),
  ('title-emberfall-contender', 'rare'),
  ('title-emberfall-elite', 'legendary'),
  ('title-emberfall-initiate', 'uncommon'),
  ('title-final-boss', 'epic'),
  ('title-forged-in-ember', 'legendary'),
  ('title-forged-in-emberfall', 'epic'),
  ('title-infernal', 'legendary'),
  ('title-iron-forged', 'rare'),
  ('title-keepers-of-the-flame', 'epic'),
  ('title-kept-the-fire', 'rare'),
  ('title-kindled', 'common'),
  ('title-kindled-by-emberfall', 'legendary'),
  ('title-last-flame-standing', 'epic'),
  ('title-locked-in', 'common'),
  ('title-main-character', 'rare'),
  ('title-night-owl', 'rare'),
  ('title-ninety-day-siege', 'epic'),
  ('title-on-fire', 'epic'),
  ('title-pacesetter', 'uncommon'),
  ('title-prometheus-disciples', 'epic'),
  ('title-s1-agni', 'mythic'),
  ('title-s1-built-different', 'legendary'),
  ('title-s1-certified-firestarter', 'rare'),
  ('title-s1-firebreather', 'epic'),
  ('title-s1-helios', 'mythic'),
  ('title-s1-surtur', 'mythic'),
  ('title-s1-the-relentless', 'legendary'),
  ('title-s1-top-1', 'legendary'),
  ('title-s1-top-10', 'epic'),
  ('title-s1-top-25', 'rare'),
  ('title-s1-top-5', 'epic'),
  ('title-s1-top-50', 'uncommon'),
  ('title-s1-warming-up', 'uncommon'),
  ('title-season-mvp', 'epic'),
  ('title-the-goat', 'epic'),
  ('title-the-relentless', 'epic'),
  ('title-the-undefeated', 'epic'),
  ('title-the-untouchable', 'epic'),
  ('title-titan', 'legendary'),
  ('title-unbroken', 'epic'),
  ('title-villain-arc', 'rare')
on conflict (cosmetic_key) do update set rarity = excluded.rarity;

-- ═══════════════════════════════ ASSERT ═══════════════════════════════
do $assert$
declare
  v_cfg jsonb := (select value from economy_config where key = 'pass_prestige');
  v_key text;
begin
  -- The counter's anchor is the curve's own L100: 85,000 is Level 100, one XP less is not.
  if economy_level_from_xp((v_cfg ->> 'base_xp')::int) <> 100
     or economy_level_from_xp((v_cfg ->> 'base_xp')::int - 1) <> 99 then
    raise exception '0232: pass_prestige.base_xp is not the curve''s Level 100';
  end if;

  -- The spec's worked numbers.
  if pass_prestige_from_xp(85000) <> 0 or pass_prestige_from_xp(93999) <> 0 or pass_prestige_from_xp(94000) <> 1
     or pass_prestige_from_xp(85000 + 3 * 9000) <> 3 or pass_prestige_from_xp(190000) <> 11
     or pass_prestige_from_xp(0) <> 0 then
    raise exception '0232: pass_prestige_from_xp does not match the spec';
  end if;

  -- Every exclusive and the medal are priced, and NONE of them can drop from a box.
  for v_key in
    select e.value ->> 'item_key' from jsonb_each(v_cfg -> 'exclusives') e
    union all select v_cfg -> 'capstone' ->> 'medal_key'
  loop
    if not exists (select 1 from cosmetic_rarity where cosmetic_key = v_key) then
      raise exception '0232: % is not in cosmetic_rarity', v_key;
    end if;
    if exists (select 1 from box_droppable_items where item_key = v_key) then
      raise exception '0232: prestige exclusive % is in the box drop pool', v_key;
    end if;
  end loop;

  -- The per-level box is the mythic tier, and is a box key installed builds already know.
  if v_cfg -> 'per_level' ->> 'box_key' <> 'promethean' or v_cfg -> 'capstone' ->> 'box_key' <> 'promethean' then
    raise exception '0232: prestige boxes must be the Promethean Vault';
  end if;

  -- Grants: the claim and read are a signed-in user's, the close and reward table are not anyone's.
  if has_function_privilege('anon', 'claim_pass_prestige(int)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'get_pass_prestige()'::regprocedure, 'EXECUTE') then
    raise exception '0232: anon can reach a prestige RPC';
  end if;
  if not has_function_privilege('authenticated', 'claim_pass_prestige(int)'::regprocedure, 'EXECUTE') then
    raise exception '0232: authenticated cannot claim prestige';
  end if;
  if has_function_privilege('authenticated', 'close_season_prestige(text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'close_season_prestige(text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'close_season_placements()'::regprocedure, 'EXECUTE') then
    raise exception '0232: a season close is client-callable';
  end if;

  -- The cron still points at the function this restated.
  if not exists (select 1 from cron.job where jobname = 'philoi-season-placement-close'
                 and command ilike '%close_season_placements()%') then
    raise exception '0232: philoi-season-placement-close no longer runs close_season_placements';
  end if;

  -- One overload per new name.
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
             and proname in ('claim_pass_prestige', 'get_pass_prestige', 'close_season_prestige',
                             'pass_prestige_from_xp', 'pass_prestige_rewards')
             group by proname having count(*) > 1) then
    raise exception '0232: a prestige function has more than one overload';
  end if;

  -- The read runs (plpgsql binds at call time) — without a session it must refuse, not crash.
  begin
    perform get_pass_prestige();
    raise exception '0232: get_pass_prestige answered without a session';
  exception when raise_exception then
    if sqlerrm <> 'Not signed in' then raise; end if;
  end;
end;
$assert$;
