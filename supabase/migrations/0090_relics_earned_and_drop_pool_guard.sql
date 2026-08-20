-- §6 — relics become EARNED, and the drop pool stops trusting the client.
--
-- CONFIRMED TRIGGERS (the "/" in the brief read as "first clause only", per the build decision):
--   Hestia's Hearthstone  (epic)      — a 30-day streak
--   Athena's Aegis        (epic)      — a calendar month with zero dead days
--   Icarus' Feather       (legendary) — a new personal peak rank, Gold or above
--   Anvil of Hephaestus   (legendary) — 500 total hours locked in
--   Prometheus' Shard     (mythic)    — Top 1% of a season
--
-- The Shard's second clause ("bring N friends who verify") is NOT built, because the same decision
-- dropped every second clause. N was settled at 5 if it is ever revived; it is recorded here rather
-- than as dead config, since an unused threshold in economy_config would read as live.

-- ───────────────────────── 1. the drop pool stops trusting the client ─────────────────────────
--
-- 0064's open_loot_box takes its candidate ids FROM THE CALLER. Its comment says "the client can't
-- aim the roll", which is true of WHICH item is picked from a bucket and false of WHAT IS IN the
-- bucket: a modified client can send {"mythic": ["relic-prometheus-shard"]} and be granted it.
--
-- That makes "relics are earned-only" unenforceable in the client alone — boxPoolByRarity()
-- already filters them out for every honest user, and none of that binds a patched build. So the
-- server gets its own list of what a box may ever produce.
--
-- A KEY LIST, not a full catalog mirror. Copying ~60 rows of item metadata into Postgres is what
-- 0064 was avoiding and that reasoning still holds — but an id allowlist is one column, and it is
-- the only fact the server actually needs to refuse a grant.
create table if not exists box_droppable_items (
  item_key text primary key,
  rarity text not null
);

alter table box_droppable_items enable row level security;
-- Readable by anyone signed in (it is the published drop table); writes are service-role only.
drop policy if exists box_droppable_read on box_droppable_items;
create policy box_droppable_read on box_droppable_items for select to authenticated using (true);

/**
 * Refresh the allowlist from the client's catalog.
 *
 * Service-role only. This is how the list stays in sync without duplicating the catalog by hand:
 * a deploy step sends the current `acquisition === 'box'` ids, and anything absent stops dropping.
 * Deliberately a REPLACE of the whole set — an item removed from the catalog must stop being
 * droppable, and a merge would leave it behind forever.
 */
