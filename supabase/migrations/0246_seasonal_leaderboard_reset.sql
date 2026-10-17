-- SEASONAL (PER-SEMESTER) LEADERBOARD RESET.
--
-- Decision (Noah, Oct 2026): leaderboards are per-semester now, not lifetime. An early adopter's
-- lifetime pile only ever grows, so the same few names sit on top forever and everyone else gives
-- up — defeatist. From here, the competitive BOARD STANDINGS reset every academic semester so any
-- student can top the board this term. See CODE_PROMPT_seasonal_leaderboard_reset.md.
--
-- MODEL B — "board resets, rank is sacred":
--   * BOARD POSITION (My Uni / Global order, Uni-vs-Uni totals, board rank #) = SEASON score:
--     only XP earned since the current semester started. Resets to zero each term.
--   * PERSONAL RANK / TIER (Bronze..Legend hexagon on every row + profile) = LIFETIME universal_score,
--     UNCHANGED. A player never loses the rank they climbed to; it just keeps growing. The board is
--     "who put in the work THIS semester," the badge is "who you are all-time."
--   * Agora rank stays lifetime (decision #231) — untouched here.
--   * get_my_ranks / get_user_rank (the personal rank hexagon) stay lifetime — untouched here.
--
-- The reset is COMPUTED, not a cron job: season_score() filters check_ins/bonus_xp by created_at >=
-- current_season_start(). The instant now() crosses into the next seasons row, every board recomputes
-- from zero on its own. (An end-of-season job to FREEZE final standings into placement trophies is a
-- separate piece — tasks #92/#224 — and is additive to this; nothing here depends on it.)
--
-- Fully additive + non-destructive: adds one table + read-only helper functions, and swaps the
-- ORDER/position source of the board functions from universal_score -> season_score while keeping
-- their tier/division from universal_score. Touches no existing rows. universal_score/domain_score
-- (the lifetime primitives everything else uses) are NOT modified.
--
-- LEDGER DISCIPLINE: prod ledger tops at 0242 (0243 meme-drops + 0244 FK + 0245 live-status pending).
-- Verify the current max applied migration + the schema_migrations ledger in PROD before applying;
-- this is 0246, numbered sequentially; never hand-edit the ledger; do NOT `db push` (it would also
-- try to ship the unapplied landmine migrations). Apply in isolation, then
-- `supabase migration repair --status applied 0246`.

begin;

-- ───────────────────────────── seasons (academic semesters) ─────────────────────────────
-- Explicit boundary rows rather than a computed "every 3 months" rule, so a season never drifts
-- off the real term and the exact reset moment is auditable. Season 1 keeps the live Emberfall
-- start (Oct 1) so the ~2 weeks of real launch data are NOT retroactively wiped. Terms are set to
-- the common Laurier/Waterloo calendar; adjust dates here if the real term boundaries differ.
create table if not exists seasons (
  season_number int primary key,
  label         text not null,
  term          text not null check (term in ('fall', 'winter', 'summer')),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  check (ends_at > starts_at)
);

-- Half-open intervals [starts_at, ends_at): each ends exactly where the next begins, so there is no
-- gap or overlap and "which season is now()" is always a single row.
insert into seasons (season_number, label, term, starts_at, ends_at) values
  (1, 'Emberfall',   'fall',   '2026-10-01T04:00:00Z', '2027-01-01T05:00:00Z'),
  (2, 'Winter 2027', 'winter', '2027-01-01T05:00:00Z', '2027-05-01T04:00:00Z'),
  (3, 'Summer 2027', 'summer', '2027-05-01T04:00:00Z', '2027-09-01T04:00:00Z'),
  (4, 'Fall 2027',   'fall',   '2027-09-01T04:00:00Z', '2028-01-01T05:00:00Z')
on conflict (season_number) do nothing;

alter table seasons enable row level security;
drop policy if exists "seasons: read all" on seasons;
create policy "seasons: read all" on seasons for select using (true);

-- ───────────────────────────── season helpers ─────────────────────────────
-- The start of the semester now() falls in. Fallbacks keep it total: the most recent started
-- season if we're between the seeded rows, and -infinity (== lifetime) if now() somehow precedes
-- every season, so a board can never return empty because a season row is missing.
create or replace function current_season_start()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.starts_at from seasons s where now() >= s.starts_at and now() < s.ends_at order by s.starts_at desc limit 1),
    (select s.starts_at from seasons s where s.starts_at <= now() order by s.starts_at desc limit 1),
    '-infinity'::timestamptz
  );
$$;

-- The active season row, for the header/countdown ("Emberfall ends in 74 days").
create or replace function current_season()
returns table (season_number int, label text, term text, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.season_number, s.label, s.term, s.starts_at, s.ends_at
  from seasons s
  where now() >= s.starts_at and now() < s.ends_at
  order by s.starts_at desc
  limit 1;
$$;

-- Season-scoped mirror of universal_score: all XP (earned + bonus) since the semester started.
-- No per-domain breakdown — the board ranks on the single number. Lifetime universal_score is left
-- intact and still powers rank/tier everywhere.
create or replace function season_score(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with s as (select current_season_start() as since)
  select
    coalesce((
      select sum(ci.xp_earned) from check_ins ci, s
      where ci.user_id = p_user_id and ci.removed_at is null and ci.created_at >= s.since
    ), 0)
    + coalesce((
      select sum(b.amount) from bonus_xp_awards b, s
      where b.user_id = p_user_id and b.created_at >= s.since
    ), 0);
$$;

-- Read-only, no economy write surface — safe to grant like the other leaderboard reads.
grant execute on function current_season_start() to authenticated;
grant execute on function current_season() to authenticated, anon;
grant execute on function season_score(uuid) to authenticated;

-- ───────────────────────────── board functions → season-ordered ─────────────────────────────
-- PATTERN for every board below: ORDER / row_number / shown score  =  season_score (this term);
-- tier + division  =  rank_tier_for_score(universal_score) (lifetime, never resets). Same columns,
-- same signatures — only the scoring source of the ordering changes, so CREATE OR REPLACE is safe.

-- My-uni board (true-rank pinning preserved: top N + always the caller's own row).
create or replace function get_university_leaderboard(p_university text, p_limit int default 50)
returns table (
  user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean,
  score numeric, tier text, division int, check_ins_this_week bigint, rank int, is_me boolean
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
      coalesce((
        select count(*) from check_ins ci
        where ci.user_id = p.id and ci.created_at >= date_trunc('week', now())
      ), 0) as check_ins_this_week,
      row_number() over (order by s.season desc, p.display_name asc)::int as rank
    from profiles p
    cross join lateral (select season_score(p.id) as season, universal_score(p.id) as life) s
    cross join lateral rank_tier_for_score(s.life) t
    where p.university = p_university and not p.is_demo and not p.is_disabled
  )
  select r.user_id, r.handle, r.display_name, r.avatar_url, r.is_pro,
         r.score, r.tier, r.division, r.check_ins_this_week, r.rank,
         (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

-- Global board.
create or replace function get_global_leaderboard(p_limit int default 50)
returns table (
  user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean,
  score numeric, tier text, division int, university text, check_ins_this_week bigint, rank int, is_me boolean
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
      s.season as score, t.tier, t.division, p.university,
      coalesce((
        select count(*) from check_ins ci
        where ci.user_id = p.id and ci.created_at >= date_trunc('week', now())
      ), 0) as check_ins_this_week,
      row_number() over (order by s.season desc, p.display_name asc)::int as rank
    from profiles p
    cross join lateral (select season_score(p.id) as season, universal_score(p.id) as life) s
    cross join lateral rank_tier_for_score(s.life) t
    where not p.is_demo and not p.is_disabled
  )
  select r.user_id, r.handle, r.display_name, r.avatar_url, r.is_pro,
         r.score, r.tier, r.division, r.university, r.check_ins_this_week, r.rank,
         (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= p_limit or r.user_id = auth.uid()
  order by r.rank;
end;
$$;

-- Campfire board. A long-lived circle shouldn't have its earliest joiner permanently on top either,
-- so it resets with the rest. (If a per-campfire all-time view is ever wanted, add it separately.)
create or replace function get_group_leaderboard(p_group_id uuid)
returns table (
  user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean,
  score numeric, tier text, division int, check_ins_this_week bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    gm.user_id, p.handle, p.display_name, p.avatar_url, p.is_pro,
    s.season as score, t.tier, t.division,
    coalesce((
      select count(*) from check_ins ci
      where ci.user_id = gm.user_id and ci.created_at >= date_trunc('week', now())
    ), 0) as check_ins_this_week
  from group_members gm
  join profiles p on p.id = gm.user_id
  cross join lateral (select season_score(gm.user_id) as season, universal_score(gm.user_id) as life) s
  cross join lateral rank_tier_for_score(s.life) t
  where gm.group_id = p_group_id and is_group_member(p_group_id)
  order by s.season desc, check_ins_this_week desc, p.display_name asc;
$$;

-- My / Global position number (home-screen "you're #47 at Laurier"). Season-scoped position.
create or replace function get_user_board_position(p_user_id uuid)
returns table (board text, rank int)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_university text;
begin
  select university into v_university from profiles where id = p_user_id;

  if v_university is not null then
    return query
    select 'My uni'::text, r.rank
    from (
      select p.id, row_number() over (order by season_score(p.id) desc, p.display_name asc)::int as rank
      from profiles p
      where p.university = v_university and not p.is_demo and not p.is_disabled
    ) r
    where r.id = p_user_id;
    if found then return; end if;
  end if;

  return query
  select 'Global'::text, r.rank
  from (
    select p.id, row_number() over (order by season_score(p.id) desc, p.display_name asc)::int as rank
    from profiles p
    where not p.is_demo and not p.is_disabled
  ) r
  where r.id = p_user_id;
end;
$$;

-- Uni-vs-uni: campus-vs-campus total for THIS semester, so a school can win the term even if another
-- banked more all-time. This is the collective version of the same fresh-shot fix.
create or replace function get_university_totals(p_limit int default 20)
returns table (university text, total_xp numeric, member_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.university,
    sum(season_score(p.id)) as total_xp,
    count(*) as member_count
  from profiles p
  where p.university is not null and p.is_demo = false
  group by p.university
  order by total_xp desc
  limit p_limit;
$$;

-- Leaderboard search: a result's live board position follows the same season-scoped ranking as the
-- boards it points at; its rank hexagon (tier/division) stays lifetime.
create or replace function search_leaderboard(p_query text, p_limit int default 20)
returns table (
  user_id uuid, display_name text, handle text, avatar_url text,
  tier text, division int, score numeric, board text, board_rank int, is_friend boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_my_university text;
begin
  select university into v_my_university from profiles where id = auth.uid();

  return query
  with matches as (
    select p.id, p.display_name, p.handle, p.avatar_url, p.university
    from profiles p
    where p.id <> auth.uid()
      and not p.is_demo and not p.is_disabled
      and (p.handle ilike '%' || p_query || '%' or p.display_name ilike '%' || p_query || '%')
    order by (p.handle = p_query) desc, (p.handle ilike p_query || '%') desc, p.display_name asc
    limit p_limit
  ),
  scored as (
    select m.*, s.season as score, t.tier, t.division
    from matches m
    cross join lateral (select season_score(m.id) as season, universal_score(m.id) as life) s
    cross join lateral rank_tier_for_score(s.life) t
  ),
  uni_ranked as (
    select p.id, row_number() over (order by season_score(p.id) desc, p.display_name asc)::int as rank
    from profiles p
    where p.university = v_my_university and not p.is_demo and not p.is_disabled and v_my_university is not null
  ),
  global_ranked as (
    select p.id, row_number() over (order by season_score(p.id) desc, p.display_name asc)::int as rank
    from profiles p
    where not p.is_demo and not p.is_disabled
  )
  select
    sc.id, sc.display_name, sc.handle, sc.avatar_url, sc.tier, sc.division, sc.score,
    case when sc.university = v_my_university and v_my_university is not null then 'My uni' else 'Global' end as board,
    coalesce(
      case when sc.university = v_my_university and v_my_university is not null then ur.rank else null end,
      gr.rank
    ) as board_rank,
    exists (
      select 1 from friend_requests fr
      where fr.status = 'accepted'
        and ((fr.requester_id = auth.uid() and fr.recipient_id = sc.id) or (fr.requester_id = sc.id and fr.recipient_id = auth.uid()))
    ) as is_friend
  from scored sc
  left join uni_ranked ur on ur.id = sc.id
  left join global_ranked gr on gr.id = sc.id;
end;
$$;

commit;

-- NOTE: get_my_ranks(), get_user_rank(), get_my_friends(), the Agora rank, and get_my_cross_circle_people()
-- are LEFT ON LIFETIME universal_score on purpose (Model B — rank/identity never resets). Only the
-- competitive board ordering above moves to the season.
