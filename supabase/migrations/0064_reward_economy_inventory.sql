-- Reward economy + inventory (REWARD_ECONOMY.md §1/§8, CODE_BUILD_PROMPTS Step 21a–21k).
--
-- THE non-negotiable from §0.4: the server owns the truth. There is no client-writable table in
-- this migration. Every RLS policy below grants SELECT on your own rows and nothing else — no
-- INSERT, no UPDATE, no DELETE for the `authenticated` role anywhere. All mutation happens through
-- the security-definer functions at the bottom, which is the only place ember math, drop rolls,
-- and pity counters exist. A client that hand-rolls a Supabase call cannot mint an ember.
--
-- Amounts are deliberately NOT constants in these functions — they read economy_config, so the
-- economy can be rebalanced post-launch with an UPDATE instead of an app release (§5 / 21e).

-- ───────────────────────────── server-tunable config ─────────────────────────────

create table if not exists economy_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table economy_config enable row level security;

-- Readable by everyone (the shop has to render prices), writable by nobody but the service role.
drop policy if exists economy_config_read on economy_config;
create policy economy_config_read on economy_config for select to authenticated using (true);

insert into economy_config (key, value) values
  ('box_price', '{"kindling":80,"ignition":200,"furnace":500,"hestia":1200,"hephaestus":3000,"promethean":8000}'),
  ('salvage_embers', '{"common":40,"uncommon":90,"rare":200,"epic":420,"legendary":900,"mythic":2000}'),
  ('direct_buy_price', '{"common":150,"uncommon":300,"rare":600,"epic":1500,"legendary":4000,"mythic":10000}'),
  -- Published odds (§8.2). The roll reads THIS, not the client's copy in src/lib/economy/boxes.ts.
  ('box_odds', '{
     "kindling":{"common":80,"uncommon":17.5,"rare":2.4,"epic":0.1,"legendary":0,"mythic":0},
     "ignition":{"common":45,"uncommon":40,"rare":12,"epic":2.8,"legendary":0.2,"mythic":0},
     "furnace":{"common":15,"uncommon":45,"rare":30,"epic":8.5,"legendary":1.4,"mythic":0.1},
     "hestia":{"common":0,"uncommon":20,"rare":50,"epic":22,"legendary":7.2,"mythic":0.8},
     "hephaestus":{"common":0,"uncommon":0,"rare":35,"epic":45,"legendary":17.5,"mythic":2.5},
     "promethean":{"common":0,"uncommon":0,"rare":0,"epic":40,"legendary":48,"mythic":12}
   }'),
  -- PITY, not a floor. The published odds above are authoritative: every single open matches the
  -- printed per-open probability, with no clamping. This is purely a bad-luck backstop — after
  -- `every` consecutive opens WITHOUT hitting `rarity` or better, the next open is forced to it.
  --
  -- §8.2 states both a per-box "floor" and soft/hard pity steps, but a floor that clamps the roll
  -- would make the published table false (Hestia's floor:Epic would turn a printed 22% Epic into
  -- ~92%). Since the whole reason odds are published is regulatory — student/minor audience, the
  -- Belgium/NL paid-loot-box bans, store disclosure rules — the table has to be the truth and the
  -- floor becomes pity.
  --
  -- Targets are chosen to be MEANINGFUL: where §8.2's floor is the box's most likely outcome
  -- (Kindling floor:Common at 80%, Ignition floor:Uncommon at 40%, Promethean floor:Legendary at
  -- 48%), guaranteeing it would promise something you already get almost every time, so those
  -- step up to the next genuinely scarce tier. ~1-in-10 on the mid boxes, tighter as they climb.
  ('box_pity', '{
     "kindling":{"rarity":"rare","every":10},
     "ignition":{"rarity":"rare","every":10},
     "furnace":{"rarity":"epic","every":10},
     "hestia":{"rarity":"epic","every":10},
     "hephaestus":{"rarity":"legendary","every":8},
     "promethean":{"rarity":"mythic","every":3}
   }'),
  ('pass_price_usd', '8.99'),
  ('season', '{"id":"S1","name":"Emberfall","total_tiers":100}')
