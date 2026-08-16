-- ============================================================================
-- Philoi — combined migration batch 0062–0075 (SUPERSEDES the 0062–0070 file)
-- Paste this whole file into Supabase → SQL Editor → Run. Runs as ONE transaction:
-- if anything errors, NOTHING applies. Fixes: equip, box opens, challenges + rollover,
-- week boundary, default loadout, Forge Pass season window + level claims, placement rewards.
-- Edge functions (send_uni_code/verify_uni_code) still need a separate CLI deploy.
-- After running, have Code: supabase migration repair --status applied 0062 0063 0064 0065 0066
--   0067 0068 0069 0070 0071 0072 0073 0074 0075
-- ============================================================================

begin;

-- ───────── 0062_university_email_verification.sql ─────────
-- University email verification (UNI_VERIFICATION_SPEC.md, design-mocks/75 + 76).
--
-- The uni email is a verified ATTRIBUTE on the existing OAuth user — never a login. Supabase
-- Auth's own OTP (signInWithOtp/verifyOtp) is a full sign-in: it would return a session for the
-- uni-email identity, switching the user to a different auth user and orphaning the profile
-- their Google/Apple session owns. So this is a custom code store that Auth never touches, read
-- and written only by the two Edge Functions running as service role.

alter table profiles
  add column if not exists university_email text,
  add column if not exists university_email_verified boolean not null default false,
  add column if not exists university_domain text;

comment on column profiles.university_domain is
  'Email domain for the chosen school (e.g. mylaurier.ca), from the shipped top-20 cache or the Hipolabs API. Null = school has no known domain, so it can never be verified — which must never block onboarding.';

-- One active code per user: a second send REPLACES the first (upsert on the pk), so an old code
-- can't stay valid alongside a new one.
create table if not exists uni_verification_codes (
  user_id uuid primary key references profiles (id) on delete cascade,
  email text not null,
  -- Never the plaintext code. A leaked table read must not hand out working codes.
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  last_sent_at timestamptz not null default now()
);

alter table uni_verification_codes enable row level security;

-- Deliberately NO policy of any kind. RLS with zero policies denies every client read and write,
-- which is exactly right here: the anon/authenticated roles must never see a code_hash, an
-- attempt count, or another user's pending email. The Edge Functions use the service role, which
-- bypasses RLS entirely.

-- ───────────────────────── verified-only campus boards ─────────────────────────
-- The selling point is that campus rankings are REAL, so the filter lives here and not only in
-- the client: an unverified account must not be able to appear on a campus board even through a
-- hand-rolled RPC call.
--
-- Dropped and recreated rather than replaced, matching how 0040 defines these — the bodies
-- change but the signatures don't, so this is belt-and-braces against the create-or-replace
-- return-type trap this project has hit before.

