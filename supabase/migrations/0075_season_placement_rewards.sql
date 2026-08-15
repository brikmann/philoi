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

-- NOTE: no explicit begin/commit — `supabase db push` already runs each
-- migration inside a transaction AND records schema_migrations in that same
-- transaction. An explicit commit; here would close the transaction early and
-- strand the migration record, which the CLI reports as a schema_migrations
-- insert failure rather than as the real cause.



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


