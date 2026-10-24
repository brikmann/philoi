-- PROGRAM ADDER + GREEK PATRONS.
--
-- Adds a student's academic program (major) as a first-class profile attribute, each program answering
-- to a Greek patron deity/hero (shown as "Heir of <Patron>"), plus the picker + a season-scoped program
-- leaderboard. Design from PATRON_MAP_program_deities.md + PROGRAMS_SEED_laurier_waterloo.md +
-- CODE_PROMPT_program_picker_search.md.
--
-- Fully additive + non-destructive: two new reference tables (patrons, programs), one nullable column
-- (profiles.program_id), and read/set RPCs. The live App Store app never calls any of it, so prod is
-- untouched; the dev app (com.philoi.app.dev) exercises it against this same shared backend.
--
-- LEDGER DISCIPLINE: prod ledger tops at 0242 (0243 meme-drops, 0244 FK, 0245 live-status, 0246 seasonal
-- reset all pending). This is 0247. Verify the current max applied migration + the schema_migrations
-- ledger in PROD before applying; number sequentially; never hand-edit the ledger; do NOT `db push`
-- (it would also try to ship the unapplied landmine migrations). Apply in isolation, then
-- `supabase migration repair --status applied 0247`. Sync supabase/schema.sql to match afterward.
--
-- NOTE on Engineering patrons: core engineering disciplines (Mechanical/Civil/Electrical/Chemical/...)
-- map to HEPHAESTUS (the forge, maker of machines); Architecture + Systems Design + UX/planning map to
-- DAEDALUS (the master architect; ties to the existing "Daedalus Blueprint" relic). If you'd rather make
-- Daedalus the blanket Engineering patron, it's a one-line patron_key swap on the eng rows below.
-- Prometheus is reserved as Noah's dev title and is intentionally NOT assigned to any program.

begin;

-- ───────────────────────────── patrons (the deity registry) ─────────────────────────────
-- One row per patron. `attribute` doubles as the crest art brief (feeds the bespoke per-item art
-- pipeline, like the cosmetics). All figures are public domain.
create table if not exists patrons (
  key       text primary key,
  name      text not null,
  attribute text not null,
  blurb     text
);
alter table patrons enable row level security;
drop policy if exists "patrons: read all" on patrons;
create policy "patrons: read all" on patrons for select using (true);

insert into patrons (key, name, attribute, blurb) values
  ('heracles','Heracles','lion pelt & club','god-hero of strength and labour'),
  ('nike','Nike','winged wreath','victory'),
  ('hermes','Hermes','caduceus & winged sandals','trade, travel, language, the messenger'),
  ('hygieia','Hygieia','bowl & serpent','health, care, recovery'),
  ('asclepius','Asclepius','rod & serpent','healing'),
  ('panacea','Panacea','vial','the universal remedy'),
  ('artemis','Artemis','bow & stag','the wild and its creatures'),
  ('demeter','Demeter','wheat sheaf','nourishment and the harvest'),
  ('atlas','Atlas','bearing the cosmos','the forces that hold the heavens'),
  ('urania','Urania','globe & stars','Muse of astronomy'),
  ('hecate','Hecate','twin torches','transformation and alchemy'),
  ('athena','Athena','owl','reason, wisdom, order'),
  ('moirai','The Moirai','thread & spindle','measure, chance, and fate'),
  ('metis','Metis','woven knot','deep cunning and pattern'),
  ('hephaestus','Hephaestus','hammer & anvil','the forge; maker of machines and automata'),
  ('daedalus','Daedalus','labyrinth & compass','the master architect and inventor'),
  ('plutus','Plutus','cornucopia','wealth and resources'),
  ('peitho','Peitho','ribbon','persuasion'),
  ('psyche','Psyche','butterfly','the soul itself'),
  ('mnemosyne','Mnemosyne','still water','memory, mother of the Muses'),
  ('hestia','Hestia','hearth flame','the common hearth, home, belonging'),
  ('gaia','Gaia','globe & leaf','the earth and all life'),
  ('aphrodite','Aphrodite','dove & shell','love, desire, gender'),
  ('themis','Themis','scales','divine justice and law'),
  ('nemesis','Nemesis','scales & sword','retribution'),
  ('zeus','Zeus','thunderbolt','rule and order'),
  ('ares','Ares','spear & helm','war and force'),
  ('clio','Clio','scroll','Muse of history'),
  ('calliope','Calliope','writing tablet','Muse of epic poetry'),
  ('erato','Erato','lyre','Muse of lyric poetry'),
  ('polyhymnia','Polyhymnia','veil','Muse of sacred hymn'),
  ('hades','Hades','bident & helm','what lies buried, unearthed'),
  ('apollo','Apollo','lyre & sun','patron of the arts'),
  ('euterpe','Euterpe','aulos','Muse of music'),
  ('dionysus','Dionysus','grapevine & mask','theatre and spectacle'),
  ('iris','Iris','rainbow','the messenger'),
  ('chloris','Chloris','blossom','flowers and growth'),
  ('poseidon','Poseidon','trident','the sea'),
  ('chiron','Chiron','bow & scroll','the wise teacher who trained heroes'),
  ('terpsichore','Terpsichore','lyre','Muse of dance')
