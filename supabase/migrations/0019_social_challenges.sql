-- Social challenges (PHILOI_UI_SPEC.md — design-mocks/12 & 13): head-to-head, group
-- ("all or nothing"), and solo (announced) challenges between campfire members. This is a
-- separate table from the existing personal `challenges`/`challenge_logs` tables — those are
-- a self-tracked personal habit tracker (manually logged amounts against a private target);
-- these are invite/accept, multi-party, and score themselves live off real check_ins data
-- (xp_earned / duration_seconds), not a manual log.

create table if not exists social_challenges (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references groups (id) on delete cascade,
  created_by uuid not null references profiles (id) on delete cascade,
  mode text not null check (mode in ('h2h', 'group', 'solo')),
  -- h2h only
  opponent_id uuid references profiles (id) on delete cascade,
  race_metric text check (race_metric in ('xp', 'lockin_time')),
  -- group only: lock-ins required per member during the window ("all or nothing")
  target_count int check (target_count > 0),
  -- solo only: free-text goal, e.g. "10k steps every day"
  goal_label text,
  window_hours int not null check (window_hours > 0),
  -- null until an h2h invite is accepted; set immediately for group/solo (no invite step)
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'active', 'completed', 'declined', 'expired')),
  winner_id uuid references profiles (id), -- h2h only, set by finalize_social_challenges()
  payout_xp int not null check (payout_xp > 0),
  created_at timestamptz not null default now(),
  check ((mode = 'h2h') = (opponent_id is not null)),
  check ((mode = 'group') = (target_count is not null)),
  check ((mode != 'h2h') or (race_metric is not null))
);

create index if not exists social_challenges_circle_idx on social_challenges (circle_id);
create index if not exists social_challenges_opponent_idx on social_challenges (opponent_id) where opponent_id is not null;

alter table social_challenges enable row level security;

drop policy if exists "social_challenges: read if circle member" on social_challenges;
create policy "social_challenges: read if circle member" on social_challenges for select using (
  is_group_member(circle_id) or created_by = auth.uid() or opponent_id = auth.uid()
);

-- A one-off ledger for XP that didn't come from a lock-in — challenge payouts today, maybe
-- other bonus/reward sources later. universal_score() (below) sums this in alongside the
-- normal check_ins-derived domain scores, so a challenge win shows up in rank/leaderboards
-- exactly like earned XP, not as a separate hidden number.
create table if not exists bonus_xp_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  amount numeric not null check (amount > 0),
  reason text not null,
  challenge_id uuid references social_challenges (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bonus_xp_awards_user_idx on bonus_xp_awards (user_id);

alter table bonus_xp_awards enable row level security;

drop policy if exists "bonus_xp_awards: read own" on bonus_xp_awards;
create policy "bonus_xp_awards: read own" on bonus_xp_awards for select using (user_id = auth.uid());

-- Body-only change (same signature) — folds bonus_xp_awards into the universal score so a
-- challenge payout ripples into rank/leaderboards/campfire level exactly like earned XP.
create or replace function universal_score(p_user_id uuid)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce((select sum(domain_score(p_user_id, t.type)) from (select distinct goal_type as type from check_ins where user_id = p_user_id) t), 0)
    + coalesce((select sum(amount) from bonus_xp_awards where user_id = p_user_id), 0);
$$;

-- Live-scores an h2h side or a group member's progress over a challenge's window — shared by
-- get_my_social_challenges() and finalize_social_challenges() so the two never disagree.
create or replace function social_challenge_score(p_user_id uuid, p_metric text, p_starts_at timestamptz, p_ends_at timestamptz)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(case when p_metric = 'lockin_time' then ci.duration_seconds else ci.xp_earned end), 0)
  from check_ins ci
  where ci.user_id = p_user_id
    and ci.removed_at is null
    and ci.duration_seconds is not null
    and ci.created_at >= p_starts_at
    and ci.created_at <= p_ends_at;
$$;

