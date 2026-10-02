-- 0222 — the titles are pruned, the placement ladder goes global, and three relics move. 🏅
--
-- Cosmetic Art Program, Agent A (mocks 246 · 249 · 255). The server half of one catalog change;
-- src/lib/economy/catalog.ts is the client half and the two land together.
--
-- ─────────────────────────────── WHAT CHANGES ───────────────────────────────
--
-- A · THE TITLE PRUNE (mock 249's keep-list). Cut titles are RETIRED, not deleted: an owned copy is a
--     cosmetics_owned row holding the key, so every key stays in cosmetic_rarity (still priced, still
--     resolvable) and simply stops being granted, dropped or listed.
--       box pool    − Ember Stoker, Ash-Walker, Iron-Forged, Night Owl (now earned)
--                   + Absolutely Dialed (`title-dialed-in`, renamed off "Dialed In", legendary)
--       pass track  L50 free  + On Fire (epic)                 · new
--                   L60 prem  Dialed In → a Hephaestus chest    (L55 premium's shape)
--                   L100 free The Relentless · S1 → Infernal (legendary)
--                   L100 prem − Forged in Ember                 (the Seal stays the capstone)
--       campus close (grant_season_placement_rewards) stops printing Emberfall Elite / Ascendant /
--                   Contender / Initiate. Every other campus reward — card, particle, medals, chest,
--                   embers — is unchanged.
--     Kept live although off the keep-list: the three Vs-Unis collective titles (close_season_vs_unis
--     grants them and nothing replaces them), the campfire-finisher template (0212) and the starter
--     Kindling. Built Different and The Relentless keep their BOX tier (Noah, 2026-10-02).
--
-- B · NIGHT OWL · EARLY BIRD. A matched pair of rare titles, earned on every completed lock-in:
--     15 completed sessions of 10+ minutes starting 00:00–04:59 local (Night Owl) or 05:00–08:59
--     (Early Bird). The windows do not overlap, so a 3 AM session counts once.
--
-- C · THE GLOBAL PLACEMENT LADDER (mocks 246 + 249). Noah chose the GLOBAL board, 2026-10-02. It
--     already exists: close_season_scope(…, 'global') ranks everyone by universal_score and grants
--     off season_titles. So this is mostly data —
--       season_titles S1 rows → the finisher titles (Surtur/Agni/Helios keep their keys and lead
--         the new names), + a `p5` row, + a `medal_key` column so each band also mints its medal.
--       close_season_scope → grants title + medal on the GLOBAL scope only. The campus scope keeps
--         its XP payout, participation badge and notification, and no longer prints a placement
--         title or banner: the campus ladder is 0187's, and one title per band per person was the
--         point. Global no longer notches rarity up — the finisher rarities are explicit now.
--       Overlaps kept (Noah, 2026-10-02): global #1 gets Surtur AND Ascended; the top-50% band gets
--         its finisher title AND Warming Up.
--     season_band() is NOT touched. The 5% cut is resolved inside the closer, from the p10 band, so
--     no installed build ever reads a band it has no label for (season-standing-share-card.tsx).
--
-- D · RELIC CONDITIONS (mock 255). Supersedes 0168's strings.
--       Icarus' Feather  reach Hero        → ONE lock-in of 5 h or more
--       Zeus' Bolt       reach Primordial  → reach Divine (the `olympian` key; label renamed only)
--       Prometheus'      top-10% + friend  → reach Primordial + friend (has_successful_referral is
--                                             still 0119's stub, so this stays dormant)
--     Everything else in economy_evaluate_relics is 0168's body, verbatim.
--     NO BACKFILL. A relic grant spends its one reveal (0176); claiming it here, under suppressed
--     push, is exactly how Noah's own rung reveal was lost. Anyone who now qualifies is granted on
--     their next completed lock-in, with the moment intact. Existing holders keep what they have:
--     relics are never revoked, and Icarus earned at Hero stays earned.
--
-- E · NIGHT OWL'S PRICE. Re-rated common → rare, but the copies already owned came out of a box as
--     commons. Each gets rarity_override = 'common' so selling one pays what it was (0213's rule:
--     a sale pays what the item is worth, not a re-rate after the fact).
--
-- ─────────────────────────────── SAFETY ───────────────────────────────
--
-- Three functions are restated whole. Each is pinned to the md5 of the body this file was written
-- against (CR-stripped, as 0193 does); if prod has moved on, this refuses rather than clobbering a
-- sibling branch's change.
--   close_season_scope              0201
--   grant_season_placement_rewards  0187
--   economy_evaluate_relics         0168
-- Signatures are unchanged, so grants carry over (create or replace keeps ACLs) — asserted below.
--
-- NOTE: no explicit begin/commit — the migration runs in its own transaction.

do $guard$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p
  where p.oid = 'public.close_season_scope(text, text, text)'::regprocedure;
  if v_md5 is distinct from '56d8d6d170c6826cefed3633e90eadae' then
    raise exception '0222: close_season_scope is not 0201''s body (md5 %). Re-restate from live prosrc.', v_md5;
  end if;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p
  where p.oid = 'public.grant_season_placement_rewards(text, boolean)'::regprocedure;
  if v_md5 is distinct from '56b9c458cebc76e1b1945ee3805d6090' then
    raise exception '0222: grant_season_placement_rewards is not 0187''s body (md5 %). Re-restate from live prosrc.', v_md5;
  end if;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p
  where p.oid = 'public.economy_evaluate_relics(uuid)'::regprocedure;
  if v_md5 is distinct from '750b8f453aa8fbf8e4bec08e2fda80c1' then
    raise exception '0222: economy_evaluate_relics is not 0168''s body (md5 %). Re-restate from live prosrc.', v_md5;
  end if;
end;
$guard$;

-- ───────────────────────────── the re-seed ─────────────────────────────
-- Generated by `node scripts/check-cosmetic-rarity.js --print-seed`. Do not hand-edit.
-- Against 0219: +16 keys (the finisher titles and medals, Early Bird, On Fire, Infernal) and
-- title-night-owl common → rare. Nothing is removed — retired keys stay priced.

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
  ('flame-solar-flare', 'epic'),
  ('flame-stormforge', 'mythic'),
  ('flame-toxic-green', 'epic'),
  ('flare-acid-rain', 'legendary'),
  ('flare-asgardian-valor', 'legendary'),
  ('flare-emberfall-ascendant', 'legendary'),
  ('flare-inferno', 'mythic'),
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
  ('medal-campus-sovereign', 'legendary'),
  ('medal-emberfall-centurion', 'legendary'),
  ('medal-emberfall-champion', 'legendary'),
  ('medal-emberfall-crown', 'mythic'),
  ('medal-emberfall-participant', 'common'),
  ('medal-s1-podium-1', 'mythic'),
  ('medal-s1-podium-2', 'legendary'),
  ('medal-s1-podium-3', 'legendary'),
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

-- E · the copies already owned keep the price they were pulled at.
update cosmetics_owned
   set rarity_override = 'common'
 where cosmetic_key = 'title-night-owl'
   and source = 'box'
   and rarity_override is null;

-- ───────────────────────────── A · the box pool ─────────────────────────────

delete from box_droppable_items
 where item_key in ('title-ember-stoker', 'title-ash-walker', 'title-iron-forged', 'title-night-owl');

insert into box_droppable_items (item_key, rarity) values ('title-dialed-in', 'legendary')
on conflict (item_key) do update set rarity = excluded.rarity;

-- ───────────────────────────── A · the pass track ─────────────────────────────
-- Keep in step with NAMED_LEVELS in src/lib/economy/forge-pass.ts. claim_pass_level grants THIS
-- table and only records a client mismatch (0133), so an installed build that still shows "Dialed
-- In" at L60 is paid the chest, not refused.

insert into pass_track_rewards (season_id, level, lane, ord, kind, embers, box_key, item_key, item_slot, item_rarity)
values ('S1', 50, 'free', 1, 'item', null, null, 'title-on-fire', 'title', 'epic')
on conflict (season_id, level, lane, ord) do update set
  kind = excluded.kind, embers = null, box_key = null,
  item_key = excluded.item_key, item_slot = excluded.item_slot, item_rarity = excluded.item_rarity;

update pass_track_rewards
   set kind = 'box', box_key = 'hephaestus', item_key = null, item_slot = null, item_rarity = null
 where season_id = 'S1' and level = 60 and lane = 'premium' and item_key = 'title-dialed-in';

update pass_track_rewards
   set item_key = 'title-infernal', item_slot = 'title', item_rarity = 'legendary'
 where season_id = 'S1' and level = 100 and lane = 'free' and item_key = 'title-s1-the-relentless';

delete from pass_track_rewards
 where season_id = 'S1' and level = 100 and lane = 'premium' and item_key = 'title-forged-in-ember';

-- ───────────────────────────── C · season_titles ─────────────────────────────

alter table season_titles add column if not exists medal_key text;
comment on column season_titles.medal_key is
  '0222 — the placement medal minted beside this band''s title (mock 246). GLOBAL scope only.';

-- `p5` joins the ladder. It is a SUB-CUT of season_band()'s p10, resolved in close_season_scope —
-- season_band() itself never returns it.
alter table season_titles drop constraint if exists season_titles_band_check;
alter table season_titles add constraint season_titles_band_check
  check (band in ('rank_1', 'rank_2', 'rank_3', 'p1', 'p5', 'p10', 'p25', 'p50'));

-- banner_asset is deliberately NOT in the update list: rank_2/rank_3/p1 still name the banners 0151
-- retired, and that was left as Noah's call there. Unchanged here, flagged again in the report.
insert into season_titles (season_id, band, title, cosmetic_key, rarity, banner_asset, description, medal_key) values
  ('S1', 'rank_1', 'Surtur · Emberfall 1st Finisher', 'title-s1-surtur', 'mythic', null,
   'The fire-giant of Ragnarök, whose flaming sword outshines the sun and burns the world to ash so the next can rise. There is only ever one. This season, it''s you.',
   'medal-s1-podium-1'),
  ('S1', 'rank_2', 'Agni · Emberfall 2nd Finisher', 'title-s1-agni', 'mythic', null,
   'The divine fire the gods themselves speak through — alive in every hearth and every offering, never once extinguished. Second to none but the world-ender, Surtur.',
   'medal-s1-podium-2'),
  ('S1', 'rank_3', 'Helios · Emberfall 3rd Finisher', 'title-s1-helios', 'mythic', null,
   'The Titan who hauls the sun across the sky each day — the blaze every mortal looks up to. Third of three, behind only Surtur and Agni — and still a god.',
   'medal-s1-podium-3'),
  ('S1', 'p1', 'Emberfall Top 1% Finisher', 'title-s1-top-1', 'legendary', null,
   'The top one percent of the whole season. Cut from diamond.', 'medal-s1-top-1'),
  ('S1', 'p5', 'Emberfall Top 5% Finisher', 'title-s1-top-5', 'epic', null,
   'Top five percent. Cold platinum light.', 'medal-s1-top-5'),
  ('S1', 'p10', 'Emberfall Top 10% Finisher', 'title-s1-top-10', 'epic', null,
   'One in ten. Gold, earned against everyone who showed up.', 'medal-s1-top-10'),
  ('S1', 'p25', 'Emberfall Top 25% Finisher', 'title-s1-top-25', 'rare', null,
   'Top quarter. Most people you started with aren''t on this board anymore.', 'medal-s1-top-25'),
  ('S1', 'p50', 'Emberfall Top 50% Finisher', 'title-s1-top-50', 'uncommon', null,
   'You finished in the top half of your first season. The dark took the rest.', 'medal-s1-top-50')
on conflict (season_id, band) do update set
  title = excluded.title,
  cosmetic_key = excluded.cosmetic_key,
  rarity = excluded.rarity,
  description = excluded.description,
  medal_key = excluded.medal_key;

-- ───────────────────────────── C · the global closer ─────────────────────────────
-- 0201's body. Changed: the title/banner block runs on the GLOBAL scope only, resolves the p5
-- sub-cut, grants the band's medal, grants the two kept overlaps, and drops the global rarity
-- notch. Unchanged: the closure insert, grant_reward, the participation badge, quiet_badge, and
-- the season_settled notification — for both scopes.

create or replace function public.close_season_scope(p_season text, p_scope text, p_key text default null::text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_paid int := 0;
  v_is_global boolean := (p_scope = 'global');
  r record;
  v_pct numeric;
  v_band text;
  v_cut text;
  v_title season_titles;
  v_stamp text;
  v_why text;
begin
  insert into season_closures (season_id, scope, scope_key)
  values (p_season, p_scope, coalesce(p_key, ''))
  on conflict do nothing;
  if not found then return 0; end if;

  -- 0201 — the season_settled notification below speaks for the participation badge.
  perform set_config('philoi.quiet_badge', 'on', true);

  for r in
    select p.id as user_id,
           row_number() over (order by universal_score(p.id) desc) as rank,
           count(*) over () as board_size
    from profiles p
    where not p.is_demo and not p.is_disabled
      and (p_scope <> 'uni' or (p.university = p_key and p.university_email_verified))
  loop
    v_pct := r.rank::numeric / greatest(r.board_size, 1);
    perform grant_reward(r.user_id, 'season', 1.0, 90, r.board_size::int, v_pct, true, null);

    -- Everyone who met the floor keeps a dated participation badge (§4b).
    perform economy_grant_badge(r.user_id, 'season-participant-' || p_season, 'Season ' || p_season || ' · took part');

    v_band := season_band(r.rank::int, r.board_size::int);

    -- 0222 — the placement ladder is GLOBAL (Noah, 2026-10-02). A campus board still pays its XP,
    -- badge and notification above and below, and prints its own ladder in 0187's closer.
    if v_is_global and v_band is not null then
      -- The 5% cut lives HERE, not in season_band(): installed builds label bands by name, and a
      -- band they have never seen would render blank. Logged under the band season_band() gave.
      v_cut := case when v_band = 'p10' and v_pct <= 0.05 then 'p5' else v_band end;
      select * into v_title from season_titles st where st.season_id = p_season and st.band = v_cut;

      if v_title.cosmetic_key is not null then
        v_stamp := '🌍 GLOBAL ' ||
          case v_cut
            when 'rank_1' then '#1'
            when 'rank_2' then '#2'
            when 'rank_3' then '#3'
            when 'p1' then '· TOP 1%'
            when 'p5' then '· TOP 5%'
            when 'p10' then '· TOP 10%'
            when 'p25' then '· TOP 25%'
            else '· TOP 50%'
          end || ' · ' || p_season;
        v_why := 'Season ' || p_season || ' · global placement #' || r.rank;

        -- The rarity is the catalog's (cosmetic_rarity), so no override: the finisher ladder's
        -- rarities are explicit, and the old global notch would have mis-priced every one of them.
        perform economy_grant_title(r.user_id, v_title.cosmetic_key, v_why, v_stamp, null);
        perform season_log_grant(p_season, r.user_id, p_scope, v_band, 'title', v_title.cosmetic_key,
                                 v_title.title, v_title.rarity, true, null);

        if v_title.medal_key is not null then
          perform economy_grant_cosmetic(r.user_id, v_title.medal_key, null,
            coalesce((select cr.rarity from cosmetic_rarity cr where cr.cosmetic_key = v_title.medal_key), v_title.rarity),
            'earned', v_why);
          -- "Surtur · Emberfall 1st Finisher" → the medal is "Emberfall 1st Finisher".
          perform season_log_grant(p_season, r.user_id, p_scope, v_band, 'medal', v_title.medal_key,
                                   regexp_replace(v_title.title, '^.* · ', ''),
                                   (select cr.rarity from cosmetic_rarity cr where cr.cosmetic_key = v_title.medal_key),
                                   true, null);
        end if;

        -- The two overlaps mock 249 flagged, both kept.
        if v_cut = 'rank_1' then
          perform economy_grant_title(r.user_id, 'title-ascended', v_why, v_stamp, null);
          perform season_log_grant(p_season, r.user_id, p_scope, v_band, 'title', 'title-ascended',
                                   'Ascended', 'mythic', true, null);
        elsif v_cut = 'p50' and p_season = 'S1' then
          perform economy_grant_title(r.user_id, 'title-s1-warming-up', v_why, v_stamp, null);
          perform season_log_grant(p_season, r.user_id, p_scope, v_band, 'title', 'title-s1-warming-up',
                                   'Warming Up', 'uncommon', true, null);
        end if;

        if v_title.banner_asset is not null then
          perform economy_grant_cosmetic(r.user_id, v_title.banner_asset, 'banner', v_title.rarity, 'earned',
                                         'Season ' || p_season || ' · ' || v_title.title);
          perform season_log_grant(p_season, r.user_id, p_scope, v_band, 'banner', v_title.banner_asset,
                                   v_title.title || ' Banner', v_title.rarity, true, null);
        end if;
      end if;
    end if;

    -- 0201 — the season's result, announced once per user per scope.
    perform notify_event(
      array[r.user_id], 'season_settled',
      'Season ' || p_season || case when v_is_global then '' else ' · ' || coalesce(p_key, 'campus') end || ' results are in',
      'You finished #' || r.rank || ' of ' || r.board_size || '. Your rewards are in your inventory.',
      null, null,
      '/inventory', '{}'::jsonb,
      null, null,
      jsonb_build_object('season', p_season, 'scope', p_scope, 'rank', r.rank, 'board_size', r.board_size)
    );

    v_paid := v_paid + 1;
  end loop;

  perform set_config('philoi.quiet_badge', 'off', true);
  return v_paid;
end;
$function$;

-- ───────────────────────────── A · the campus closer ─────────────────────────────
-- 0187's body with the four retired titles' grant lines removed. Nothing else differs.

create or replace function grant_season_placement_rewards(p_season text default null, p_dry_run boolean default false)
returns table(university text, ranked integer, granted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := coalesce(p_season, season_config() ->> 'id');
  v_stamp text;
  v_band text;
  v_pct numeric;
  v_granted int := 0;
  r record;
begin
  -- 0187: the same lock close_season_placements takes (re-entrant within one transaction), so a
  -- direct service-role call cannot race the cron either.
  if not p_dry_run then
    perform pg_advisory_xact_lock(hashtext('philoi.season_placements'), hashtext(v_season));
  end if;

  if not p_dry_run and exists (select 1 from season_placement_closures where season_id = v_season) then
    raise notice 'Season % placement rewards already granted; nothing to do.', v_season;
    return query select s.university, count(*)::int, 0
      from season_standings s where s.season_id = v_season group by s.university;
    return;
  end if;

  for r in
    select * from season_standings s where s.season_id = v_season order by s.university, s.rank
  loop
    v_pct := r.rank::numeric / greatest(r.board_size, 1);
    v_band := season_band(r.rank, r.board_size);
    v_stamp := '🎓 ' || upper(r.university) || ' · ' ||
      case
        when r.rank = 1 then '#1'
        when r.rank <= 10 then 'TOP 10'
        when v_pct <= 0.01 then 'TOP 1%'
        when v_pct <= 0.10 then 'TOP 10%'
        else 'TOP 50%'
      end || ' · ' || v_season;

    if not p_dry_run then
      -- ── exclusive placement band ──
      -- 0222: the campus ladder no longer prints a title below #1 (Elite / Ascendant / Contender /
      -- Initiate retired with mock 249's prune — the GLOBAL finisher ladder replaced them). Every
      -- other reward in each band is unchanged.
      if r.rank = 1 then
        perform economy_grant_cosmetic(r.user_id, 'card-emberfall-sovereign', 'card', 'mythic', 'earned', 'Season ' || v_season || ' Champion');
        perform economy_grant_title(r.user_id, 'title-emberfall-champion', 'Season ' || v_season || ' Champion', v_stamp);
        perform economy_grant_cosmetic(r.user_id, 'medal-emberfall-champion', null, 'mythic', 'earned', 'Season ' || v_season || ' Champion');
        perform economy_move_embers(r.user_id, 5000, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'card', 'card-emberfall-sovereign', 'Emberfall Sovereign', 'mythic', true, null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'medal', 'medal-emberfall-champion', 'Champion Medal', 'mythic', true, null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 5000);
      elsif r.rank <= 10 then
        perform economy_grant_cosmetic(r.user_id, 'banner-emberfall-elite', 'banner', 'legendary', 'earned', 'Season ' || v_season || ' Top 10');
        perform economy_move_embers(r.user_id, 2500, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'banner', 'banner-emberfall-elite', 'Emberfall Elite', 'legendary', true, null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 2500);
      elsif v_pct <= 0.01 then
        perform economy_grant_cosmetic(r.user_id, 'particle-emberfall-ascendant', 'particle', 'epic', 'earned', 'Season ' || v_season || ' Top 1%');
        perform economy_move_embers(r.user_id, 1500, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'particle', 'particle-emberfall-ascendant', 'Emberfall Ascendant', 'epic', true, null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 1500);
      elsif v_pct <= 0.10 then
        insert into loot_boxes (user_id, box_key, obtained_via, provenance)
        values (r.user_id, 'furnace', 'season', 'Season ' || v_season || ' Top 10%');
        perform economy_move_embers(r.user_id, 750, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'box', 'furnace', 'Furnace Chest', null, false, 1);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 750);
      elsif v_pct <= 0.50 then
        perform economy_move_embers(r.user_id, 500, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 500);
      end if;

      -- ── orthogonal medals ──
      if r.pass_level >= 100 then
        perform economy_grant_cosmetic(r.user_id, 'medal-emberfall-centurion', null, 'legendary', 'earned', 'Season ' || v_season || ' · Level 100');
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'medal', 'medal-emberfall-centurion', 'Centurion Medal', 'legendary', true, null);
      end if;
      perform economy_grant_cosmetic(r.user_id, 'medal-emberfall-participant', null, 'common', 'earned', 'Season ' || v_season || ' · took part');
      perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'medal', 'medal-emberfall-participant', 'Participant Medal', 'common', true, null);
    end if;

    v_granted := v_granted + 1;
  end loop;

  if not p_dry_run then
    insert into season_placement_closures (season_id, boards, granted)
    select v_season, count(distinct s.university), v_granted from season_standings s where s.season_id = v_season
    on conflict (season_id) do nothing;
  end if;

  return query select s.university, count(*)::int, v_granted
    from season_standings s where s.season_id = v_season group by s.university;
end;
$$;

-- ───────────────────────────── B + D · the evaluator ─────────────────────────────
-- 0168's body. Changed: Icarus, Zeus, Prometheus (§D), and the Night Owl / Early Bird block at the
-- end (§B). The Anvil, Aegis, Atlas, the three ladder families and the Crown are verbatim.
-- ⚠️ Still NO `grant execute` (0132 revoked it deliberately — see 0168's header).

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
  v_volume numeric;
  v_km numeric;
  v_bench numeric;
  v_squat numeric;
  v_dead numeric;
  v_disc record;
  v_maxed int;
  v_longest int;
  v_tz text;
  v_night int;
  v_dawn int;
begin
  if p_user is null then return 0; end if;

  -- ── ANVIL OF HEPHAESTUS · legendary · 500 cumulative hours ──
  -- THE REPAIR, half one. Was lock_in_sessions.(last_confirmed_at - started_at), ~0 per row, which
  -- made a 500-hour relic unreachable by construction rather than by difficulty.
  select coalesce(sum(ci.duration_seconds) / 3600.0, 0) into v_hours
  from check_ins ci
  where ci.user_id = p_user
    and ci.removed_at is null
    and ci.duration_seconds is not null;

  if v_hours >= 500 then
    if economy_grant_relic(p_user, 'relic-anvil-of-hephaestus', 'legendary',
      '500 hours, forged. The work did not fill time — it made you the weapon.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── ICARUS' FEATHER · legendary · ONE lock-in of 5 hours or more (0222, mock 255) ──
  -- Was "reach Hero". The myth is a single flight too close to the sun — one sitting long enough
  -- to scorch the feather, the edge of burnout — not a rank. The longest single check-in, off the
  -- same column the Anvil reads (0168).
  select coalesce(max(ci.duration_seconds), 0) into v_longest
  from check_ins ci
  where ci.user_id = p_user
    and ci.removed_at is null
    and ci.duration_seconds is not null;

  if v_longest >= 5 * 3600 then
    if economy_grant_relic(p_user, 'relic-icarus-feather', 'legendary',
      'Five hours in one sitting — you flew close enough to the sun to scorch the feather.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- The rank, for Zeus and Prometheus below.
  select t.tier into v_tier from rank_tier_for_score(universal_score(p_user)) t limit 1;
  v_pos := array_position(
    array['bronze','silver','gold','platinum','diamond','hero','titan','olympian','immortal','primordial'],
    v_tier);

  -- ── ZEUS' BOLT · mythic · reach DIVINE (0222) ──
  -- Was Primordial. Divine is the `olympian` key — rank-tiers.ts renamed the LABEL for trademark
  -- and kept the key — at position 8; Immortal and Primordial are above it and count too.
  if coalesce(v_pos, 0) >= 8 then
    if economy_grant_relic(p_user, 'relic-zeus-bolt', 'mythic',
      'You reached Divine. The king himself bows toward your greatness.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── ATHENA'S AEGIS · epic · 6 CONSECUTIVE weeks with a session ──
  -- Unchanged from 0119, and deliberately still sourced from lock_in_sessions: this branch counts
  -- WEEKS, asking only whether a session exists in each one and never how long it ran, so the
  -- duration bug never touched it.
  with wk as (
    select distinct date_trunc('week', s.started_at)::date as d
    from lock_in_sessions s
    where s.user_id = p_user and s.status = 'completed'
  ), grouped as (
    select d, d - make_interval(weeks => (row_number() over (order by d))::int) as grp from wk
  )
  select coalesce(max(cnt), 0) into v_weeks
  from (select count(*) as cnt from grouped group by grp) s;

  if v_weeks >= 6 then
    if economy_grant_relic(p_user, 'relic-athenas-aegis', 'epic',
      'Six weeks unbroken, without a gap. Athena guards the standard that is never set down.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── PROMETHEUS' SHARD · mythic · reach PRIMORDIAL and bring a friend in (0222) ──
  -- Was a top-10% season finish + a referral; the summit is now the rank itself. Still dormant:
  -- has_successful_referral() is 0119's documented stub, so this grants nobody until referrals
  -- land — and then grants everyone already at Primordial on their next lock-in, with no backfill.
  if v_tier = 'primordial' and has_successful_referral(p_user) then
    if economy_grant_relic(p_user, 'relic-prometheus-shard', 'mythic',
      'You reached the summit and brought someone into the fire. Mastery that spreads.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── ATLAS' BURDEN · mythic · the 1000 lb club (§4a-3) ── unchanged from 0119.
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

  -- ── DISCIPLINE LADDER · VOLUME (Hercules' Might) ── unchanged from 0119.
  select coalesce(sum(coalesce(ws.weight, 0) * ws.reps), 0) into v_volume
  from workout_sets ws
  join workouts w on w.id = ws.workout_id
  where w.user_id = p_user;

  perform economy_apply_relic_ladder(p_user, 'volume', v_volume);

  -- ── DISCIPLINE LADDER · DISTANCE (Pheidippides' Sandals) ── unchanged from 0119.
  select
    coalesce((select sum(ci.distance_m) from check_ins ci
              where ci.user_id = p_user and ci.removed_at is null), 0)
    + coalesce((select sum(sd.steps) * stride_m_for(p_user) from user_step_days sd
                where sd.user_id = p_user), 0)
  into v_km;
  v_km := v_km / 1000.0;

  perform economy_apply_relic_ladder(p_user, 'distance', v_km);

  -- ── DISCIPLINE LADDERS · HOURS, one per discipline ──
  --
  -- THE REPAIR, half two. Socrates' Scroll (study) · Daedalus' Blueprint (deep work) · Oracle's
  -- Stillness (meditate), each on §4a-2's 10 / 25 / 50 / 100 h ladder.
  --
  -- session_discipline() is 0119's map and is unchanged, so the routing it documents still holds:
  -- `read` folds into study (§4a-2 "Reading counts as study"), `job_applications` is the only
  -- current GoalType that fits deep work, `run` rides Distance instead, and `custom` is
  -- deliberately unmapped rather than credited to a discipline the user did not pick. It is fed
  -- check_ins.goal_type here rather than lock_in_sessions.goal_type — the same denormalised value,
  -- read off the row that actually carries the duration.
  --
  -- ONE grouped pass, not one query per family: this function runs on every check-in insert, and a
  -- query per hours-ladder would be three more scans of the hottest table in the app.
  --
  -- A discipline with no hours gets no row, which costs nothing — get_my_relic_progress and
  -- get_trophy_hall both LEFT JOIN from relic_ladders, so all five ladders still report.
  for v_disc in
    select session_discipline(ci.goal_type) as family,
           sum(ci.duration_seconds) / 3600.0 as hours
    from check_ins ci
    where ci.user_id = p_user
      and ci.removed_at is null
      and ci.duration_seconds is not null
      and session_discipline(ci.goal_type) is not null
    group by 1
  loop
    perform economy_apply_relic_ladder(p_user, v_disc.family, v_disc.hours);
  end loop;

  -- ── CROWN OF OLYMPUS · mythic · top rung of every discipline ladder (§4a-2 capstone) ──
  -- Counted against relic_ladders rather than a literal 5, so a discipline added later joins the
  -- capstone's requirement by INSERT and needs no change here.
  select count(*) into v_maxed
  from relic_progress rp
  join relic_ladders rl on rl.relic_key = rp.relic_key
  where rp.user_id = p_user and rp.tier >= array_length(rl.thresholds, 1);

  if v_maxed >= (select count(*) from relic_ladders) then
    if economy_grant_relic(p_user, 'relic-crown-of-olympus', 'mythic',
      'Master of no single art, but of the discipline beneath all of them. Olympus has a seat for that.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── NIGHT OWL · EARLY BIRD · rare titles · 15 lock-ins in a window (0222, mock 249) ──
  -- A matched pair. The hour is the session's START in the user's own zone; the windows are
  -- disjoint (00:00–04:59 and 05:00–08:59) so a 3 AM session counts for exactly one of them.
  -- Only completed sessions of 10+ minutes count: a title is worn in public, and fifteen
  -- thirty-second taps at 1 AM is not what "Night Owl" says about someone.
  --
  -- profiles.timezone, not notification_prefs.timezone (empty on every prod row). A zone Postgres
  -- doesn't recognise must not throw: this runs inside lock_in_sessions_relics, which has no
  -- handler, so an exception here would refuse the lock-in itself. Probe it once, fall back to UTC.
  select nullif(p.timezone, '') into v_tz from profiles p where p.id = p_user;
  begin
    perform now() at time zone coalesce(v_tz, 'UTC');
  exception when others then
    v_tz := null;
  end;

  select count(*) filter (where x.h < 5),
         count(*) filter (where x.h >= 5 and x.h < 9)
    into v_night, v_dawn
  from (
    select extract(hour from s.started_at at time zone coalesce(v_tz, 'UTC')) as h
    from lock_in_sessions s
    join check_ins ci on ci.id = s.ended_check_in_id
    where s.user_id = p_user
      and s.status = 'completed'
      and ci.removed_at is null
      and ci.duration_seconds >= 600
  ) x;

  -- economy_grant_title is one row per key and a no-op when owned — including a Night Owl that
  -- came out of a box before 0222, which keeps its box provenance.
  if v_night >= 15 then
    perform economy_grant_title(p_user, 'title-night-owl', '15 lock-ins after midnight', null, null);
  end if;
  if v_dawn >= 15 then
    perform economy_grant_title(p_user, 'title-early-bird', '15 lock-ins before 9 AM', null, null);
  end if;

  return v_granted;
end;
$$;

-- ───────────────────────────── assertions ─────────────────────────────

do $assert$
declare
  v_n int;
  v_keys text;
  v_src text;
  v_uid uuid;
  v_uni text;
  v_marker constant text := '0222-probe-rollback';
  v_err text;
begin
  -- ── the three rarity copies still agree (0213's invariant) ──
  if exists (
    select 1 from box_droppable_items d
    left join cosmetic_rarity cr on cr.cosmetic_key = d.item_key
    where cr.rarity is distinct from d.rarity
  ) then
    raise exception '0222: box_droppable_items disagrees with cosmetic_rarity';
  end if;
  if exists (
    select 1 from pass_track_rewards p
    left join cosmetic_rarity cr on cr.cosmetic_key = p.item_key
    where p.item_key is not null and cr.rarity is distinct from p.item_rarity
  ) then
    raise exception '0222: pass_track_rewards disagrees with cosmetic_rarity';
  end if;
  if exists (
    select 1 from season_titles st
    left join cosmetic_rarity cr on cr.cosmetic_key = st.cosmetic_key
    where st.season_id = 'S1' and cr.rarity is distinct from st.rarity
  ) or exists (
    select 1 from season_titles st
    where st.season_id = 'S1' and st.medal_key is not null
      and not exists (select 1 from cosmetic_rarity cr where cr.cosmetic_key = st.medal_key)
  ) then
    raise exception '0222: season_titles names a title or medal cosmetic_rarity cannot price';
  end if;

  -- ── A · no live grant path names a retired title ──
  select string_agg(item_key, ',' order by item_key) into v_keys from box_droppable_items
  where item_key in ('title-ember-stoker', 'title-ash-walker', 'title-iron-forged', 'title-night-owl');
  if v_keys is not null then raise exception '0222: retired titles still drop: %', v_keys; end if;
  if not exists (select 1 from box_droppable_items where item_key = 'title-dialed-in' and rarity = 'legendary') then
    raise exception '0222: Absolutely Dialed is not in the legendary box pool';
  end if;

  select string_agg(item_key, ',' order by item_key) into v_keys from pass_track_rewards
  where item_key in ('title-dialed-in', 'title-s1-the-relentless', 'title-forged-in-ember', 'title-kindled-by-emberfall');
  if v_keys is not null then raise exception '0222: the pass still grants retired titles: %', v_keys; end if;

  select string_agg(level || ':' || lane || ':' || item_key, ',' order by level) into v_keys from pass_track_rewards
  where season_id = 'S1' and item_key in ('title-on-fire', 'title-infernal');
  if v_keys is distinct from '50:free:title-on-fire,100:free:title-infernal' then
    raise exception '0222: pass titles are [%], expected On Fire at L50 free and Infernal at L100 free', v_keys;
  end if;
  if not exists (select 1 from pass_track_rewards
                 where season_id = 'S1' and level = 60 and lane = 'premium' and kind = 'box' and box_key = 'hephaestus') then
    raise exception '0222: L60 premium was not re-filled with a chest';
  end if;
  -- 0219's invariant survives: the pass still mints exactly its two mythics.
  select string_agg(item_key, ',' order by item_key) into v_keys from pass_track_rewards where item_rarity = 'mythic';
  if v_keys is distinct from 'medal-emberfall-crown,relic-emberfall' then
    raise exception '0222: pass_track_rewards mints mythics [%]', v_keys;
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.grant_season_placement_rewards(text, boolean)'::regprocedure;
  if v_src ~ 'title-emberfall-(elite|ascendant|contender|initiate)' then
    raise exception '0222: the campus closer still prints a retired title';
  end if;
  if v_src !~ 'title-emberfall-champion' or v_src !~ 'medal-emberfall-centurion' then
    raise exception '0222: the campus closer lost a reward it should have kept';
  end if;

  -- ── C · the ladder is whole ──
  select count(*) into v_n from season_titles where season_id = 'S1' and medal_key is not null;
  if v_n <> 8 then raise exception '0222: % S1 bands carry a medal, expected 8', v_n; end if;

  -- ── D · the evaluator's conditions, as text (exercised below) ──
  select prosrc into v_src from pg_proc where oid = 'public.economy_evaluate_relics(uuid)'::regprocedure;
  if v_src !~ 'v_longest >= 5 \* 3600' or v_src !~ 'v_pos, 0\) >= 8' or v_src ~ 'v_top10' then
    raise exception '0222: economy_evaluate_relics does not carry the new relic conditions';
  end if;

  -- ── grants survived create or replace ──
  if has_function_privilege('anon', 'public.close_season_scope(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.close_season_scope(text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.grant_season_placement_rewards(text, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.grant_season_placement_rewards(text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.economy_evaluate_relics(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.economy_evaluate_relics(uuid)', 'execute') then
    raise exception '0222: a restated internal function is client-callable';
  end if;

  -- ══ EXERCISED, NOT GREPPED ══
  -- plpgsql binds a statement only when it first runs, so each body is RUN here, against live data,
  -- inside a block that raises a marker at the end — the savepoint rolls every write back (grants,
  -- closures, notify rows, and the pg_net queue rows with them). Assertions are recount agreements,
  -- never hard-coded counts: this is pilot data and it moves.

  -- C · the global close, for real, then undone.
  begin
    perform set_config('philoi.suppress_push', 'on', true);
    perform close_season_scope('S1', 'global', null);

    -- Positive control: a board with anyone on it has a #1, so the ladder must have minted at least
    -- the podium medal. Without this, an empty result would pass every check below.
    if exists (select 1 from profiles p where not p.is_demo and not p.is_disabled)
       and not exists (select 1 from cosmetics_owned where cosmetic_key = 'medal-s1-podium-1') then
      raise exception '0222: the global close minted no podium medal';
    end if;

    -- Exactly one finisher medal per banded person, and each holds the matching title. The
    -- expected set is recomputed from the same ranking the closer used.
    with board as (
      select p.id as user_id,
             row_number() over (order by universal_score(p.id) desc) as rank,
             count(*) over () as board_size
      from profiles p where not p.is_demo and not p.is_disabled
    ), banded as (
      select b.user_id, st.cosmetic_key, st.medal_key
      from board b
      join season_titles st on st.season_id = 'S1' and st.band =
        case when season_band(b.rank::int, b.board_size::int) = 'p10'
                  and b.rank::numeric / greatest(b.board_size, 1) <= 0.05 then 'p5'
             else season_band(b.rank::int, b.board_size::int) end
    )
    select count(*) into v_n from banded b
    where not exists (select 1 from cosmetics_owned co where co.user_id = b.user_id and co.cosmetic_key = b.medal_key)
       or not exists (select 1 from cosmetics_owned co where co.user_id = b.user_id and co.cosmetic_key = b.cosmetic_key);
    if v_n <> 0 then raise exception '0222: % banded players are missing their title or medal', v_n; end if;

    select count(*) into v_n from (
      select co.user_id from cosmetics_owned co where co.cosmetic_key like 'medal-s1-%'
      group by co.user_id having count(*) > 1
    ) x;
    if v_n <> 0 then raise exception '0222: % players were minted more than one placement medal', v_n; end if;

    -- Positive control for the overlap: if the board has a #1, they hold Ascended too.
    select co.user_id into v_uid from cosmetics_owned co where co.cosmetic_key = 'medal-s1-podium-1' limit 1;
    if v_uid is not null and not exists (select 1 from cosmetics_owned where user_id = v_uid and cosmetic_key = 'title-ascended') then
      raise exception '0222: global #1 was not granted Ascended';
    end if;

    raise exception '%', v_marker;
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> v_marker then raise exception '0222 global-close probe: %', v_err; end if;
  end;

  -- C · a CAMPUS close prints no global ladder. Pair: the global probe above proved the same keys
  -- DO appear when the scope is global, so a zero here is the scope gate, not a dead body.
  select p.university into v_uni from profiles p
  where p.university is not null and p.university_email_verified and not p.is_demo and not p.is_disabled
  limit 1;
  if v_uni is not null then
    begin
      perform set_config('philoi.suppress_push', 'on', true);
      perform close_season_scope('S1', 'uni', v_uni);
      select count(*) into v_n from cosmetics_owned
      where cosmetic_key like 'medal-s1-%' or cosmetic_key like 'title-s1-top-%';
      if v_n <> 0 then raise exception '0222: a campus close minted % global-ladder items', v_n; end if;
      raise exception '%', v_marker;
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err <> v_marker then raise exception '0222 campus-close probe: %', v_err; end if;
    end;
  end if;

  -- A · the campus closer runs and prints no retired title.
  begin
    perform set_config('philoi.suppress_push', 'on', true);
    perform snapshot_season_standings('S1');
    perform grant_season_placement_rewards('S1', false);
    select count(*) into v_n from cosmetics_owned
    where cosmetic_key in ('title-emberfall-elite', 'title-emberfall-ascendant', 'title-emberfall-contender', 'title-emberfall-initiate')
      and acquired_at = now();
    if v_n <> 0 then raise exception '0222: the campus closer minted % retired titles', v_n; end if;
    raise exception '%', v_marker;
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> v_marker then raise exception '0222 campus-placement probe: %', v_err; end if;
  end;

  -- B + D · the evaluator, run for everyone who has completed a session, then undone. New grants
  -- must be a SUBSET of who qualifies (no false grants) and every qualifier must end up holding it
  -- (no missed grants) — both directions, for each of the four changed conditions.
  begin
    perform set_config('philoi.suppress_push', 'on', true);
    create temp table _0222_before on commit drop as
      select user_id, cosmetic_key from cosmetics_owned
      where cosmetic_key in ('relic-icarus-feather', 'relic-zeus-bolt', 'title-night-owl', 'title-early-bird');

    for v_uid in select distinct s.user_id from lock_in_sessions s where s.status = 'completed' loop
      perform economy_evaluate_relics(v_uid);
    end loop;

    -- Icarus: granted ⇔ a 5h+ check-in.
    select count(*) into v_n from (
      select distinct ci.user_id from check_ins ci
      where ci.removed_at is null and ci.duration_seconds >= 5 * 3600
        and exists (select 1 from lock_in_sessions s where s.user_id = ci.user_id and s.status = 'completed')
      except
      select user_id from cosmetics_owned where cosmetic_key = 'relic-icarus-feather'
    ) missed;
    if v_n <> 0 then raise exception '0222: % players with a 5h lock-in did not get Icarus', v_n; end if;
    select count(*) into v_n from cosmetics_owned co
    where co.cosmetic_key = 'relic-icarus-feather'
      and not exists (select 1 from _0222_before b where b.user_id = co.user_id and b.cosmetic_key = co.cosmetic_key)
      and not exists (select 1 from check_ins ci where ci.user_id = co.user_id and ci.removed_at is null and ci.duration_seconds >= 5 * 3600);
    if v_n <> 0 then raise exception '0222: Icarus was granted to % players without a 5h lock-in', v_n; end if;

    -- Night Owl / Early Bird: new grants only where the window count reaches 15.
    select count(*) into v_n from cosmetics_owned co
    where co.cosmetic_key in ('title-night-owl', 'title-early-bird')
      and not exists (select 1 from _0222_before b where b.user_id = co.user_id and b.cosmetic_key = co.cosmetic_key)
      and (
        select count(*) from lock_in_sessions s
        join check_ins ci on ci.id = s.ended_check_in_id
        join profiles p on p.id = s.user_id
        where s.user_id = co.user_id and s.status = 'completed' and ci.duration_seconds >= 600
          and extract(hour from s.started_at at time zone coalesce(nullif(p.timezone, ''), 'UTC'))
              between case co.cosmetic_key when 'title-night-owl' then 0 else 5 end
                  and case co.cosmetic_key when 'title-night-owl' then 4 else 8 end
      ) < 15;
    if v_n <> 0 then raise exception '0222: % time-of-day titles granted below the 15-session bar', v_n; end if;

    raise exception '%', v_marker;
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> v_marker then raise exception '0222 evaluator probe: %', v_err; end if;
  end;
end;
$assert$;
