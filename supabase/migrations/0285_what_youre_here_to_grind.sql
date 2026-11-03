-- 0285 . WHAT YOU'RE HERE TO GRIND — onboarding interests + goals, the matching cold-start signal
-- (CODE_PROMPT onboarding interests + goals, mock 323).
--
-- Onboarding asked who you are (handle, school, program) and nothing about what you're into, so
-- grind-alike matching (0275) — whose biggest term is the discipline-mix cosine over logged
-- check_ins — had NO signal for a brand-new account. This adds the declared signal and blends it in:
--
--   · interest_vocab — the canonical tag vocabulary: disciplines, interest-hub tags, goals. Every tag
--     a person can hold is a row here, so nothing free-text that can't be matched is ever stored.
--     Disciplines carry the discipline_bucket they mean (0272); disciplines and interests carry the
--     forests.tags they resolve to, so a picked tag finds real forests at read time — official or
--     user-made, cross-uni or this-uni-only — instead of pinning one forest id that goes stale.
--   · user_interests — what one person declared: disciplines[], interest_tags[], goals[]. RPC-only,
--     like match_settings and profile_identity, because profiles is world-readable (0272 header).
--     Program/major is NOT copied in: profiles.program_id stays the one source, and read paths fold
--     it into the tag set (a Kinesiology major meets someone who picked the Kinesiology tag).
--   · get_interest_vocab / get_my_interests / set_my_interests — the onboarding steps and the
--     Profile edit screen. Goals are INTENT, not a tracked target: nothing reads them as a goal row,
--     nothing gates on them, and both steps are skippable client-side (this is not the #19 gate).
--   · get_suggested_forests — forests to one-tap join from your tags + program (the reveal screen).
--
-- Restated from the LIVE prod bodies (pg_get_functiondef, 2026-10-27 — byte-identical to 0275/0274):
--   · grind_alike_rows — the similarity vector is built from what you DECLARED first, then blended
--     with the logged discipline mix as sessions accumulate. Per pair, w = min(sessions_a,
--     sessions_b) / 10 over the same 90 days, capped at 1:
--         discipline term = (40 + 12·(1−w)) · (w · mix_cos + (1−w) · declared_cos)
--         schedule term   = 12 · w · sched_cos         (no sessions, no schedule — its weight moves
--                                                       to the declared disciplines until there is)
--         shared tags     = 15 · ochiai(tags)           (declared interest tags ∪ program-implied)
--         goals           =  6 · ochiai(goals)
--         house 15 / goal-keywords 6 / streak band 5 / identity interests 6 — as before (8 → 6 on
--         goal keywords so the total stays at ~100).
--     ochiai(A, B) = |A ∩ B| / √(|A|·|B|) — cosine over 0/1 vectors, the same math on new inputs.
--     A person with no declared disciplines stands in with what they actually do (buckets ≥ 15% of
--     their time), so a day-0 account still meets the established users who never filled this in.
--     New reason chips: shared disciplines, shared interest tags, shared goals. Every chip now also
--     carries `icon` (a client IconName); `emoji` stays for installed builds, empty on the new ones.
--   · get_forests — "suggested" also reads your declared tags (one line, in `me`).
--
-- OPT-IN AND SAFETY ARE 0275's, UNCHANGED: candidates still come only from discoverable
-- match_settings rows through match_pair_ok (both people's scope + find_me, blocks both ways,
-- disabled / demo / test excluded), and get_grind_alikes still returns [] to a viewer who hasn't
-- opted in. Declaring interests does NOT opt you in; the reveal screen asks for that explicitly.
-- Minors: still no age data (18+ attestation at signup) — the school-scoped defaults are the guard.
--
-- Additive. No economy surface. NO db push from here.

-- ──────────────────── 1. the vocabulary ────────────────────
create table if not exists public.interest_vocab (
  key         text primary key check (key ~ '^[a-z0-9_]{2,32}$'),
  kind        text not null check (kind in ('discipline', 'interest', 'goal')),
  label       text not null,
  -- goals' second line ("Build the habit, hold a streak")
  sub         text,
  -- a client IconName (src/components/ui/icon.tsx); the client falls back on an unknown one
  icon        text not null,
  -- disciplines only: the discipline_bucket (0272) this means
  bucket      text check (bucket is null or bucket in ('study', 'deep_work', 'gym', 'run', 'other')),
  -- lowercase forests.tags this resolves to; also matched as whole words against a program's name
  forest_tags text[] not null default '{}',
  -- goals only: the chip a shared goal shows on a match ("Both chasing PRs")
  match_label text,
  -- shown up front on the onboarding step; the rest sit behind "+ more"
  featured    boolean not null default false,
  sort        integer not null default 100,
  -- retired tags stay (people may hold them) but are no longer offered or matched
  active      boolean not null default true,
  check ((kind = 'discipline') = (bucket is not null))
);

alter table public.interest_vocab enable row level security;   -- no policies: read through get_interest_vocab
revoke all on public.interest_vocab from public, anon, authenticated;

insert into public.interest_vocab (key, kind, label, sub, icon, bucket, forest_tags, match_label, featured, sort) values
  -- disciplines — the five buckets, labelled the way the lock-in picker says them
  ('study',          'discipline', 'Study',          null, 'study',     'study',     array['study', 'exams'],             null, true, 10),
  ('gym',            'discipline', 'Gym',            null, 'gym',       'gym',       array['gym'],                        null, true, 20),
  ('cardio',         'discipline', 'Cardio',         null, 'run',       'run',       array['run', 'cardio'],              null, true, 30),
  ('deep_work',      'discipline', 'Deep Work',      null, 'deep-work', 'deep_work', array['deep work', 'focus'],         null, true, 40),
  ('discipline',     'discipline', 'Discipline',     null, 'timer',     'other',     array['morning', 'routine'],         null, true, 50),
  -- interest hubs — the mock's seven up front, then the "+ more" set
  ('pre_med',        'interest', 'Pre-med',          null, 'heart',     null, array['pre-med', 'premed', 'mcat', 'medicine'], null, true, 10),
  ('powerlifting',   'interest', 'Powerlifting',     null, 'gym',       null, array['powerlifting', 'strength'],     null, true, 20),
  ('compsci',        'interest', 'CompSci',          null, 'bolt',      null, array['compsci', 'computer science', 'coding', 'programming'], null, true, 30),
  ('languages',      'interest', 'Languages',        null, 'chat',      null, array['languages', 'language'],        null, true, 40),
  ('kinesiology',    'interest', 'Kinesiology',      null, 'run',       null, array['kinesiology', 'kin'],           null, true, 50),
  ('finance',        'interest', 'Finance',          null, 'chart',     null, array['finance', 'investing', 'accounting'], null, true, 60),
  ('design',         'interest', 'Design',           null, 'sparkle',   null, array['design', 'ux'],                 null, true, 70),
  ('engineering',    'interest', 'Engineering',      null, 'compass',   null, array['engineering'],                  null, false, 100),
  ('nursing',        'interest', 'Nursing',          null, 'hand',      null, array['nursing'],                      null, false, 110),
  ('pre_law',        'interest', 'Pre-law',          null, 'shield',    null, array['pre-law', 'prelaw', 'law', 'lsat'], null, false, 120),
  ('business',       'interest', 'Business',         null, 'card',      null, array['business', 'entrepreneurship'], null, false, 130),
  ('psychology',     'interest', 'Psychology',       null, 'deep-work', null, array['psychology', 'psych'],          null, false, 140),
  ('biology',        'interest', 'Biology',          null, 'sprout',    null, array['biology', 'bio', 'life sciences'], null, false, 150),
  ('math',           'interest', 'Math',             null, 'notes',     null, array['math', 'mathematics', 'statistics'], null, false, 160),
  ('writing',        'interest', 'Writing',          null, 'edit',      null, array['writing', 'english'],           null, false, 170),
  ('music',          'interest', 'Music',            null, 'music',     null, array['music'],                        null, false, 180),
  ('running',        'interest', 'Running',          null, 'run',       null, array['run', 'running', 'marathon'],   null, false, 190),
  ('early_riser',    'interest', 'Early riser',      null, 'clock',     null, array['morning', '6am'],               null, false, 200),
  ('exam_season',    'interest', 'Exam season',      null, 'read',      null, array['exams', 'finals'],              null, false, 210),
  -- goals — intent, never a tracked target
  ('lock_in_more',   'goal', 'Lock in more',             'Build the habit, hold a streak',  'flame',   null, '{}', 'Both locking in more', true, 10),
  ('climb',          'goal', 'Hit a PR / climb a board', 'Compete when I want the smoke',   'trophy',  null, '{}', 'Both chasing PRs',     true, 20),
  ('meet_people',    'goal', 'Meet people to grind with','Find my crew / a campfire',       'friends', null, '{}', 'Both looking for a crew', true, 30),
  ('school',         'goal', 'Stay on top of school',    'Study hours, grades, deadlines',  'study',   null, '{}', 'Both school-first',    true, 40)
on conflict (key) do nothing;

-- Official forests for the featured hubs that had none, so every featured tag resolves to a forest
-- somewhere (0274 §7 seeded pre-med / powerlifting / kinesiology; the last two are Laurier-only).
insert into public.forests (name, purpose, emoji, visibility, university, tags, is_official)
select v.name, v.purpose, v.emoji, 'open', null, v.tags, true
  from (values
    ('CompSci grind',    'Problem sets, side projects, LeetCode at 2am.', '💻', array['compsci', 'coding']),
    ('Language lab',     'Daily reps in the language you''re learning.',  '🗣️', array['languages']),
    ('Finance & markets','CFA, accounting, case comps, the market open.', '📈', array['finance', 'investing']),
    ('Design crit',      'Studio hours, portfolios, honest feedback.',    '🎨', array['design', 'ux'])
  ) as v(name, purpose, emoji, tags)
 where not exists (
   select 1 from forests f
    where f.removed_at is null and lower(btrim(f.name)) = lower(v.name) and f.university is null);

-- ──────────────────── 2. what one person declared ────────────────────
create table if not exists public.user_interests (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  disciplines   text[] not null default '{}' check (cardinality(disciplines) <= 5),
  interest_tags text[] not null default '{}' check (cardinality(interest_tags) <= 12),
  goals         text[] not null default '{}' check (cardinality(goals) <= 4),
  updated_at    timestamptz not null default now()
);

alter table public.user_interests enable row level security;   -- no policies: RPC-only
revoke all on public.user_interests from public, anon, authenticated;

comment on table public.user_interests is
  '0285 -- declared disciplines / interest tags / goals (keys of interest_vocab). Matching input; RPC-only.';

-- ──────────────────── 3. helpers ────────────────────
-- Lowercase, dedupe (first wins), check each key against the vocabulary. An unknown key is an
-- error (a client bug, not user input); a retired one is dropped quietly so an old build's pick
-- doesn't block a save.
create or replace function public.interest_clean(p_keys text[], p_kind text, p_max integer)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text;
  v_out text[] := '{}';
  v_active boolean;
begin
  foreach v_key in array coalesce(p_keys, '{}') loop
    v_key := lower(btrim(coalesce(v_key, '')));
    continue when v_key = '' or v_key = any (v_out);
    v_active := null;   -- SELECT INTO leaves it untouched on no row; don't inherit the last key's
    select iv.active into v_active from interest_vocab iv where iv.key = v_key and iv.kind = p_kind;
    if v_active is null then raise exception 'Unknown %: %', p_kind, v_key; end if;
    continue when not v_active;
    v_out := v_out || v_key;
  end loop;
  if cardinality(v_out) > p_max then raise exception 'Pick up to % of those.', p_max; end if;
  return v_out;
end;
$$;

-- Cosine over 0/1 vectors: |A ∩ B| / √(|A|·|B|). 0 when either side is empty. Inputs are deduped
-- by their producers (interest_clean, array_agg(distinct …)).
create or replace function public.match_ochiai(p_a text[], p_b text[])
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(cardinality(p_a), 0) = 0 or coalesce(cardinality(p_b), 0) = 0 then 0::numeric
    else (select count(*) from (select unnest(p_a) intersect select unnest(p_b)) i)::numeric
         / sqrt(cardinality(p_a)::numeric * cardinality(p_b))
  end;
$$;

-- The interest tags a program implies: a vocab tag whose forest_tags appear as a whole word in the
-- program's name or abbreviation. 3+ letters only, so 'cs' can't match inside a word.
create or replace function public.program_interest_tags(p_program uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct iv.key), '{}')
    from programs pr
    join interest_vocab iv on iv.kind = 'interest' and iv.active
   where pr.id = p_program
     and exists (select 1 from unnest(iv.forest_tags) t
                  where length(t) >= 3
                    and lower(concat_ws(' ', pr.name, pr.abbrev)) ~ ('\m' || t || '\M'));
