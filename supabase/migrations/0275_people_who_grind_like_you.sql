-- 0275 . PEOPLE WHO GRIND LIKE YOU — matchmaking, non-competitive (CODE_PROMPT_matchmaking.md, mock 299).
--
-- A shelf of opted-in people whose lock-in habits, goals and field line up with yours, each shown
-- with the REASONS (shared-trait chips) and a soft "alike" score. The score is SIMILARITY, never
-- better/worse: it carries none of the earned-status language, and nothing here touches rank, XP or
-- the economy. (Open design choice, Noah: keep the number or chips-only — the client de-emphasises
-- it and it is one line to hide.)
--
-- Signals, all already in the database — no stored match scores, everything read-time:
--   · discipline mix — cosine of the two computed mixes (check_ins by bucket, last 90 days). 45 pts.
--   · schedule — cosine of when you lock in (early / day / evening / night, in your timezone). 15.
--   · house — same program 15, else same patron 4, else same university 8 (whichever is higher).
--   · goal & field — keyword overlap of career_goal + working_toward (0272). 8. Only when the
--     candidate's identity is visible to the viewer — a chip must never reveal a hidden field.
--   · streak band — both on a 7+ day streak within a week of each other. 5.
--   · interests — shared self-reported tags (0272), 2 each, up to 6. Same visibility rule as goal.
--
-- OPT-IN AND SAFE BY DEFAULT (required, not optional):
--   · match_settings.discoverable defaults FALSE. Off = you match no one and see no one.
--   · match_scope (program | uni | wider) is who YOU look among; find_me (everyone |
--     friends_of_friends | same_uni) is who may find YOU. A pair is shown only when BOTH people's
--     settings admit each other.
--   · blocks hide people both ways; disabled / demo / test accounts never appear.
--   · live status shows only to friends, or to non-friends if you turned show_live on (default off),
--     and always only if your account-level show_live_status is on.
--   · NO stranger contact: this adds no messaging. Cheer / message (0270) stays mutual-friends-only;
--     a match card offers Add friend and Challenge, both existing paths.
--   · Minors: Philoi has no age data (signup is an 18+ attestation), so there is no age-keyed rule
--     to apply. The defaults ARE the school-scoped guard: match_scope 'uni', find_me 'same_uni'.
--
-- Why a table and not profiles columns: profiles is world-readable (read any, anon included), and
-- whether someone has opted into discovery is their business. RPC-only, like 0272's identity.

-- ──────────────────── 1. settings ────────────────────
create table if not exists public.match_settings (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  discoverable boolean not null default false,
  match_scope  text not null default 'uni' check (match_scope in ('program', 'uni', 'wider')),
  find_me      text not null default 'same_uni' check (find_me in ('everyone', 'friends_of_friends', 'same_uni')),
  show_live    boolean not null default false,
  updated_at   timestamptz not null default now()
);
alter table public.match_settings enable row level security;   -- no policies: RPC-only
revoke all on public.match_settings from public, anon, authenticated;

create or replace function public.get_my_match_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'discoverable', coalesce(ms.discoverable, false),
    'match_scope', coalesce(ms.match_scope, 'uni'),
    'find_me', coalesce(ms.find_me, 'same_uni'),
    'show_live', coalesce(ms.show_live, false)
  )
  from (select auth.uid() as uid) me
  left join match_settings ms on ms.user_id = me.uid
  where me.uid is not null;
$$;

