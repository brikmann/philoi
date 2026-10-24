-- 0264 . THE HOUSE YOU REP — patron titles, program abbreviations + lore, and the identity stack.
--
-- Every program answers to a patron (0257). This gives the onboarding claim ceremony and the
-- "Heir to Heracles · Kin · Laurier" identity stack the data they render:
--
--   1. patrons.title   — the epic title ("Titan of the Twelve Labours"), all 40 seeded.
--   2. programs.abbrev — the short label beside a name ("Kin", "Comp. Sci"), by program_key so both
--                        schools read the same.
--   3. programs.lore   — the claim-screen blurb, by program_key. Kinesiology + Mathematics are the
--                        final two-paragraph form (mock 286); the other 85 are the first-pass
--                        program-first blurbs from PROGRAM_LORE_blurbs.md until the full rewrite lands.
--   4. get_my_program / get_programs_for_university also return patron_title, program_abbrev,
--      program_lore. Their RETURNS TABLE grows, so each is dropped and recreated (CREATE OR REPLACE
--      cannot change a result type) and its grant re-issued. Columns are appended after the old ones,
--      so the installed share sticker's reader (patron_key / patron_name / name) is unaffected.
--   5. get_identity_badges(uuid[]) — one batch read of patron · program · school for the rows a
--      screen is showing (boards, Agora, campfires), so no board RPC has to be restated for it.
--   6. get_program_leaderboard gains the two gates every other board has: verified students only
--      and can_see_rank (0170/0217). As shipped in 0257 it listed private climbers.
--
-- Additive. LEDGER: apply this file alone, then `supabase migration repair --status applied 0264`.
-- Never `db push` (0236, and 0262/0263 pending Noah, would ride along).

begin;

-- ──────────────────── 1–3. columns ────────────────────
alter table patrons  add column if not exists title  text;
alter table programs add column if not exists abbrev text;
alter table programs add column if not exists lore   text;

-- patron titles (40)
update patrons pa set title = v.title from (values
  ('aphrodite', 'Goddess of Love & Desire'),
  ('apollo', 'God of Light & the Arts'),
  ('ares', 'God of War'),
  ('artemis', 'Goddess of the Wild Hunt'),
  ('asclepius', 'God of Healing'),
  ('athena', 'Goddess of Wisdom & War'),
  ('atlas', 'Titan Who Bears the Heavens'),
  ('calliope', 'Muse of Epic Poetry'),
  ('chiron', 'Mentor of Heroes'),
  ('chloris', 'Goddess of Flowers & Growth'),
  ('clio', 'Muse of History'),
  ('daedalus', 'The Master Architect'),
  ('demeter', 'Goddess of the Harvest'),
  ('dionysus', 'God of Wine & Theatre'),
  ('erato', 'Muse of Lyric Poetry'),
  ('euterpe', 'Muse of Music'),
  ('gaia', 'Primordial Mother of Earth'),
  ('hades', 'Lord of the Underworld'),
  ('hecate', 'Goddess of Alchemy & Transformation'),
  ('hephaestus', 'God of the Forge'),
  ('heracles', 'Titan of the Twelve Labours'),
  ('hermes', 'Herald of Trade & Travel'),
  ('hestia', 'Goddess of the Hearth & Home'),
  ('hygieia', 'Goddess of Health & Recovery'),
  ('iris', 'Messenger of the Rainbow'),
  ('metis', 'Titaness of Deep Cunning'),
  ('mnemosyne', 'Titaness of Memory'),
  ('moirai', 'Weavers of Fate'),
  ('nemesis', 'Goddess of Retribution'),
  ('nike', 'Goddess of Victory'),
  ('panacea', 'Bearer of the Universal Remedy'),
  ('peitho', 'Goddess of Persuasion'),
  ('plutus', 'God of Wealth'),
  ('polyhymnia', 'Muse of Sacred Hymn'),
  ('poseidon', 'God of the Sea'),
  ('psyche', 'Goddess of the Soul'),
  ('terpsichore', 'Muse of Dance'),
  ('themis', 'Titaness of Divine Law'),
  ('urania', 'Muse of the Stars'),
  ('zeus', 'King of the Gods')
) as v(key, title) where pa.key = v.key;