on conflict (key) do nothing;

-- ───────────────────────────── programs (school-scoped) ─────────────────────────────
-- A row per (program, university): "Kinesiology @ Laurier" and "Kinesiology @ Waterloo" are distinct
-- rows (so inter-school rivalry compares them) but share a program_key so a cross-school "all
-- Kinesiology" grouping is possible later. university matches the canonical names in `universities`
-- (and profiles.university, which is plain text by design).
create table if not exists programs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  program_key text not null,
  university  text not null,
  patron_key  text not null references patrons (key),
  created_at  timestamptz not null default now(),
  unique (university, program_key)
);
alter table programs enable row level security;
drop policy if exists "programs: read all" on programs;
create policy "programs: read all" on programs for select using (true);
create index if not exists programs_university_idx on programs (university);
create index if not exists programs_key_idx on programs (program_key);

-- Wilfrid Laurier University (no Engineering, no Architecture).
insert into programs (name, program_key, university, patron_key) values
  ('Business Administration (BBA)','business-administration','Wilfrid Laurier University','hermes'),
  ('Economics','economics','Wilfrid Laurier University','plutus'),
  ('Business Technology Management','business-technology-management','Wilfrid Laurier University','hermes'),
  ('Financial Mathematics','financial-mathematics','Wilfrid Laurier University','plutus'),
  ('Biology','biology','Wilfrid Laurier University','gaia'),
  ('Biochemistry & Biotechnology','biochemistry','Wilfrid Laurier University','asclepius'),
  ('Chemistry','chemistry','Wilfrid Laurier University','hecate'),
  ('Computer Science','computer-science','Wilfrid Laurier University','hephaestus'),
  ('Data Science','data-science','Wilfrid Laurier University','metis'),
  ('Mathematics','mathematics','Wilfrid Laurier University','athena'),
  ('Physics','physics','Wilfrid Laurier University','atlas'),
  ('Health Sciences','health-sciences','Wilfrid Laurier University','asclepius'),
  ('Kinesiology','kinesiology','Wilfrid Laurier University','heracles'),
  ('Psychology','psychology','Wilfrid Laurier University','psyche'),
  ('Environmental Science','environmental-science','Wilfrid Laurier University','gaia'),
  ('English','english','Wilfrid Laurier University','calliope'),
  ('History','history','Wilfrid Laurier University','clio'),
  ('Philosophy','philosophy','Wilfrid Laurier University','athena'),
  ('Political Science','political-science','Wilfrid Laurier University','zeus'),
  ('Sociology','sociology','Wilfrid Laurier University','hestia'),
  ('Communication Studies','communication-studies','Wilfrid Laurier University','hermes'),
  ('Digital Media & Journalism','digital-media-journalism','Wilfrid Laurier University','iris'),
  ('Film Studies','film-studies','Wilfrid Laurier University','dionysus'),
  ('Global Studies','global-studies','Wilfrid Laurier University','hermes'),
  ('Religion & Culture','religion-culture','Wilfrid Laurier University','polyhymnia'),
  ('Women & Gender Studies','gender-studies','Wilfrid Laurier University','aphrodite'),
  ('Anthropology','anthropology','Wilfrid Laurier University','gaia'),
  ('Geography','geography','Wilfrid Laurier University','gaia'),
  ('Criminology','criminology','Wilfrid Laurier University','nemesis'),
  ('Law & Society','law-society','Wilfrid Laurier University','themis'),
  ('Policing','policing','Wilfrid Laurier University','ares'),
  ('Social Work','social-work','Wilfrid Laurier University','hestia'),
  ('Youth & Children''s Studies','youth-childrens-studies','Wilfrid Laurier University','chiron'),
  ('User Experience Design','ux-design','Wilfrid Laurier University','daedalus'),
  ('Game Design & Development','game-design','Wilfrid Laurier University','hephaestus'),
  ('Health Administration','health-administration','Wilfrid Laurier University','hygieia'),
  ('Music','music','Wilfrid Laurier University','euterpe'),
  ('Music Therapy','music-therapy','Wilfrid Laurier University','hygieia'),
  ('Education (BEd)','education','Wilfrid Laurier University','chiron')