create or replace function public.set_my_match_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_row match_settings;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'Nothing to save.'; end if;

  select * into v_row from match_settings where user_id = v_me;
  if v_row.user_id is null then
    v_row := row(v_me, false, 'uni', 'same_uni', false, now())::match_settings;
  end if;

  if p_patch ? 'discoverable' then v_row.discoverable := coalesce((p_patch->>'discoverable')::boolean, false); end if;
  if p_patch ? 'show_live' then v_row.show_live := coalesce((p_patch->>'show_live')::boolean, false); end if;
  if p_patch ? 'match_scope' then
    if p_patch->>'match_scope' not in ('program', 'uni', 'wider') then raise exception 'Unknown scope.'; end if;
    v_row.match_scope := p_patch->>'match_scope';
  end if;
  if p_patch ? 'find_me' then
    if p_patch->>'find_me' not in ('everyone', 'friends_of_friends', 'same_uni') then raise exception 'Unknown setting.'; end if;
    v_row.find_me := p_patch->>'find_me';
  end if;

  insert into match_settings (user_id, discoverable, match_scope, find_me, show_live, updated_at)
  values (v_me, v_row.discoverable, v_row.match_scope, v_row.find_me, v_row.show_live, now())
  on conflict (user_id) do update
    set discoverable = excluded.discoverable, match_scope = excluded.match_scope,
        find_me = excluded.find_me, show_live = excluded.show_live, updated_at = now();

  return get_my_match_settings();
end;
$$;

-- ──────────────────── 2. helpers ────────────────────
create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from friend_requests fr
     where fr.status = 'accepted'
       and ((fr.requester_id = p_a and fr.recipient_id = p_b)
         or (fr.requester_id = p_b and fr.recipient_id = p_a)));
$$;

create or replace function public.have_mutual_friend(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with fa as (
    select case when fr.requester_id = p_a then fr.recipient_id else fr.requester_id end as f
      from friend_requests fr
     where fr.status = 'accepted' and (fr.requester_id = p_a or fr.recipient_id = p_a)
  ),
  fb as (
    select case when fr.requester_id = p_b then fr.recipient_id else fr.requester_id end as f
      from friend_requests fr
     where fr.status = 'accepted' and (fr.requester_id = p_b or fr.recipient_id = p_b)
  )
  select exists (select 1 from fa join fb using (f));
$$;

-- Does P_WHO's own settings admit P_OTHER? (Applied in both directions by match_pair_ok.)
create or replace function public.match_admits(p_who uuid, p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select ms.discoverable
       and case ms.match_scope
             when 'program' then pw.program_id is not null and pw.program_id = po.program_id
             when 'uni' then pw.university is not null and pw.university = po.university
             else true
           end
       and case ms.find_me
             when 'everyone' then true
             when 'same_uni' then pw.university is not null and pw.university = po.university
             else are_friends(p_who, p_other) or have_mutual_friend(p_who, p_other)
           end
      from match_settings ms
      join profiles pw on pw.id = ms.user_id
      join profiles po on po.id = p_other
     where ms.user_id = p_who
  ), false);
$$;