on conflict (key) do nothing;

-- ───────────────────────────── wallet + append-only ledger ─────────────────────────────

create table if not exists ember_wallet (
  user_id uuid primary key references profiles (id) on delete cascade,
  -- Enforced non-negative at the column level, not just in the spend functions: a bug that tried
  -- to overdraw should abort the transaction, never quietly leave a negative balance.
  balance int not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

alter table ember_wallet enable row level security;
drop policy if exists ember_wallet_read_own on ember_wallet;
create policy ember_wallet_read_own on ember_wallet for select to authenticated using (user_id = auth.uid());

do $$ begin
  create type ember_reason as enum
    ('lock_in','flame_meter','challenge_win','season_reward','box_open','shop_spend','stipend','forge_pass','salvage','admin');
exception when duplicate_object then null; end $$;

-- Append-only by design (§1) — auditability and anti-fraud. Nothing ever updates or deletes a
-- ledger row; the wallet balance is a materialized convenience, the ledger is the record.
create table if not exists ember_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  delta int not null,
  reason ember_reason not null,
  ref_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists ember_ledger_user_idx on ember_ledger (user_id, created_at desc);

alter table ember_ledger enable row level security;
drop policy if exists ember_ledger_read_own on ember_ledger;
create policy ember_ledger_read_own on ember_ledger for select to authenticated using (user_id = auth.uid());

-- ───────────────────────────── owned items ─────────────────────────────

do $$ begin
  create type item_source as enum ('earned','paid','box','forge_pass');
exception when duplicate_object then null; end $$;

do $$ begin
  create type box_obtained_via as enum ('challenge','season','forge_pass','purchase','promo');
exception when duplicate_object then null; end $$;

-- Cosmetics. `cosmetic_key` is an id from src/lib/economy/catalog.ts — the catalog stays in the
-- client bundle (it's ~60 static rows of names and lore, and it has to render offline), while
-- OWNERSHIP lives here where the client can't touch it.
create table if not exists cosmetics_owned (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  cosmetic_key text not null,
  slot text,
  source item_source not null,
  provenance text,
  equipped boolean not null default false,
  acquired_at timestamptz not null default now(),
  -- Dupes auto-salvage (§8.3) rather than stacking, so one row per user per item is correct and
  -- the unique index is what makes "do I already own this?" a cheap upsert conflict.
  unique (user_id, cosmetic_key)
);

create index if not exists cosmetics_owned_user_idx on cosmetics_owned (user_id);

-- One equipped item per slot — enforced in the index, not just in equip_cosmetic(), so no future
-- caller can leave a user with two live flames.
create unique index if not exists cosmetics_owned_one_per_slot
  on cosmetics_owned (user_id, slot) where equipped and slot is not null;

alter table cosmetics_owned enable row level security;
drop policy if exists cosmetics_owned_read_own on cosmetics_owned;
create policy cosmetics_owned_read_own on cosmetics_owned for select to authenticated using (user_id = auth.uid());

-- Badges carry provenance because that string IS the value of an earned badge (§0.3). `source`
-- drives the earned-vs-paid visual split and is never mixed.
create table if not exists owned_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  badge_key text not null,
  source item_source not null,
  provenance text,
  earned_at timestamptz not null default now(),
  equipped boolean not null default false,
  unique (user_id, badge_key)
);

create index if not exists owned_badges_user_idx on owned_badges (user_id);

alter table owned_badges enable row level security;
drop policy if exists owned_badges_read_own on owned_badges;
create policy owned_badges_read_own on owned_badges for select to authenticated using (user_id = auth.uid());

-- Unopened boxes sit here until opened. `provenance` shows on the box BEFORE opening ("Won from
-- vs Aidan · S1") so an earned box reads differently from a bought one.
create table if not exists loot_boxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  box_key text not null,
  obtained_via box_obtained_via not null,
  provenance text,
  opened boolean not null default false,
  opened_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists loot_boxes_user_unopened_idx on loot_boxes (user_id) where not opened;

alter table loot_boxes enable row level security;
drop policy if exists loot_boxes_read_own on loot_boxes;
create policy loot_boxes_read_own on loot_boxes for select to authenticated using (user_id = auth.uid());

-- The pity counter. Kept server-side per box tier; a client that could read-modify-write this
-- could farm guaranteed Mythics, so like everything else it's select-only.
create table if not exists box_pity (
  user_id uuid not null references profiles (id) on delete cascade,
  box_key text not null,
  opens_since_hard int not null default 0,
  primary key (user_id, box_key)
);

alter table box_pity enable row level security;
drop policy if exists box_pity_read_own on box_pity;
create policy box_pity_read_own on box_pity for select to authenticated using (user_id = auth.uid());

-- ───────────────────────────── Forge Pass ─────────────────────────────

create table if not exists forge_pass_state (
  user_id uuid not null references profiles (id) on delete cascade,
  season_id text not null,
  pass_xp int not null default 0 check (pass_xp >= 0),
  -- Premium ownership. STUBBED FALSE until RevenueCat (task #71) — grant_forge_pass() flips it,
  -- and a founder "free Pro" entitlement can flip it server-side with no IAP involved at all.
  owns_premium boolean not null default false,
  premium_granted_at timestamptz,
  primary key (user_id, season_id)
);

alter table forge_pass_state enable row level security;
drop policy if exists forge_pass_state_read_own on forge_pass_state;
create policy forge_pass_state_read_own on forge_pass_state for select to authenticated using (user_id = auth.uid());

-- Pass XP is a DISTINCT ledger from rank XP — that separation is the whole point (FORGE_PASS.md
-- "Progression"). Nothing in here ever touches universal_score()/rank.
create table if not exists pass_xp_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  season_id text not null,
  achievement_key text not null,
  xp int not null check (xp > 0),
  -- The once-per-day cap lives in this column + the unique index below. A daily achievement
  -- claimed today can't be claimed again today, which is what makes marathoning impossible.
  period_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, achievement_key, period_key)
);

create index if not exists pass_xp_ledger_user_idx on pass_xp_ledger (user_id, season_id);

alter table pass_xp_ledger enable row level security;
drop policy if exists pass_xp_ledger_read_own on pass_xp_ledger;
create policy pass_xp_ledger_read_own on pass_xp_ledger for select to authenticated using (user_id = auth.uid());

create table if not exists pass_claims (
  user_id uuid not null references profiles (id) on delete cascade,
  season_id text not null,
  tier int not null,
  lane text not null check (lane in ('free','premium')),
  claimed_at timestamptz not null default now(),
  primary key (user_id, season_id, tier, lane)
);

alter table pass_claims enable row level security;
drop policy if exists pass_claims_read_own on pass_claims;
create policy pass_claims_read_own on pass_claims for select to authenticated using (user_id = auth.uid());

-- ───────────────────────────── internal helpers ─────────────────────────────

-- Single funnel for every ember movement: wallet and ledger always change together or not at all.
-- Nothing else in this file is allowed to UPDATE ember_wallet directly.
create or replace function economy_move_embers(
  p_user uuid, p_delta int, p_reason ember_reason, p_ref uuid default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  insert into ember_wallet (user_id, balance) values (p_user, 0)
    on conflict (user_id) do nothing;

  update ember_wallet
     set balance = balance + p_delta, updated_at = now()
   where user_id = p_user
  returning balance into v_balance;

  -- The check constraint would already have aborted an overdraw, but naming it turns a raw
  -- constraint violation into something the client can actually show the user.
  if v_balance is null then
    raise exception 'No wallet for user %', p_user;
  end if;

  insert into ember_ledger (user_id, delta, reason, ref_id) values (p_user, p_delta, p_reason, p_ref);
  return v_balance;
end;
$$;

-- Weighted roll over the PUBLISHED odds. There is deliberately no clamp anywhere in this function:
-- whatever the odds table prints is exactly what each open does. The only deviation is the pity
-- backstop, which can only ever move a result UP and only after a documented run of bad luck.
create or replace function economy_roll_rarity(p_user uuid, p_box_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ladder text[] := array['common','uncommon','rare','epic','legendary','mythic'];
  v_odds jsonb;
  v_pity_cfg jsonb;
  v_streak int;
  v_roll numeric;
  v_acc numeric := 0;
  v_rarity text;
begin
  v_odds := (select value from economy_config where key = 'box_odds') -> p_box_key;
  v_pity_cfg := (select value from economy_config where key = 'box_pity') -> p_box_key;
  if v_odds is null then
    raise exception 'Unknown box %', p_box_key;
  end if;

  insert into box_pity (user_id, box_key) values (p_user, p_box_key) on conflict do nothing;
  select opens_since_hard into v_streak from box_pity where user_id = p_user and box_key = p_box_key;

  -- Pity fires only when the streak is already at the limit. Everything else rolls honestly.
  if v_pity_cfg is not null and v_streak + 1 >= (v_pity_cfg ->> 'every')::int then
    update box_pity set opens_since_hard = 0 where user_id = p_user and box_key = p_box_key;
    return v_pity_cfg ->> 'rarity';
  end if;

  v_roll := random() * 100;
  foreach v_rarity in array v_ladder
  loop
    v_acc := v_acc + coalesce((v_odds ->> v_rarity)::numeric, 0);
    exit when v_roll < v_acc;
  end loop;

  -- Streak resets on the pity target OR ANYTHING BETTER — pulling a Mythic obviously satisfies a
  -- "guaranteed Epic" promise, and not resetting there would hand out a second guarantee on top.
  if v_pity_cfg is not null
     and array_position(v_ladder, v_rarity) >= array_position(v_ladder, v_pity_cfg ->> 'rarity') then
    update box_pity set opens_since_hard = 0 where user_id = p_user and box_key = p_box_key;
  else
    update box_pity set opens_since_hard = opens_since_hard + 1 where user_id = p_user and box_key = p_box_key;
  end if;

  return v_rarity;
end;
$$;

-- ───────────────────────────── read API ─────────────────────────────
-- One call the client uses for the whole Inventory (§1 "client reads via a single getInventory").

drop function if exists get_inventory();
create function get_inventory()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  return jsonb_build_object(
    'embers', coalesce((select balance from ember_wallet where user_id = v_user), 0),
    'cosmetics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'cosmetic_key', c.cosmetic_key, 'slot', c.slot,
        'source', c.source, 'provenance', c.provenance, 'equipped', c.equipped,
        'acquired_at', c.acquired_at
      ) order by c.acquired_at desc)
      from cosmetics_owned c where c.user_id = v_user
    ), '[]'::jsonb),
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'badge_key', b.badge_key, 'source', b.source,
        'provenance', b.provenance, 'equipped', b.equipped, 'earned_at', b.earned_at
      ) order by b.earned_at desc)
      from owned_badges b where b.user_id = v_user
    ), '[]'::jsonb),
    'boxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'box_key', l.box_key, 'obtained_via', l.obtained_via, 'provenance', l.provenance
      ) order by l.created_at desc)
      from loot_boxes l where l.user_id = v_user and not l.opened
    ), '[]'::jsonb),
    'pass', jsonb_build_object(
      'season_id', v_season,
      'pass_xp', coalesce((select pass_xp from forge_pass_state where user_id = v_user and season_id = v_season), 0),
      'owns_premium', coalesce((select owns_premium from forge_pass_state where user_id = v_user and season_id = v_season), false),
      'claims', coalesce((
        select jsonb_agg(jsonb_build_object('tier', tier, 'lane', lane))
        from pass_claims where user_id = v_user and season_id = v_season
      ), '[]'::jsonb),
      'achievements', coalesce((
        select jsonb_agg(jsonb_build_object('key', achievement_key, 'period_key', period_key, 'xp', xp))
        from pass_xp_ledger where user_id = v_user and season_id = v_season
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- ───────────────────────────── mutations (server-authoritative) ─────────────────────────────

-- Grant a cosmetic. Returns whether it was a DUPE, because a dupe auto-salvages to embers (§8.3)
-- rather than creating a second row — that's the dupe-protection the reward menu dims and prices.
create or replace function economy_grant_cosmetic(
  p_user uuid, p_key text, p_slot text, p_rarity text, p_source item_source, p_provenance text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_payout int;
begin
  select true into v_exists from cosmetics_owned where user_id = p_user and cosmetic_key = p_key;

  if v_exists then
    v_payout := ((select value from economy_config where key = 'salvage_embers') ->> p_rarity)::int;
    perform economy_move_embers(p_user, v_payout, 'salvage', null);
    return jsonb_build_object('cosmetic_key', p_key, 'rarity', p_rarity, 'dupe', true, 'embers', v_payout);
  end if;

  insert into cosmetics_owned (user_id, cosmetic_key, slot, source, provenance)
  values (p_user, p_key, p_slot, p_source, p_provenance);
  return jsonb_build_object('cosmetic_key', p_key, 'rarity', p_rarity, 'dupe', false, 'embers', 0);
end;
$$;

-- Open one box the user owns. The RESULT IS DECIDED HERE, before any animation runs (§8.5) —
-- the client receives a finished outcome and merely visualizes it.
drop function if exists open_loot_box(uuid, text[]);
create function open_loot_box(p_box_id uuid, p_pool text[])
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
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  -- Locked so a double-tap can't open the same box twice.
  select * into v_box from loot_boxes where id = p_box_id and user_id = v_user and not opened for update;
  if v_box.id is null then raise exception 'Box not found or already opened'; end if;

  v_rarity := economy_roll_rarity(v_user, v_box.box_key);

  -- p_pool is the caller's candidate item ids AT THAT RARITY, from the catalog. The server picks
  -- WHICH one, so the client can't aim the roll; passing the pool just avoids duplicating ~60
  -- rows of static catalog data into Postgres.
  select p into v_pick from unnest(p_pool) p order by random() limit 1;
  if v_pick is null then raise exception 'Empty drop pool for rarity %', v_rarity; end if;

  update loot_boxes set opened = true, opened_at = now() where id = p_box_id;

  return economy_grant_cosmetic(v_user, v_pick, null, v_rarity, 'box', v_box.provenance)
         || jsonb_build_object('box_key', v_box.box_key, 'rolled_rarity', v_rarity);
end;
$$;

-- Buy a box with embers, then hand back an unopened row for the open flow to consume.
drop function if exists buy_loot_box(text);
create function buy_loot_box(p_box_key text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_price int;
  v_id uuid;
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  v_price := ((select value from economy_config where key = 'box_price') ->> p_box_key)::int;
  if v_price is null then raise exception 'Unknown box %', p_box_key; end if;

  perform economy_move_embers(v_user, -v_price, 'shop_spend', null);
  insert into loot_boxes (user_id, box_key, obtained_via, provenance)
  values (v_user, p_box_key, 'purchase', 'Bought in the Forge Shop')
  returning id into v_id;
  return v_id;
end;
$$;

-- Direct buy (§8.4). p_rarity + p_slot come from the catalog; the PRICE does not — it's read from
-- config here so the client can never name its own price.
drop function if exists buy_cosmetic(text, text, text);
create function buy_cosmetic(p_key text, p_slot text, p_rarity text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_price int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from cosmetics_owned where user_id = v_user and cosmetic_key = p_key) then
    raise exception 'You already own this';
  end if;

  v_price := ((select value from economy_config where key = 'direct_buy_price') ->> p_rarity)::int;
  perform economy_move_embers(v_user, -v_price, 'shop_spend', null);
  insert into cosmetics_owned (user_id, cosmetic_key, slot, source, provenance)
  values (v_user, p_key, p_slot, 'paid', 'Bought in the Forge Shop');
  return jsonb_build_object('cosmetic_key', p_key, 'spent', v_price);
end;
$$;

-- Equip. The partial unique index guarantees one-per-slot; this just does the swap atomically.
drop function if exists equip_cosmetic(text, text);
create function equip_cosmetic(p_key text, p_slot text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  if p_slot is null then raise exception 'This item is showcase-only and cannot be equipped'; end if;

  update cosmetics_owned set equipped = false where user_id = v_user and slot = p_slot and equipped;
  update cosmetics_owned set equipped = true, slot = p_slot
   where user_id = v_user and cosmetic_key = p_key;
end;
$$;

drop function if exists unequip_cosmetic(text);
create function unequip_cosmetic(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update cosmetics_owned set equipped = false
   where user_id = auth.uid() and cosmetic_key = p_key;
end;
$$;

-- Salvage / sell (§8.3). Works on EARNED items too, and is permanent — sold is gone, and an earned
-- title only comes back by earning it again. Unequips first so you can't sell what you're wearing.
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
  if not exists (select 1 from cosmetics_owned where user_id = v_user and cosmetic_key = p_key) then
    raise exception 'You do not own this item';
  end if;

  v_payout := ((select value from economy_config where key = 'salvage_embers') ->> p_rarity)::int;
  delete from cosmetics_owned where user_id = v_user and cosmetic_key = p_key;
  perform economy_move_embers(v_user, v_payout, 'salvage', null);
  return jsonb_build_object('embers', v_payout);
end;
$$;

-- Credit Pass XP for an achievement. The unique (user, achievement, period) key is what enforces
-- once-per-day — a second call in the same period is a no-op, not an error, so a retry is safe.
drop function if exists credit_pass_xp(text, int, text);
create function credit_pass_xp(p_achievement text, p_xp int, p_period text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
  v_inserted int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  insert into pass_xp_ledger (user_id, season_id, achievement_key, xp, period_key)
  values (v_user, v_season, p_achievement, p_xp, p_period)
  on conflict (user_id, achievement_key, period_key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return (select pass_xp from forge_pass_state where user_id = v_user and season_id = v_season);
  end if;

  insert into forge_pass_state (user_id, season_id, pass_xp) values (v_user, v_season, p_xp)
  on conflict (user_id, season_id) do update set pass_xp = forge_pass_state.pass_xp + p_xp;

  return (select pass_xp from forge_pass_state where user_id = v_user and season_id = v_season);
end;
$$;

-- Mirrors src/lib/economy/forge-pass.ts's tierCost: 200 → 600 linear, ≈40,000 to tier 100.
-- Defined BEFORE claim_pass_tier, which calls it.
create or replace function economy_tier_from_xp(p_xp int)
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  v_remaining int := p_xp;
  v_cost int;
  t int;
begin
  for t in 1..100 loop
    v_cost := round(200 + ((t - 1) * 400.0) / 99);
    if v_remaining < v_cost then return t - 1; end if;
    v_remaining := v_remaining - v_cost;
  end loop;
  return 100;
end;
$$;

-- Claim a Pass tier reward. Premium claims are gated on owning THIS season's Pass; because the
-- gate is checked at claim time and not at climb time, buying mid-season retroactively unlocks
-- every tier already climbed, exactly as FORGE_PASS.md requires.
--
-- Full 8-arg signature in the DROP: this project has been bitten before by create-or-replace
-- silently keeping an old signature, so every drop here spells out the exact parameter list.
drop function if exists claim_pass_tier(int, text, text, int, text, text, text, text);
create function claim_pass_tier(
  p_tier int, p_lane text, p_kind text,
  p_embers int default null, p_box_key text default null,
  p_item_key text default null, p_item_rarity text default null, p_item_slot text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
  v_state forge_pass_state;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  select * into v_state from forge_pass_state where user_id = v_user and season_id = v_season;
  if v_state.user_id is null then raise exception 'No Pass progress this season yet'; end if;

  if p_lane = 'premium' and not v_state.owns_premium then
    raise exception 'The Premium track needs this season''s Forge Pass';
  end if;

  -- Tier reached is derived from XP server-side rather than trusted from the caller.
  if p_tier > economy_tier_from_xp(v_state.pass_xp) then
    raise exception 'You have not reached tier % yet', p_tier;
  end if;

  insert into pass_claims (user_id, season_id, tier, lane) values (v_user, v_season, p_tier, p_lane);

  if p_kind = 'embers' then
    perform economy_move_embers(v_user, p_embers, 'forge_pass', null);
  elsif p_kind = 'box' then
    insert into loot_boxes (user_id, box_key, obtained_via, provenance)
    values (v_user, p_box_key, 'forge_pass', 'Forge Pass · tier ' || p_tier);
  elsif p_kind = 'item' then
    perform economy_grant_cosmetic(
      v_user, p_item_key, p_item_slot, p_item_rarity, 'forge_pass', 'Forge Pass · tier ' || p_tier
    );
  elsif p_kind = 'badge' then
    insert into owned_badges (user_id, badge_key, source, provenance)
    values (v_user, p_item_key, 'forge_pass', 'Forge Pass · tier ' || p_tier)
    on conflict do nothing;
  end if;

  return jsonb_build_object('tier', p_tier, 'lane', p_lane, 'kind', p_kind);
end;
$$;

-- Founder "free Pro" / RevenueCat webhook seam. Deliberately NOT callable by the client: no grant
-- to `authenticated`, so only the service role can turn Premium on. Real-money purchase (task #71)
-- calls this from the RevenueCat webhook; the founder entitlement calls it directly.
create or replace function grant_forge_pass(p_user uuid, p_season text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := coalesce(p_season, (select value ->> 'id' from economy_config where key = 'season'));
begin
  insert into forge_pass_state (user_id, season_id, owns_premium, premium_granted_at)
  values (p_user, v_season, true, now())
  on conflict (user_id, season_id) do update set owns_premium = true, premium_granted_at = now();
end;
$$;

revoke all on function grant_forge_pass(uuid, text) from public, authenticated;

-- The ONE place rewards are computed (21b). Challenge close and season close both call it.
-- Significance = difficulty × scope × duration × placement → a payout band.
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
begin
  -- Step 18 floor: unverified effort pays the completion floor and nothing else. A grant may only
  -- ride on already-counted, verified progress (§0.2).
  if not p_verified then
    perform economy_move_embers(p_user, 10, 'challenge_win', p_ref);
    return jsonb_build_object('embers', 10, 'box', null, 'band', 'completion');
  end if;

  v_sig := p_difficulty
         * greatest(1, log(greatest(p_scope, 1)::numeric + 1))
         * greatest(1, p_duration_days::numeric / 7)
         * greatest(0.2, 1 - coalesce(p_placement_pct, 1));

  if    v_sig >= 24 then v_embers := 1200; v_box := 'promethean';
  elsif v_sig >= 12 then v_embers := 600;  v_box := 'hephaestus';
  elsif v_sig >= 6  then v_embers := 300;  v_box := 'hestia';
  elsif v_sig >= 3  then v_embers := 150;  v_box := 'furnace';
  elsif v_sig >= 1  then v_embers := 60;   v_box := 'ignition';
  else                   v_embers := 25;   v_box := null;
  end if;

  perform economy_move_embers(p_user, v_embers, case when p_type = 'season' then 'season_reward' else 'challenge_win' end, p_ref);

  if v_box is not null then
    insert into loot_boxes (user_id, box_key, obtained_via, provenance)
    values (p_user, v_box, case when p_type = 'season' then 'season' else 'challenge' end,
            case when p_type = 'season' then 'Season reward' else 'Challenge reward' end);
  end if;

  return jsonb_build_object('embers', v_embers, 'box', v_box, 'significance', v_sig);
end;
$$;