$$;

-- ──────────────────── 4. the onboarding / edit reads + write ────────────────────
create or replace function public.get_interest_vocab()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', iv.key, 'kind', iv.kind, 'label', iv.label, 'sub', iv.sub, 'icon', iv.icon,
           'featured', iv.featured,
           -- how many forests this tag would find for you (the "+ more" search shows it)
           'forest_count', (select count(*)::int from forests f
                             where f.removed_at is null and f.tags && iv.forest_tags
                               and (f.university is null or f.university = me.university))
         ) order by iv.kind, iv.sort, iv.key), '[]'::jsonb)
    from interest_vocab iv
    cross join (select p.university from profiles p where p.id = auth.uid()) me
   where iv.active;
$$;

create or replace function public.get_my_interests()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'disciplines', to_jsonb(coalesce(ui.disciplines, '{}'::text[])),
    'interest_tags', to_jsonb(coalesce(ui.interest_tags, '{}'::text[])),
    'goals', to_jsonb(coalesce(ui.goals, '{}'::text[])),
    -- the tags your program already implies, so the picker can show them as "from your program"
    'program_tags', to_jsonb(program_interest_tags(p.program_id)),
    'updated_at', ui.updated_at
  )
  from profiles p
  left join user_interests ui on ui.user_id = p.id
  where p.id = auth.uid();