on conflict (university, program_key) do nothing;

-- University of Waterloo (has Engineering + Architecture + large Math faculty).
insert into programs (name, program_key, university, patron_key) values
  ('Architecture','architecture','University of Waterloo','daedalus'),
  ('Architectural Engineering','architectural-engineering','University of Waterloo','daedalus'),
  ('Biomedical Engineering','biomedical-engineering','University of Waterloo','asclepius'),
  ('Chemical Engineering','chemical-engineering','University of Waterloo','hephaestus'),
  ('Civil Engineering','civil-engineering','University of Waterloo','hephaestus'),
  ('Computer Engineering','computer-engineering','University of Waterloo','hephaestus'),
  ('Electrical Engineering','electrical-engineering','University of Waterloo','hephaestus'),
  ('Environmental Engineering','environmental-engineering','University of Waterloo','gaia'),
  ('Geological Engineering','geological-engineering','University of Waterloo','hades'),
  ('Management Engineering','management-engineering','University of Waterloo','hephaestus'),
  ('Mechanical Engineering','mechanical-engineering','University of Waterloo','hephaestus'),
  ('Mechatronics Engineering','mechatronics-engineering','University of Waterloo','hephaestus'),
  ('Nanotechnology Engineering','nanotechnology-engineering','University of Waterloo','hephaestus'),
  ('Systems Design Engineering','systems-design-engineering','University of Waterloo','daedalus'),
  ('Software Engineering','software-engineering','University of Waterloo','hephaestus'),
  ('Computer Science','computer-science','University of Waterloo','hephaestus'),
  ('Actuarial Science','actuarial-science','University of Waterloo','moirai'),
  ('Applied Mathematics','applied-mathematics','University of Waterloo','athena'),
  ('Pure Mathematics','pure-mathematics','University of Waterloo','athena'),
  ('Combinatorics & Optimization','combinatorics-optimization','University of Waterloo','athena'),
  ('Statistics','statistics','University of Waterloo','moirai'),
  ('Data Science','data-science','University of Waterloo','metis'),
  ('Mathematical Finance','mathematical-finance','University of Waterloo','plutus'),
  ('Mathematical Physics','mathematical-physics','University of Waterloo','atlas'),
  ('Mathematical Economics','mathematical-economics','University of Waterloo','plutus'),
  ('Computing & Financial Management','computing-financial-management','University of Waterloo','hermes'),
  ('Biology','biology','University of Waterloo','gaia'),
  ('Biochemistry','biochemistry','University of Waterloo','asclepius'),
  ('Biomedical Sciences','biomedical-sciences','University of Waterloo','asclepius'),
  ('Chemistry','chemistry','University of Waterloo','hecate'),
  ('Physics','physics','University of Waterloo','atlas'),
  ('Astronomy','astronomy','University of Waterloo','urania'),
  ('Earth Sciences','earth-sciences','University of Waterloo','gaia'),
  ('Environmental Science','environmental-science','University of Waterloo','gaia'),
  ('Materials & Nanosciences','materials-nanosciences','University of Waterloo','hephaestus'),
  ('Life Sciences','life-sciences','University of Waterloo','gaia'),
  ('Science & Business','science-business','University of Waterloo','hermes'),
  ('Pharmacy','pharmacy','University of Waterloo','panacea'),
  ('Optometry','optometry','University of Waterloo','asclepius'),
  ('Kinesiology','kinesiology','University of Waterloo','heracles'),
  ('Public Health','public-health','University of Waterloo','hygieia'),
  ('Health Sciences','health-sciences','University of Waterloo','asclepius'),
  ('Recreation & Leisure Studies','recreation-leisure','University of Waterloo','hermes'),
  ('Planning (Urban)','urban-planning','University of Waterloo','daedalus'),
  ('Geography & Environmental Management','geography-environmental-management','University of Waterloo','gaia'),
  ('Geomatics','geomatics','University of Waterloo','metis'),
  ('International Development','international-development','University of Waterloo','hermes'),
  ('Knowledge Integration','knowledge-integration','University of Waterloo','metis'),
  ('Accounting & Financial Management','accounting-financial-management','University of Waterloo','plutus'),
  ('Economics','economics','University of Waterloo','plutus'),
  ('Psychology','psychology','University of Waterloo','psyche'),
  ('English','english','University of Waterloo','calliope'),
  ('History','history','University of Waterloo','clio'),
  ('Philosophy','philosophy','University of Waterloo','athena'),
  ('Political Science','political-science','University of Waterloo','zeus'),
  ('Sociology','sociology','University of Waterloo','hestia'),
  ('Legal Studies','legal-studies','University of Waterloo','themis'),
  ('Fine Arts','fine-arts','University of Waterloo','apollo'),
  ('Music','music','University of Waterloo','euterpe'),
  ('Theatre & Performance','theatre-performance','University of Waterloo','dionysus'),
  ('Global Business & Digital Arts','gbda','University of Waterloo','daedalus'),
  ('Social Work','social-work','University of Waterloo','hestia'),
  ('Peace & Conflict Studies','peace-conflict-studies','University of Waterloo','themis'),
  ('Religious Studies','religious-studies','University of Waterloo','polyhymnia'),
  ('Classical Studies','classical-studies','University of Waterloo','mnemosyne'),
  ('Anthropology','anthropology','University of Waterloo','gaia'),
  ('Speech Communication','speech-communication','University of Waterloo','peitho')
