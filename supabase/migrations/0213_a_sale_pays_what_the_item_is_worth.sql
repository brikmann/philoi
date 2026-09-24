-- 0213 — a sale pays what the item is worth, and what you earned is not for sale. 🔴 exploit fix
--
-- Two holes in salvage_cosmetic, both live since 0073:
--
-- 1. IT PAID THE CLIENT'S RARITY. `v_payout := salvage_embers ->> p_rarity`, and p_rarity came off
--    the phone unchecked — a rare flame "sold as mythic" paid the mythic rate (200 → 2000 embers).
--    0069 closed exactly this class for box auto-salvage; the user-initiated sell was missed.
-- 2. IT SOLD ANYTHING YOU OWNED, earned prestige included — season placement titles, relics,
--    medals, campfire finisher titles (0212 fenced that last one by name; this fences the class).
--
-- Server-only. Installed builds keep calling salvage_cosmetic(key, rarity) — the signature is
-- unchanged, p_rarity is simply no longer read — so this fixes prod the moment it applies.
--
-- ─── WHERE THE TRUE RARITY COMES FROM ───
-- There was no complete server source. cosmetics_owned stores only rarity_override (a placement
-- escalation, set on 6 rows); box_droppable_items covers the box pool but not the Flame Pass set or
-- anything retired from the pool; pass_track_rewards covers only the pass. So this adds one:
-- `cosmetic_rarity`, every item in src/lib/economy/catalog.ts, seeded below.
--
--   ⚠️ RE-SEED WHEN THE CATALOG GAINS OR RE-RATES AN ITEM. An item missing here cannot be sold (the
--   RPC refuses rather than guessing). `npm run typecheck` runs scripts/check-cosmetic-rarity.js,
--   which fails when the newest cosmetic_rarity seed in supabase/migrations disagrees with the
--   catalog in either direction — so the drift is caught at the next typecheck, not by a user.
--
-- The seed was checked against prod before it was written: box_droppable_items and
-- pass_track_rewards agree with it on every row (asserted again below), and every sellable owned
-- key resolves except `sfx-victory-anthem` — never in the catalog, dropped by every build, so no
-- screen can offer to sell it; the RPC now refuses it instead of pricing it off the client.
--
-- Precedence: the owned row's rarity_override, then cosmetic_rarity. Unknown → raise. Never the
-- client's p_rarity, never a default.
--
-- ─── WHAT WAS VERIFIED UNCHANGED ───
-- Box auto-salvage of dupes happens inside economy_grant_cosmetic, which pays the rarity its caller
-- hands it. Every caller derives that server-side: open_loot_box (the rolled rarity, filtered by
-- box_droppable_items AT that rarity), forge_combine (the recipe's next tier), claim_pass_level
-- (pass_level_rewards, not the client's p_rewards), close_season_scope (season_titles), and fixed
-- literals in grant_level_zero_unlock / grant_season_placement_rewards / economy_grant_relic's
-- callers. claim_pass_tier does take p_item_rarity from its caller but is not executable by
-- authenticated or anon (0132) — asserted below so a future grant cannot quietly reopen it.
-- economy_move_embers is untouched.
--
-- Restated from live prosrc. 0212 also restates salvage_cosmetic, and may or may not have been
-- applied when this runs, so the guard accepts exactly those two bodies and nothing else.
--
-- NOTE: no explicit begin/commit — the migration runs in its own transaction.

do $guard$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5 from pg_proc p
  where p.oid = 'public.salvage_cosmetic(text, text)'::regprocedure;

  -- 9b6c60a5… = 0073's body (live 2026-09-24). 12591a07… = the same body plus 0212's finisher refusal.
  if v_md5 is null or v_md5 not in ('9b6c60a5d80e04dae0ffb1b4fb485d62', '12591a075bfa892f18edf692da072776') then
    raise exception '0213: salvage_cosmetic changed since it was read (md5 %). Re-restate from live prosrc.', v_md5;
  end if;
end;
$guard$;

-- ───────────────────────────── the rarity source ─────────────────────────────

create table if not exists cosmetic_rarity (
  cosmetic_key text primary key,
  rarity text not null check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'))
);

-- Server-only. The client already ships these values in catalog.ts; nothing needs to read them over
-- the wire, and RLS with no policy keeps it that way.
alter table cosmetic_rarity enable row level security;

-- GENERATED from src/lib/economy/catalog.ts by scripts/check-cosmetic-rarity.js --print-seed.
-- `do update` so a re-rated item is corrected by the next re-seed rather than skipped.
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
  ('banner-emberfall-mythic', 'mythic'),
  ('banner-emberfall-night', 'epic'),
  ('banner-obsidian-colosseum', 'legendary'),
  ('banner-the-great-forge', 'legendary'),
  ('card-base-hearth', 'common'),
  ('card-brushed-steel', 'uncommon'),
  ('card-carbon-fiber', 'rare'),
  ('card-cracked-magma', 'epic'),
  ('card-emberfall', 'epic'),
  ('card-emberfall-mythic', 'mythic'),
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
  ('flare-emberfall-ascendant', 'mythic'),
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
  ('halo-emberfall-mythic', 'mythic'),
  ('halo-glowing-amber', 'rare'),
  ('halo-hades', 'mythic'),
  ('halo-inferno-flare', 'legendary'),
  ('medal-campus-sovereign', 'legendary'),
  ('medal-emberfall-centurion', 'legendary'),
  ('medal-emberfall-champion', 'legendary'),
  ('medal-emberfall-crown', 'mythic'),
  ('medal-emberfall-participant', 'common'),
  ('medal-unbroken-season', 'legendary'),
  ('particle-base-spark', 'common'),
  ('particle-ember-swarm', 'epic'),
  ('particle-emberfall-ascendant', 'epic'),
  ('particle-falling-ash', 'epic'),
  ('particle-floating-sparks', 'epic'),
  ('particle-lightning-tendrils', 'legendary'),
  ('particle-solar-flares', 'legendary'),
  ('particle-void-smoke', 'mythic'),
  ('relic-anvil-of-hephaestus', 'legendary'),
  ('relic-athenas-aegis', 'epic'),
  ('relic-atlas-burden', 'mythic'),
  ('relic-crown-of-olympus', 'mythic'),
  ('relic-daedalus-blueprint', 'uncommon'),
  ('relic-emberfall', 'legendary'),
  ('relic-hercules-might', 'uncommon'),
  ('relic-hestias-hearthstone', 'epic'),
  ('relic-icarus-feather', 'legendary'),
  ('relic-pheidippides-sandals', 'rare'),
  ('relic-prometheus-shard', 'mythic'),
  ('relic-socrates-scroll', 'uncommon'),
  ('relic-zeus-bolt', 'mythic'),
  ('sfx-campfire-spark', 'common'),
  ('sfx-ember-settle', 'common'),
  ('sfx-emberfall-strike', 'mythic'),
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
  ('title-elite-ember', 'epic'),
  ('title-ember-stoker', 'common'),
  ('title-emberfall-ascendant', 'epic'),
  ('title-emberfall-champion', 'mythic'),
  ('title-emberfall-contender', 'rare'),
  ('title-emberfall-elite', 'legendary'),
  ('title-emberfall-initiate', 'uncommon'),
  ('title-final-boss', 'epic'),
  ('title-forged-in-ember', 'mythic'),
  ('title-forged-in-emberfall', 'epic'),
  ('title-iron-forged', 'rare'),
  ('title-keepers-of-the-flame', 'epic'),
  ('title-kept-the-fire', 'rare'),
  ('title-kindled', 'common'),
  ('title-kindled-by-emberfall', 'legendary'),
  ('title-last-flame-standing', 'epic'),
  ('title-locked-in', 'common'),
  ('title-main-character', 'rare'),
  ('title-night-owl', 'common'),
  ('title-ninety-day-siege', 'epic'),
  ('title-pacesetter', 'uncommon'),
  ('title-prometheus-disciples', 'epic'),
  ('title-s1-agni', 'mythic'),
  ('title-s1-built-different', 'legendary'),
  ('title-s1-certified-firestarter', 'rare'),
  ('title-s1-firebreather', 'epic'),
  ('title-s1-helios', 'mythic'),
  ('title-s1-surtur', 'mythic'),
  ('title-s1-the-relentless', 'legendary'),
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

-- ───────────────────────────── the sale ─────────────────────────────

create or replace function salvage_cosmetic(p_key text, p_rarity text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row cosmetics_owned;
  v_rarity text;
  v_payout int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  -- p_rarity is VESTIGIAL (0213). It stays in the signature only because installed builds send it;
  -- it is never read. The price is the server's.

  if p_key = any (default_cosmetic_keys()) then
    raise exception 'Starter items are permanent and cannot be sold.';
  end if;

  -- 0212 — kept as a belt to the source rule below.
  if p_key like 'title-campfire-finisher:%' then
    raise exception 'Campfire finisher titles are permanent and cannot be sold.';
  end if;

  -- Locked so a double-tap cannot pay twice for one row.
  select * into v_row from cosmetics_owned
  where user_id = v_user and cosmetic_key = p_key
  for update;

  if v_row.id is null then
    raise exception 'You do not own this item';
  end if;

  -- 0213 — THE fence. Season titles, relics, medals, finisher titles: prestige, not currency.
  if v_row.source = 'earned' then
    raise exception 'Earned items are permanent and cannot be sold.';
  end if;

  v_rarity := coalesce(
    v_row.rarity_override,
    (select cr.rarity from cosmetic_rarity cr where cr.cosmetic_key = p_key)
  );
  if v_rarity is null then
    raise exception 'This item cannot be sold right now (no known rarity for %).', p_key;
  end if;

  v_payout := ((select value from economy_config where key = 'salvage_embers') ->> v_rarity)::int;
  if v_payout is null then
    raise exception 'No salvage price for rarity %', v_rarity;
  end if;

  delete from equipped_loadout where user_id = v_user and cosmetic_key = p_key;
  delete from cosmetics_owned where id = v_row.id;
  perform economy_move_embers(v_user, v_payout, 'salvage', null);
  -- `rarity` is new and additive: the rarity actually paid, so a client can stop guessing.
  return jsonb_build_object('embers', v_payout, 'rarity', v_rarity);
end;
$$;

-- ───────────────────────────── assertions ─────────────────────────────

do $assert$
declare
  v_src text;
  v_n int;
begin
  -- Complete: every catalog item is priced (the seed row count is checked against the script's).
  select count(*) into v_n from cosmetic_rarity;
  if v_n < 139 then
    raise exception '0213: cosmetic_rarity has % rows, expected at least 139', v_n;
  end if;

  -- Agrees with the two server tables that already carried rarity. A disagreement means one of
  -- them is wrong, and a sale would price differently from a drop.
  if exists (
    select 1 from box_droppable_items d
    left join cosmetic_rarity cr on cr.cosmetic_key = d.item_key
    where cr.rarity is distinct from d.rarity
  ) then
    raise exception '0213: box_droppable_items disagrees with cosmetic_rarity';
  end if;
  if exists (
    select 1 from pass_track_rewards p
    left join cosmetic_rarity cr on cr.cosmetic_key = p.item_key
    where p.item_key is not null and cr.rarity is distinct from p.item_rarity
  ) then
    raise exception '0213: pass_track_rewards disagrees with cosmetic_rarity';
  end if;

  -- Every sellable owned row resolves, bar the one known orphan named in the header.
  if exists (
    select 1 from cosmetics_owned co
    left join cosmetic_rarity cr on cr.cosmetic_key = co.cosmetic_key
    where co.source <> 'earned' and co.rarity_override is null and cr.rarity is null
      and co.cosmetic_key <> 'sfx-victory-anthem'
  ) then
    raise exception '0213: a sellable owned item has no server rarity';
  end if;

  -- The body no longer reads the client's rarity, and does fence earned.
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.salvage_cosmetic(text, text)'::regprocedure;
  if v_src ~ '->>\s*p_rarity' then
    raise exception '0213: salvage_cosmetic still prices off p_rarity';
  end if;
  if v_src not like '%v_row.source = ''earned''%' then
    raise exception '0213: salvage_cosmetic does not refuse earned items';
  end if;

  -- One signature, still callable by a signed-in client, not by anon.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'salvage_cosmetic';
  if v_n <> 1 then raise exception '0213: salvage_cosmetic has % overloads', v_n; end if;
  if not has_function_privilege('authenticated', 'public.salvage_cosmetic(text, text)', 'execute') then
    raise exception '0213: authenticated lost execute on salvage_cosmetic — installed builds cannot sell';
  end if;
  if has_function_privilege('anon', 'public.salvage_cosmetic(text, text)', 'execute') then
    raise exception '0213: anon can execute salvage_cosmetic';
  end if;

  -- The one grant path that trusts a caller's rarity stays unreachable from a client.
  if has_function_privilege('authenticated', 'public.claim_pass_tier(integer,text,text,integer,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.claim_pass_tier(integer,text,text,integer,text,text,text,text)', 'execute') then
    raise exception '0213: claim_pass_tier (caller-supplied rarity) is client-callable';
  end if;
end;
$assert$;