$$;

-- A patch: a null argument leaves that list as it is; an empty array clears it.
drop function if exists public.set_my_interests(text[], text[], text[]);
create function public.set_my_interests(
  p_disciplines text[] default null,
  p_interest_tags text[] default null,
  p_goals text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_row user_interests;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;

  select * into v_row from user_interests ui where ui.user_id = v_me;
  if v_row.user_id is null then
    v_row := row(v_me, '{}', '{}', '{}', now())::user_interests;
  end if;

  if p_disciplines is not null then v_row.disciplines := interest_clean(p_disciplines, 'discipline', 5); end if;
  if p_interest_tags is not null then v_row.interest_tags := interest_clean(p_interest_tags, 'interest', 12); end if;
  if p_goals is not null then v_row.goals := interest_clean(p_goals, 'goal', 4); end if;

  insert into user_interests as ui (user_id, disciplines, interest_tags, goals, updated_at)
  values (v_me, v_row.disciplines, v_row.interest_tags, v_row.goals, now())
  on conflict (user_id) do update
    set disciplines = excluded.disciplines, interest_tags = excluded.interest_tags,
        goals = excluded.goals, updated_at = now();

  return get_my_interests();
end;
$$;

-- Forests to join, from your declared disciplines + interest tags + program. Only forests you could
-- find in browse (get_forests' rules: not removed, cross-uni or your uni, creator not blocked either
-- way) and are not already in, waiting on, or removed from. Strongest overlap first, then this-uni
-- forests, then the busiest.
drop function if exists public.get_suggested_forests(integer);
create function public.get_suggested_forests(p_limit integer default 6)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.id, p.university, program_interest_tags(p.program_id) as prog_tags,
           coalesce(ui.disciplines, '{}') || coalesce(ui.interest_tags, '{}') as declared
      from profiles p
      left join user_interests ui on ui.user_id = p.id
     where p.id = auth.uid()
  ),
  mine as (
    select iv.key, iv.label, iv.icon, iv.forest_tags, iv.kind, iv.sort
      from interest_vocab iv cross join me
     where iv.active and iv.kind in ('discipline', 'interest')
       and (iv.key = any (me.declared) or iv.key = any (me.prog_tags))
  ),
  scored as (
    select f.id, f.name, f.purpose, f.emoji, f.visibility, f.university, f.is_official,
           m.n_hits, m.label, m.icon,
           (select count(*)::int from forest_members fm where fm.forest_id = f.id and fm.status = 'active') as member_count,
           forest_locked_in_now(f.id) as locked_in_now
      from forests f
      cross join me
      cross join lateral (
        -- interests outrank disciplines: "Pre-med" is a better label for a forest than "Study"
        select count(*)::int as n_hits,
               (array_agg(mi.label order by (mi.kind = 'interest') desc, mi.sort))[1] as label,
               (array_agg(mi.icon order by (mi.kind = 'interest') desc, mi.sort))[1] as icon
          from mine mi where f.tags && mi.forest_tags
      ) m
     where f.removed_at is null
       and m.n_hits > 0
       and (f.university is null or f.university = me.university)
       and forest_status_of(f.id, me.id) is null
       and (f.created_by is null or not exists (
             select 1 from blocked_users b
              where (b.blocker_id = me.id and b.blocked_id = f.created_by)
                 or (b.blocker_id = f.created_by and b.blocked_id = me.id)))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'purpose', s.purpose, 'emoji', s.emoji,
           'visibility', s.visibility, 'university', s.university, 'is_official', s.is_official,
           'member_count', s.member_count, 'locked_in_now', s.locked_in_now,
           'because', s.label, 'icon', s.icon
         ) order by s.n_hits desc, (s.university is not null) desc, s.member_count desc, s.name), '[]'::jsonb)
    from (select * from scored
           order by n_hits desc, (university is not null) desc, member_count desc, name
           limit least(greatest(coalesce(p_limit, 6), 1), 20)) s;