-- program abbrevs + lore by program_key (87)
update programs pr set abbrev = v.abbrev, lore = v.lore from (values
  ('accounting-financial-management', 'AFM', 'As an AFM student, you keep the ledger of empires — the one who knows exactly where every dollar came from and where it must go. You answer to Plutus, lord of resources, for whom nothing of value is ever left uncounted.'),
  ('actuarial-science', 'Actuarial', 'As an Actuarial Science student, you put a price on the future and a number on risk no one else will touch. You follow the Moirai, weavers of fate, who alone know the length of every thread.'),
  ('anthropology', 'Anthro', 'As an Anthropology student, you study humanity across every culture and age — who we are and how we came to be. You follow Gaia, the ancient Earth, witness to the whole human story.'),
  ('applied-mathematics', 'Applied Math', 'As an Applied Math student, you turn abstract truth into tools that bend the real world. Athena, goddess of wisdom and strategy, claims the mind that makes theory do work.'),
  ('architectural-engineering', 'Arch. Eng', 'As an Architectural Engineering student, you make buildings stand, marrying beauty to the forces that would bring them down. Daedalus, master builder, claims those who design and engineer as one.'),
  ('architecture', 'Arch', 'As an Architecture student, you shape the spaces people live their lives inside. You pledge to Daedalus, the master architect, designer of the Labyrinth and the first to give mankind wings.'),
  ('astronomy', 'Astro', 'As an Astronomy student, you lift your eyes past the world to the vast order written in the stars. You follow Urania, muse of the heavens, who maps what the rest of us only wonder at.'),
  ('biochemistry', 'Biochem', 'As a Biochemistry student, you read the chemistry that keeps us alive, the molecular machinery beneath every heartbeat. You follow Asclepius, god of healing, who understood the body so deeply he could pull it back from death.'),
  ('biology', 'Bio', 'As a Biology student, you study life itself, from the single cell to the whole living system. You answer to Gaia, primordial mother of all that grows and breathes — the oldest power, from whom every organism first came.'),
  ('biomedical-engineering', 'Biomed. Eng', 'As a Biomedical Engineering student, you build the machines that heal, from prosthetics to pacemakers. You follow Asclepius, god of healing, whose craft now runs on engineering as much as medicine.'),
  ('biomedical-sciences', 'Biomed Sci', 'As a Biomedical Sciences student, you trace disease to its source and build the knowledge medicine stands on. Asclepius, god of healing, claims those who learn the body well enough to mend it.'),
  ('business-administration', 'BBA', 'As a Business student, you move among dealmakers and builders — people who see an opening and take it, who turn a handshake into a venture. You follow Hermes, god of trade and the open road: wherever value changes hands, that is your ground.'),
  ('business-technology-management', 'BTM', 'As a BTM student, you stand where business meets the machine, translating between people and systems so both move faster. You follow Hermes, the messenger who crosses every border and makes sure the signal always gets through.'),
  ('chemical-engineering', 'Chem. Eng', 'As a Chemical Engineering student, you turn raw matter into the materials the modern world runs on. Hephaestus, god of the forge, claims those who transform the elements at scale.'),
  ('chemistry', 'Chem', 'As a Chemistry student, you command the moment one substance becomes another, breaking bonds and forging new ones. You serve Hecate, goddess of alchemy and transformation, who rules every threshold where matter is remade.'),
  ('civil-engineering', 'Civil Eng', 'As a Civil Engineering student, you build the bones of civilization — the bridges, roads, and towers that outlast us. You follow Hephaestus, smith of the gods, whose works were made to endure.'),
  ('classical-studies', 'Classics', 'As a Classical Studies student, you walk the ancient world — its languages, myths, and ideas still shaping ours. You follow Mnemosyne, titaness of memory and mother of the muses, keeper of all that must not be forgotten.'),
  ('combinatorics-optimization', 'C&O', 'As a C&O student, you find the best possible path through impossible complexity — the optimal answer hidden in a sea of options. Athena, the strategist, claims those who win by out-thinking the problem.'),
  ('communication-studies', 'Comm', 'As a Communication student, you study how meaning moves — through media, message, and audience. You follow Hermes, messenger of the gods, master of every channel between one mind and another.'),
  ('computer-engineering', 'Comp. Eng', 'As a Computer Engineering student, you build the machines that think, from the silicon up. Hephaestus, the great maker, claims those who forge hardware and logic into one.'),
  ('computer-science', 'Comp. Sci', 'As a Computer Science student, you build machines of pure logic — systems that think, scale, and never sleep. You answer to Hephaestus, smith of the gods, who forged the first automata and whose craft is creation that works.'),
  ('computing-financial-management', 'CFM', 'As a CFM student, you code the systems that move money at the speed of light, fluent in both markets and machines. You follow Hermes, whose domain is wherever value travels fastest.'),
  ('criminology', 'Crim', 'As a Criminology student, you study crime, justice, and the reckoning that follows wrongdoing. You answer to Nemesis, goddess of retribution, who balances the scales no one else will.'),
  ('data-science', 'Data Sci', 'As a Data Science student, you find the pattern hidden in the noise, the signal no one else can see. You follow Metis, titaness of deep cunning, whose wisdom was so profound the king of the gods kept her counsel closest.'),
  ('digital-media-journalism', 'DMJ', 'As a DMJ student, you carry the story to the world, fast and true, across every screen. You follow Iris, the rainbow messenger, who bridges every distance to deliver the word.'),
  ('earth-sciences', 'Earth Sci', 'As an Earth Sciences student, you read the planet''s deep history in stone and strata, learning how worlds are made. Gaia, the primordial Earth, claims those who study the ground beneath everything.'),
  ('economics', 'Econ', 'As an Economics student, you chase the hidden logic behind every price, choice, and market — the invisible rules that move the world. You answer to Plutus, keeper of wealth, who rewards those who understand how abundance is made and lost.'),
  ('education', 'BEd', 'As an Education student, you take up the oldest noble calling — to teach. You serve Chiron, mentor of Achilles and Asclepius, the immortal teacher who raised heroes.'),
  ('electrical-engineering', 'Elec. Eng', 'As an Electrical Engineering student, you command the invisible force that powers everything. You follow Hephaestus, god of the forge, master of fire and the energy that drives the world.'),
  ('english', 'English', 'As an English student, you live inside language — its power to persuade, move, and outlast its author. You follow Calliope, eldest muse, who gave Homer his voice and makes words a lasting force.'),
  ('environmental-engineering', 'Env. Eng', 'As an Environmental Engineering student, you engineer the systems that protect the planet — clean water, clean air, a livable world. You answer to Gaia, the living Earth you are sworn to defend.'),
  ('environmental-science', 'Env. Sci', 'As an Environmental Science student, you study the living planet as one connected system — and fight to keep it whole. You answer to Gaia, the primordial Earth herself, oldest of all powers, mother of every living thing.'),
  ('film-studies', 'Film', 'As a Film Studies student, you study spectacle and story — how moving images seize a crowd. You answer to Dionysus, god of theatre and ecstasy, who rules the art of making people feel together.'),
  ('financial-mathematics', 'Fin. Math', 'As a Financial Math student, you price risk and tame uncertainty with equations most never see. You serve Plutus, god of wealth, who favours those who read the numbers beneath the money and bend them toward gain.'),
  ('fine-arts', 'Fine Arts', 'As a Fine Arts student, you create — turning vision into something the world can see. You follow Apollo, god of light and the arts, exacting master of every craft he touches.'),
  ('game-design', 'Game Dev', 'As a Game Design student, you build whole worlds out of code and imagination. Hephaestus, smith of the gods and maker of wonders, claims those who forge the impossible into play.'),
  ('gbda', 'GBDA', 'As a GBDA student, you fuse business, design, and technology into things people love to use. You follow Daedalus, the inventor who built what no one had built before.'),
  ('gender-studies', 'WGS', 'As a Women & Gender Studies student, you examine identity, power, and desire — how gender shapes every life. You follow Aphrodite, goddess of love and the self, who rules what moves the heart.'),
  ('geography', 'Geo', 'As a Geography student, you map the relationship between people and the planet they live on. Gaia, the living Earth, claims those who understand the land and all who move across it.'),
  ('geography-environmental-management', 'GEM', 'As a GEM student, you steward land and resources, balancing what people need against what the Earth can give. You answer to Gaia herself — the Earth you are sworn to manage well.'),
  ('geological-engineering', 'Geo. Eng', 'As a Geological Engineering student, you work the deep earth, reading the strata and drawing up what lies buried below. You pledge to Hades, lord of the underworld, keeper of the riches hidden beneath the surface.'),
  ('geomatics', 'Geomatics', 'As a Geomatics student, you turn the world into data, mapping and modelling the planet with precision. You follow Metis, titaness of cunning, whose gift is seeing the hidden pattern in everything.'),
  ('global-studies', 'Global', 'As a Global Studies student, you study a connected world — cultures, borders, and the flows between them. You follow Hermes, god of travel, who moves freely across every boundary.'),
  ('health-administration', 'Health Admin', 'As a Health Administration student, you build the systems that keep care running — the quiet order behind every hospital. Hygieia claims those who protect the many through good design.'),
  ('health-sciences', 'Health Sci', 'As a Health Sciences student, you learn how the body works, fails, and recovers — the whole science of staying alive. Asclepius, god of healing, claims those who master the body in order to mend it.'),
  ('history', 'History', 'As a History student, you keep the record of what truly happened, so the past can teach the present. You serve Clio, muse of history, who makes mortal deeds outlive the mortals who did them.'),
  ('international-development', 'Int''l Dev', 'As an International Development student, you work across borders to build a fairer world. Hermes, who crosses every threshold, claims those who carry change from one place to another.'),
  ('kinesiology', 'Kin', 'Heracles was born half-mortal and earned his place among the gods through labour alone — twelve impossible trials, each finished by sheer will. He made the mortal body the stuff of legend: proof that flesh and bone, pushed far enough, become something more.

As a Kinesiology student, you walk his path — surrounded by the like-minded, fuelled by the pursuit of understanding the body: where it breaks, where it bends, and where it can reach its fullest potential. You come to know it not as a mystery but as a machine of muscle and will. Every rep, every recovery, every limit broken is one of your own labours claimed.'),
  ('knowledge-integration', 'KI', 'As a Knowledge Integration student, you connect ideas across every discipline, building understanding no single field could reach. Metis, deepest of the wise, claims those who think across the lines.'),
  ('law-society', 'Law & Soc', 'As a Law & Society student, you study the rules that bind us and the justice beneath them. You serve Themis, titaness of divine law, who held the scales before they were ever written down.'),
  ('legal-studies', 'Legal', 'As a Legal Studies student, you learn how law orders society and protects the powerless from the powerful. Themis, goddess of justice, claims those who seek what is right.'),
  ('life-sciences', 'Life Sci', 'As a Life Sciences student, you explore the full web of living things, from molecules to ecosystems. You serve Gaia, mother of all life, from whom every organism descends.'),
  ('management-engineering', 'Mgmt Eng', 'As a Management Engineering student, you engineer the systems that make organizations run. Hephaestus, who built the automata of Olympus, claims those who design how the work itself moves.'),
  ('materials-nanosciences', 'Materials', 'As a Materials & Nanosciences student, you invent the substances the future will be built from. Hephaestus, smith of the gods, always knew the right material makes the maker.'),
  ('mathematical-economics', 'Math Econ', 'As a Math Economics student, you give the forces of markets the hard spine of proof. Under Plutus, you study not just what people choose, but the exact mathematics of why.'),
  ('mathematical-finance', 'Math Fin', 'As a Math Finance student, you model markets as living systems of risk and reward, pricing the future before it arrives. Plutus, god of wealth, claims those who turn volatility into opportunity.'),
  ('mathematical-physics', 'Math Phys', 'As a Math Physics student, you write the universe in equations exact enough to predict it. Atlas, who holds up the sky, claims those who shoulder its deepest questions.'),
  ('mathematics', 'Math', 'Athena won her city not with armies but with wisdom — born fully armoured from the mind of Zeus, she wages war by out-thinking it. She is the clear mind in the storm, the strategist who sees the victory before the first move is made.

As a Mathematics student, you fight as she does — pursuing truth in its purest form, where a single elegant argument settles what no amount of force ever could, and the right idea, once proven, stays true forever. Under her, the sharpest weapon is a sound mind, and the disciplined thinker always plans the win before the fight.'),
  ('mechanical-engineering', 'Mech. Eng', 'As a Mechanical Engineering student, you design the machines that move the world — engines, mechanisms, motion itself. You pledge to Hephaestus, smith of the gods, maker of every great machine.'),
  ('mechatronics-engineering', 'Mechatronics', 'As a Mechatronics student, you fuse machine and mind, building things that sense, think, and act. Hephaestus, who forged living automata, claims those who bring metal to life.'),
  ('music', 'Music', 'As a Music student, you turn sound into feeling, practising until the notes become second nature. You serve Euterpe, muse of music, named "the giver of delight."'),
  ('music-therapy', 'Music Th.', 'As a Music Therapy student, you heal through sound, reaching places medicine alone cannot. Hygieia, goddess of health and recovery, claims those who mend the whole person.'),
  ('nanotechnology-engineering', 'Nano. Eng', 'As a Nanotechnology Engineering student, you build at the scale of atoms, engineering matter itself. You follow Hephaestus, god of the forge, whose craft now reaches the smallest things there are.'),
  ('optometry', 'Optom', 'As an Optometry student, you restore one of the senses we fear losing most — sight itself. Asclepius, god of healing, claims those who give people back their clearest view of the world.'),
  ('peace-conflict-studies', 'Peace & Conflict', 'As a Peace & Conflict student, you study how societies break and how they are made whole again. You follow Themis, titaness of law and order, who stands for justice over force.'),
  ('pharmacy', 'Pharm', 'As a Pharmacy student, you master the medicines that mend us, one precise dose at a time. You follow Panacea, who carried the cure-all — the promise that for every ailment there is an answer.'),
  ('philosophy', 'Phil', 'As a Philosophy student, you chase the hardest questions there are — truth, meaning, what we owe each other. You answer to Athena, goddess of wisdom, for whom the clear argument is the highest victory.'),
  ('physics', 'Physics', 'As a Physics student, you seek the laws that hold the universe together, from the smallest particle to the turning of galaxies. You answer to Atlas, the titan who bears the heavens and carries the weight of the cosmos itself.'),
  ('policing', 'Policing', 'As a Policing student, you prepare to stand on the line between order and chaos. You answer to Ares, god of war, who meets conflict head-on and holds the ground others flee.'),
  ('political-science', 'Poli Sci', 'As a Political Science student, you study power itself — who holds it, how it''s kept, and how the state is ruled. You pledge to Zeus, king of the gods, lord of law and sovereignty, the final word on Olympus.'),
  ('psychology', 'Psych', 'As a Psychology student, you study the mind and heart — why people feel, choose, and break the way they do. You follow Psyche, whose very name means the soul: a mortal tested until she became divine.'),
  ('public-health', 'Public Health', 'As a Public Health student, you protect whole populations, stopping sickness before it ever starts. You serve Hygieia, goddess of prevention, who keeps the well strong rather than waiting to heal the sick.'),
  ('pure-mathematics', 'Pure Math', 'As a Pure Math student, you chase structure for its own sake, climbing toward ideas with no ceiling. Athena, goddess of reason, holds the elegant proof as its own kind of victory.'),
  ('recreation-leisure', 'Rec & Leisure', 'As a Recreation & Leisure student, you design the experiences that bring people together and keep them well. You follow Hermes, patron of movement and connection, wherever people gather and play.'),
  ('religion-culture', 'Religion', 'As a Religion & Culture student, you study belief itself — the sacred stories that give cultures meaning. You serve Polyhymnia, muse of sacred song, keeper of the solemn and the divine.'),
  ('religious-studies', 'Religious St.', 'As a Religious Studies student, you explore faith across the world''s traditions, seeking the meaning beneath the ritual. Polyhymnia, veiled muse of the sacred, claims those who study the deepest questions.'),
  ('science-business', 'Sci & Biz', 'As a Science & Business student, you carry discovery out of the lab and into the world, turning breakthroughs into things people can use. Hermes, god of trade and travel, claims those who bridge two worlds and profit in both.'),
  ('social-work', 'Social Work', 'As a Social Work student, you stand with people at their hardest moments, rebuilding the ground beneath them. Hestia, goddess of home and belonging, claims those who keep others'' fires from going out.'),
  ('sociology', 'Socio', 'As a Sociology student, you study the bonds that hold a society together — and the forces that pull it apart. You follow Hestia, goddess of the hearth and community, who keeps the shared fire lit.'),
  ('software-engineering', 'Soft. Eng', 'As a Software Engineering student, you build systems of pure logic, made to scale and made to last. Hephaestus, the great maker, claims those who forge software that holds under any load.'),
  ('speech-communication', 'Speech Comm', 'As a Speech Communication student, you learn to move a room with nothing but words. You serve Peitho, goddess of persuasion, whose gift is winning minds where others would use force.'),
  ('statistics', 'Stats', 'As a Statistics student, you measure chance itself and pull certainty out of the random. You serve the Moirai, the three Fates who spin, measure, and cut every thread — for even destiny obeys probability.'),
  ('systems-design-engineering', 'SYDE', 'As a SYDE student, you engineer whole systems, seeing how every part must serve the whole. You follow Daedalus, the architect-inventor, who designed solutions nothing could escape.'),
  ('theatre-performance', 'Theatre', 'As a Theatre student, you live for the stage — the mask, the crowd, the electric moment of live performance. Dionysus, god of theatre, claims those who give themselves fully to the show.'),
  ('urban-planning', 'Planning', 'As an Urban Planning student, you design the cities of the future — how people, movement, and space fit together. Daedalus, the master architect, claims those who plan the world people will live in.'),
  ('ux-design', 'UX', 'As a UX Design student, you design how people move through the things we build, making the complex feel effortless. You follow Daedalus, the master craftsman, who engineered a way through the Labyrinth itself.'),
  ('youth-childrens-studies', 'Youth St.', 'As a Youth & Children''s Studies student, you shape the people the next generation will become. You follow Chiron, wisest of teachers, who trained heroes and made others great.')
) as v(program_key, abbrev, lore) where pr.program_key = v.program_key;


-- ──────────────────── 4. the program reads, wider ────────────────────
drop function if exists get_my_program();
create function get_my_program()
returns table (
  program_id uuid, name text, program_key text, university text, patron_key text, patron_name text,
  patron_attribute text, patron_title text, program_abbrev text, program_lore text
)
language sql
stable
security definer
set search_path = public
as $$
  select pr.id, pr.name, pr.program_key, pr.university, pr.patron_key, pa.name, pa.attribute,
         pa.title, pr.abbrev, pr.lore
  from profiles p
  join programs pr on pr.id = p.program_id
  join patrons pa on pa.key = pr.patron_key
  where p.id = auth.uid();
$$;

drop function if exists get_programs_for_university(text);
create function get_programs_for_university(p_university text)
returns table (
  program_id uuid, name text, program_key text, patron_key text, patron_name text, patron_attribute text,
  patron_title text, program_abbrev text, program_lore text
)
language sql
stable
security definer
set search_path = public
as $$
  select pr.id, pr.name, pr.program_key, pr.patron_key, pa.name, pa.attribute, pa.title, pr.abbrev, pr.lore
  from programs pr
  join patrons pa on pa.key = pr.patron_key
  where pr.university = p_university
  order by pr.name;
$$;

revoke all on function get_my_program() from public;
revoke all on function get_programs_for_university(text) from public;
grant execute on function get_programs_for_university(text) to authenticated, anon;
grant execute on function get_my_program() to authenticated;

-- ──────────────────── 5. identity badges, batched ────────────────────
-- The program is the identity a student claimed in public ("shown to the world as an Heir to …"),
-- so it reads for anyone the caller can already see listed. Disabled and demo accounts read nothing.
create or replace function get_identity_badges(p_user_ids uuid[])
returns table (
  user_id uuid, university text, program_name text, program_abbrev text,
  patron_key text, patron_name text, patron_title text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.university, pr.name, pr.abbrev, pa.key, pa.name, pa.title
  from profiles p
  left join programs pr on pr.id = p.program_id
  left join patrons pa on pa.key = pr.patron_key
  where p.id = any (p_user_ids[1:200])
    and not p.is_demo and not p.is_disabled;
$$;

revoke all on function get_identity_badges(uuid[]) from public, anon;
grant execute on function get_identity_badges(uuid[]) to authenticated;

-- ──────────────────── 6. the program board gets the board gates ────────────────────
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
      and p.university_email_verified          -- 0264 · same gate as every board
      and can_see_rank(auth.uid(), p.id)       -- 0264 · 0170/0217
  )
  select r.user_id, r.handle, r.display_name, r.avatar_url, r.is_pro,
         r.score, r.tier, r.division, r.rank, (r.user_id = auth.uid()) as is_me
  from ranked r
  where p_limit is null or r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

-- ──────────────────── assertions ────────────────────
do $assert$
declare
  v_n int;
begin
  select count(*) into v_n from patrons where title is null;
  if v_n > 0 then raise exception '0264: % patrons have no title', v_n; end if;

  select count(*) into v_n from programs where abbrev is null or lore is null;
  if v_n > 0 then raise exception '0264: % programs lack an abbrev or lore', v_n; end if;

  select count(*) into v_n from programs where program_key = 'kinesiology' and lore like 'Heracles was born half-mortal%';
  if v_n <> 2 then raise exception '0264: expected the final Kinesiology lore on both schools, got %', v_n; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('get_my_program', 'get_programs_for_university');
  if v_n <> 2 then raise exception '0264: expected one overload each of the program reads, got %', v_n; end if;

  if not has_function_privilege('authenticated', 'public.get_my_program()', 'execute')
     or not has_function_privilege('anon', 'public.get_programs_for_university(text)', 'execute')
     or has_function_privilege('anon', 'public.get_identity_badges(uuid[])', 'execute') then
    raise exception '0264: grants on the program reads are wrong';
  end if;
end;
$assert$;

commit;