on conflict (university, program_key) do nothing;

-- ───────────────────────────── profile column ─────────────────────────────
alter table profiles add column if not exists program_id uuid references programs (id) on delete set null;
create index if not exists profiles_program_idx on profiles (program_id);

-- ───────────────────────────── RPCs ─────────────────────────────
-- Picker list for a school (called at onboarding with the chosen university, before verification; and
-- from Settings). Returns the program + its patron so the row can show "Heir of <Patron>".
create or replace function get_programs_for_university(p_university text)
returns table (program_id uuid, name text, program_key text, patron_key text, patron_name text, patron_attribute text)
language sql
stable
security definer
set search_path = public
as $$
  select pr.id, pr.name, pr.program_key, pr.patron_key, pa.name, pa.attribute
  from programs pr
  join patrons pa on pa.key = pr.patron_key
  where pr.university = p_university
  order by pr.name;
$$;

-- Set the caller's program. Security definer so it can write the caller's own profile row regardless of
-- the profiles update policy; validates the program exists (FK would too, but this returns a clean error).
create or replace function set_my_program(p_program_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from programs where id = p_program_id) then
    raise exception 'no such program';
  end if;
  update profiles set program_id = p_program_id where id = auth.uid();
end;
$$;

-- The caller's current program + patron, for the profile header ("Heir of <Patron>") and the board.
create or replace function get_my_program()
returns table (program_id uuid, name text, program_key text, university text, patron_key text, patron_name text, patron_attribute text)
language sql
stable
security definer
set search_path = public
as $$
  select pr.id, pr.name, pr.program_key, pr.university, pr.patron_key, pa.name, pa.attribute
  from profiles p
  join programs pr on pr.id = p.program_id
  join patrons pa on pa.key = pr.patron_key
  where p.id = auth.uid();
$$;

-- Program leaderboard: season-scoped standing within one program (mirrors get_university_leaderboard —
-- ordered by season_score, tier/division from lifetime universal_score, your own row always pinned).
create or replace function get_program_leaderboard(p_program_id uuid, p_limit int default 50)
returns table (
  user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean,
  score numeric, tier text, division int, rank int, is_me boolean
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
      s.season as score, t.tier, t.division,
      row_number() over (order by s.season desc, p.display_name asc)::int as rank
    from profiles p
    cross join lateral (select season_score(p.id) as season, universal_score(p.id) as life) s
    cross join lateral rank_tier_for_score(s.life) t
    where p.program_id = p_program_id and not p.is_demo and not p.is_disabled
  )
  select r.user_id, r.handle, r.display_name, r.avatar_url, r.is_pro,
         r.score, r.tier, r.division, r.rank, (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

grant execute on function get_programs_for_university(text) to authenticated, anon;
grant execute on function set_my_program(uuid) to authenticated;
grant execute on function get_my_program() to authenticated;
grant execute on function get_program_leaderboard(uuid, int) to authenticated;

commit;

-- FOLLOW-UPS (not this migration):
--   * Program-vs-Program / cross-school rivalry = the Versus engine (next migration, 0248).
--   * Bespoke patron crest art per deity (attribute column is the brief) rides the cosmetic art pipeline.
--   * "Other" free-text program at onboarding resolves to patron Hestia (handle client-side or add an
--     is_other sentinel program per school later).