$$;

-- ──────────────────── 5. the engine, restated (live body + the declared signal) ────────────────────
create or replace function public.grind_alike_rows(p_viewer uuid, p_only uuid default null, p_scope text default null)
returns table(o_user uuid, o_score integer, o_reasons jsonb, o_my_mix jsonb, o_their_mix jsonb,
              o_live boolean, o_is_friend boolean, o_identity_visible boolean)
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select p.id, p.university, p.program_id, pr.patron_key, coalesce(p.current_streak, 0) as streak,
           coalesce(nullif(p_scope, ''), (select ms.match_scope from match_settings ms where ms.user_id = p.id), 'uni') as scope
      from profiles p left join programs pr on pr.id = p.program_id
     where p.id = p_viewer
  ),
  cands as (
    select c.id, c.university, c.program_id, pr.patron_key, pr.abbrev, pa.name as patron_name,
           coalesce(c.current_streak, 0) as streak
      from v
      join match_settings ms on ms.discoverable and ms.user_id <> v.id
      join profiles c on c.id = ms.user_id
      left join programs pr on pr.id = c.program_id
      left join patrons pa on pa.key = pr.patron_key
     where (p_only is null or c.id = p_only)
       -- The viewer's chosen scope narrows first (cheap prefilter), then match_pair_ok checks both
       -- people's full settings.
       and case v.scope
             when 'program' then v.program_id is not null and c.program_id = v.program_id
             when 'uni' then v.university is not null and c.university = v.university
             else true
           end
       and match_pair_ok(v.id, c.id)
     limit 300
  ),
  people as (select v.id from v union all select cands.id from cands),
  tz as (select name from pg_timezone_names),
  sess as (
    select c.user_id,
           discipline_bucket(c.goal_type, c.category) as bucket,
           greatest(coalesce(c.duration_seconds, 0), 60)::numeric as secs,
           extract(hour from (c.created_at - make_interval(secs => coalesce(c.duration_seconds, 0)))
                   at time zone coalesce(tz.name, 'America/Toronto'))::int as hr
      from check_ins c
      join profiles p on p.id = c.user_id
      left join tz on tz.name = p.timezone
     where c.user_id in (select id from people)
       and c.removed_at is null
       and c.created_at > now() - interval '90 days'
  ),
  mix as (
    select s.user_id,
           sum(case when s.bucket = 'study' then s.secs else 0 end) as study,
           sum(case when s.bucket = 'deep_work' then s.secs else 0 end) as deep_work,
           sum(case when s.bucket = 'gym' then s.secs else 0 end) as gym,
           sum(case when s.bucket = 'run' then s.secs else 0 end) as run,
           sum(case when s.bucket = 'other' then s.secs else 0 end) as other,
           sum(case when s.hr between 4 and 8 then s.secs else 0 end) as h_early,
           sum(case when s.hr between 9 and 16 then s.secs else 0 end) as h_day,
           sum(case when s.hr between 17 and 20 then s.secs else 0 end) as h_eve,
           sum(case when s.hr >= 21 or s.hr <= 3 then s.secs else 0 end) as h_night,
           sum(s.secs) as total,
           count(*) as n
      from sess s group by s.user_id
  ),
  ident as (
    select pi.user_id,
           match_keywords(concat_ws(' ', pi.career_goal, pi.working_toward)) as kw,
           coalesce(pi.interests, '{}') as interests,
           pi.working_toward
      from profile_identity pi where pi.user_id in (select id from people)
  ),
  -- 0285: the declared signal per person. Disciplines as buckets — or, with none declared, the
  -- buckets they actually spend ≥ 15% of their time in. Tags = declared ∪ what their program implies.
  sig as (
    select pe.id as user_id,
           coalesce(
             (select array_agg(distinct iv.bucket) from interest_vocab iv
               where iv.kind = 'discipline' and iv.active and iv.key = any (ui.disciplines)),
             (select array_agg(x.b) from (values ('study', m.study), ('deep_work', m.deep_work), ('gym', m.gym),
                                                 ('run', m.run), ('other', m.other)) x(b, secs)
               where m.total > 0 and x.secs / m.total >= 0.15),
             '{}') as buckets,
           (select coalesce(array_agg(distinct t), '{}') from unnest(
              coalesce((select array_agg(k) from unnest(ui.interest_tags) k
                         where exists (select 1 from interest_vocab iv where iv.key = k and iv.active)), '{}')
              || program_interest_tags(pp.program_id)) t) as tags,
           coalesce((select array_agg(k) from unnest(ui.goals) k
                      where exists (select 1 from interest_vocab iv where iv.key = k and iv.active)), '{}') as goals,
           coalesce(m.n, 0) as n
      from people pe
      join profiles pp on pp.id = pe.id
      left join user_interests ui on ui.user_id = pe.id
      left join mix m on m.user_id = pe.id
  ),
  scored as (
    select c.id,
           c.abbrev, c.patron_name, c.streak,
           -- coalesce: a null on either side must read as "not shared", not as unknown — an
           -- unknown here silently drops the chip (`not null` is null, and the WHERE fails).
           coalesce(c.program_id = v.program_id, false) as same_program,
           coalesce(c.patron_key = v.patron_key, false) as same_patron,
           coalesce(c.university = v.university, false) as same_uni,
           identity_visible_to(c.id, v.id) as id_visible,
           -- cosine of the five-bucket mixes
           coalesce(
             (mv.study * mc.study + mv.deep_work * mc.deep_work + mv.gym * mc.gym + mv.run * mc.run + mv.other * mc.other)
             / nullif(sqrt(mv.study^2 + mv.deep_work^2 + mv.gym^2 + mv.run^2 + mv.other^2)
                    * sqrt(mc.study^2 + mc.deep_work^2 + mc.gym^2 + mc.run^2 + mc.other^2), 0), 0) as mix_cos,
           coalesce(
             (mv.h_early * mc.h_early + mv.h_day * mc.h_day + mv.h_eve * mc.h_eve + mv.h_night * mc.h_night)
             / nullif(sqrt(mv.h_early^2 + mv.h_day^2 + mv.h_eve^2 + mv.h_night^2)
                    * sqrt(mc.h_early^2 + mc.h_day^2 + mc.h_eve^2 + mc.h_night^2), 0), 0) as sched_cos,
           mv.study / nullif(mv.total, 0) as v_study, mc.study / nullif(mc.total, 0) as c_study,
           mv.deep_work / nullif(mv.total, 0) as v_deep, mc.deep_work / nullif(mc.total, 0) as c_deep,
           mv.gym / nullif(mv.total, 0) as v_gym, mc.gym / nullif(mc.total, 0) as c_gym,
           mv.run / nullif(mv.total, 0) as v_run, mc.run / nullif(mc.total, 0) as c_run,
           mv.h_early / nullif(mv.total, 0) as v_early, mc.h_early / nullif(mc.total, 0) as c_early,
           mv.h_night / nullif(mv.total, 0) as v_night, mc.h_night / nullif(mc.total, 0) as c_night,
           coalesce(iv.kw, '{}') && coalesce(ic.kw, '{}') as goal_overlap,
           (select coalesce(array_agg(t), '{}') from unnest(coalesce(ic.interests, '{}')) t
             where t = any (coalesce(iv.interests, '{}'))) as shared_interests,
           (v.streak >= 7 and c.streak >= 7 and abs(v.streak - c.streak) <= 7) as streak_band,
           least(v.streak, c.streak) as band_streak,
           -- 0285: how far the logged mix has taken over from the declared one, for this pair
           least(1.0, least(sv.n, sc.n) / 10.0) as w,
           match_ochiai(sv.buckets, sc.buckets) as decl_cos,
           match_ochiai(sv.tags, sc.tags) as tag_sim,
           match_ochiai(sv.goals, sc.goals) as goal_sim,
           (select coalesce(array_agg(b), '{}') from unnest(sc.buckets) b where b = any (sv.buckets)) as shared_buckets,
           (select coalesce(array_agg(t), '{}') from unnest(sc.tags) t where t = any (sv.tags)) as shared_tags,
           (select coalesce(array_agg(g), '{}') from unnest(sc.goals) g where g = any (sv.goals)) as shared_goals
      from cands c
      cross join v
      left join mix mv on mv.user_id = v.id
      left join mix mc on mc.user_id = c.id
      left join ident iv on iv.user_id = v.id
      left join ident ic on ic.user_id = c.id
      join sig sv on sv.user_id = v.id
      join sig sc on sc.user_id = c.id
  ),
  final as (
    select s.*,
           least(100, round(
               (40 + 12 * (1 - s.w)) * (s.w * s.mix_cos + (1 - s.w) * s.decl_cos)
             + 12 * s.w * s.sched_cos
             + greatest(case when s.same_program then 15 else 0 end,
                        case when s.same_uni then 8 else 0 end,
                        case when s.same_patron then 4 else 0 end)
             + 15 * s.tag_sim
             + 6 * s.goal_sim
             + case when s.id_visible and s.goal_overlap then 6 else 0 end
             + case when s.streak_band then 5 else 0 end
             + case when s.id_visible then least(cardinality(s.shared_interests), 3) * 2 else 0 end
           ))::int as score,
           -- Shared declared disciplines the activity chips below don't already say.
           (select string_agg(dv.label, ' + ' order by dv.sort) from interest_vocab dv
             where dv.kind = 'discipline' and dv.active and dv.bucket = any (s.shared_buckets)
               and not case dv.bucket
                         when 'study' then coalesce(s.v_study >= 0.3 and s.c_study >= 0.3, false)
                         when 'deep_work' then coalesce(s.v_deep >= 0.3 and s.c_deep >= 0.3, false)
                         when 'gym' then coalesce(s.v_gym >= 0.15 and s.c_gym >= 0.15, false)
                         when 'run' then coalesce(s.v_run >= 0.15 and s.c_run >= 0.15, false)
                         else false
                       end) as decl_label,
           (select dv.icon from interest_vocab dv
             where dv.kind = 'discipline' and dv.active and dv.bucket = any (s.shared_buckets)
             order by dv.sort limit 1) as decl_icon
      from scored s
  )
  select f.id,
         f.score,
         -- Reasons, strongest first; the client shows the top 2–4.
         (select coalesce(jsonb_agg(r.chip order by r.w desc), '[]'::jsonb) from (
            select 30::numeric as w, jsonb_build_object('key', 'deep', 'emoji', '🧠', 'icon', 'deep-work', 'label', 'Deep-work grinder') as chip
             where f.v_deep >= 0.3 and f.c_deep >= 0.3
            union all select 29, jsonb_build_object('key', 'study', 'emoji', '📚', 'icon', 'study', 'label', 'Study-heavy')
             where f.v_study >= 0.3 and f.c_study >= 0.3
            union all select 28, jsonb_build_object('key', 'gym', 'emoji', '🏋️', 'icon', 'gym',
                              'label', case when f.v_gym >= 0.3 and f.c_gym >= 0.3 then 'Gym regular' else 'Gym too' end)
             where f.v_gym >= 0.15 and f.c_gym >= 0.15
            union all select 27, jsonb_build_object('key', 'run', 'emoji', '🏃', 'icon', 'run', 'label', 'Runner')
             where f.v_run >= 0.15 and f.c_run >= 0.15
            union all select 26.5, jsonb_build_object('key', 'disciplines', 'emoji', '', 'icon', coalesce(f.decl_icon, 'session'),
                              'label', f.decl_label)
             where f.decl_label is not null
            union all select 26, jsonb_build_object('key', 'house', 'emoji', '🎓', 'icon', 'campus',
                              'label', coalesce(f.abbrev, 'Same program') || ' · same house')
             where f.same_program
            union all select 25.5, jsonb_build_object('key', 'tag:' || tv.key, 'emoji', '', 'icon', tv.icon, 'label', tv.label)
              from interest_vocab tv
             where tv.key = any (f.shared_tags)
            union all select 25, jsonb_build_object('key', 'patron', 'emoji', '⬡', 'icon', 'shield', 'label', 'Heirs of ' || f.patron_name)
             where not f.same_program and f.same_patron and f.patron_name is not null
            union all select 24, jsonb_build_object('key', 'uni', 'emoji', '📍', 'icon', 'campus', 'label', 'Same uni')
             where not f.same_program and not f.same_patron and f.same_uni
            union all select 23, jsonb_build_object('key', 'goal', 'emoji', '🎯', 'icon', 'target', 'label', 'Same goal')
             where f.id_visible and f.goal_overlap
            union all select 22, jsonb_build_object('key', 'early', 'emoji', '🌅', 'icon', 'clock', 'label', '6am')
             where f.v_early >= 0.35 and f.c_early >= 0.35
            union all select 21.5, jsonb_build_object('key', 'intent:' || gv.key, 'emoji', '', 'icon', gv.icon,
                              'label', coalesce(gv.match_label, gv.label))
              from interest_vocab gv
             where gv.kind = 'goal' and gv.key = any (f.shared_goals)
            union all select 21, jsonb_build_object('key', 'night', 'emoji', '🦉', 'icon', 'clock', 'label', 'Night owl')
             where f.v_night >= 0.35 and f.c_night >= 0.35
            union all select 20, jsonb_build_object('key', 'streak', 'emoji', '🔥', 'icon', 'streak',
                              'label', (f.band_streak / 7 * 7) || '-day streak club')
             where f.streak_band
            union all select 10, jsonb_build_object('key', 'interest:' || i, 'emoji', '✨', 'icon', 'sparkle', 'label', i)
              from unnest(f.shared_interests) i
             where f.id_visible
          ) r),
         -- Both mixes as percentages, for the detail screen's overlap bars.
         jsonb_build_object('study', round(100 * coalesce(f.v_study, 0)), 'deep_work', round(100 * coalesce(f.v_deep, 0)),
                            'gym', round(100 * coalesce(f.v_gym, 0)), 'run', round(100 * coalesce(f.v_run, 0))),
         jsonb_build_object('study', round(100 * coalesce(f.c_study, 0)), 'deep_work', round(100 * coalesce(f.c_deep, 0)),
                            'gym', round(100 * coalesce(f.c_gym, 0)), 'run', round(100 * coalesce(f.c_run, 0))),
         -- Live: only through the account's show_live_status, and to non-friends only if they opted in.
         exists (select 1 from lock_in_sessions s
                  where s.user_id = f.id and s.status = 'active' and not coalesce(s.paused, false))
           and coalesce((select p.show_live_status from profiles p where p.id = f.id), true)
           and (are_friends(p_viewer, f.id)
                or coalesce((select ms.show_live from match_settings ms where ms.user_id = f.id), false)),
         are_friends(p_viewer, f.id),
         f.id_visible
    from final f;