drop function if exists get_university_leaderboard(text, int);
create function get_university_leaderboard(p_university text, p_limit int default 50)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  score numeric,
  tier text,
  division int,
  check_ins_this_week bigint,
  rank int,
  is_me boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  with ranked as (
    select
      p.id as user_id, p.handle, p.display_name, p.avatar_url, p.is_pro,
      s.score, t.tier, t.division,
      coalesce((
        select count(*) from check_ins ci
        where ci.user_id = p.id and ci.created_at >= date_trunc('week', now())
      ), 0) as check_ins_this_week,
      row_number() over (order by s.score desc, p.display_name asc)::int as rank
    from profiles p
    cross join lateral (select universal_score(p.id) as score) s
    cross join lateral rank_tier_for_score(s.score) t
    where p.university = p_university
      and p.university_email_verified          -- new in 0062
      and not p.is_demo and not p.is_disabled
  )
  select r.*, (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

-- Vs. unis — the collective school ranking. Same rule: an unverified account contributes nothing
-- to its school's total, so a school can't be inflated by people who never proved they go there.
drop function if exists get_university_totals(int);
create function get_university_totals(p_limit int default 20)
returns table (university text, total_xp numeric, member_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.university,
    sum(universal_score(p.id)) as total_xp,
    count(*) as member_count
  from profiles p
  where p.university is not null
    and p.university_email_verified            -- new in 0062
    and p.is_demo = false
    and p.is_disabled = false                  -- was missing; a disabled account shouldn't score
  group by p.university
  order by total_xp desc
  limit p_limit;
$$;

-- ───────────────────────── changing school re-locks ─────────────────────────
-- Settings can change `university` directly (it's an ordinary profile update). A verified email
-- only proves the school it belongs to, so moving schools must drop the badge — otherwise
-- someone verifies at one campus and then re-points that verification at another. Enforced by
-- trigger rather than trusting every future caller to remember.
create or replace function reset_uni_verification_on_school_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.university is distinct from old.university then
    -- Only when the email no longer matches the new school's domain. Re-picking the SAME school
    -- from a different spelling shouldn't punish someone who is genuinely verified.
    if new.university_email is null
       or new.university_domain is null
       or lower(split_part(new.university_email, '@', 2)) <> lower(new.university_domain) then
      new.university_email_verified := false;
      new.university_email := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_reset_uni_verification on profiles;
create trigger profiles_reset_uni_verification
  before update of university on profiles
  for each row execute function reset_uni_verification_on_school_change();


-- ───────── 0063_rank_rework_primordial.sql ─────────
-- Rank rework: 10-tier Primordial ladder (RANK_REWORK_SPEC.md, design-mocks/77).
-- Steeper curve + four new legend tiers (hero/titan/olympian/immortal) + apex rename
-- infernal -> primordial. Table-driven: rank_tier_for_score/get_my_ranks are unchanged;
-- only the threshold DATA changes. Rank is derived from score, so no per-user migration.
-- Existing testers re-map downward on next read (expected, pre-launch).

-- Defensive: clear any rows beyond the new max index (old table maxed at 15).
delete from rank_thresholds where rank_index > 27;

insert into rank_thresholds (rank_index, tier, division, cumulative_xp_required) values
  (0,  'bronze',    3, 0),
  (1,  'bronze',    2, 900),
  (2,  'bronze',    1, 1800),
  (3,  'silver',    3, 2700),
  (4,  'silver',    2, 4200),
  (5,  'silver',    1, 5700),
  (6,  'gold',      3, 7200),
  (7,  'gold',      2, 9400),
  (8,  'gold',      1, 11600),
  (9,  'platinum',  3, 13800),
  (10, 'platinum',  2, 16700),
  (11, 'platinum',  1, 19600),
  (12, 'diamond',   3, 22500),
  (13, 'diamond',   2, 26200),
  (14, 'diamond',   1, 29900),
  (15, 'hero',      3, 33600),
  (16, 'hero',      2, 38400),
  (17, 'hero',      1, 43200),
  (18, 'titan',     3, 48000),
  (19, 'titan',     2, 54200),
  (20, 'titan',     1, 60400),
  (21, 'olympian',  3, 66600),
  (22, 'olympian',  2, 74800),
  (23, 'olympian',  1, 83000),
  (24, 'immortal',  3, 91200),
  (25, 'immortal',  2, 102200),
  (26, 'immortal',  1, 113200),
  -- Primordial: apex, singular/no divisions. division stored as 1 so ordinal arithmetic
  -- still orders it above Immortal I (same convention the old 'infernal' row used).
  (27, 'primordial', 1, 124200)
on conflict (rank_index) do update set
  tier = excluded.tier,
  division = excluded.division,
  cumulative_xp_required = excluded.cumulative_xp_required;


-- ───────── 0064_reward_economy_inventory.sql ─────────
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


-- ───────── 0065_economy_engine.sql ─────────
-- Turning the economy over (Step 21 follow-up P2): embers actually accrue, Pass XP actually
-- climbs, and grant_reward actually fires. 0064 built the vault; this fills it.
--
-- Everything here runs server-side off ALREADY-RECORDED effort. Nothing trusts a client call:
-- the entry points are triggers on lock_in_sessions / daily_fire / social_challenges, so a reward
-- can only ride on a row the server itself wrote (REWARD_ECONOMY §0.2, Step 18).

-- ───────────────────────────── config ─────────────────────────────

insert into economy_config (key, value) values
  -- Step 18's verified-effort floor. A session shorter than this pays nothing at all — it is the
  -- same floor the XP economy uses, restated here so no reward can outrun it.
  ('lock_in_min_seconds', '300'),
  -- Ember earn rates. `daily_cap` is the anti-grind rail: past it, extra lock-ins still earn XP
  -- and still climb the Pass, they just stop minting currency. Without it a marathon day could
  -- print more embers than an ember pack sells, which would gut the paid economy (§5 / 21e).
  ('ember_earn', '{"lock_in_base":15,"lock_in_per_10min":5,"lock_in_session_cap":60,"daily_cap":150,"flame_meter":50}')
on conflict (key) do nothing;

-- ───────────────────────────── internals ─────────────────────────────

-- credit_pass_xp() reads auth.uid(), which is null inside a trigger. This is the same logic with
-- the user passed in; the public RPC delegates here so there's exactly one implementation of the
-- once-per-period rule.
create or replace function economy_credit_pass_xp_for(
  p_user uuid, p_achievement text, p_xp int, p_period text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
  v_inserted int;
begin
  insert into pass_xp_ledger (user_id, season_id, achievement_key, xp, period_key)
  values (p_user, v_season, p_achievement, p_xp, p_period)
  on conflict (user_id, achievement_key, period_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return; end if;

  insert into forge_pass_state (user_id, season_id, pass_xp) values (p_user, v_season, p_xp)
  on conflict (user_id, season_id) do update set pass_xp = forge_pass_state.pass_xp + p_xp;
end;
$$;

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
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  perform economy_credit_pass_xp_for(v_user, p_achievement, p_xp, p_period);
  return coalesce((select pass_xp from forge_pass_state where user_id = v_user and season_id = v_season), 0);
end;
$$;

-- ───────────────────────────── P2a · ember earning ─────────────────────────────

create or replace function economy_award_lock_in_embers(p_user uuid, p_seconds int, p_ref uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb := (select value from economy_config where key = 'ember_earn');
  v_min int := (select value::int from economy_config where key = 'lock_in_min_seconds');
  v_award int;
  v_earned_today int;
  v_room int;
begin
  -- Below the floor this is not counted effort, so it cannot pay.
  if p_seconds is null or p_seconds < v_min then return; end if;

  v_award := least(
    (v_cfg ->> 'lock_in_session_cap')::int,
    (v_cfg ->> 'lock_in_base')::int + (p_seconds / 600) * (v_cfg ->> 'lock_in_per_10min')::int
  );

  -- Daily cap measured off the ledger itself rather than a counter column — the ledger is the
  -- record, and deriving from it means the cap can never drift out of sync with what was paid.
  select coalesce(sum(delta), 0) into v_earned_today
  from ember_ledger
  where user_id = p_user and reason = 'lock_in' and created_at >= date_trunc('day', now());

  v_room := greatest(0, (v_cfg ->> 'daily_cap')::int - v_earned_today);
  v_award := least(v_award, v_room);
  if v_award <= 0 then return; end if;

  perform economy_move_embers(p_user, v_award, 'lock_in', p_ref);
end;
$$;

-- ───────────────────────────── P2b · Pass XP achievement engine ─────────────────────────────
--
-- Detects checkpoint completion off already-recorded sessions. Every credit goes through
-- economy_credit_pass_xp_for, whose unique (user, achievement, period) index is what makes a daily
-- once-per-day — so this can be re-run as often as we like and will never double-pay.
--
-- NOT YET DETECTED (each needs signal this schema doesn't carry; the UI simply never ticks them):
--   daily_with_a_friend      — needs overlapping-session detection across a campfire
--   weekly_hit_goal          — needs per-goal cadence evaluation
--   season_new_rank          — needs rank history; rank is derived, never stored (see 0063)
create or replace function evaluate_pass_achievements(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day text := to_char(now(), 'YYYY-MM-DD');
  v_week text := to_char(now(), 'IYYY-"W"IW');
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
  v_min int := (select value::int from economy_config where key = 'lock_in_min_seconds');
  v_today_count int;
  v_today_deep boolean;
  v_today_gym boolean;
  v_today_types text[];
  v_yesterday_types text[];
  v_week_days int;
  v_week_seconds numeric;
  v_week_gym int;
  v_streak_days int;
begin
  -- ── daily ──
  select count(*),
         bool_or(extract(epoch from (s.last_confirmed_at - s.started_at)) >= 5400),
         bool_or(g.type ilike '%gym%'),
         array_agg(distinct g.type)
    into v_today_count, v_today_deep, v_today_gym, v_today_types
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= date_trunc('day', now())
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  if coalesce(v_today_count, 0) >= 1 then
    perform economy_credit_pass_xp_for(p_user, 'daily_first_lock_in', 50, v_day);
  end if;
  if coalesce(v_today_count, 0) >= 3 then
    perform economy_credit_pass_xp_for(p_user, 'daily_three_lock_ins', 75, v_day);
  end if;
  if coalesce(v_today_deep, false) then
    perform economy_credit_pass_xp_for(p_user, 'daily_deep_session', 100, v_day);
  end if;
  if coalesce(v_today_gym, false) then
    perform economy_credit_pass_xp_for(p_user, 'daily_gym_lock_in', 60, v_day);
  end if;

  -- "A different goal type than yesterday" — rewards varying what you do, which is the habit the
  -- app is actually trying to build (FORGE_PASS wellbeing note).
  select array_agg(distinct g.type) into v_yesterday_types
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= date_trunc('day', now()) - interval '1 day'
    and s.started_at < date_trunc('day', now());

  if v_today_types is not null and v_yesterday_types is not null
     and exists (select 1 from unnest(v_today_types) t where t <> all(v_yesterday_types)) then
    perform economy_credit_pass_xp_for(p_user, 'daily_different_goal', 40, v_day);
  end if;

  -- ── weekly ──
  select count(distinct s.started_at::date),
         coalesce(sum(extract(epoch from (s.last_confirmed_at - s.started_at))), 0),
         count(*) filter (where g.type ilike '%gym%')
    into v_week_days, v_week_seconds, v_week_gym
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= date_trunc('week', now())
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  if coalesce(v_week_days, 0) >= 6 then
    perform economy_credit_pass_xp_for(p_user, 'weekly_six_active_days', 300, v_week);
  end if;
  if coalesce(v_week_seconds, 0) >= 36000 then
    perform economy_credit_pass_xp_for(p_user, 'weekly_ten_hours', 250, v_week);
  end if;
  if coalesce(v_week_gym, 0) >= 5 then
    perform economy_credit_pass_xp_for(p_user, 'weekly_five_gym', 200, v_week);
  end if;

  -- ── season ──
  select count(distinct s.started_at::date) into v_streak_days
  from lock_in_sessions s
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= now() - interval '30 days';

  if coalesce(v_streak_days, 0) >= 30 then
    perform economy_credit_pass_xp_for(p_user, 'season_thirty_day_streak', 500, v_season);
  end if;
end;
$$;

-- ───────────────────────────── triggers: the only entry points ─────────────────────────────

create or replace function economy_on_lock_in_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds int;
begin
  -- Only the transition INTO completed. Without this guard any later touch of a finished row
  -- would pay again.
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  v_seconds := greatest(0, extract(epoch from (new.last_confirmed_at - new.started_at))::int);
  perform economy_award_lock_in_embers(new.user_id, v_seconds, new.id);
  perform evaluate_pass_achievements(new.user_id);
  return new;
end;
$$;

drop trigger if exists lock_in_sessions_economy on lock_in_sessions;
create trigger lock_in_sessions_economy
  after update of status on lock_in_sessions
  for each row execute function economy_on_lock_in_completed();

-- Flame-meter completion. publish_flame_completion() only publishes a post — it has never granted
-- embers — so the grant hangs off daily_fire flipping complete, which is where the actual
-- achievement happens regardless of whether the user chooses to share it.
create or replace function economy_on_flame_meter_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.completed or coalesce(old.completed, false) then
    return new;
  end if;
  perform economy_move_embers(
    new.user_id,
    ((select value from economy_config where key = 'ember_earn') ->> 'flame_meter')::int,
    'flame_meter',
    null
  );
  return new;
end;
$$;

drop trigger if exists daily_fire_economy on daily_fire;
create trigger daily_fire_economy
  after update of completed on daily_fire
  for each row execute function economy_on_flame_meter_complete();

-- ───────────────────────────── P2c · grant_reward wiring ─────────────────────────────

-- Social challenge close (21c). finalize_social_challenges() sets status = 'completed' and, for
-- h2h, winner_id — so that transition is the hook. Group mode has no single winner, so everyone
-- who took part is paid at the completion band and the winner bonus is h2h-only.
create or replace function economy_on_social_challenge_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int;
  v_scope int;
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  v_days := greatest(1, ceil(new.window_hours / 24.0)::int);

  if new.mode = 'h2h' then
    v_scope := 1;
    if new.winner_id is not null then
      perform grant_reward(new.winner_id, 'friend_h2h', 1.0, v_days, v_scope, 0.0, true, new.id);
      -- The loser still finished the thing. Completion band only — placement 1.0 is last place.
      perform grant_reward(
        case when new.winner_id = new.created_by then new.opponent_id else new.created_by end,
        'friend_h2h', 1.0, v_days, v_scope, 1.0, true, new.id
      );
    end if;
  else
    -- Group mode has no participants table. Membership alone isn't participation either — being
    -- in the campfire while the challenge ran shouldn't pay. So a participant is someone who
    -- actually completed a qualifying lock-in inside the window, which is the same
    -- verified-effort signal everything else in this file keys off (Step 18).
    if new.circle_id is null then return new; end if;

    with participants as (
      select distinct s.user_id
      from lock_in_sessions s
      join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
      where s.status = 'completed'
        and s.started_at >= new.starts_at
        and s.started_at <= coalesce(new.ends_at, now())
        and extract(epoch from (s.last_confirmed_at - s.started_at))
            >= (select value::int from economy_config where key = 'lock_in_min_seconds')
    )
    select count(*) into v_scope from participants;

    -- Real percentile placement needs the per-member standings the watch RPCs compute; until
    -- that's factored out of the read path, everyone lands on the completion band rather than
    -- being handed a guessed rank.
    perform grant_reward(pt.user_id, 'campfire_group', 1.0, v_days, greatest(v_scope, 1), 0.75, true, new.id)
    from (
      select distinct s.user_id
      from lock_in_sessions s
      join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
      where s.status = 'completed'
        and s.started_at >= new.starts_at
        and s.started_at <= coalesce(new.ends_at, now())
        and extract(epoch from (s.last_confirmed_at - s.started_at))
            >= (select value::int from economy_config where key = 'lock_in_min_seconds')
    ) pt;
  end if;

  return new;
end;
$$;

drop trigger if exists social_challenges_economy on social_challenges;
create trigger social_challenges_economy
  after update of status on social_challenges
  for each row execute function economy_on_social_challenge_closed();

-- Personal goal challenges — the solo `challenges` table. No opponents, so scope is 1 and the
-- payout rides on duration alone, which is what §4a's "scale by difficulty × duration" reduces to
-- when there's nobody to place against.
create or replace function economy_on_challenge_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;
  perform grant_reward(
    new.user_id, 'friend_h2h', 1.0,
    case when new.period = 'week' then 7 else 1 end,
    1, 0.0, true, new.id
  );
  perform evaluate_pass_achievements(new.user_id);
  return new;
end;
$$;

drop trigger if exists challenges_economy on challenges;
create trigger challenges_economy
  after update of completed_at on challenges
  for each row execute function economy_on_challenge_completed();

-- Season close (21d). Deliberately NOT a trigger: a season ends when we say it does, and it pays
-- every ranked user at once. Service-role only — no grant to `authenticated`, so nobody can close
-- a season (or re-close one to farm it) from the client.
create or replace function close_season_rewards(p_university text default null, p_limit int default 500)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid int := 0;
  r record;
begin
  for r in
    select p.id as user_id,
           row_number() over (order by universal_score(p.id) desc) as rank,
           count(*) over () as board_size
    from profiles p
    where not p.is_demo and not p.is_disabled
      and (p_university is null or (p.university = p_university and p.university_email_verified))
    limit p_limit
  loop
    perform grant_reward(
      r.user_id, 'season', 1.0, 90, r.board_size::int,
      (r.rank::numeric / greatest(r.board_size, 1)), true, null
    );
    v_paid := v_paid + 1;
  end loop;
  return v_paid;
end;
$$;

revoke all on function close_season_rewards(text, int) from public, authenticated;

-- ───────────────────────────── reads the client needs ─────────────────────────────

-- Other people's equipped cosmetics. get_inventory is own-rows-only by design, but "how others
-- see you" is the entire point of a loadout — so this exposes ONLY the equipped cosmetic keys of
-- the users asked for. No balances, no unopened boxes, no provenance, nothing sellable.
drop function if exists get_public_loadouts(uuid[]);
create function get_public_loadouts(p_user_ids uuid[])
returns table (user_id uuid, slot text, cosmetic_key text)
language sql
security definer
set search_path = public
stable
as $$
  select c.user_id, c.slot, c.cosmetic_key
  from cosmetics_owned c
  join profiles p on p.id = c.user_id
  where c.user_id = any(p_user_ids)
    and c.equipped
    and c.slot is not null
    and not p.is_disabled;
$$;

-- Live achievement progress for the Pass XP tab, so the list shows "2 / 3" off real data instead
-- of only a claimed/unclaimed tick.
drop function if exists get_pass_achievement_progress();
create function get_pass_achievement_progress()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_min int := (select value::int from economy_config where key = 'lock_in_min_seconds');
  v_today int;
  v_week_days int;
  v_week_seconds numeric;
  v_week_gym int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  select count(*) into v_today
  from lock_in_sessions s
  where s.user_id = v_user and s.status = 'completed'
    and s.started_at >= date_trunc('day', now())
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  select count(distinct s.started_at::date),
         coalesce(sum(extract(epoch from (s.last_confirmed_at - s.started_at))), 0),
         count(*) filter (where g.type ilike '%gym%')
    into v_week_days, v_week_seconds, v_week_gym
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = v_user and s.status = 'completed'
    and s.started_at >= date_trunc('week', now())
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  return jsonb_build_object(
    'daily_three_lock_ins', coalesce(v_today, 0),
    'weekly_six_active_days', coalesce(v_week_days, 0),
    'weekly_ten_hours', round(coalesce(v_week_seconds, 0) / 3600.0, 1),
    'weekly_five_gym', coalesce(v_week_gym, 0)
  );
end;
$$;


-- ───────── 0066_prestige_and_season_close.sql ─────────
-- Step 21 final pass: the PRESTIGE half of the reward economy.
--
-- 0064 built the vault, 0065 made embers and Pass XP flow. What was still missing is the thing
-- REWARD_ECONOMY §5 says actually matters: "earned rewards skew to prestige". Until now a season
-- win paid embers and a box — the same currency you can buy — and none of the un-buyable status
-- that makes earning worth it. This emits the badges and the 21j placement titles.
--
-- Invariant restated: every title and badge below is source='earned'. §8.4 keeps `earned` out of
-- the direct-buy pool by construction, so nothing here can ever be bought.

-- ───────────────────────── owned-item metadata for placement grants ─────────────────────────

-- 21j needs two things the catalog alone can't express, because the SAME title id is granted at
-- different scopes with different weight:
--   • rarity_override — "percentile titles read one rarity notch hotter at Global". A Top 1% at
--     MIT and a Top 1% globally are the same item with different prestige.
--   • season_stamp    — "Ascended · S1", "🌍 GLOBAL #1", "MIT · TOP 1%". Renders next to the name.
-- Both null for ordinary box drops, which is every cosmetic that isn't a placement award.
alter table cosmetics_owned
  add column if not exists rarity_override text,
  add column if not exists season_stamp text;

comment on column cosmetics_owned.rarity_override is
  'Placement grants only (21j). Overrides the catalog rarity for display AND salvage value — a Global Top 1% is worth more than a campus one. Null everywhere else.';

-- ───────────────────────── rank index (for rank-up events) ─────────────────────────

create or replace function rank_index_for_score(p_score numeric)
returns int
language sql
stable
set search_path = public
as $$
  select rt.rank_index
  from rank_thresholds rt
  where rt.cumulative_xp_required <= p_score
  order by rt.cumulative_xp_required desc
  limit 1;
$$;

-- Rank is DERIVED and never stored (0063), which is why `season_new_rank` was undetectable: there
-- was nothing to diff against. This is the minimum state needed to notice a crossing — one row per
-- user holding the last index we saw. It is NOT a second source of truth for rank; universal_score
-- remains authoritative and this is only a high-water mark.
create table if not exists user_rank_state (
  user_id uuid primary key references profiles (id) on delete cascade,
  rank_index int not null,
  updated_at timestamptz not null default now()
);

alter table user_rank_state enable row level security;
drop policy if exists user_rank_state_read_own on user_rank_state;
create policy user_rank_state_read_own on user_rank_state for select to authenticated using (user_id = auth.uid());

create table if not exists rank_up_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  from_rank_index int,
  to_rank_index int not null,
  from_tier text,
  from_division int,
  to_tier text not null,
  to_division int not null,
  season_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists rank_up_events_user_idx on rank_up_events (user_id, created_at desc);

alter table rank_up_events enable row level security;
drop policy if exists rank_up_events_read_own on rank_up_events;
create policy rank_up_events_read_own on rank_up_events for select to authenticated using (user_id = auth.uid());

-- Fires off a check-in, which is the only thing that moves universal_score. Records ONLY ordinal
-- increases — a score that dips (decay, a deleted check-in) must never emit a "rank up".
create or replace function economy_track_rank_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score numeric;
  v_index int;
  v_prev int;
  v_from record;
  v_to record;
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
begin
  v_score := universal_score(new.user_id);
  v_index := rank_index_for_score(v_score);
  if v_index is null then return new; end if;

  select rank_index into v_prev from user_rank_state where user_id = new.user_id;

  insert into user_rank_state (user_id, rank_index) values (new.user_id, v_index)
  on conflict (user_id) do update set rank_index = greatest(user_rank_state.rank_index, excluded.rank_index),
                                      updated_at = now();

  -- First sighting establishes the baseline without claiming a rank-up for the whole history.
  if v_prev is null or v_index <= v_prev then return new; end if;

  select tier, division into v_to from rank_thresholds where rank_index = v_index;
  select tier, division into v_from from rank_thresholds where rank_index = v_prev;

  insert into rank_up_events (user_id, from_rank_index, to_rank_index, from_tier, from_division, to_tier, to_division, season_id)
  values (new.user_id, v_prev, v_index, v_from.tier, v_from.division, v_to.tier, v_to.division, v_season);

  perform economy_credit_pass_xp_for(new.user_id, 'season_new_rank', 500, v_season);
  return new;
end;
$$;

drop trigger if exists check_ins_rank_tracking on check_ins;
create trigger check_ins_rank_tracking
  after insert on check_ins
  for each row execute function economy_track_rank_change();

-- ───────────────────────── prestige grants ─────────────────────────

-- One place badges are minted. Idempotent on (user, badge_key), so a season badge whose key
-- carries the season stamp can never be double-granted on a re-run.
create or replace function economy_grant_badge(
  p_user uuid, p_key text, p_provenance text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into owned_badges (user_id, badge_key, source, provenance)
  values (p_user, p_key, 'earned', p_provenance)
  on conflict (user_id, badge_key) do nothing;
end;
$$;

-- Placement titles (21j). Earn-only, season-stamped, never re-issued.
create or replace function economy_grant_title(
  p_user uuid, p_item_key text, p_provenance text, p_stamp text, p_rarity_override text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into cosmetics_owned (user_id, cosmetic_key, slot, source, provenance, season_stamp, rarity_override)
  values (p_user, p_item_key, 'title', 'earned', p_provenance, p_stamp, p_rarity_override)
  on conflict (user_id, cosmetic_key) do nothing;
end;
$$;

-- grant_reward, now emitting prestige. Same signature as 0064 (full param list on the drop), so
-- every existing caller and trigger keeps working — the return object just gains `badge`.
drop function if exists grant_reward(uuid, text, numeric, int, int, numeric, boolean, uuid);
create function grant_reward(
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
  v_badge text;
  v_band text;
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
begin
  if not p_verified then
    perform economy_move_embers(p_user, 10, 'challenge_win', p_ref);
    return jsonb_build_object('embers', 10, 'box', null, 'badge', null, 'band', 'completion');
  end if;

  v_sig := p_difficulty
         * greatest(1, log(greatest(p_scope, 1)::numeric + 1))
         * greatest(1, p_duration_days::numeric / 7)
         * greatest(0.2, 1 - coalesce(p_placement_pct, 1));

  if    v_sig >= 24 then v_embers := 1200; v_box := 'promethean';  v_band := 'apex';
  elsif v_sig >= 12 then v_embers := 600;  v_box := 'hephaestus';  v_band := 'elite';
  elsif v_sig >= 6  then v_embers := 300;  v_box := 'hestia';      v_band := 'impressive';
  elsif v_sig >= 3  then v_embers := 150;  v_box := 'furnace';     v_band := 'notable';
  elsif v_sig >= 1  then v_embers := 60;   v_box := 'ignition';    v_band := 'casual';
  else                   v_embers := 25;   v_box := null;          v_band := 'completion';
  end if;

  perform economy_move_embers(p_user, v_embers, case when p_type = 'season' then 'season_reward' else 'challenge_win' end, p_ref);

  if v_box is not null then
    insert into loot_boxes (user_id, box_key, obtained_via, provenance)
    values (p_user, v_box, case when p_type = 'season' then 'season' else 'challenge' end,
            case when p_type = 'season' then 'Season reward · ' || v_season else 'Challenge reward' end);
  end if;

  -- The prestige half (§5 / 21c): the top two bands mint an UN-BUYABLE earned badge. This is what
  -- the biggest wins are actually for — the embers above are the same currency anyone can buy, so
  -- on their own they'd make a season win feel purchasable.
  if v_band in ('elite', 'apex') then
    v_badge := case
      when p_type = 'season' then 'season-' || v_band || '-' || v_season
      else 'challenge-' || v_band
    end;
    perform economy_grant_badge(
      p_user, v_badge,
      case when p_type = 'season'
        then 'Season ' || v_season || ' · ' || initcap(v_band) || ' finish'
        else initcap(v_band) || ' challenge win'
      end
    );
  end if;

  return jsonb_build_object('embers', v_embers, 'box', v_box, 'badge', v_badge, 'band', v_band, 'significance', v_sig);
end;
$$;

-- ───────────────────────── daily_with_a_friend ─────────────────────────
-- The last undetectable daily. "Lock in with a friend / in a campfire" means your session actually
-- OVERLAPPED theirs — not merely that you both used the app today, which would fire for everyone.

create or replace function economy_locked_in_with_friend(p_user uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from lock_in_sessions me
    join friend_requests fr
      on fr.status = 'accepted'
     and (fr.requester_id = me.user_id or fr.recipient_id = me.user_id)
    join lock_in_sessions them
      on them.user_id = case when fr.requester_id = me.user_id then fr.recipient_id else fr.requester_id end
    where me.user_id = p_user
      and me.started_at >= date_trunc('day', now())
      and them.started_at >= date_trunc('day', now()) - interval '1 day'
      -- Real overlap: each started before the other finished.
      and me.started_at <= them.last_confirmed_at
      and them.started_at <= me.last_confirmed_at
  );
$$;

-- Replaces 0065's version to add the friend check. Kept as an override of the TRIGGER function
-- rather than re-declaring the whole 200-line evaluate_pass_achievements — one small addition
-- shouldn't mean maintaining two copies of the achievement engine.
create or replace function economy_on_lock_in_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds int;
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  v_seconds := greatest(0, extract(epoch from (new.last_confirmed_at - new.started_at))::int);
  perform economy_award_lock_in_embers(new.user_id, v_seconds, new.id);
  perform evaluate_pass_achievements(new.user_id);

  if economy_locked_in_with_friend(new.user_id) then
    perform economy_credit_pass_xp_for(
      new.user_id, 'daily_with_a_friend', 50, to_char(now(), 'YYYY-MM-DD')
    );
  end if;

  return new;
end;
$$;

-- ───────────────────────── group-challenge percentiles ─────────────────────────
-- Replaces the flat completion band. Standings are computed from the same verified signal the
-- watch screens rank on: qualifying lock-ins inside the window. Falls back to the completion band
-- when there aren't enough participants for a placement to mean anything.

create or replace function economy_on_social_challenge_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int;
  v_min int := (select value::int from economy_config where key = 'lock_in_min_seconds');
  v_count int;
  r record;
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  v_days := greatest(1, ceil(new.window_hours / 24.0)::int);

  if new.mode = 'h2h' then
    if new.winner_id is not null then
      perform grant_reward(new.winner_id, 'friend_h2h', 1.0, v_days, 1, 0.0, true, new.id);
      perform grant_reward(
        case when new.winner_id = new.created_by then new.opponent_id else new.created_by end,
        'friend_h2h', 1.0, v_days, 1, 1.0, true, new.id
      );
    end if;
    return new;
  end if;

  if new.circle_id is null then return new; end if;

  -- Deliberately a CTE in the loop query rather than a temp table: a temp table created inside a
  -- row-level trigger persists for the whole transaction, so a batch close that fires this trigger
  -- for several challenges at once would have them stomping each other's standings.
  for r in
    with participants as (
      select s.user_id,
             count(*)::int as lockins,
             sum(extract(epoch from (s.last_confirmed_at - s.started_at))) as seconds
      from lock_in_sessions s
      join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
      where s.status = 'completed'
        and s.started_at >= new.starts_at
        and s.started_at <= coalesce(new.ends_at, now())
        and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min
      group by s.user_id
    )
    select user_id,
           row_number() over (order by lockins desc, seconds desc)::int as place,
           count(*) over ()::int as total
    from participants
  loop
    v_count := r.total;
    perform grant_reward(
      r.user_id, 'campfire_group', 1.0, v_days, v_count,
      -- Fallback: with one participant there is no field to place against, so pay completion.
      case when v_count < 2 then 0.75 else (r.place::numeric / v_count) end,
      true, new.id
    );
    -- Campfire podium caps at EPIC (21j) — a six-person campfire #1 is not a god, so the
    -- god-tier names (Demigod / Titan / Ascended) never appear off this board.
    if r.place = 1 and v_count >= 3 then
      perform economy_grant_title(
        r.user_id, 'title-campfire-champion',
        'First in a campfire challenge',
        '🔥 CAMPFIRE #1',
        null
      );
    end if;
  end loop;

  return new;
end;
$$;

-- ───────────────────────── season close (21d + 21j) ─────────────────────────

-- Idempotence guard: a season closes exactly once per scope, whatever re-runs the cron does.
create table if not exists season_closures (
  season_id text not null,
  scope text not null,
  scope_key text not null default '',
  closed_at timestamptz not null default now(),
  primary key (season_id, scope, scope_key)
);

alter table season_closures enable row level security;
-- No policy: nothing about closure bookkeeping belongs to a client.

drop function if exists close_season_rewards(text, int);

/**
 * Individual placement close for one board scope.
 *   p_scope = 'uni'    → p_key is the university; rank 1 gets Mythic "Ascended"
 *   p_scope = 'global' → whole app; rank 1 gets the 1-of-1 "Ascended · Global"
 * Percentile titles carry the scope stamp and read one rarity notch hotter at Global (21j).
 */
create or replace function close_season_scope(p_season text, p_scope text, p_key text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid int := 0;
  v_hotter boolean := (p_scope = 'global');
  v_stamp_prefix text := case when p_scope = 'global' then '🌍 GLOBAL' else '🎓 ' || upper(coalesce(p_key, '')) end;
  r record;
  v_pct numeric;
  v_title text;
  v_override text;
begin
  insert into season_closures (season_id, scope, scope_key)
  values (p_season, p_scope, coalesce(p_key, ''))
  on conflict do nothing;
  if not found then return 0; end if;

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

    v_title := null;
    v_override := null;

    if r.rank = 1 then
      -- Global #1 is the single rarest cosmetic in Philoi — one person per season.
      v_title := case when p_scope = 'global' then 'title-ascended-global' else 'title-ascended' end;
    elsif r.rank = 2 then v_title := 'title-titan';
    elsif r.rank = 3 then v_title := 'title-demigod';
    elsif v_pct <= 0.01 then
      v_title := 'title-the-untouchable';
      if v_hotter then v_override := 'legendary'; end if;
    elsif v_pct <= 0.05 then
      v_title := 'title-elite-ember';
      if v_hotter then v_override := 'legendary'; end if;
    elsif v_pct <= 0.10 then
      v_title := 'title-ashborne';
      if v_hotter then v_override := 'legendary'; end if;
    elsif v_pct <= 0.50 then
      v_title := 'title-kept-the-fire';
      if v_hotter then v_override := 'epic'; end if;
    end if;

    if v_title is not null then
      perform economy_grant_title(
        r.user_id, v_title,
        'Season ' || p_season || ' · ' || p_scope || ' placement #' || r.rank,
        v_stamp_prefix || ' ' ||
          case when r.rank <= 3 then '#' || r.rank
               when v_pct <= 0.01 then '· TOP 1%'
               when v_pct <= 0.05 then '· TOP 5%'
               when v_pct <= 0.10 then '· TOP 10%'
               else '· TOP 50%' end
          || ' · ' || p_season,
        v_override
      );
    end if;

    v_paid := v_paid + 1;
  end loop;

  return v_paid;
end;
$$;

/**
 * Vs-Unis is COLLECTIVE (21j): the SCHOOL places, not the person. Every contributing member of a
 * top-3 university earns the shared campus title; the season's top contributors get the ★
 * Legendary variant. Nobody ever earns "Ascended" off this board — it's a team win.
 */
create or replace function close_season_vs_unis(p_season text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid int := 0;
  u record;
  m record;
  v_title text;
  v_contributors int;
begin
  insert into season_closures (season_id, scope, scope_key) values (p_season, 'vs_unis', '')
  on conflict do nothing;
  if not found then return 0; end if;

  for u in
    select p.university, sum(universal_score(p.id)) as total,
           row_number() over (order by sum(universal_score(p.id)) desc) as place
    from profiles p
    where p.university is not null and p.university_email_verified
      and not p.is_demo and not p.is_disabled
    group by p.university
    order by total desc
    limit 3
  loop
    v_title := case u.place
      when 1 then 'title-prometheus-disciples'
      when 2 then 'title-keepers-of-the-flame'
      else 'title-champions-of-academia'
    end;

    select greatest(1, (count(*) * 0.1)::int) into v_contributors
    from profiles p
    where p.university = u.university and p.university_email_verified and not p.is_demo and not p.is_disabled;

    for m in
      select p.id as user_id,
             row_number() over (order by universal_score(p.id) desc) as contrib_rank
      from profiles p
      where p.university = u.university and p.university_email_verified
        and not p.is_demo and not p.is_disabled
    loop
      perform economy_grant_title(
        m.user_id, v_title,
        'Season ' || p_season || ' · ' || u.university || ' finished #' || u.place || ' among all schools',
        '🎓 ' || upper(u.university) || ' #' || u.place || ' · ' || p_season,
        -- ★ Legendary variant for the season's top contributors to their school's score.
        case when m.contrib_rank <= v_contributors then 'legendary' else null end
      );
      v_paid := v_paid + 1;
    end loop;
  end loop;

  return v_paid;
end;
$$;

-- The whole close, on the ONE season clock. Reads `ends_at` off the same economy_config('season')
-- row the Forge Pass reads, so the leaderboard reset, the Pass reset, and this can never drift.
create or replace function close_season_if_due()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb := (select value from economy_config where key = 'season');
  v_season text := v_cfg ->> 'id';
  v_ends timestamptz := (v_cfg ->> 'ends_at')::timestamptz;
  v_uni record;
  v_total int := 0;
begin
  if v_ends is null or now() < v_ends then
    return 'not due';
  end if;
  if exists (select 1 from season_closures where season_id = v_season and scope = 'global') then
    return 'already closed';
  end if;

  v_total := v_total + close_season_scope(v_season, 'global', null);
  for v_uni in
    select distinct university from profiles
    where university is not null and university_email_verified and not is_demo and not is_disabled
  loop
    v_total := v_total + close_season_scope(v_season, 'uni', v_uni.university);
  end loop;
  v_total := v_total + close_season_vs_unis(v_season);

  return 'closed ' || v_season || ' · ' || v_total || ' grants';
end;
$$;

revoke all on function close_season_scope(text, text, text) from public, authenticated;
revoke all on function close_season_vs_unis(text) from public, authenticated;
revoke all on function close_season_if_due() from public, authenticated;

-- Give S1 an end date so the clock exists. Tunable like everything else in economy_config.
update economy_config
   set value = value || jsonb_build_object('ends_at', (now() + interval '90 days')::text)
 where key = 'season' and not (value ? 'ends_at');

-- Daily check rather than a one-shot at an exact timestamp: a missed tick just closes a few hours
-- late instead of never, and close_season_if_due is idempotent so extra ticks cost nothing.
select cron.unschedule('philoi-season-close') where exists (select 1 from cron.job where jobname = 'philoi-season-close');
select cron.schedule('philoi-season-close', '15 3 * * *', $$select close_season_if_due();$$);


-- ───────── 0067_inventory_placement_fields.sql ─────────
-- 0066 added cosmetics_owned.rarity_override / season_stamp for the 21j placement grants, but the
-- read paths were still built in 0064/0065 and don't select them — so a "Ascended · 🌍 GLOBAL #1"
-- would have rendered as a plain "Ascended". These are the two reads, updated.

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
        'acquired_at', c.acquired_at,
        -- New in 0066: placement grants override the catalog rarity and carry a season stamp.
        'rarity_override', c.rarity_override, 'season_stamp', c.season_stamp
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

-- Other people's equipped set. Still keys only — no balances, no unopened boxes, nothing sellable.
-- The stamp and rarity override ARE public, because a season title without its "🌍 GLOBAL #1" is
-- exactly the flex it exists to carry.
drop function if exists get_public_loadouts(uuid[]);
create function get_public_loadouts(p_user_ids uuid[])
returns table (user_id uuid, slot text, cosmetic_key text, rarity_override text, season_stamp text)
language sql
security definer
set search_path = public
stable
as $$
  select c.user_id, c.slot, c.cosmetic_key, c.rarity_override, c.season_stamp
  from cosmetics_owned c
  join profiles p on p.id = c.user_id
  where c.user_id = any(p_user_ids)
    and c.equipped
    and c.slot is not null
    and not p.is_disabled;
$$;


-- ───────── 0068_lock_in_sourced_challenges.sql ─────────
-- study_hours and gym_visits auto-update from the user's OWN lock-ins.
--
-- Both were dead metrics: syncChallengeFromDevice only routed steps→pedometer, run/ride→Strava and
-- workout/strain/sleep→Whoop, so a study or gym goal sat at zero unless it was logged by hand —
-- even though the app already records exactly the check-ins that should credit them.
--
-- ANTI-CHEESE IS NOT BYPASSED. Both sums run through check_in_qualifies_for_challenge, which
-- requires ≥20 minutes and, for gym specifically, a photo or logged sets. A bare gym timer with
-- nothing to show for it must never count as a visit.

/**
 * Credits a lock-in-sourced challenge from qualifying check-ins in [period_start, now].
 *
 * DELTA-TRACKED rather than assigning progress outright. A plain `progress = <sum>` is idempotent
 * in isolation, but challenges.progress is shared with the manual-log path — overwriting it would
 * silently erase anything the user logged by hand, and this metric is one people DO log manually
 * (a library session on a dead phone). Logging the difference through log_challenge_progress
 * instead reuses the completion timestamp + campfire feed event, stays idempotent because the
 * total is recomputed from source every call, and leaves manual entries intact.
 *
 * Note-tagged with its own source string, the same mechanism the steps/Strava/Whoop syncs use to
 * read back what they specifically have already contributed.
 */
drop function if exists sync_challenge_from_lock_ins(uuid);
create function sync_challenge_from_lock_ins(p_challenge_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge challenges;
  v_note text := 'Auto-synced from your lock-ins';
  v_goal_type text;
  v_total numeric;
  v_already numeric;
  v_delta numeric;
begin
  select * into v_challenge
  from challenges
  where id = p_challenge_id and user_id = auth.uid();

  if v_challenge.id is null then
    raise exception 'Challenge not found.';
  end if;
  if v_challenge.completed_at is not null then
    return 0;
  end if;

  v_goal_type := case v_challenge.type
    when 'study_hours' then 'study'
    when 'gym_visits' then 'gym'
    else null
  end;
  if v_goal_type is null then
    return 0;
  end if;

  select
    case
      -- Hours, not seconds: the challenge's unit is hours, so the conversion belongs here rather
      -- than in the client where it could drift from the target's unit.
      when v_challenge.type = 'study_hours' then coalesce(sum(ci.duration_seconds), 0) / 3600.0
      else count(*)
    end
    into v_total
  from check_ins ci
  where ci.user_id = v_challenge.user_id
    and ci.goal_type = v_goal_type
    and ci.removed_at is null
    and ci.created_at >= v_challenge.period_start
    and ci.created_at <= now()
    and check_in_qualifies_for_challenge(ci.id);

  -- Scoped to the current period, exactly like syncStepsFromDevice: a daily goal resets, so an
  -- all-time sum of prior logs would exceed today's total and drive the delta negative.
  select coalesce(sum(amount), 0) into v_already
  from challenge_logs
  where challenge_id = p_challenge_id
    and note = v_note
    and created_at >= v_challenge.period_start;

  v_delta := coalesce(v_total, 0) - v_already;
  -- Study hours are fractional; rounding to 2dp stops float noise logging 0.0000001-hour entries.
  if v_challenge.type = 'study_hours' then
    v_delta := round(v_delta, 2);
  end if;

  if v_delta <= 0 then
    return 0;
  end if;

  perform log_challenge_progress(p_challenge_id, v_delta, v_note);
  return v_delta;
end;
$$;


-- ───────── 0069_open_loot_box_rarity_pool.sql ─────────
-- Punchlist 8 §1 — open_loot_box was picking its item from the WHOLE cross-rarity pool.
--
-- 0064 documented p_pool as "the caller's candidate item ids AT THAT RARITY", but the client cannot
-- know the rarity before it calls (the server rolls it), so src/lib/api/inventory.ts sent every
-- rarity's ids concatenated into one flat array. The body then did
--
--   select p into v_pick from unnest(p_pool) p order by random() limit 1;
--
-- which picks uniformly across all ~61 box items with no reference to v_rarity, and grants it
-- labelled with v_rarity anyway. Two things break from that:
--
--   1. The published odds are a lie in the direction that matters most. An 8,000-ember Promethean
--      rolls Mythic 12% of the time and then hands over whatever the flat pick landed on — Common
--      included. `rolled_rarity` and the item's real catalog rarity disagree on nearly every open.
--   2. Salvage is mispriced. economy_grant_cosmetic is paid p_rarity, not the item's own rarity, so
--      a dupe Common pulled from a Mythic roll auto-salvages for the Mythic payout (2,000 embers
--      against a 40-ember item) — an ember faucet straight through the flagship box.
--
-- Fixed by making the pool a rarity -> ids MAP. The server still owns the roll and still chooses
-- WHICH item within the tier; the client just can't collapse the tiers any more. Sending the map
-- rather than moving the catalog into Postgres keeps 0064's original trade-off intact.
--
-- Signature change (text[] -> jsonb), so the old overload is DROPPED, not replaced: leaving both
-- would give PostgREST two candidates to resolve between and old clients would keep hitting the
-- broken one.

drop function if exists open_loot_box(uuid, text[]);
drop function if exists open_loot_box(uuid, jsonb);

create function open_loot_box(p_box_id uuid, p_pool jsonb)
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
  v_bucket jsonb;
  -- Descending, so a tier this build's catalog can't fill steps DOWN to the next one it can.
  v_ladder text[] := array['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
  v_i int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  if p_pool is null or jsonb_typeof(p_pool) <> 'object' then
    raise exception 'Drop pool must be a rarity -> item-id object';
  end if;

  -- Locked so a double-tap can't open the same box twice.
  select * into v_box from loot_boxes where id = p_box_id and user_id = v_user and not opened for update;
  if v_box.id is null then raise exception 'Box not found or already opened'; end if;

  v_rarity := economy_roll_rarity(v_user, v_box.box_key);
  v_bucket := p_pool -> v_rarity;

  -- A rolled tier with no items in it is a catalog/app-version mismatch, not a user error, and the
  -- box has already been paid for. Step down to the nearest tier that CAN be filled and report that
  -- as rolled_rarity, so the grant, the salvage price and what the screen shows all agree.
  if v_bucket is null or jsonb_typeof(v_bucket) <> 'array' or jsonb_array_length(v_bucket) = 0 then
    for v_i in coalesce(array_position(v_ladder, v_rarity), 1) + 1 .. array_length(v_ladder, 1) loop
      if jsonb_typeof(p_pool -> v_ladder[v_i]) = 'array'
         and jsonb_array_length(p_pool -> v_ladder[v_i]) > 0 then
        v_rarity := v_ladder[v_i];
        v_bucket := p_pool -> v_rarity;
        exit;
      end if;
    end loop;
  end if;

  if v_bucket is null or jsonb_typeof(v_bucket) <> 'array' or jsonb_array_length(v_bucket) = 0 then
    raise exception 'Empty drop pool for rarity %', v_rarity;
  end if;

  select e into v_pick from jsonb_array_elements_text(v_bucket) e order by random() limit 1;
  if v_pick is null then raise exception 'Empty drop pool for rarity %', v_rarity; end if;

  update loot_boxes set opened = true, opened_at = now() where id = p_box_id;

  return economy_grant_cosmetic(v_user, v_pick, null, v_rarity, 'box', v_box.provenance)
         || jsonb_build_object('box_key', v_box.box_key, 'rolled_rarity', v_rarity);
end;
$$;


-- ───────── 0070_equipped_loadout_table.sql ─────────
-- PUNCHLIST_13 — move the equipped loadout off cosmetics_owned and into its own table.
--
-- The old model put equip state on the OWNED ROW (`cosmetics_owned.slot` + `equipped` bool), which
-- makes "equipped" a property of the item. That can hold an item in exactly one slot, and the two
-- SFX slots need the same sting in both Start and End at once. Inverting it — the loadout is a map
-- of (user, slot) -> key, and the owned row only records ownership — makes any item equippable in
-- any number of slots and drops the swap logic to a single upsert.
--
-- cosmetics_owned.slot/equipped are deliberately LEFT IN PLACE rather than dropped: an app build
-- that predates this migration still reads them out of get_inventory, and dropping the columns
-- would take those clients down mid-rollout. They stop being authoritative here and can be dropped
-- in a later migration once the old builds are gone.

create table if not exists equipped_loadout (
  user_id uuid not null references profiles (id) on delete cascade,
  slot text not null,
  cosmetic_key text not null,
  equipped_at timestamptz not null default now(),
  primary key (user_id, slot)
);

create index if not exists equipped_loadout_user_idx on equipped_loadout (user_id);

alter table equipped_loadout enable row level security;

-- Readable by any signed-in user: equipped cosmetics are public by design (they're how other people
-- see you), and get_public_loadouts reads them for the feed and leaderboards. Writes go exclusively
-- through equip_cosmetic/unequip_cosmetic, which are security-definer and check ownership — there is
-- deliberately no insert/update/delete policy, so a client cannot equip something it doesn't own.
drop policy if exists equipped_loadout_read on equipped_loadout;
create policy equipped_loadout_read on equipped_loadout for select to authenticated using (true);

-- ── One-time backfill of the existing equip state ──────────────────────────────────────────────
-- 'sfx' became two slots (sfx_start/sfx_stop). Anyone with an SFX equipped chose it as their one
-- sting, so it carries into BOTH new slots — that reproduces the old single-sound behaviour at
-- start and end rather than silently emptying a slot the user had filled.
insert into equipped_loadout (user_id, slot, cosmetic_key)
select c.user_id, c.slot, c.cosmetic_key
from cosmetics_owned c
where c.equipped and c.slot is not null and c.slot <> 'sfx'
on conflict (user_id, slot) do nothing;

insert into equipped_loadout (user_id, slot, cosmetic_key)
select c.user_id, s.slot, c.cosmetic_key
from cosmetics_owned c
cross join (values ('sfx_start'), ('sfx_stop')) as s(slot)
where c.equipped and c.slot = 'sfx'
on conflict (user_id, slot) do nothing;

-- ── equip ──────────────────────────────────────────────────────────────────────────────────────
-- Ownership is checked HERE and nowhere else: the table has no write policy, so this function is
-- the only path in. Previously the check was implicit (the update simply matched no rows if you
-- didn't own the item, and failed silently); an explicit raise is what turns "nothing happened"
-- into an error the client can show.
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
  if not exists (select 1 from cosmetics_owned where user_id = v_user and cosmetic_key = p_key) then
    raise exception 'You do not own this item';
  end if;

  insert into equipped_loadout (user_id, slot, cosmetic_key, equipped_at)
  values (v_user, p_slot, p_key, now())
  on conflict (user_id, slot) do update
    set cosmetic_key = excluded.cosmetic_key, equipped_at = excluded.equipped_at;
end;
$$;

-- ── unequip ────────────────────────────────────────────────────────────────────────────────────
-- Takes a SLOT, not a key (PUNCHLIST_13). With one item allowed in several slots, "unequip this
-- item" is ambiguous — the same sting in both SFX slots has to be removable from one and left in
-- the other. Same (text) arity as the old key-based version, so the old overload is dropped rather
-- than replaced: leaving it would let a stale client's unequip_cosmetic('flame-ember') silently
-- resolve here and delete whatever sits in a slot literally named after an item.
drop function if exists unequip_cosmetic(text);
create function unequip_cosmetic(p_slot text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  delete from equipped_loadout where user_id = v_user and slot = p_slot;
end;
$$;

-- ── salvage: keep "selling unequips it" true ───────────────────────────────────────────────────
-- The old version relied on the owned row being deleted, which took its equipped flag with it. Now
-- that the loadout is a separate table, deleting the row alone would leave a dangling (user, slot)
-- pointing at an item the user no longer owns — a phantom equipped flame. Rewritten to clear every
-- slot holding the key, which is also why it can't just be a foreign key: cosmetic_key isn't
-- unique on its own and the loadout has to survive being read by clients that don't know the item.
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
  delete from equipped_loadout where user_id = v_user and cosmetic_key = p_key;
  delete from cosmetics_owned where user_id = v_user and cosmetic_key = p_key;
  perform economy_move_embers(v_user, v_payout, 'salvage', null);
  return jsonb_build_object('embers', v_payout);
end;
$$;

-- ── reads ──────────────────────────────────────────────────────────────────────────────────────
-- get_inventory gains a `loadout` object (slot -> key). `cosmetics[].equipped` is still emitted,
-- now DERIVED from the loadout, purely so an app build older than this migration keeps working
-- through the rollout; new clients read `loadout` and ignore it. It can't express "in two slots",
-- which is exactly why the new field exists.
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
    'loadout', coalesce((
      select jsonb_object_agg(e.slot, e.cosmetic_key)
      from equipped_loadout e where e.user_id = v_user
    ), '{}'::jsonb),
    'cosmetics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'cosmetic_key', c.cosmetic_key, 'slot', c.slot,
        'source', c.source, 'provenance', c.provenance,
        -- Legacy shape for pre-0070 clients. A key in ANY slot reads as equipped.
        'equipped', exists (
          select 1 from equipped_loadout e
          where e.user_id = v_user and e.cosmetic_key = c.cosmetic_key
        ),
        'acquired_at', c.acquired_at,
        'rarity_override', c.rarity_override, 'season_stamp', c.season_stamp
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

-- Other people's equipped set. Same contract as 0067 (keys only, plus the public stamp/override),
-- but sourced from the loadout table. The join back to cosmetics_owned is what carries the stamp
-- and rarity override — those live on the grant, not on the slot.
drop function if exists get_public_loadouts(uuid[]);
create function get_public_loadouts(p_user_ids uuid[])
returns table (user_id uuid, slot text, cosmetic_key text, rarity_override text, season_stamp text)
language sql
security definer
set search_path = public
stable
as $$
  select e.user_id, e.slot, e.cosmetic_key, c.rarity_override, c.season_stamp
  from equipped_loadout e
  join profiles p on p.id = e.user_id
  left join cosmetics_owned c on c.user_id = e.user_id and c.cosmetic_key = e.cosmetic_key
  where e.user_id = any(p_user_ids)
    and not p.is_disabled;
$$;


-- ───────── 0071_shared_week_boundary.sql ─────────
-- One week boundary, server side (punchlist 8 §5). The client half is src/lib/time/week.ts and the
-- two MUST agree — `week_key()` here and `weekKey()` there write into the same dedupe column.
--
-- Postgres' `date_trunc('week', …)` is ISO, which means MONDAY. The shop was flooring
-- `Date.now() / WEEK_MS` client-side, which anchors to the Unix epoch — a THURSDAY. The Forge Pass
-- counted weeks from the season start, so it rolled on whatever weekday that happened to be. Three
-- "weekly" resets, three weekdays. Everything below moves to Sunday 00:00 UTC.
--
-- Why UTC and not the session timezone: weekly challenges are shared between friends who may be in
-- different timezones. A local-midnight boundary would close the same shared window at a different
-- instant for each member, so the standings would depend on which member you asked.

begin;


-- ───────────────────────────────── the helpers ─────────────────────────────────

-- Sunday 00:00 UTC of the week containing p_ts. date_trunc('week') lands on Monday, so shift the
-- input forward a day before truncating and pull the result back a day after — Monday of the
-- shifted week is Sunday of the real one.
create or replace function week_start(p_ts timestamptz default now())
returns timestamptz
language sql
immutable
as $$
  select ((date_trunc('week', (p_ts at time zone 'UTC') + interval '1 day') - interval '1 day')
          at time zone 'UTC');
$$;

-- Whole weeks since Sun 4 Jan 1970 00:00 UTC — the first Sunday after the epoch (a Thursday).
-- 259200 seconds = those 3 days; 604800 = one week. This is the exact integer that
-- `weekIndex()` computes client-side, which is what lets week_key() and weekKey() agree.
create or replace function week_index(p_ts timestamptz default now())
returns bigint
language sql
immutable
as $$
  select floor((extract(epoch from p_ts) - 259200) / 604800)::bigint;
$$;

-- "W2953" — the once-per-week dedupe key for pass_xp_ledger.period_key. Never displayed; its only
-- job is to be identical to what the client computes for the same instant.
create or replace function week_key(p_ts timestamptz default now())
returns text
language sql
immutable
as $$
  select 'W' || week_index(p_ts)::text;
$$;

comment on function week_start(timestamptz) is
  'Sunday 00:00 UTC week boundary. Mirrors weekStart() in src/lib/time/week.ts — change both together.';
comment on function week_key(timestamptz) is
  'Weekly dedupe key ("W2953"). Mirrors weekKey() in src/lib/time/week.ts — change both together.';


-- ─────────────────────── migrate the weekly windows in the economy engine ───────────────────────
--
-- Both functions below are re-emitted verbatim from 0065 apart from the week boundary:
--   date_trunc('week', now())        → week_start()
--   to_char(now(), 'IYYY-"W"IW')     → week_key()
-- Signatures are unchanged, so `create or replace` is safe here (a changed signature would need a
-- drop first — Postgres would otherwise leave the old overload in place alongside the new one).

create or replace function evaluate_pass_achievements(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day text := to_char(now(), 'YYYY-MM-DD');
  v_week text := week_key();
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
  v_min int := (select value::int from economy_config where key = 'lock_in_min_seconds');
  v_today_count int;
  v_today_deep boolean;
  v_today_gym boolean;
  v_today_types text[];
  v_yesterday_types text[];
  v_week_days int;
  v_week_seconds numeric;
  v_week_gym int;
  v_streak_days int;
begin
  -- ── daily ──
  select count(*),
         bool_or(extract(epoch from (s.last_confirmed_at - s.started_at)) >= 5400),
         bool_or(g.type ilike '%gym%'),
         array_agg(distinct g.type)
    into v_today_count, v_today_deep, v_today_gym, v_today_types
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= date_trunc('day', now())
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  if coalesce(v_today_count, 0) >= 1 then
    perform economy_credit_pass_xp_for(p_user, 'daily_first_lock_in', 50, v_day);
  end if;
  if coalesce(v_today_count, 0) >= 3 then
    perform economy_credit_pass_xp_for(p_user, 'daily_three_lock_ins', 75, v_day);
  end if;
  if coalesce(v_today_deep, false) then
    perform economy_credit_pass_xp_for(p_user, 'daily_deep_session', 100, v_day);
  end if;
  if coalesce(v_today_gym, false) then
    perform economy_credit_pass_xp_for(p_user, 'daily_gym_lock_in', 60, v_day);
  end if;

  -- "A different goal type than yesterday" — rewards varying what you do, which is the habit the
  -- app is actually trying to build (FORGE_PASS wellbeing note).
  select array_agg(distinct g.type) into v_yesterday_types
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= date_trunc('day', now()) - interval '1 day'
    and s.started_at < date_trunc('day', now());

  if v_today_types is not null and v_yesterday_types is not null
     and exists (select 1 from unnest(v_today_types) t where t <> all(v_yesterday_types)) then
    perform economy_credit_pass_xp_for(p_user, 'daily_different_goal', 40, v_day);
  end if;

  -- ── weekly ── (Sunday-anchored as of 0071)
  select count(distinct s.started_at::date),
         coalesce(sum(extract(epoch from (s.last_confirmed_at - s.started_at))), 0),
         count(*) filter (where g.type ilike '%gym%')
    into v_week_days, v_week_seconds, v_week_gym
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= week_start()
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  if coalesce(v_week_days, 0) >= 6 then
    perform economy_credit_pass_xp_for(p_user, 'weekly_six_active_days', 300, v_week);
  end if;
  if coalesce(v_week_seconds, 0) >= 36000 then
    perform economy_credit_pass_xp_for(p_user, 'weekly_ten_hours', 250, v_week);
  end if;
  if coalesce(v_week_gym, 0) >= 5 then
    perform economy_credit_pass_xp_for(p_user, 'weekly_five_gym', 200, v_week);
  end if;

  -- ── season ──
  select count(distinct s.started_at::date) into v_streak_days
  from lock_in_sessions s
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= now() - interval '30 days';

  if coalesce(v_streak_days, 0) >= 30 then
    perform economy_credit_pass_xp_for(p_user, 'season_thirty_day_streak', 500, v_season);
  end if;
end;
$$;


-- The progress counters the achievement list renders ("6.5 / 10 h"). These must scan the SAME
-- window evaluate_pass_achievements credits from, or the bar would fill against Monday's week while
-- the reward paid out on Sunday's.
create or replace function get_pass_achievement_progress()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_min int := (select value::int from economy_config where key = 'lock_in_min_seconds');
  v_today int;
  v_week_days int;
  v_week_seconds numeric;
  v_week_gym int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  select count(*) into v_today
  from lock_in_sessions s
  where s.user_id = v_user and s.status = 'completed'
    and s.started_at >= date_trunc('day', now())
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  select count(distinct s.started_at::date),
         coalesce(sum(extract(epoch from (s.last_confirmed_at - s.started_at))), 0),
         count(*) filter (where g.type ilike '%gym%')
    into v_week_days, v_week_seconds, v_week_gym
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = v_user and s.status = 'completed'
    and s.started_at >= week_start()
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  return jsonb_build_object(
    'daily_three_lock_ins', coalesce(v_today, 0),
    'weekly_six_active_days', coalesce(v_week_days, 0),
    'weekly_ten_hours', round(coalesce(v_week_seconds, 0) / 3600.0, 1),
    'weekly_five_gym', coalesce(v_week_gym, 0)
  );
end;
$$;


-- ─────────────────────────── new challenges open on the same Sunday ───────────────────────────
--
-- `challenges.period_start` defaulted to `date_trunc('week', now())::date` — Monday, in the DB
-- session timezone. Only the DEFAULT moves here; existing rows keep the period_start they were
-- created with, because rewriting them would retroactively widen or narrow the window that
-- sync_challenge_from_lock_ins and the Strava/Whoop syncs have already credited against, and could
-- double-count activity that fell in the shifted days.
--
-- NOTE: this changes when a challenge's window OPENS. It does not make challenges roll over — see
-- task #89; nothing in this schema ever advances period_start after insert.
-- Read back through UTC before casting to date: week_start() returns the *instant* of Sunday 00:00
-- UTC, and a bare ::date renders that instant in the session timezone — which in anything west of
-- UTC is the Saturday.
alter table challenges
  alter column period_start set default (week_start() at time zone 'UTC')::date;

commit;


-- ───────── 0072_challenge_period_rollover.sql ─────────
-- Task #89: "challenges not resetting."
--
-- The diagnosis was not the week helper and not the deploy — NOTHING in this schema ever reset a
-- challenge. `period_start` was written once by the column default at insert and never updated
-- again: no cron job, no RPC, no Edge Function, no client path. `progress` was never zeroed either.
-- schema.sql said so out loud ("a challenge is a single-instance goal, not an auto-resetting
-- recurring one"), but the UI has been rendering "Resets Monday" / "Resets at midnight" and a
-- Daily/Weekly cadence chip the whole time. This migration makes the schema tell the truth the UI
-- was already telling.
--
-- The rest of the system was ALREADY built for this and just never got the signal. Every delta sync
-- — syncStepsFromDevice, the Strava/Whoop functions, sync_challenge_from_lock_ins — windows BOTH
-- its source total AND its already-contributed sum by `>= period_start`. Advancing period_start is
-- therefore the entire reset: the source window narrows to the new period, the already-synced
-- window narrows with it, and the next delta is computed like-for-like against the new period. That
-- is also why challenge_logs is NOT deleted below — the ledger stays whole, and old rows simply
-- fall out of the window.

begin;


-- ───────────────────────────────── the archive ─────────────────────────────────
--
-- A reset that just zeroed progress would silently destroy the record of every week the user
-- actually hit their goal, which for a recurring goal IS the interesting history. Each period is
-- closed into a row here before the counter goes back to zero.

create table if not exists challenge_periods (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  -- The window that just closed: [period_start, period_end).
  period_start date not null,
  period_end date not null,
  period text not null check (period in ('day', 'week')),
  -- Snapshotted rather than joined back to `challenges`: the target and unit are editable, and a
  -- history row must keep the target that was actually in force when it was earned.
  target numeric not null,
  progress numeric not null,
  unit text not null,
  completed_at timestamptz,
  archived_at timestamptz not null default now(),
  -- One archive row per challenge per period, so a double-fired cron closes the period once.
  unique (challenge_id, period_start)
);

create index if not exists challenge_periods_user_idx on challenge_periods (user_id, period_start desc);
create index if not exists challenge_periods_challenge_idx on challenge_periods (challenge_id, period_start desc);

alter table challenge_periods enable row level security;

-- Read-own only, matching `challenges` itself after 0059 unbound goals from campfires. Nothing is
-- granted insert/update/delete: rows are written exclusively by the security-definer function
-- below, so a client cannot forge a period it never completed.
drop policy if exists "challenge_periods: read own" on challenge_periods;
create policy "challenge_periods: read own" on challenge_periods
  for select using (user_id = auth.uid());


-- ───────────────────────────────── the rollover ─────────────────────────────────

/**
 * Closes every challenge period that has ended and opens the next one. Returns how many rolled.
 *
 * Boundaries, both UTC and both shared with the rest of the app:
 *   period = 'day'   → the UTC calendar day
 *   period = 'week'  → week_start() from 0071 — Sunday 00:00 UTC
 *
 * Idempotent by construction. The driving predicate is `period_start < <current boundary>`, so a
 * challenge already sitting on the current period is not selected at all; running this twice in a
 * row rolls nothing the second time, and the unique (challenge_id, period_start) on the archive is
 * the backstop if two runs ever overlap.
 *
 * Deliberately NOT a trigger and not called from the client: a reset is time-driven, and letting a
 * client ask for one would let a user roll a period they were about to lose.
 */
create or replace function roll_over_challenges()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_start date := (now() at time zone 'UTC')::date;
  v_week_start date := (week_start() at time zone 'UTC')::date;
  v_rolled int := 0;
  r record;
  v_next date;
begin
  for r in
    select * from challenges
    where (period = 'day'  and period_start < v_day_start)
       or (period = 'week' and period_start < v_week_start)
    -- Oldest first purely so a long-dormant challenge archives in a sensible order.
    order by period_start
    for update
  loop
    v_next := case when r.period = 'day' then v_day_start else v_week_start end;

    -- A challenge dormant for three weeks closes as ONE archive row spanning [period_start, now),
    -- not three. That is the honest shape of the data: nothing reset during those weeks, so the
    -- progress on it genuinely accrued across the whole span and there is no way to attribute it
    -- to individual weeks after the fact. Fabricating two empty rows to make the history look
    -- tidy would invent periods that never existed as periods.
    --
    -- FIRST RUN AFTER DEPLOY: every challenge in the table predates any rollover, so each one
    -- archives its since-creation total and resets to 0. That is the intended correction — those
    -- counters have been accumulating since the day they were created — but it IS a visible,
    -- one-time reset of live progress for existing users.

    -- An untouched period is not worth a history row — a user who never opened the app would
    -- otherwise accrue one empty archive row per day forever. The reset below still runs, because
    -- period_start must advance regardless for the sync windows to be correct.
    if r.progress > 0 or r.completed_at is not null then
      insert into challenge_periods (
        challenge_id, user_id, period_start, period_end, period,
        target, progress, unit, completed_at
      )
      values (
        r.id, r.user_id, r.period_start, v_next, r.period,
        r.target, r.progress, r.unit, r.completed_at
      )
      on conflict (challenge_id, period_start) do nothing;
    end if;

    -- Clearing completed_at does NOT re-fire the reward. economy_on_challenge_completed() returns
    -- early when `new.completed_at is null`, so this update is invisible to it — which is what
    -- stops a weekly challenge from paying out its friend_h2h grant again every single Sunday.
    update challenges
    set progress = 0,
        completed_at = null,
        period_start = v_next
    where id = r.id;

    v_rolled := v_rolled + 1;
  end loop;

  return v_rolled;
end;
$$;

comment on function roll_over_challenges() is
  'Closes ended challenge periods into challenge_periods and reopens them at the current UTC day/Sunday boundary. Cron-driven; see task #89.';

-- Service-role only. `authenticated` is deliberately not granted execute — see the note above about
-- a user rolling away a period they are about to fail.
revoke all on function roll_over_challenges() from public;
revoke all on function roll_over_challenges() from authenticated;


-- ───────────────────────────────── the schedule ─────────────────────────────────
--
-- 00:10 UTC daily, ten minutes after the day boundary and behind philoi-daily-streak-decay at
-- 00:05 so the streak sweep reads the day's challenges before they roll. A daily cadence covers
-- weeklies too: on six days of seven `period_start < week_start()` is false for them and only the
-- dailies move; on Sunday both do. Re-running this file re-schedules idempotently, same shape as
-- the existing philoi-daily-streak-decay job.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'philoi-challenge-rollover') then
    perform cron.unschedule('philoi-challenge-rollover');
  end if;
end $$;

select cron.schedule(
  'philoi-challenge-rollover',
  '10 0 * * *',
  $$select roll_over_challenges();$$
);

commit;


-- ───────── 0073_default_starter_loadout.sql ─────────
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
    -- No starter FLARE, deliberately: FLARES_SPEC.md rules out any free or base perimeter aura, so
    -- the flare slot is the one a new account sees empty. That emptiness is the product.
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

  -- What they're actually WEARING. Two slots are absent for opposite reasons: `audio` is owned but
  -- not worn (an ambient loop starts on its own when a lock-in begins, and defaulting it on would
  -- play a loop into a room the user never agreed to make noise in), and `flare` is not owned at
  -- all (no free perimeter aura exists). Every other default is silent decoration and goes on now.
  insert into equipped_loadout (user_id, slot, cosmetic_key)
  values
    (p_user, 'flame',     'flame-base-ember'),
    (p_user, 'particle',  'particle-base-spark'),
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


-- ───────── 0074_season_window_and_level_claims.sql ─────────
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

begin;


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


commit;


-- ───────── 0075_season_placement_rewards.sql ─────────
-- End-of-season placement rewards (FORGE_PASS_SEASON1 §"End-of-season placement rewards").
--
-- At close, every player is ranked WITHIN THEIR UNIVERSITY by season Forge XP and paid an exclusive,
-- never-reissued Emberfall reward for where they finished. Cosmetics and embers only — nothing here
-- carries an advantage into Season 2, which is the same rule the rest of this economy runs on.
--
-- ⚠️ ASSUMPTION FLAGGED FOR NOAH (#2 of the three open numbers): the board is ranked by season
-- Forge XP (`forge_pass_state.pass_xp`), per the spec's "ranked by season Forge XP / activity". The
-- alternative basis is universal_score, which is what the EXISTING close_season_scope in 0066 uses
-- for the 21j "Ascended" titles. These are deliberately two different boards paying two different
-- sets of rewards: 0066 ranks lifetime standing, this ranks what you did during Emberfall. If that
-- is wrong, the fix is the ORDER BY in season_standings_for and nothing else.
--
-- Relationship to 0066: additive. close_season_scope still grants the 21j placement titles off
-- universal_score. This grants the Emberfall-coded set off pass XP. Neither touches the other's rows.

begin;


-- ───────────────────────────── the standings snapshot ─────────────────────────────
--
-- Snapshotted rather than computed live at grant time, because the two must not drift: rewards are
-- paid from a fixed final standing, and a board that kept moving between the snapshot and the last
-- grant could pay two people the same "#1" or none at all. The snapshot IS the record of where the
-- season ended, and it outlives the season for the share card and any appeal.
create table if not exists season_standings (
  season_id text not null,
  university text not null,
  user_id uuid not null references profiles (id) on delete cascade,
  rank int not null,
  board_size int not null,
  pass_xp int not null,
  pass_level int not null,
  captured_at timestamptz not null default now(),
  primary key (season_id, university, user_id)
);

create index if not exists season_standings_board_idx on season_standings (season_id, university, rank);

alter table season_standings enable row level security;

-- Readable by any signed-in user: final standings are public by nature — they're what the champion
-- share card and the "you finished #4" line are drawn from. Writes are service-role only.
drop policy if exists season_standings_read on season_standings;
create policy season_standings_read on season_standings for select to authenticated using (true);

-- One row per season, so the whole close is idempotent at the top level: a cron that fires twice,
-- or a manual re-run, finds the closure already recorded and does nothing.
create table if not exists season_placement_closures (
  season_id text primary key,
  closed_at timestamptz not null default now(),
  boards int not null default 0,
  granted int not null default 0
);

alter table season_placement_closures enable row level security;


/**
 * Freeze the final board. Ranked within each university by season Forge XP, ties broken by who got
 * there first — an earlier `premium_granted_at`/`created_at` is the only tiebreak that can't be
 * gamed after the fact, and leaving ties unbroken would make rank 1 ambiguous exactly where it
 * matters most.
 *
 * Only VERIFIED university members are ranked. An unverified account can claim any school, and a
 * per-campus board that anyone can join by typing a name is not a campus board.
 */
create or replace function snapshot_season_standings(p_season text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := coalesce(p_season, season_config() ->> 'id');
  v_rows int;
begin
  insert into season_standings (season_id, university, user_id, rank, board_size, pass_xp, pass_level)
  select
    v_season,
    p.university,
    p.id,
    row_number() over (partition by p.university order by f.pass_xp desc, f.created_at asc, p.id asc),
    count(*) over (partition by p.university),
    f.pass_xp,
    economy_level_from_xp(f.pass_xp)
  from profiles p
  join forge_pass_state f on f.user_id = p.id and f.season_id = v_season
  where not p.is_demo
    and not p.is_disabled
    and p.university is not null
    and p.university_email_verified
    -- Zero-XP accounts are not "last place", they simply didn't play. Ranking them would inflate
    -- every board_size and hand out Top-50% titles to people who never opened the Pass.
    and f.pass_xp > 0
  on conflict (season_id, university, user_id) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function snapshot_season_standings(text) from public, authenticated;


-- ───────────────────────────── the one-time grant ─────────────────────────────

/**
 * Pay every band from the frozen standings.
 *
 * Placement bands are EXCLUSIVE — you are paid for your best band and only that one. The spec lists
 * them as a ladder (#1 · Top 10 · Top 1% · Top 10% · Top 50%), and a champion who also collected the
 * Top-10 and Top-50% titles would end the season wearing four titles that each say something weaker
 * than the one above it.
 *
 * The two MEDALS are orthogonal and stack on top of any band: "Reached L100" is about the track, not
 * the board, and the participation mark is for everyone who showed up. The spec says exactly this
 * ("regardless of placement" / "any pass level").
 *
 * `p_dry_run` returns the counts without granting anything — worth having for a payout that can only
 * ever be run once for real.
 */
create or replace function grant_season_placement_rewards(p_season text default null, p_dry_run boolean default false)
returns table (university text, ranked int, granted int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := coalesce(p_season, season_config() ->> 'id');
  v_stamp text;
  v_pct numeric;
  v_granted int := 0;
  r record;
begin
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
      if r.rank = 1 then
        perform economy_grant_cosmetic(r.user_id, 'card-emberfall-sovereign', 'card', 'mythic', 'earned', 'Season ' || v_season || ' Champion');
        perform economy_grant_title(r.user_id, 'title-emberfall-champion', 'Season ' || v_season || ' Champion', v_stamp);
        perform economy_grant_cosmetic(r.user_id, 'medal-emberfall-champion', null, 'mythic', 'earned', 'Season ' || v_season || ' Champion');
        perform economy_move_embers(r.user_id, 5000, 'season_reward', null);
      elsif r.rank <= 10 then
        perform economy_grant_cosmetic(r.user_id, 'banner-emberfall-elite', 'banner', 'legendary', 'earned', 'Season ' || v_season || ' Top 10');
        perform economy_grant_title(r.user_id, 'title-emberfall-elite', 'Season ' || v_season || ' Top 10', v_stamp);
        perform economy_move_embers(r.user_id, 2500, 'season_reward', null);
      elsif v_pct <= 0.01 then
        perform economy_grant_cosmetic(r.user_id, 'particle-emberfall-ascendant', 'particle', 'epic', 'earned', 'Season ' || v_season || ' Top 1%');
        perform economy_grant_title(r.user_id, 'title-emberfall-ascendant', 'Season ' || v_season || ' Top 1%', v_stamp);
        perform economy_move_embers(r.user_id, 1500, 'season_reward', null);
      elsif v_pct <= 0.10 then
        insert into loot_boxes (user_id, box_key, obtained_via, provenance)
        values (r.user_id, 'furnace', 'season', 'Season ' || v_season || ' Top 10%');
        perform economy_grant_title(r.user_id, 'title-emberfall-contender', 'Season ' || v_season || ' Top 10%', v_stamp);
        perform economy_move_embers(r.user_id, 750, 'season_reward', null);
      elsif v_pct <= 0.50 then
        perform economy_grant_title(r.user_id, 'title-emberfall-initiate', 'Season ' || v_season || ' Top 50%', v_stamp);
        perform economy_move_embers(r.user_id, 500, 'season_reward', null);
      end if;

      -- ── orthogonal medals ──
      if r.pass_level >= 100 then
        perform economy_grant_cosmetic(r.user_id, 'medal-emberfall-centurion', null, 'legendary', 'earned', 'Season ' || v_season || ' · Level 100');
      end if;
      perform economy_grant_cosmetic(r.user_id, 'medal-emberfall-participant', null, 'common', 'earned', 'Season ' || v_season || ' · took part');
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

revoke all on function grant_season_placement_rewards(text, boolean) from public, authenticated;


-- ───────────────────────────── the scheduled close ─────────────────────────────

/**
 * Snapshot then pay, but only once the season has actually ended. Safe to run every day for the
 * whole season: before `ends_at` this returns immediately, and after the first real run the closure
 * row stops it.
 */
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
  if exists (select 1 from season_placement_closures where season_id = v_season) then return; end if;

  perform snapshot_season_standings(v_season);
  perform grant_season_placement_rewards(v_season, false);
end;
$$;

-- 02:00 UTC daily. It is a no-op on all but one morning of the season — cheaper and far more robust
-- than a single one-shot job scheduled for Dec 23 that would silently miss the season if the
-- database happened to be down that hour.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'philoi-season-placement-close') then
    perform cron.unschedule('philoi-season-placement-close');
  end if;
end $$;

select cron.schedule(
  'philoi-season-placement-close',
  '0 2 * * *',
  $$select close_season_placements();$$
);


-- ───────────────────────────── the read for the share card ─────────────────────────────

/**
 * Your own final standing, for the season-close screen and the Champion share card. Returns no row
 * before the snapshot exists, which is how the client knows the season hasn't been closed out yet.
 */
create or replace function get_my_season_standing(p_season text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_season text := coalesce(p_season, season_config() ->> 'id');
  v_row season_standings;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  select * into v_row from season_standings
  where season_id = v_season and user_id = auth.uid();

  if v_row.user_id is null then return null; end if;

  return jsonb_build_object(
    'season_id', v_row.season_id,
    'university', v_row.university,
    'rank', v_row.rank,
    'board_size', v_row.board_size,
    'pass_xp', v_row.pass_xp,
    'pass_level', v_row.pass_level,
    'percentile', round((v_row.rank::numeric / greatest(v_row.board_size, 1)) * 100, 1)
  );
end;
$$;

commit;


commit;