create or replace function economy_set_droppable_items(p_items jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from box_droppable_items;
  insert into box_droppable_items (item_key, rarity)
  select key, value ->> 'rarity'
  from jsonb_each(p_items);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function economy_set_droppable_items(jsonb) from public;
revoke all on function economy_set_droppable_items(jsonb) from authenticated;

-- open_loot_box now intersects the caller's pool with the allowlist. Signature is unchanged, so
-- CREATE OR REPLACE is safe and no client change is required.
--
-- FAILS OPEN WHILE THE TABLE IS EMPTY. Until the sync step has run once there is nothing to check
-- against, and refusing every open would break box-opening on deploy. The moment the table has any
-- rows it is authoritative.
create or replace function open_loot_box(p_box_id uuid, p_pool jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_box loot_boxes;
  v_rarity text;
  v_pick text;
  v_have_allowlist boolean;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  select * into v_box from loot_boxes where id = p_box_id and user_id = v_user and not opened for update;
  if v_box.id is null then raise exception 'Box not found or already opened'; end if;

  v_rarity := economy_roll_rarity(v_user, v_box.box_key);

  select exists (select 1 from box_droppable_items) into v_have_allowlist;

  -- The candidate set is the caller's bucket for the ROLLED rarity, filtered to items the server
  -- agrees are droppable AT THAT RARITY. The rarity check matters as much as membership: without
  -- it a client could list a Common id under "mythic" and have it granted as a Mythic.
  select p into v_pick
  from jsonb_array_elements_text(coalesce(p_pool -> v_rarity, '[]'::jsonb)) p
  where not v_have_allowlist
     or exists (select 1 from box_droppable_items d where d.item_key = p and d.rarity = v_rarity)
  order by random()
  limit 1;

  if v_pick is null then raise exception 'Empty drop pool for rarity %', v_rarity; end if;

  update loot_boxes set opened = true, opened_at = now() where id = p_box_id;

  return economy_grant_cosmetic(v_user, v_pick, null, v_rarity, 'box', v_box.provenance)
         || jsonb_build_object('box_key', v_box.box_key, 'rolled_rarity', v_rarity);
end;
$$;

-- ───────────────────────── 2. relic grants ─────────────────────────

/**
 * Grant a relic once, idempotently.
 *
 * economy_grant_cosmetic already no-ops a duplicate into a salvage, but a relic is not a cosmetic
 * anyone can roll twice — a second "grant" would read as a dupe payout for something that cannot
 * drop. So the check is explicit here, and a relic already owned simply returns false.
 */
create or replace function economy_grant_relic(
  p_user uuid, p_key text, p_rarity text, p_why text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owned boolean;
begin
  select exists (select 1 from cosmetics_owned co where co.user_id = p_user and co.cosmetic_key = p_key)
    into v_owned;
  if v_owned then return false; end if;

  perform economy_grant_cosmetic(p_user, p_key, null, p_rarity, 'earned', p_why);

  perform notify_event(
    array[p_user], 'reward_ready',
    'Relic earned',
    p_why,
    null, null,
    '/inventory', '{}'::jsonb,
    null, 'rounded',
    jsonb_build_object('relic', p_key, 'rarity', p_rarity)
  );
  return true;
end;
$$;

/**
 * Evaluate every relic condition for one user and grant whatever they now qualify for.
 *
 * ONE function rather than five triggers on five tables: the conditions read from streaks,
 * sessions, ranks and season standings, and scattering them would mean five places to keep in
 * step with the catalog. Cheap enough to call opportunistically — each branch exits early on an
 * already-owned relic before it runs its query.
 */
create or replace function economy_evaluate_relics(p_user uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_granted int := 0;
  v_streak int;
  v_hours numeric;
  v_tier text;
  v_dead_days int;
  v_top_pct boolean;
begin
  if p_user is null then return 0; end if;

  -- Hestia's Hearthstone — a 30-day streak. longest_streak, not current: the relic marks that it
  -- was ever achieved, and reading `current` would make it un-earnable by anyone who reached 30
  -- and then missed a day before this shipped.
  select longest_streak into v_streak from profiles where id = p_user;
  if coalesce(v_streak, 0) >= 30 then
    if economy_grant_relic(p_user, 'relic-hestias-hearthstone', 'epic', '30-day streak') then
      v_granted := v_granted + 1;
    end if;
  end if;

  -- Anvil of Hephaestus — 500 hours locked in, summed from confirmed sessions. Only completed
  -- ones count, so an abandoned session left running cannot inflate the total.
  select coalesce(sum(extract(epoch from (last_confirmed_at - started_at))) / 3600.0, 0)
    into v_hours
  from lock_in_sessions
  where user_id = p_user and status = 'completed';
  if v_hours >= 500 then
    if economy_grant_relic(p_user, 'relic-anvil-of-hephaestus', 'legendary', '500 hours locked in') then
      v_granted := v_granted + 1;
    end if;
  end if;

  -- Icarus' Feather — a personal peak of Gold or above. Read off the live universal rank rather
  -- than a stored peak: there is no peak column, and the rank ladder is ordered, so "has reached"
  -- is the same question as "is at or above" for anyone who has not decayed. A user who peaked and
  -- fell before this shipped misses it, which is the honest limit of the data we kept.
  -- rank_tier_for_score(universal_score(user)) is how get_my_ranks derives a tier; reused here
  -- rather than calling get_my_ranks, which is auth.uid()-scoped and would read the CALLER's rank
  -- instead of p_user's when invoked from a trigger.
  select t.tier into v_tier from rank_tier_for_score(universal_score(p_user)) t limit 1;
  if v_tier is not null and array_position(
       array['bronze','silver','gold','platinum','diamond','hero','titan','olympian','immortal','primordial'],
       v_tier
     ) >= 3 then
    if economy_grant_relic(p_user, 'relic-icarus-feather', 'legendary', 'Reached Gold') then
      v_granted := v_granted + 1;
    end if;
  end if;

  -- Prometheus' Shard — Top 1% of any closed season. season_standings is the frozen final board,
  -- so this is a settled fact rather than a live standing that could move.
  select exists (
    select 1 from season_standings s
    where s.user_id = p_user
      and s.rank::numeric / greatest(s.board_size, 1) <= 0.01
  ) into v_top_pct;
  if v_top_pct then
    if economy_grant_relic(p_user, 'relic-prometheus-shard', 'mythic', 'Top 1% of a season') then
      v_granted := v_granted + 1;
    end if;
  end if;

  -- Athena's Aegis — a calendar month with zero dead days. Counts the days of the PREVIOUS whole
  -- month that have no completed session; zero means the month was unbroken. Checked against the
  -- previous month rather than a rolling 30 days so it is a discrete, nameable achievement
  -- ("March") instead of something that silently qualifies mid-window.
  select count(*) into v_dead_days
  from generate_series(
         date_trunc('month', now() - interval '1 month')::date,
         (date_trunc('month', now()) - interval '1 day')::date,
         interval '1 day'
       ) d
  where not exists (
    select 1 from lock_in_sessions s
    where s.user_id = p_user
      and s.status = 'completed'
      and s.started_at::date = d::date
  );
  if v_dead_days = 0 then
    if economy_grant_relic(p_user, 'relic-athenas-aegis', 'epic', 'A full month with no dead days') then
      v_granted := v_granted + 1;
    end if;
  end if;

  return v_granted;
end;
$$;

grant execute on function economy_evaluate_relics(uuid) to authenticated;

-- Opportunistic evaluation: every completed lock-in re-checks. That covers streak, hours and the
-- dead-day month without a scheduler, and the season/rank branches are re-checked often enough by
-- the same path. Deliberately AFTER UPDATE on completion only, not on every heartbeat.
create or replace function economy_on_session_check_relics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and coalesce(old.status, '') <> 'completed' then
    perform economy_evaluate_relics(new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists lock_in_sessions_relics on lock_in_sessions;
create trigger lock_in_sessions_relics
  after update of status on lock_in_sessions
  for each row execute function economy_on_session_check_relics();

-- ───────────────────────── 3. seed the allowlist ─────────────────────────
--
-- GENERATED from src/lib/economy/catalog.ts, not hand-typed: every id whose acquisition is
-- 'box', with its rarity. 64 items. Extracting them mechanically is the point — a hand-copied
-- list of 64 keys is a transcription error waiting to silently un-droppable a real item, or
-- worse, to mis-tier one so it grants at the wrong rarity.
--
-- Verified at generation time: all 6 relic ids are absent, which is the whole objective of §6.
-- Re-run economy_set_droppable_items() from a deploy step when the catalog changes; until then
-- this seed is the authority, and anything not listed cannot drop.
insert into box_droppable_items (item_key, rarity) values
  ('flame-molten-copper', 'rare'),
  ('flame-lime-volt', 'rare'),
  ('flame-electric-cyan', 'rare'),
  ('flame-toxic-green', 'epic'),
  ('flame-solar-flare', 'epic'),
  ('flame-cosmic-purple', 'legendary'),
  ('flame-neutron-starfire', 'legendary'),
  ('flame-stormforge', 'mythic'),
  ('particle-floating-sparks', 'epic'),
  ('particle-falling-ash', 'epic'),
  ('particle-ember-swarm', 'epic'),
  ('particle-solar-flares', 'legendary'),
  ('particle-lightning-tendrils', 'legendary'),
  ('particle-void-smoke', 'mythic'),
  ('flare-zeus-wrath', 'mythic'),
  ('flare-void-purple-aura', 'legendary'),
  ('flare-void-plasma', 'legendary'),
  ('flare-white-incandescence', 'epic'),
  ('flare-asgardian-valor', 'legendary'),
  ('flare-acid-rain', 'legendary'),
  ('flare-inferno', 'mythic'),
  ('flare-solar', 'epic'),
  ('card-forged-bronze', 'uncommon'),
  ('card-brushed-steel', 'uncommon'),
  ('card-carbon-fiber', 'rare'),
  ('card-obsidian-mesh', 'rare'),
  ('card-cracked-magma', 'epic'),
  ('card-plasma-grid', 'epic'),
  ('card-golden-anvil', 'legendary'),
  ('halo-copper-ring', 'uncommon'),
  ('halo-ember-halo', 'uncommon'),
  ('halo-glowing-amber', 'rare'),
  ('halo-diamond-prism', 'epic'),
  ('halo-inferno-flare', 'legendary'),
  ('halo-hades', 'mythic'),
  ('title-kindled', 'common'),
  ('title-ember-stoker', 'common'),
  ('title-night-owl', 'common'),
  ('title-locked-in', 'common'),
  ('title-pacesetter', 'uncommon'),
  ('title-built-different', 'uncommon'),
  ('title-ash-walker', 'rare'),
  ('title-iron-forged', 'rare'),
  ('title-main-character', 'rare'),
  ('title-cracked', 'rare'),
  ('title-villain-arc', 'rare'),
  ('title-unbroken', 'epic'),
  ('title-the-relentless', 'epic'),
  ('title-final-boss', 'epic'),
  ('title-the-goat', 'epic'),
  ('banner-emberfall-night', 'epic'),
  ('banner-ashfall-ridge', 'epic'),
  ('banner-obsidian-colosseum', 'legendary'),
  ('banner-the-great-forge', 'legendary'),
  ('audio-heavy-bonfire-crackle', 'uncommon'),
  ('audio-edm-pulse', 'rare'),
  ('audio-midnight-thunder', 'rare'),
  ('audio-monastery-drone', 'epic'),
  ('audio-lofi-lullaby', 'epic'),
  ('audio-deep-space-sub-bass', 'legendary'),
  ('sfx-heavy-anvil-slam', 'rare'),
  ('sfx-sub-bass-drop', 'rare'),
  ('sfx-jet-engine-ignition', 'epic'),
  ('sfx-olympian-foghorn', 'legendary')
on conflict (item_key) do update set rarity = excluded.rarity;