$$;

-- ──────────────────── 6. get_forests, restated: "suggested" reads declared tags too ────────────────────
create or replace function public.get_forests(p_sort text default 'active', p_query text default null, p_limit integer default 40)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.id, p.university,
           coalesce((select pi.interests from profile_identity pi where pi.user_id = p.id), '{}')
             -- 0285: the forest tags of what you declared at onboarding
             || coalesce((select array_agg(distinct t)
                            from user_interests ui
                            join interest_vocab iv on iv.active and iv.key = any (ui.disciplines || ui.interest_tags)
                            cross join unnest(iv.forest_tags) t
                           where ui.user_id = p.id), '{}') as interests,
           (select lower(coalesce(pr.name, '') || ' ' || coalesce(pr.abbrev, '')) from programs pr where pr.id = p.program_id) as program
      from profiles p where p.id = auth.uid()
  ),
  q as (select nullif(btrim(lower(coalesce(p_query, ''))), '') as q),
  base as (
    select f.*,
           forest_status_of(f.id, me.id) as my_status,
           (select count(*)::int from forest_members fm where fm.forest_id = f.id and fm.status = 'active') as member_count,
           forest_locked_in_now(f.id) as locked_in_now,
           (select count(*)::int from agora_posts ap where ap.forest_id = f.id and ap.created_at > now() - interval '24 hours') as posts_24h,
           (select count(*)::int from groups g where g.forest_id = f.id) as campfire_count,
           ( (case when f.university is not null and f.university = me.university then 2 else 0 end)
           + (case when f.tags && me.interests then 2 else 0 end)
           + (case when me.program is not null and exists (
                select 1 from unnest(f.tags) t where length(t) >= 3 and me.program like '%' || t || '%') then 2 else 0 end)
           ) as suggest_score
      from forests f, me, q
     where f.removed_at is null
       and (f.university is null or f.university = me.university or forest_status_of(f.id, me.id) = 'active')
       and coalesce(forest_status_of(f.id, me.id), '') <> 'removed'
       and (f.created_by is null or not exists (
             select 1 from blocked_users b
              where (b.blocker_id = me.id and b.blocked_id = f.created_by)
                 or (b.blocker_id = f.created_by and b.blocked_id = me.id)))
       and (q.q is null
            or lower(f.name) like '%' || q.q || '%'
            or lower(coalesce(f.purpose, '')) like '%' || q.q || '%'
            or exists (select 1 from unnest(f.tags) t where t like '%' || q.q || '%'))
       and (coalesce(p_sort, 'active') <> 'mine' or forest_status_of(f.id, me.id) in ('active', 'pending'))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'name', b.name, 'purpose', b.purpose, 'emoji', b.emoji, 'cover_url', b.cover_url,
           'visibility', b.visibility, 'university', b.university, 'tags', to_jsonb(b.tags),
           'is_official', b.is_official, 'my_status', b.my_status,
           'member_count', b.member_count, 'locked_in_now', b.locked_in_now, 'posts_24h', b.posts_24h,
           'campfire_count', b.campfire_count,
           'pulse', b.locked_in_now > 0 or b.posts_24h > 0,
           'suggested', b.suggest_score > 0,
           'created_at', b.created_at
         ) order by
           case coalesce(p_sort, 'active')
             when 'new' then extract(epoch from b.created_at)
             when 'popular' then b.member_count::numeric
             else (b.locked_in_now * 10 + b.posts_24h * 3 + b.suggest_score * 5 + least(b.member_count, 50))::numeric
           end desc,
           b.member_count desc, b.created_at desc), '[]'::jsonb)
    from (select * from base
           order by case coalesce(p_sort, 'active')
                      when 'new' then extract(epoch from base.created_at)
                      when 'popular' then base.member_count::numeric
                      else (base.locked_in_now * 10 + base.posts_24h * 3 + base.suggest_score * 5 + least(base.member_count, 50))::numeric
                    end desc
           limit least(greatest(coalesce(p_limit, 40), 1), 100)) b;
