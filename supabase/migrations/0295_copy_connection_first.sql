-- 0295 · COPY, CONNECTION-FIRST (copy/declutter pass, CODE_PROMPT_copy_declutter.md §C/§D).
--
-- The server half of the client's copy sweep: the strings users read that live in the database.
-- Copy only — the tier ladder, rewards, embers, boxes, Flame Pass and Forge are untouched.
--
--   1 · interest_vocab — two goal rows: "Meet people to grind with" → "Find your crew",
--       "Compete when I want the smoke" → "Compete when I feel like it". Keys, icons and
--       match_label are unchanged, so matching and every stored user_interests row are unaffected.
--   2 · forests — the three official forests named or described in that register: "CompSci grind"
--       → "CompSci", "Pre-med grind" → "Pre-med", and Finals szn's "Nobody grinds alone." →
--       "Nobody studies alone." (forests_name_uni_uniq checked: no live "CompSci"/"Pre-med" clash).
--   3 · economy_grant_rank_crates — the ranked_up bell row reads as an achievement, not a placement:
--       "⚔️ You ranked up — X" → "⚔️ You reached X"; "Up a division." → "A new division.";
--       "a flame only climbers wear" → "a flame you earned". The payload (rank / label / kind …),
--       which installed builds parse for the badge art, is byte-identical. The 9 ranked_up rows
--       already in the log get the same three rewrites.
--   4 · grind_alike_rows — the match chip "Deep-work grinder" → "Deep-work regular".
--   5 · send_lockin_message — the rate-limit refusal "back to the grind." → "give it a minute."
--   6 · get_profile_identity — a tier-up "recent win" reads "Reached Platinum III" (was "Ranked up
--       to platinum 3"), and is offered only where can_see_rank lets the viewer see that person's
--       rank: the same 0217 gate the profile's rank tile already sits behind. Your own always shows.
--
-- Every function body is the live one from pg_get_functiondef (2026-11-06) with only the edits
-- above; no signature, return type or grant changes, so CREATE OR REPLACE keeps every ACL.

begin;

-- 1 ─────────────────────────────────────────────────────────────────────────────
update public.interest_vocab set label = 'Find your crew', sub = 'Friends, a campfire, a club'
 where key = 'meet_people';
update public.interest_vocab set sub = 'Compete when I feel like it'
 where key = 'climb';

-- 2 ─────────────────────────────────────────────────────────────────────────────
update public.forests set name = 'CompSci'
 where is_official and removed_at is null and university is null and name = 'CompSci grind';
update public.forests set name = 'Pre-med'
 where is_official and removed_at is null and name = 'Pre-med grind';
update public.forests set purpose = 'Exam season. Nobody studies alone.'
 where is_official and removed_at is null and name = 'Finals szn' and purpose = 'Exam season. Nobody grinds alone.';

-- 3 ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.economy_grant_rank_crates(p_user uuid, p_index integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_live boolean := season_phase() = 'live';
  v_season text := season_config() ->> 'id';
  v_label text;
  v_legacy text;
  v_kind text;
  v_pass int;
  v_box uuid;
  v_n int := 0;
begin
  if p_user is null or coalesce(p_index, 0) < 1 then return 0; end if;

  for r in
    select c.rank_index, c.embers, c.pass_xp, c.box_key, c.exclusive_item_key, t.tier, t.division
    from rank_rung_crates c
    join rank_thresholds t on t.rank_index = c.rank_index
    where c.rank_index <= p_index
      and not exists (select 1 from rank_crate_grants g
                      where g.user_id = p_user and g.rank_index = c.rank_index)
    order by c.rank_index
  loop
    -- Claim the rung. Only the insert that lands pays — a concurrent check-in that loses the race
    -- skips it.
    insert into rank_crate_grants (user_id, rank_index) values (p_user, r.rank_index)
    on conflict (user_id, rank_index) do nothing;
    if not found then continue; end if;

    v_label := rank_display_label(r.rank_index);

    if r.embers > 0 then
      perform economy_move_embers(p_user, r.embers, 'season_reward'::ember_reason, null);
    end if;

    -- Season-gated inside economy_credit_pass_xp_for; record what actually landed.
    v_pass := case when v_live then r.pass_xp else 0 end;
    if v_pass > 0 then
      perform economy_credit_pass_xp_for(p_user, 'rank_reward:' || r.rank_index, v_pass, v_season);
    end if;

    insert into loot_boxes (user_id, box_key, obtained_via, provenance)
    values (p_user, r.box_key, 'season'::box_obtained_via, v_label || ' Box')
    returning id into v_box;

    if r.exclusive_item_key is not null then
      perform economy_grant_cosmetic(
        p_user, r.exclusive_item_key, 'flame',
        coalesce((select cr.rarity from cosmetic_rarity cr where cr.cosmetic_key = r.exclusive_item_key), 'rare'),
        'earned'::item_source, 'Rank set · ' || v_label
      );
    end if;

    update rank_crate_grants
    set embers = r.embers, pass_xp = v_pass, box_key = r.box_key, box_id = v_box,
        exclusive_item_key = r.exclusive_item_key
    where user_id = p_user and rank_index = r.rank_index;

    v_kind := case when r.tier = 'primordial' then 'primordial'
                   when r.exclusive_item_key is not null then 'tier'
                   else 'division' end;
    -- 0121's format, which notifications.tsx parses as the STORED division ("Gold III" = stored 3).
    -- Kept byte-compatible so the bell badge on installed builds still draws the right rung.
    v_legacy := initcap(r.tier) || case when r.tier = 'primordial' then ''
                  else ' ' || (array['', 'I', 'II', 'III'])[r.division + 1] end;

    -- actor null: notify_event drops a recipient equal to the actor (0120).
    perform notify_event(
      array[p_user], 'ranked_up',
      '⚔️ You reached ' || v_label,
      case v_kind
        when 'primordial' then 'You reached Primordial. The ' || v_label || ' Box, +' || r.embers
                               || ' embers and The First Fire are yours.'
        when 'tier'       then 'A new tier. The ' || v_label || ' Box, +' || r.embers
                               || ' embers and a flame you earned.'
        else                   'A new division. The ' || v_label || ' Box and +' || r.embers || ' embers.'
      end,
      null, null,
      '/inventory', '{}'::jsonb,
      null, 'hexagon',
      jsonb_build_object('embers', r.embers, 'box', r.box_key, 'box_id', v_box,
                         'pass_xp', v_pass, 'exclusive', r.exclusive_item_key,
                         'rank', v_legacy, 'label', v_label, 'kind', v_kind,
                         'to_rank_index', r.rank_index)
    );

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;

update public.notification_events
   set title = replace(title, '⚔️ You ranked up — ', '⚔️ You reached '),
       body  = replace(replace(body, 'a flame only climbers wear', 'a flame you earned'),
                       'Up a division.', 'A new division.')
 where type = 'ranked_up'
   and (title like '⚔️ You ranked up — %' or body like '%a flame only climbers wear%' or body like 'Up a division.%');

-- 4 ─────────────────────────────────────────────────────────────────────────────
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
            select 30::numeric as w, jsonb_build_object('key', 'deep', 'emoji', '🧠', 'icon', 'deep-work', 'label', 'Deep-work regular') as chip
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

-- 5 ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_lockin_message(p_to_user uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_mine uuid;
  v_theirs uuid;
  v_thread uuid;
  v_id uuid;
  v_first_unread boolean;
  v_replying boolean;
  v_name text;
  v_avatar text;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if p_to_user is null or p_to_user = v_me then
    raise exception 'You can''t message yourself.';
  end if;
  if char_length(v_body) = 0 then
    raise exception 'Say something first.';
  end if;
  if char_length(v_body) > 140 then
    raise exception 'Keep it under 140 characters.';
  end if;
  if not is_friend_of(p_to_user) or is_blocked_either_way(p_to_user) then
    raise exception 'You can only message friends.';
  end if;
  -- Hidden live status cuts both ways: you can't reach out while hidden, nor reach someone hidden.
  if not coalesce((select p.show_live_status from profiles p where p.id = v_me), true) then
    raise exception 'Turn on your live status to message friends.';
  end if;
  if not coalesce((select p.show_live_status and not coalesce(p.is_disabled, false)
                     from profiles p where p.id = p_to_user), false) then
    raise exception 'They just finished their session.';
  end if;

  v_mine := lockin_reachable_session(v_me);
  v_theirs := lockin_reachable_session(p_to_user);
  v_thread := lockin_open_thread(v_me, p_to_user);

  if v_thread is null then
    if v_theirs is null then
      raise exception 'They just finished their session.';
    end if;
    -- A row still marked open that lockin_thread_is_open rejects (its closing trigger never fired —
    -- a session deleted outright) would hold the unique slot forever. Close it first.
    update lockin_threads t
       set closed_at = now()
     where t.user_a = least(v_me, p_to_user) and t.user_b = greatest(v_me, p_to_user)
       and t.closed_at is null
       and not lockin_thread_is_open(t.id);
    insert into lockin_threads (user_a, user_b)
    values (least(v_me, p_to_user), greatest(v_me, p_to_user))
    -- A simultaneous first message from the other side wins the race; use its thread.
    on conflict (user_a, user_b) where closed_at is null do nothing
    returning id into v_thread;
    if v_thread is null then
      v_thread := lockin_open_thread(v_me, p_to_user);
    end if;
    if v_thread is null then
      raise exception 'They just finished their session.';
    end if;
  end if;

  -- A light thread, not a firehose: 60 lines a thread, one every two seconds.
  if (select count(*) from lockin_messages m where m.thread_id = v_thread and m.from_user = v_me) >= 60 then
    raise exception 'That''s a lot of messages — give it a minute.';
  end if;
  if exists (select 1 from lockin_messages m
              where m.from_user = v_me and m.created_at > now() - interval '2 seconds') then
    raise exception 'Slow down a second.';
  end if;

  v_first_unread := not exists (
    select 1 from lockin_messages m
     where m.thread_id = v_thread and m.from_user = v_me and m.read_at is null);
  v_replying := exists (
    select 1 from lockin_messages m
     where m.thread_id = v_thread and m.from_user = p_to_user);

  insert into lockin_messages (thread_id, from_user, to_user, from_session_id, to_session_id, body)
  values (v_thread, v_me, p_to_user, v_mine, v_theirs, v_body)
  returning id into v_id;

  if v_first_unread then
    select coalesce(nullif(btrim(p.display_name), ''), p.handle), p.avatar_url
      into v_name, v_avatar
      from profiles p where p.id = v_me;

    perform notify_event(
      array[p_to_user],
      'lockin_message',
      coalesce(v_name, 'A friend') || case when v_replying then ' replied' else ' sent you a message' end,
      -- Never the text: this row outlives the thread.
      'Open Philoi to read it.',
      v_me,
      v_id,
      '/(tabs)',
      '{}'::jsonb,
      v_avatar,
      'circle',
      '{}'::jsonb
    );
  end if;

  return v_id;
end;
$function$;

-- 6 ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_profile_identity(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
               'label', 'Reached ' || rank_display_label(ru.to_rank_index),
               'at', ru.created_at),
             ru.created_at
        from rank_up_events ru
       where ru.user_id = p_user
         and (p_user = v_me or can_see_rank(v_me, p_user))
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
$function$;

commit;
