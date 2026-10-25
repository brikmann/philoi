-- 0272 . WHO YOU ARE — the identity profile layer (CODE_PROMPT_identity_profile.md, mocks 283).
--
-- A profile leads with a person, not a number: what you wanna be, what you're working toward, what
-- you're working on, your grind anthem, light interests — and an honest, COMPUTED discipline mix
-- (what you actually lock in on, from check_ins; it can't be self-reported, so it can't be faked).
-- Plus the momentum strip — streak · rank + weekly trend · most recent win — in one read.
--
-- WHY A SEPARATE TABLE, NOT profiles COLUMNS (the spec said columns). profiles has
-- "profiles: read any" (qual = true, role public — anon included) and a table-wide UPDATE grant,
-- so any column added to profiles is world-readable the instant it exists. Identity fields carry
-- their own visibility dial, so they live in profile_identity: RLS on, no policies, no grants —
-- reachable only through the security-definer RPCs below, which apply the dial.
--
-- Visibility is the Agora's three-way dial (friends | campus | public) via can_see_milestone_for,
-- the same predicate every Agora/milestone read already uses. Default 'friends' (privacy-first,
-- and what mock 283's edit screen shows). Self always sees self.
--
-- What each viewer gets from get_profile_identity:
--   · identity fields, recent win, discipline mix — only if the dial lets them in;
--   · streak — always (profiles.current_streak is already world-readable; nothing new exposed);
--   · rank + trend — only if can_see_rank (0217's dial), exactly like get_user_rank.
--
-- Additive: one table, five functions. No profiles change, no economy surface, no grants beyond
-- authenticated. Free text runs through ugc_assert_clean (0242), like bio does.

-- ──────────────────── 1. the table ────────────────────
create table if not exists public.profile_identity (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  career_goal    text check (career_goal is null or char_length(career_goal) <= 60),
  working_toward text check (working_toward is null or char_length(working_toward) <= 80),
  working_on     text check (working_on is null or char_length(working_on) <= 80),
  -- { title, artist, url? } — a saved "grind song", not live now-playing. 0194 keeps Spotify
  -- now-playing owner-only by design, so nothing here reads it.
  anthem         jsonb check (anthem is null or jsonb_typeof(anthem) = 'object'),
  interests      text[] not null default '{}' check (cardinality(interests) <= 8),
  visibility     text not null default 'friends' check (visibility in ('friends', 'campus', 'public')),
  updated_at     timestamptz not null default now()
);

alter table public.profile_identity enable row level security;   -- no policies: RPC-only
revoke all on public.profile_identity from public, anon, authenticated;

comment on table public.profile_identity is
  '0272 -- identity fields behind their own visibility dial; profiles is world-readable so these cannot live there. RPC-only.';

-- ──────────────────── 2. who can see whose identity ────────────────────
create or replace function public.identity_visible_to(p_owner uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_viewer is null or p_owner is null then false
    when p_owner = p_viewer then true
    when exists (
      select 1 from blocked_users b
       where (b.blocker_id = p_viewer and b.blocked_id = p_owner)
          or (b.blocker_id = p_owner and b.blocked_id = p_viewer)) then false
    else can_see_milestone_for(
      p_owner,
      coalesce((select pi.visibility from profile_identity pi where pi.user_id = p_owner), 'friends'),
      p_viewer)
  end;
$$;

revoke all on function public.identity_visible_to(uuid, uuid) from public, anon, authenticated;

-- ──────────────────── 3. the bucket a check-in lands in ────────────────────
-- Deep Work writes goal_type 'custom' + category 'deep_work' (0186); reading counts as study.
create or replace function public.discipline_bucket(p_goal_type text, p_category text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_goal_type = 'custom' and p_category = 'deep_work' then 'deep_work'
    when p_goal_type in ('study', 'read') then 'study'
    when p_goal_type = 'gym' then 'gym'
    when p_goal_type = 'run' then 'run'
    else 'other'
  end;
$$;

-- ──────────────────── 4. write: one patch, only the keys you send ────────────────────
-- A patch (not a full replace) so onboarding can set career + goal without knowing the rest, and
-- the edit screen can't clobber a field it didn't load. '' or null clears a field.
create or replace function public.set_my_identity(p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_row profile_identity;
  v_tag text;
  v_tags text[] := '{}';
  v_anthem jsonb;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Nothing to save.';
  end if;

  select * into v_row from profile_identity where user_id = v_me;
  if v_row.user_id is null then
    v_row.user_id := v_me;
    v_row.interests := '{}';
    v_row.visibility := 'friends';
  end if;

  if p_patch ? 'career_goal' then
    v_row.career_goal := nullif(btrim(coalesce(p_patch->>'career_goal', '')), '');
    if v_row.career_goal is not null then
      if char_length(v_row.career_goal) > 60 then raise exception 'Keep it under 60 characters.'; end if;
      perform ugc_assert_clean(v_row.career_goal);
    end if;
  end if;

  if p_patch ? 'working_toward' then
    v_row.working_toward := nullif(btrim(coalesce(p_patch->>'working_toward', '')), '');
    if v_row.working_toward is not null then
      if char_length(v_row.working_toward) > 80 then raise exception 'Keep it under 80 characters.'; end if;
      perform ugc_assert_clean(v_row.working_toward);
    end if;
  end if;

  if p_patch ? 'working_on' then
    v_row.working_on := nullif(btrim(coalesce(p_patch->>'working_on', '')), '');
    if v_row.working_on is not null then
      if char_length(v_row.working_on) > 80 then raise exception 'Keep it under 80 characters.'; end if;
      perform ugc_assert_clean(v_row.working_on);
    end if;
  end if;

  if p_patch ? 'anthem' then
    v_anthem := p_patch->'anthem';
    if v_anthem is null or jsonb_typeof(v_anthem) <> 'object'
       or nullif(btrim(coalesce(v_anthem->>'title', '')), '') is null then
      v_row.anthem := null;
    else
      if char_length(v_anthem->>'title') > 80 or char_length(coalesce(v_anthem->>'artist', '')) > 80 then
        raise exception 'That song name is too long.';
      end if;
      -- Only an https Spotify/Apple Music link rides along; anything else is dropped, not stored.
      v_row.anthem := jsonb_strip_nulls(jsonb_build_object(
        'title', btrim(v_anthem->>'title'),
        'artist', nullif(btrim(coalesce(v_anthem->>'artist', '')), ''),
        'url', case when coalesce(v_anthem->>'url', '') ~ '^https://(open\.spotify\.com|music\.apple\.com)/'
                    then left(v_anthem->>'url', 300) end
      ));
      perform ugc_assert_clean(concat_ws(' ', v_row.anthem->>'title', v_row.anthem->>'artist'));
    end if;
  end if;

  if p_patch ? 'interests' then
    if jsonb_typeof(p_patch->'interests') = 'array' then
      for v_tag in select lower(btrim(value)) from jsonb_array_elements_text(p_patch->'interests') loop
        continue when v_tag = '' or v_tag = any (v_tags);
        if char_length(v_tag) > 24 then raise exception 'Keep each interest under 24 characters.'; end if;
        perform ugc_assert_clean(v_tag);
        v_tags := v_tags || v_tag;
      end loop;
    end if;
    if cardinality(v_tags) > 8 then raise exception 'Up to 8 interests.'; end if;
    v_row.interests := v_tags;
  end if;

  if p_patch ? 'visibility' then
    if p_patch->>'visibility' not in ('friends', 'campus', 'public') then
      raise exception 'Unknown visibility.';
    end if;
    v_row.visibility := p_patch->>'visibility';
  end if;

  insert into profile_identity as pi (user_id, career_goal, working_toward, working_on, anthem, interests, visibility, updated_at)
  values (v_row.user_id, v_row.career_goal, v_row.working_toward, v_row.working_on, v_row.anthem,
          coalesce(v_row.interests, '{}'), coalesce(v_row.visibility, 'friends'), now())
  on conflict (user_id) do update
    set career_goal = excluded.career_goal,
        working_toward = excluded.working_toward,
        working_on = excluded.working_on,
        anthem = excluded.anthem,
        interests = excluded.interests,
        visibility = excluded.visibility,
        updated_at = now();
end;
$$;

-- ──────────────────── 5. read: the discipline mix ────────────────────
-- Seconds locked in per bucket over a window: 'season' (current_season_start(), the default),
-- '30d', or 'all'. Percentages are whole numbers that sum to ~100. Empty when the viewer can't see
-- this person's identity — the mix is identity, gated by the same dial.
drop function if exists public.get_discipline_mix(uuid, text);
create function public.get_discipline_mix(p_user uuid, p_window text default 'season')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with w as (
    select case p_window
      when 'all' then '-infinity'::timestamptz
      when '30d' then now() - interval '30 days'
      else current_season_start()
    end as since
  ),
  b as (
    select discipline_bucket(c.goal_type, c.category) as bucket,
           sum(greatest(coalesce(c.duration_seconds, 0), 0))::bigint as secs,
           count(*)::int as sessions
      from check_ins c, w
     where c.user_id = p_user
       and c.removed_at is null
       and c.created_at >= w.since
     group by 1
  ),
  t as (select sum(secs) as total from b)
  select case when not identity_visible_to(p_user, auth.uid()) then '[]'::jsonb
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'bucket', b.bucket,
               'seconds', b.secs,
               'sessions', b.sessions,
               'pct', case when t.total > 0 then round(100.0 * b.secs / t.total)::int else 0 end
             ) order by b.secs desc, b.bucket)
        from b, t
       where b.secs > 0
    ), '[]'::jsonb)
  end;
$$;

-- ──────────────────── 6. read: the whole identity + momentum strip in one call ────────────────────
drop function if exists public.get_profile_identity(uuid);
create function public.get_profile_identity(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_visible boolean;
  v_row profile_identity;
  v_prof profiles;
  v_rank record;
  v_week numeric := 0;
  v_prev numeric := 0;
  v_win jsonb;
  v_out jsonb;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  select * into v_prof from profiles p where p.id = p_user;
  if v_prof.id is null or coalesce(v_prof.is_disabled, false) then return null; end if;
  if is_blocked_either_way(p_user) then return null; end if;

  v_visible := identity_visible_to(p_user, v_me);
  select * into v_row from profile_identity pi where pi.user_id = p_user;

  v_out := jsonb_build_object(
    'user_id', p_user,
    'is_self', p_user = v_me,
    'identity_visible', v_visible,
    -- Streak is already world-readable on profiles; nothing new.
    'streak', jsonb_build_object('current', coalesce(v_prof.current_streak, 0),
                                 'longest', coalesce(v_prof.longest_streak, 0))
  );

  if v_visible then
    v_out := v_out || jsonb_build_object(
      'career_goal', v_row.career_goal,
      'working_toward', v_row.working_toward,
      'working_on', v_row.working_on,
      'anthem', v_row.anthem,
      'interests', to_jsonb(coalesce(v_row.interests, '{}'::text[]))
    );
  end if;
  if p_user = v_me then
    v_out := v_out || jsonb_build_object('visibility', coalesce(v_row.visibility, 'friends'));
  end if;

  -- Rank + this-week trend: only through 0217's dial, the same gate get_user_rank applies.
  if can_see_rank(v_me, p_user) then
    select r.tier, r.division into v_rank from rank_tier_for_score(live_rank_xp(p_user)) r;

    select coalesce(sum(case when c.created_at >= now() - interval '7 days' then c.xp_earned end), 0),
           coalesce(sum(case when c.created_at < now() - interval '7 days' then c.xp_earned end), 0)
      into v_week, v_prev
      from check_ins c
     where c.user_id = p_user and c.removed_at is null
       and c.created_at >= now() - interval '14 days';

    select v_week + coalesce(sum(case when a.created_at >= now() - interval '7 days' then a.amount end), 0),
           v_prev + coalesce(sum(case when a.created_at < now() - interval '7 days' then a.amount end), 0)
      into v_week, v_prev
      from bonus_xp_awards a
     where a.user_id = p_user and a.created_at >= now() - interval '14 days';

    v_out := v_out || jsonb_build_object('rank', jsonb_build_object(
      'tier', v_rank.tier,
      'division', v_rank.division,
      'week_xp', round(v_week),
      'prev_week_xp', round(v_prev),
      'trend', case when v_week > v_prev then 'up' when v_week < v_prev then 'down' else 'flat' end
    ));
  end if;

  -- Recent win: the newest of a ranked PR, a won challenge, a tier-up, a badge. Pure read over
  -- existing tables; nothing new is written on those events. Behind the identity dial.
  if v_visible then
    select w into v_win from (
      select jsonb_build_object(
               'kind', 'pr',
               'label', 'New ' || lower(e.name) || ' PR · ' ||
                        trim(trailing '.' from trim(trailing '0' from pr.weight::text)) ||
                        case when pr.reps > 1 then ' × ' || pr.reps else '' end,
               'at', pr.achieved_at) as w,
             pr.achieved_at as at
        from personal_records pr
        join exercises e on e.id = pr.exercise_id
        left join workout_sets ws on ws.id = pr.workout_set_id
       where pr.user_id = p_user
         and pr.weight is not null
         and not coalesce(ws.pr_private, false)
         and coalesce(ws.pr_status, 'ok') <> 'pulled'
      union all
      select jsonb_build_object(
               'kind', 'challenge',
               'label', 'Won ' || coalesce(nullif(btrim(sc.public_name), ''), 'a challenge'),
               'at', sc.ends_at),
             sc.ends_at
        from social_challenges sc
       where sc.winner_id = p_user and sc.status = 'completed' and sc.ends_at <= now()
      union all
      select jsonb_build_object(
               'kind', 'rank_up',
               'label', 'Ranked up to ' || ru.to_tier ||
                        case when ru.to_division is not null then ' ' || ru.to_division else '' end,
               'at', ru.created_at),
             ru.created_at
        from rank_up_events ru
       where ru.user_id = p_user
      union all
      select jsonb_build_object(
               'kind', 'badge',
               'label', 'Earned ' || initcap(replace(replace(ob.badge_key, '-', ' '), '_', ' ')),
               'at', ob.earned_at),
             ob.earned_at
        from owned_badges ob
       where ob.user_id = p_user
    ) x
    order by x.at desc nulls last
    limit 1;

    v_out := v_out || jsonb_build_object('recent_win', v_win);
  end if;

  return v_out;
end;
$$;

-- ──────────────────── 7. grants ────────────────────
revoke all on function public.set_my_identity(jsonb) from public, anon;
revoke all on function public.get_discipline_mix(uuid, text) from public, anon;
revoke all on function public.get_profile_identity(uuid) from public, anon;
revoke all on function public.discipline_bucket(text, text) from public, anon;
grant execute on function public.set_my_identity(jsonb) to authenticated;
grant execute on function public.get_discipline_mix(uuid, text) to authenticated;
grant execute on function public.get_profile_identity(uuid) to authenticated;
grant execute on function public.discipline_bucket(text, text) to authenticated;

-- ──────────────────── assertions ────────────────────
do $assert$
begin
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'profile_identity'
                and grantee in ('anon', 'authenticated')) then
    raise exception '0272: profile_identity must not be directly readable by clients';
  end if;
  if has_function_privilege('anon', 'public.get_profile_identity(uuid)', 'execute') then
    raise exception '0272: anon can call get_profile_identity';
  end if;
  if discipline_bucket('custom', 'deep_work') <> 'deep_work' or discipline_bucket('custom', null) <> 'other' then
    raise exception '0272: discipline_bucket mislabels Deep Work';
  end if;
end;
$assert$;
