-- 0293 · PATRON PERSONAS (Phase 9, mocks 338 / 340 / 341).
--
-- Patrons stop being program-locked mascots and become a self-chosen persona: twelve recognizable
-- Greek names, each with an official title and one line of who it's for. Program stays its own field
-- (the pride badge); patron is self-expression. "Heracles of Kinesiology", "Heracles · Kin".
--
-- 1 · THE ROSTER. patrons gains represents (a one-word trait — sort metadata ONLY, never drawn),
--     for_line, featured, roster_order (non-null = one of the twelve), and successor_key. Socrates is
--     new; the other eleven are updated in place to mock 341's official titles. Featured follows
--     mock 341's badges (eight: the brief's table ticks six, but names the mock the source of truth).
--
-- 2 · NOTHING IS DELETED. The 28 program-era deities stay — programs.patron_key still references
--     them — and each gets a successor_key on the roster. resolved_patron(key) walks that forward,
--     so any old key anywhere reads as its persona.
--
-- 3 · profiles.patron_key — the chosen patron. Program no longer grants one. Everyone who held a
--     patron through their program is mapped forward ONCE here, so nobody loses theirs.
--
-- 4 · set_my_patron(key) — a roster key or null. (profiles' own-row update policy could also write
--     the column; the FK keeps it a real patron and every read resolves it forward.)
--
-- 5 · The reads that showed a patron now show the CHOSEN one, each restated from its live body with
--     only the patron join changed: get_identity_badges (every name/seal/identity line),
--     get_metric_leaderboard (board rows), grind_alike_rows (the "Both Heracles" match reason, was
--     "Heirs of"), get_my_program (falls back to the program's old house, forwarded, only so
--     installed builds' ceremony still has one to show). get_programs_for_university is untouched:
--     current builds no longer draw a patron per program.
--
-- Additive: five columns, one row, two functions, four bodies restated. Grants server-side.

begin;

alter table public.patrons add column represents    text;
alter table public.patrons add column for_line      text;
alter table public.patrons add column featured      boolean not null default false;
alter table public.patrons add column roster_order  integer;
alter table public.patrons add column successor_key text references public.patrons (key);

insert into public.patrons (key, name, attribute, blurb) values
  ('socrates', 'Socrates', 'the column', 'father of philosophy')
on conflict (key) do nothing;

update public.patrons pa
   set name = v.name, title = v.title, represents = v.represents, for_line = v.for_line,
       featured = v.featured, roster_order = v.ord, successor_key = null
  from (values
  ('zeus', 'Zeus', 'King of the Gods', 'Leader', 'those who are born to lead the room', true, 1),
  ('heracles', 'Heracles', 'Greatest of Heroes', 'Strength', 'those who love to push past every limit', true, 2),
  ('athena', 'Athena', 'Goddess of Wisdom', 'Strategy', 'those who love to outthink the problem', true, 3),
  ('socrates', 'Socrates', 'Father of Philosophy', 'Wisdom', 'those who love to understand the world fundamentally', true, 4),
  ('aphrodite', 'Aphrodite', 'Goddess of Love', 'Charm', 'those who light up every room they walk into', true, 5),
  ('ares', 'Ares', 'God of War', 'Competitor', 'those who come alive in the arena', true, 6),
  ('apollo', 'Apollo', 'God of Music & Light', 'Talent', 'those who pour everything into their craft', true, 7),
  ('nike', 'Nike', 'Goddess of Victory', 'Victory', 'those who love to win at all costs', true, 8),
  ('hermes', 'Hermes', 'Messenger of the Gods', 'Hustle', 'those who are always chasing what’s next', false, 9),
  ('hades', 'Hades', 'Lord of the Underworld', 'Intensity', 'those who do their deepest work in the quiet', false, 10),
  ('artemis', 'Artemis', 'Goddess of the Hunt', 'Independence', 'those who forge their own path', false, 11),
  ('dionysus', 'Dionysus', 'God of Wine', 'Fun', 'those who bring everyone together', false, 12)
  ) as v(key, name, title, represents, for_line, featured, ord)
 where pa.key = v.key;

update public.patrons pa
   set successor_key = v.succ
  from (values
  ('asclepius', 'apollo'),
  ('atlas', 'heracles'),
  ('calliope', 'apollo'),
  ('chiron', 'socrates'),
  ('chloris', 'artemis'),
  ('clio', 'apollo'),
  ('daedalus', 'athena'),
  ('demeter', 'artemis'),
  ('erato', 'apollo'),
  ('euterpe', 'apollo'),
  ('gaia', 'artemis'),
  ('hecate', 'hades'),
  ('hephaestus', 'apollo'),
  ('hestia', 'dionysus'),
  ('hygieia', 'apollo'),
  ('iris', 'hermes'),
  ('metis', 'athena'),
  ('mnemosyne', 'socrates'),
  ('moirai', 'socrates'),
  ('nemesis', 'ares'),
  ('panacea', 'apollo'),
  ('peitho', 'aphrodite'),
  ('plutus', 'hermes'),
  ('polyhymnia', 'apollo'),
  ('poseidon', 'zeus'),
  ('psyche', 'aphrodite'),
  ('terpsichore', 'apollo'),
  ('themis', 'athena'),
  ('urania', 'apollo')
  ) as v(key, succ)
 where pa.key = v.key;

-- Every non-roster patron must point at the roster, or resolved_patron would return a retired key.
do $check$
begin
  if (select count(*) from patrons where roster_order is not null) <> 12 then
    raise exception '0293: expected 12 roster patrons';
  end if;
  if exists (select 1 from patrons p
              where p.roster_order is null
                and not exists (select 1 from patrons s where s.key = p.successor_key and s.roster_order is not null)) then
    raise exception '0293: a retired patron has no roster successor';
  end if;
end;
$check$;

create function public.resolved_patron(p_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(pa.successor_key, pa.key) from patrons pa where pa.key = p_key;
$$;

revoke all on function public.resolved_patron(text) from public, anon, authenticated;

alter table public.profiles add column patron_key text references public.patrons (key) on delete set null;

-- Map forward: the patron each person held through their program becomes their chosen one.
update public.profiles p
   set patron_key = resolved_patron(pr.patron_key)
  from public.programs pr
 where pr.id = p.program_id
   and p.patron_key is null;

create function public.set_my_patron(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_key is not null and not exists (select 1 from patrons where key = p_key and roster_order is not null) then
    raise exception 'no such patron' using errcode = '22023';
  end if;
  update profiles set patron_key = p_key where id = auth.uid();
end;
$$;

revoke all on function public.set_my_patron(text) from public, anon;
grant execute on function public.set_my_patron(text) to authenticated;

-- ── restated from live (only the patron join changes) ──

CREATE OR REPLACE FUNCTION public.get_identity_badges(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, university text, program_name text, program_abbrev text, patron_key text, patron_name text, patron_title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.university, pr.name, pr.abbrev, pa.key, pa.name, pa.title
  from profiles p
  left join programs pr on pr.id = p.program_id
  -- 0293 · the patron is the one the person CHOSE (profiles.patron_key), resolved forward through
  -- successor_key — no longer the one their program implies.
  left join patrons pa on pa.key = resolved_patron(p.patron_key)
  where p.id = any (p_user_ids[1:200])
    and not p.is_demo and not p.is_disabled;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_program()
 RETURNS TABLE(program_id uuid, name text, program_key text, university text, patron_key text, patron_name text, patron_attribute text, patron_title text, program_abbrev text, program_lore text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select pr.id, pr.name, pr.program_key, pr.university, pa.key, pa.name, pa.attribute,
         pa.title, pr.abbrev, pr.lore
  from profiles p
  join programs pr on pr.id = p.program_id
  -- 0293 · the chosen patron. Installed builds' claim ceremony still reads a patron here, so a
  -- program with no patron chosen yet falls back to its old house, carried forward to the roster —
  -- compat for those builds only; current builds read profiles.patron_key and never this fallback.
  join patrons pa on pa.key = coalesce(resolved_patron(p.patron_key), resolved_patron(pr.patron_key))
  where p.id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_metric_leaderboard(p_metric text, p_scope text DEFAULT 'global'::text, p_window text DEFAULT 'season'::text, p_limit integer DEFAULT 50, p_verified_only boolean DEFAULT false, p_include_unranked boolean DEFAULT false)
 RETURNS TABLE(user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean, value numeric, verified boolean, tier text, division integer, rank integer, is_me boolean, university text, patron_key text, program_abbrev text, pr_set_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

begin

  return query

  with vals as (

    select p.id, p.handle, p.display_name, p.avatar_url, p.is_pro, p.university, p.program_id,

           user_metric(p.id, p_metric, p_window) as v_all,

           user_metric_verified(p.id, p_metric, p_window) as v_ok

    from profiles p

    join scope_user_ids(p_scope) pool on pool.id = p.id

    where p.university_email_verified          -- the board gate every board has (0062/0253)

      and can_see_rank(auth.uid(), p.id)       -- 0170/0217

  ),

  shown as (

    select vals.*, case when p_verified_only then coalesce(vals.v_ok, 0) else vals.v_all end as v

    from vals

  ),

  ranked as (

    select s.*,

           -- A rank only for someone with something on the board; the unranked tail gets null.

           case when coalesce(s.v, 0) > 0 then

             row_number() over (partition by coalesce(s.v, 0) > 0 order by s.v desc, s.display_name asc)::int

           end as rnk,

           -- Position on the page: ranked first by value, then the unranked tail by name. With

           -- p_include_unranked = false every row is ranked, so pos = rnk and the old limit holds.

           row_number() over (order by coalesce(s.v, 0) > 0 desc, s.v desc nulls last, s.display_name asc)::int as pos

    from shown s

    where coalesce(s.v, 0) > 0 or p_include_unranked

  )

  select r.id, r.handle, r.display_name, r.avatar_url, r.is_pro,

         coalesce(r.v, 0),

         case when r.v_ok is null then null else r.v_ok > 0 and r.v_ok >= r.v_all end,

         t.tier, t.division, r.rnk, (r.id = auth.uid()),

         r.university, (select resolved_patron(pp.patron_key) from profiles pp where pp.id = r.id), pr.abbrev,

         case when p_metric like 'ex:%' and r.rnk is not null then

           user_exercise_best_set(r.id, split_part(p_metric, ':', 2), split_part(p_metric, ':', 3), p_window)

         end

  from ranked r

  cross join lateral rank_tier_for_score(universal_score(r.id)) t

  left join programs pr on pr.id = r.program_id

  where p_limit is null or r.pos <= p_limit or r.id = auth.uid()

  order by r.pos;

end;

$function$;

CREATE OR REPLACE FUNCTION public.grind_alike_rows(p_viewer uuid, p_only uuid DEFAULT NULL::uuid, p_scope text DEFAULT NULL::text)
 RETURNS TABLE(o_user uuid, o_score integer, o_reasons jsonb, o_my_mix jsonb, o_their_mix jsonb, o_live boolean, o_is_friend boolean, o_identity_visible boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with v as (
    select p.id, p.university, p.program_id, resolved_patron(p.patron_key) as patron_key, coalesce(p.current_streak, 0) as streak,
           coalesce(nullif(p_scope, ''), (select ms.match_scope from match_settings ms where ms.user_id = p.id), 'uni') as scope
      from profiles p left join programs pr on pr.id = p.program_id
     where p.id = p_viewer
  ),
  cands as (
    select c.id, c.university, c.program_id, pa.key as patron_key, pr.abbrev, pa.name as patron_name,
           coalesce(c.current_streak, 0) as streak
      from v
      join match_settings ms on ms.discoverable and ms.user_id <> v.id
      join profiles c on c.id = ms.user_id
      left join programs pr on pr.id = c.program_id
      left join patrons pa on pa.key = resolved_patron(c.patron_key)
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
            union all select 25, jsonb_build_object('key', 'patron', 'emoji', '⬡', 'icon', 'shield', 'label', 'Both ' || f.patron_name)
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
$function$;

commit;
