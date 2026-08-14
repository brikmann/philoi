-- Task #88 — seed a base loadout on signup.
--
-- A new account used to land on a profile with every cosmetic slot empty: no flame, no card, no
-- title. The first impression of the entire cosmetics system was a row of blanks, which reads as
-- "broken" far more readily than it reads as "unlockable."
--
-- These are the FLOOR, not a reward. All common, all house orange, deliberately plain — a starter
-- set attractive enough to keep would remove the reason to ever open a box. They mirror DEFAULTS in
-- src/lib/economy/catalog.ts and the two sets must stay in step: a key seeded here that the client
-- can't resolve renders as an empty slot again, which is the exact bug this fixes.

begin;


-- The starter keys, in one place so the seeder, the backfill and the salvage guard can't drift.
-- IMMUTABLE + a literal body means Postgres can inline it wherever it's used.
create or replace function default_cosmetic_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'flame-base-ember',
    'particle-base-spark',
    'flare-base-glow',
    'card-base-hearth',
    'halo-base-ring',
    'title-base-kindling',
    'banner-base-hearth',
    'sfx-campfire-spark',
    'sfx-ember-settle',
    'audio-base-hearth-hum'
  ];
$$;

/**
 * Grant the starter set and put it on. Idempotent — safe to call for a user who already has it,
 * which is what lets the trigger, the backfill and any future repair script all share one path.
 *
 * `on conflict do nothing` on the loadout is doing something specific: it must never overwrite a
 * slot the user has already filled. Re-running this for an established account grants nothing new
 * and, critically, does not strip the Mythic flame they equipped last week back down to the base.
 */
create or replace function seed_default_loadout(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- source 'earned' rather than a new enum value: ALTER TYPE ... ADD VALUE cannot be used in the
  -- same transaction that adds it, so introducing a 'default' member here would need a two-step
  -- deploy for no real gain. `provenance` is what actually names these, and it's the field the UI
  -- reads anyway.
  insert into cosmetics_owned (user_id, cosmetic_key, slot, source, provenance)
  select p_user, k.key, null, 'earned'::item_source, 'Starter set'
  from unnest(default_cosmetic_keys()) as k(key)
  on conflict (user_id, cosmetic_key) do nothing;

  -- What they're actually WEARING. The audio slot is deliberately absent: an Audio cosmetic is a
  -- looping ambient bed that starts on its own when a lock-in begins, so equipping one by default
  -- would play a loop into a room the user never agreed to make noise in. They own it and can
  -- equip it in one tap. Every other default is silent decoration and goes on immediately.
  insert into equipped_loadout (user_id, slot, cosmetic_key)
  values
    (p_user, 'flame',     'flame-base-ember'),
    (p_user, 'particle',  'particle-base-spark'),
    (p_user, 'flare',     'flare-base-glow'),
    (p_user, 'card',      'card-base-hearth'),
    (p_user, 'halo',      'halo-base-ring'),
    (p_user, 'title',     'title-base-kindling'),
    (p_user, 'banner',    'banner-base-hearth'),
    (p_user, 'sfx_start', 'sfx-campfire-spark'),
    (p_user, 'sfx_stop',  'sfx-ember-settle')
  on conflict (user_id, slot) do nothing;
end;
$$;


-- ── on signup ──────────────────────────────────────────────────────────────────────────────────
-- Fires on `profiles`, not on auth.users: the app creates the profile row itself, cosmetics_owned
-- and equipped_loadout both have a FK onto profiles, and a trigger on auth.users would therefore
-- fire before the row those FKs point at exists.
create or replace function seed_default_loadout_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_default_loadout(new.id);
  return new;
end;
$$;

drop trigger if exists profiles_seed_default_loadout on profiles;
create trigger profiles_seed_default_loadout
  after insert on profiles
  for each row execute function seed_default_loadout_on_signup();


-- ── backfill ───────────────────────────────────────────────────────────────────────────────────
-- Existing accounts get the starter set too. Thanks to the two `do nothing` clauses this only
-- fills genuinely empty slots — nobody's current loadout is touched.
do $$
declare
  r record;
begin
  for r in select id from profiles loop
    perform seed_default_loadout(r.id);
  end loop;
end $$;


-- ── the starter set cannot be sold ─────────────────────────────────────────────────────────────
-- Re-emitted from 0070 with one added guard. Without it a user could salvage their base flame for
-- a handful of embers and leave a slot with no floor to fall back to — unrecoverable from inside
-- the app, since these are in no box and on no shop shelf.
drop function if exists salvage_cosmetic(text, text);
create function salvage_cosmetic(p_key text, p_rarity text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_payout int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  if p_key = any (default_cosmetic_keys()) then
    raise exception 'Starter items are permanent and cannot be sold.';
  end if;

  if not exists (select 1 from cosmetics_owned where user_id = v_user and cosmetic_key = p_key) then
    raise exception 'You do not own this item';
  end if;

  v_payout := ((select value from economy_config where key = 'salvage_embers') ->> p_rarity)::int;
  delete from equipped_loadout where user_id = v_user and cosmetic_key = p_key;
  delete from cosmetics_owned where user_id = v_user and cosmetic_key = p_key;
  perform economy_move_embers(v_user, v_payout, 'salvage', null);
  return jsonb_build_object('embers', v_payout);
end;
$$;

commit;