create or replace function public.match_pair_ok(p_viewer uuid, p_cand uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_viewer is not null and p_cand is not null and p_viewer <> p_cand
     and exists (select 1 from profiles c
                  where c.id = p_cand and not coalesce(c.is_disabled, false)
                    and not coalesce(c.is_demo, false) and not coalesce(c.is_test, false))
     and not exists (select 1 from blocked_users b
                      where (b.blocker_id = p_viewer and b.blocked_id = p_cand)
                         or (b.blocker_id = p_cand and b.blocked_id = p_viewer))
     and match_admits(p_viewer, p_cand)
     and match_admits(p_cand, p_viewer);
$$;

-- Words from goal + field worth matching on: lowercase, 4+ letters, no filler.
create or replace function public.match_keywords(p_text text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(distinct w), '{}')
    from regexp_split_to_table(lower(coalesce(p_text, '')), '[^a-z0-9]+') w
   where length(w) >= 4
     and w not in ('with', 'that', 'this', 'from', 'into', 'about', 'first', 'want', 'wanna', 'future',
                   'become', 'being', 'get', 'getting', 'year', 'years', 'the', 'and', 'for', 'my', 'by',
                   'december', 'january', 'semester', 'term', 'school');
$$;

-- ──────────────────── 3. the engine ────────────────────
-- One row per candidate the viewer may see (match_pair_ok), scored. Internal — the two public
-- reads below wrap it. o_* names so the OUT columns can't shadow anything in the body.
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
           sum(s.secs) as total
      from sess s group by s.user_id
  ),
  ident as (
    select pi.user_id,
           match_keywords(concat_ws(' ', pi.career_goal, pi.working_toward)) as kw,
           coalesce(pi.interests, '{}') as interests,
           pi.working_toward
      from profile_identity pi where pi.user_id in (select id from people)
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
           least(v.streak, c.streak) as band_streak
      from cands c
      cross join v
      left join mix mv on mv.user_id = v.id
      left join mix mc on mc.user_id = c.id
      left join ident iv on iv.user_id = v.id
      left join ident ic on ic.user_id = c.id
  ),
  final as (
    select s.*,
           least(100, round(
               45 * s.mix_cos
             + 15 * s.sched_cos
             + greatest(case when s.same_program then 15 else 0 end,
                        case when s.same_uni then 8 else 0 end,
                        case when s.same_patron then 4 else 0 end)
             + case when s.id_visible and s.goal_overlap then 8 else 0 end
             + case when s.streak_band then 5 else 0 end
             + case when s.id_visible then least(cardinality(s.shared_interests), 3) * 2 else 0 end
           ))::int as score
      from scored s
  )
  select f.id,
         f.score,
         -- Reasons, strongest first; the client shows the top 2–4.
         (select coalesce(jsonb_agg(r.chip order by r.w desc), '[]'::jsonb) from (
            select 30 as w, jsonb_build_object('key', 'deep', 'emoji', '🧠', 'label', 'Deep-work grinder') as chip
             where f.v_deep >= 0.3 and f.c_deep >= 0.3
            union all select 29, jsonb_build_object('key', 'study', 'emoji', '📚', 'label', 'Study-heavy')
             where f.v_study >= 0.3 and f.c_study >= 0.3
            union all select 28, jsonb_build_object('key', 'gym', 'emoji', '🏋️',
                              'label', case when f.v_gym >= 0.3 and f.c_gym >= 0.3 then 'Gym regular' else 'Gym too' end)
             where f.v_gym >= 0.15 and f.c_gym >= 0.15
            union all select 27, jsonb_build_object('key', 'run', 'emoji', '🏃', 'label', 'Runner')
             where f.v_run >= 0.15 and f.c_run >= 0.15
            union all select 26, jsonb_build_object('key', 'house', 'emoji', '🎓',
                              'label', coalesce(f.abbrev, 'Same program') || ' · same house')
             where f.same_program
            union all select 25, jsonb_build_object('key', 'patron', 'emoji', '⬡', 'label', 'Heirs of ' || f.patron_name)
             where not f.same_program and f.same_patron and f.patron_name is not null
            union all select 24, jsonb_build_object('key', 'uni', 'emoji', '📍', 'label', 'Same uni')
             where not f.same_program and not f.same_patron and f.same_uni
            union all select 23, jsonb_build_object('key', 'goal', 'emoji', '🎯', 'label', 'Same goal')
             where f.id_visible and f.goal_overlap
            union all select 22, jsonb_build_object('key', 'early', 'emoji', '🌅', 'label', '6am')
             where f.v_early >= 0.35 and f.c_early >= 0.35
            union all select 21, jsonb_build_object('key', 'night', 'emoji', '🦉', 'label', 'Night owl')
             where f.v_night >= 0.35 and f.c_night >= 0.35
            union all select 20, jsonb_build_object('key', 'streak', 'emoji', '🔥',
                              'label', (f.band_streak / 7 * 7) || '-day streak club')
             where f.streak_band
            union all select 10, jsonb_build_object('key', 'interest:' || i, 'emoji', '✨', 'label', i)
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

-- ──────────────────── 4. the two reads ────────────────────
-- The shelf. Empty unless the viewer opted in (off = you see no one). p_scope narrows the viewer's
-- own search for one call (filter chips); it can never widen past what the candidates allow.
drop function if exists public.get_grind_alikes(integer, text);
create function public.get_grind_alikes(p_limit integer default 20, p_scope text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null
      or not coalesce((select ms.discoverable from match_settings ms where ms.user_id = auth.uid()), false)
      then '[]'::jsonb
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.id, 'display_name', p.display_name, 'handle', p.handle, 'avatar_url', p.avatar_url,
               'career_goal', case when g.o_identity_visible then pi.career_goal end,
               'score', g.o_score, 'reasons', g.o_reasons,
               'live', g.o_live, 'is_friend', g.o_is_friend
             ) order by g.o_score desc, p.id)
        from (select * from grind_alike_rows(auth.uid(), null,
                       case when p_scope in ('program', 'uni', 'wider') then p_scope end)
               order by o_score desc
               limit least(greatest(coalesce(p_limit, 20), 1), 50)) g
        join profiles p on p.id = g.o_user
        left join profile_identity pi on pi.user_id = p.id
    ), '[]'::jsonb)
  end;