create or replace function create_h2h_challenge(
  p_circle_id uuid,
  p_opponent_id uuid,
  p_race_metric text,
  p_window_hours int,
  p_payout_xp int default 200
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;
  if not exists (select 1 from group_members where group_id = p_circle_id and user_id = p_opponent_id) then
    raise exception 'That person is not in this campfire.';
  end if;
  if p_opponent_id = auth.uid() then
    raise exception 'Pick someone else to challenge.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, opponent_id, race_metric, window_hours, payout_xp, status)
  values (p_circle_id, auth.uid(), 'h2h', p_opponent_id, p_race_metric, p_window_hours, p_payout_xp, 'pending')
  returning * into v_challenge;

  perform notify_push(
    array[p_opponent_id],
    'You''ve been challenged',
    (select display_name from profiles where id = auth.uid()) || ' challenged you to a head-to-head.',
    jsonb_build_object('type', 'challenge_invite', 'challenge_id', v_challenge.id),
    'accountability'
  );

  return v_challenge;
end;
$$;

create or replace function create_group_challenge(
  p_circle_id uuid,
  p_target_count int,
  p_window_hours int,
  p_payout_xp int default 300
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, target_count, window_hours, payout_xp, status, starts_at, ends_at)
  values (p_circle_id, auth.uid(), 'group', p_target_count, p_window_hours, p_payout_xp, 'active', now(), now() + make_interval(hours => p_window_hours))
  returning * into v_challenge;

  return v_challenge;
end;
$$;

create or replace function create_solo_challenge(
  p_circle_id uuid,
  p_goal_label text,
  p_window_hours int,
  p_payout_xp int default 150
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, goal_label, window_hours, payout_xp, status, starts_at, ends_at)
  values (p_circle_id, auth.uid(), 'solo', p_goal_label, p_window_hours, p_payout_xp, 'active', now(), now() + make_interval(hours => p_window_hours))
  returning * into v_challenge;

  return v_challenge;
end;
$$;

create or replace function respond_to_h2h_challenge(p_challenge_id uuid, p_accept boolean)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  select * into v_challenge from social_challenges
  where id = p_challenge_id and opponent_id = auth.uid() and status = 'pending';

  if v_challenge.id is null then
    raise exception 'Challenge not found or already answered.';
  end if;

  if p_accept then
    update social_challenges
    set status = 'active', starts_at = now(), ends_at = now() + make_interval(hours => window_hours)
    where id = p_challenge_id
    returning * into v_challenge;
  else
    update social_challenges set status = 'declined' where id = p_challenge_id returning * into v_challenge;
  end if;

  return v_challenge;
end;
$$;

create or replace function complete_solo_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge social_challenges;
begin
  select * into v_challenge from social_challenges
  where id = p_challenge_id and created_by = auth.uid() and mode = 'solo' and status = 'active';

  if v_challenge.id is null then
    raise exception 'Challenge not found or not active.';
  end if;

  update social_challenges set status = 'completed' where id = p_challenge_id;

  insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
  values (auth.uid(), v_challenge.payout_xp, 'challenge_solo_completion', v_challenge.id);
end;
$$;

-- Cron sweep (same shape as notify_stale_lock_ins()) — closes out challenges whose window has
-- passed: h2h awards the higher scorer (no award on an exact tie), group awards everyone only
-- if every member hit target_count ("all or nothing"), solo that was never manually completed
-- just expires with no payout.
create or replace function finalize_social_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_my numeric;
  v_opp numeric;
  v_member_count int;
  v_completed_count int;
begin
  for r in select * from social_challenges where status = 'active' and ends_at <= now() loop
    if r.mode = 'h2h' then
      v_my := social_challenge_score(r.created_by, r.race_metric, r.starts_at, r.ends_at);
      v_opp := social_challenge_score(r.opponent_id, r.race_metric, r.starts_at, r.ends_at);
      update social_challenges
      set status = 'completed', winner_id = case when v_my > v_opp then r.created_by when v_opp > v_my then r.opponent_id else null end
      where id = r.id;
      if v_my != v_opp then
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        values (case when v_my > v_opp then r.created_by else r.opponent_id end, r.payout_xp, 'challenge_h2h_winner', r.id);
      end if;
    elsif r.mode = 'group' then
      select count(*) into v_member_count from group_members where group_id = r.circle_id;
      select count(*) into v_completed_count
      from group_members gm
      where gm.group_id = r.circle_id
        and (
          select count(*) from check_ins ci
          where ci.user_id = gm.user_id and ci.duration_seconds is not null and ci.removed_at is null
            and ci.created_at >= r.starts_at and ci.created_at <= r.ends_at
        ) >= r.target_count;

      if v_completed_count >= v_member_count and v_member_count > 0 then
        update social_challenges set status = 'completed' where id = r.id;
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        select user_id, r.payout_xp, 'challenge_group_completion', r.id from group_members where group_id = r.circle_id;
      else
        update social_challenges set status = 'expired' where id = r.id;
      end if;
    else
      update social_challenges set status = 'expired' where id = r.id;
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'philoi-finalize-social-challenges') then
    perform cron.unschedule('philoi-finalize-social-challenges');
  end if;