$$;

-- ──────────────────── 7. grants ────────────────────
revoke all on function public.interest_clean(text[], text, integer) from public, anon, authenticated;
revoke all on function public.match_ochiai(text[], text[]) from public, anon, authenticated;
revoke all on function public.program_interest_tags(uuid) from public, anon, authenticated;
revoke all on function public.grind_alike_rows(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_interest_vocab() from public, anon;
revoke all on function public.get_my_interests() from public, anon;
revoke all on function public.set_my_interests(text[], text[], text[]) from public, anon;
revoke all on function public.get_suggested_forests(integer) from public, anon;
revoke all on function public.get_forests(text, text, integer) from public, anon;
grant execute on function public.get_interest_vocab() to authenticated;
grant execute on function public.get_my_interests() to authenticated;
grant execute on function public.set_my_interests(text[], text[], text[]) to authenticated;
grant execute on function public.get_suggested_forests(integer) to authenticated;
grant execute on function public.get_forests(text, text, integer) to authenticated;

-- ──────────────────── assertions ────────────────────
do $assert$
declare
  v_missing text;
begin
  -- Every featured hub tag resolves to at least one live official forest (cross-uni or not).
  select string_agg(iv.key, ', ') into v_missing
    from interest_vocab iv
   where iv.kind = 'interest' and iv.featured and iv.active
     and not exists (select 1 from forests f
                      where f.removed_at is null and f.is_official and f.tags && iv.forest_tags);
  if v_missing is not null then raise exception '0285: featured tags with no forest: %', v_missing; end if;

  -- The math, both ways: a shared pair scores, a disjoint pair doesn't.
  if abs(match_ochiai(array['study', 'gym'], array['gym']) - 1 / sqrt(2::numeric)) > 1e-9 then
    raise exception '0285: ochiai({study,gym},{gym}) should be 1/sqrt(2), got %', match_ochiai(array['study', 'gym'], array['gym']);
  end if;
  if match_ochiai(array['study'], array['gym']) <> 0 or match_ochiai('{}', array['gym']) <> 0 then
    raise exception '0285: ochiai of disjoint / empty sets must be 0';
  end if;

  -- The program fold, both ways: every program named for Kinesiology implies the tag, and one that
  -- isn't (no "kin" word in it) doesn't.
  if exists (select 1 from programs pr
              where lower(pr.name) ~ '\mkinesiology\M'
                and not ('kinesiology' = any (program_interest_tags(pr.id)))) then
    raise exception '0285: a Kinesiology program does not imply the kinesiology tag';
  end if;
  if exists (select 1 from programs pr
              where lower(concat_ws(' ', pr.name, pr.abbrev)) !~ '\mkin(esiology)?\M'
                and 'kinesiology' = any (program_interest_tags(pr.id))) then
    raise exception '0285: a non-Kinesiology program implies the kinesiology tag';
  end if;

  -- RPC-only, and the engine still not client-callable.
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name in ('user_interests', 'interest_vocab')
                and grantee in ('anon', 'authenticated')) then
    raise exception '0285: user_interests / interest_vocab must be RPC-only';
  end if;
  if has_function_privilege('authenticated', 'public.grind_alike_rows(uuid,uuid,text)', 'execute') then
    raise exception '0285: the engine takes a viewer id and must not be client-callable';
  end if;
  if has_function_privilege('anon', 'public.set_my_interests(text[],text[],text[])', 'execute') then
    raise exception '0285: set_my_interests must not be anon-callable';
  end if;
  -- Declaring interests must not opt anyone in.
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'match_settings' and column_name = 'discoverable') <> 'false' then
    raise exception '0285: discoverable must still default off';
  end if;
end;
$assert$;