$$;

-- Why you two match. Null unless the pair is admissible right now (both opted in, both settings
-- admit each other, no block) — or you're already friends, who can always see why.
drop function if exists public.get_match_detail(uuid);
create function public.get_match_detail(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_row record;
  v_p profiles;
  v_out jsonb;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not (match_pair_ok(v_me, p_user) or (are_friends(v_me, p_user) and not is_blocked_either_way(p_user))) then
    return null;
  end if;

  -- A friend who hasn't opted in isn't in the engine (it only scores the discoverable), so for them
  -- score / reasons / mixes come back null and the screen shows just the identity.
  select * into v_row from grind_alike_rows(v_me, p_user, 'wider') limit 1;
  select * into v_p from profiles p where p.id = p_user;

  v_out := jsonb_build_object(
    'user_id', v_p.id, 'display_name', v_p.display_name, 'handle', v_p.handle, 'avatar_url', v_p.avatar_url,
    'university', v_p.university,
    'streak', coalesce(v_p.current_streak, 0),
    'score', v_row.o_score, 'reasons', coalesce(v_row.o_reasons, '[]'::jsonb),
    'my_mix', v_row.o_my_mix, 'their_mix', v_row.o_their_mix,
    'live', coalesce(v_row.o_live, false),
    'is_friend', are_friends(v_me, p_user),
    'request', (select case when fr.requester_id = v_me then 'outgoing' else 'incoming' end
                  from friend_requests fr
                 where fr.status = 'pending'
                   and ((fr.requester_id = v_me and fr.recipient_id = p_user)
                     or (fr.requester_id = p_user and fr.recipient_id = v_me))
                 limit 1)
  );

  if identity_visible_to(p_user, v_me) then
    -- coalesce: no identity row yet must not null the whole object (jsonb || null is null).
    v_out := v_out || coalesce((select jsonb_build_object('career_goal', pi.career_goal, 'working_toward', pi.working_toward)
                                  from profile_identity pi where pi.user_id = p_user), '{}'::jsonb);
  end if;
  return v_out;
end;
$$;

-- ──────────────────── 5. grants ────────────────────
revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function public.have_mutual_friend(uuid, uuid) from public, anon, authenticated;
revoke all on function public.match_admits(uuid, uuid) from public, anon, authenticated;
revoke all on function public.match_pair_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function public.match_keywords(text) from public, anon, authenticated;
revoke all on function public.grind_alike_rows(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_my_match_settings() from public, anon;
revoke all on function public.set_my_match_settings(jsonb) from public, anon;
revoke all on function public.get_grind_alikes(integer, text) from public, anon;
revoke all on function public.get_match_detail(uuid) from public, anon;
grant execute on function public.get_my_match_settings() to authenticated;
grant execute on function public.set_my_match_settings(jsonb) to authenticated;
grant execute on function public.get_grind_alikes(integer, text) to authenticated;
grant execute on function public.get_match_detail(uuid) to authenticated;

-- ──────────────────── assertions ────────────────────
do $assert$
begin
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'match_settings' and column_name = 'discoverable') <> 'false' then
    raise exception '0275: discoverable must default off';
  end if;
  if has_function_privilege('authenticated', 'public.grind_alike_rows(uuid,uuid,text)', 'execute') then
    raise exception '0275: the engine takes a viewer id and must not be client-callable';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'match_settings'
                and grantee in ('anon', 'authenticated')) then
    raise exception '0275: match_settings must be RPC-only';
  end if;
end;
$assert$;