end $$;

select cron.schedule(
  'philoi-finalize-social-challenges',
  '*/10 * * * *',
  $$select finalize_social_challenges();$$
);

-- The Challenges tab's feed (design-mocks/12) — everything the caller can see: pending h2h
-- invites addressed to them, their own/opponent's active or completed h2h, and every
-- group/solo challenge in circles they're a member of. Live-scores h2h/group progress via
-- social_challenge_score() rather than a stored, potentially-stale number.
create or replace function get_my_social_challenges()
returns table (
  id uuid,
  circle_id uuid,
  circle_name text,
  circle_emoji text,
  created_by uuid,
  created_by_name text,
  mode text,
  opponent_id uuid,
  opponent_name text,
  race_metric text,
  my_score numeric,
  opponent_score numeric,
  target_count int,
  member_count int,
  completed_count int,
  goal_label text,
  window_hours int,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  winner_id uuid,
  payout_xp int,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  select
    sc.id,
    sc.circle_id,
    g.name as circle_name,
    g.emoji as circle_emoji,
    sc.created_by,
    creator.display_name as created_by_name,
    sc.mode,
    sc.opponent_id,
    opp.display_name as opponent_name,
    sc.race_metric,
    case when sc.mode = 'h2h' and sc.status != 'pending'
      then social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.opponent_id else sc.created_by end,
        sc.race_metric, sc.starts_at, sc.ends_at)
      else null end as my_score,
    case when sc.mode = 'h2h' and sc.status != 'pending'
      then social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.created_by else sc.opponent_id end,
        sc.race_metric, sc.starts_at, sc.ends_at)
      else null end as opponent_score,
    sc.target_count,
    case when sc.mode = 'group' then (select count(*)::int from group_members where group_id = sc.circle_id) else null end as member_count,
    case when sc.mode = 'group' then (
      select count(*)::int from group_members gm
      where gm.group_id = sc.circle_id
        and (
          select count(*) from check_ins ci
          where ci.user_id = gm.user_id and ci.duration_seconds is not null and ci.removed_at is null
            and ci.created_at >= sc.starts_at and ci.created_at <= coalesce(sc.ends_at, now())
        ) >= sc.target_count
    ) else null end as completed_count,
    sc.goal_label,
    sc.window_hours,
    sc.starts_at,
    sc.ends_at,
    sc.status,
    sc.winner_id,
    sc.payout_xp,
    sc.created_at
  from social_challenges sc
  join groups g on g.id = sc.circle_id
  join profiles creator on creator.id = sc.created_by
  left join profiles opp on opp.id = sc.opponent_id
  where (is_group_member(sc.circle_id) or sc.created_by = auth.uid() or sc.opponent_id = auth.uid())
    and sc.status != 'declined'
  order by
    (sc.status = 'pending' and sc.opponent_id = auth.uid()) desc,
    sc.created_at desc;
end;
$$;
