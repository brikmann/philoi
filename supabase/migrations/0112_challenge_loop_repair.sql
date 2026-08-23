-- 0112 — the challenge loop, joined up.
--
-- 0096 introduced challenge_participants and 0111 taught SETTLEMENT to read it. Nothing in
-- between was updated, so the roster is a table three other readers still disagree with, and two
-- of the three write paths never put a row in it at all. What that looks like on device is a set
-- of dead ends rather than an error anyone can see:
--
--   1. A GROUP CHALLENGE CANNOT BE STARTED. create_group_challenge (0098) inserts a draft and
--      writes no participants; invite_challenge_members is the only thing that ever writes one,
--      and it has no caller anywhere in the app. start_challenge then refuses with "Nobody has
--      accepted yet." — for every group challenge, permanently. The lifecycle ends at step one.
--   2. A DUEL HAS NO ROSTER EITHER. create_h2h_challenge / respond_to_h2h_challenge predate the
--      table, so 0111's participant arm never fires for a duel, no final_* figures are ever
--      written, and get_challenge_results returns an empty set for every duel ever run — which
--      is exactly what the challenge_won bell row deep-links to.
--   3. THE DENOMINATOR IS STILL THE WHOLE CAMPFIRE in the two READ paths (0111 fixed only the
--      settle path): get_my_social_challenges' member_count/completed_count, and
--      get_group_challenge_watch's member list. A four-person race inside a thirty-person
--      campfire draws "2 / 30 done" on the card and thirty meters on the watch screen, while
--      settlement scores it out of four. Client and server describing the same race differently.
--
-- Plus three defects found alongside them:
--   4. VOLUME AND DISTANCE RACES SCORE XP. social_challenge_score's CASE is
--      `when 'lockin_time' then duration_seconds else xp_earned`, written before 0096 added the
--      metric set. Create offers Volume and Distance; every reader then scores them as XP.
--   5. A CHEER FIRES NO PUSH. CAMPFIRE_REDESIGN_SPEC's 🔴 is "🔥 {name} cheered you on" plus the
--      note. 0110 built the note, the composer and the wall; the notification was never wired.
--   6. CHEERING IS DUEL-ONLY. cheer_challenge rejects anyone who is not created_by/opponent_id,
--      so nobody in a group race can be cheered — the per-person cheer count the spec asks for
--      under each meter has no data behind it.
--
-- FORWARD-ONLY. Nothing in 0094-0111 is edited. Every backfill below is written so a challenge
-- already in flight keeps the deal it was created under: rosters are added only to challenges
-- that have NOT settled, backfilled baselines are 0 (which is precisely the pre-0096 behaviour of
-- absolute totals over the window), and 0111's legacy fallback is left exactly as it is.

-- ─────────────────────────── 1 · metric scoring ───────────────────────────
--
-- social_challenge_score is the one scoring function every read path uses (the card, both watch
-- RPCs, 0111's legacy arm). Its CASE predates the v2 metric set, so 'volume' and 'distance' fall
-- through to xp_earned and a gym duel is silently an XP duel.
--
-- Windowed as (value at the end - value at the start) through challenge_metric_value, which is
-- the same expression start_challenge already uses to take baselines — so a race's live score and
-- its settled score come from one definition instead of two that agree by coincidence.
--
-- The lockin_time / xp arm is 0033's, unchanged. Only the new metrics route elsewhere, so nothing
-- already running changes what it measures.
create or replace function social_challenge_score(p_user_id uuid, p_metric text, p_starts_at timestamptz, p_ends_at timestamptz)
returns numeric
language sql
security definer
set search_path = public
stable
as $score$
  select case
    when p_metric in ('volume', 'distance') then
      -- greatest(..., 0): both sources are cumulative and can only grow, but a deleted workout
      -- can make the later reading the smaller one, and a negative score would sort a racer below
      -- somebody who did nothing at all.
      greatest(
        challenge_metric_value(p_metric, p_user_id, p_ends_at)
          - challenge_metric_value(p_metric, p_user_id, coalesce(p_starts_at, p_ends_at)),
        0)
    else (
      select coalesce(sum(case when p_metric = 'lockin_time' then ci.duration_seconds else ci.xp_earned end), 0)
      from check_ins ci
      where ci.user_id = p_user_id
        and ci.removed_at is null
        and check_in_qualifies_for_challenge(ci.id)
        and ci.created_at >= p_starts_at
        and ci.created_at <= p_ends_at
    )
  end;
$score$;

-- ─────────────────────────── 2 · every challenge gets a roster ───────────────────────────
--
-- THE CREATOR IS A RACER. Both create paths now write their own author in as 'accepted' — they
-- proposed the race, there is nothing for them to accept. This is also what makes start_challenge
-- reachable at all: its "Nobody has accepted yet" guard exists to stop a race starting with an
-- empty field, and a field of one admin is not empty, it is a campfire that has not invited
-- anyone yet.

create or replace function create_group_challenge(
  p_circle_id uuid,
  p_target_count int,
  p_window_hours int,
  p_payout_xp int default 300,
  p_public_name text default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $cg$
declare
  v_challenge social_challenges;
begin
  if not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, target_count, window_hours, payout_xp, status, starts_at, ends_at, public_name, shape)
  values (p_circle_id, auth.uid(), 'group', p_target_count, p_window_hours, p_payout_xp, 'draft', null, null, nullif(btrim(coalesce(p_public_name, '')), ''), 'collective')
  returning * into v_challenge;

  insert into challenge_participants (challenge_id, user_id, state, responded_at)
  values (v_challenge.id, auth.uid(), 'accepted', now())
  on conflict (challenge_id, user_id) do nothing;

  return v_challenge;
end;
$cg$;

create or replace function create_h2h_challenge(
  p_opponent_id uuid,
  p_race_metric text,
  p_window_hours int,
  p_circle_id uuid default null,
  p_payout_xp int default 200,
  p_public_name text default null
)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $ch$
declare
  v_challenge social_challenges;
begin
  if p_opponent_id = auth.uid() then
    raise exception 'Pick someone else to challenge.';
  end if;

  if not exists (
    select 1 from friend_requests
    where status = 'accepted'
      and ((requester_id = auth.uid() and recipient_id = p_opponent_id)
        or (requester_id = p_opponent_id and recipient_id = auth.uid()))
  ) then
    raise exception 'You can only challenge a friend.';
  end if;

  if p_circle_id is not null and not is_group_member(p_circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  if exists (
    select 1 from social_challenges
    where mode = 'h2h' and status in ('pending', 'active')
      and ((created_by = auth.uid() and opponent_id = p_opponent_id)
        or (created_by = p_opponent_id and opponent_id = auth.uid()))
  ) then
    raise exception 'You already have an active or pending challenge with this person.';
  end if;

  insert into social_challenges (circle_id, created_by, mode, opponent_id, race_metric, window_hours, payout_xp, status, public_name, shape)
  values (p_circle_id, auth.uid(), 'h2h', p_opponent_id, p_race_metric, p_window_hours, p_payout_xp, 'pending', nullif(btrim(coalesce(p_public_name, '')), ''), 'duel')
  returning * into v_challenge;

  -- The duel's roster. The challenger is in by definition; the opponent stays 'invited' until
  -- they answer, which is the same state invite_challenge_members leaves a campfire member in.
  insert into challenge_participants (challenge_id, user_id, state, responded_at)
  values (v_challenge.id, auth.uid(), 'accepted', now()),
         (v_challenge.id, p_opponent_id, 'invited', null)
  on conflict (challenge_id, user_id) do nothing;

  perform notify_push(
    array[p_opponent_id],
    'You''ve been challenged',
    (select display_name from profiles where id = auth.uid()) || ' challenged you to a head-to-head.',
    jsonb_build_object('type', 'challenge_invite', 'challenge_id', v_challenge.id),
    'accountability'
  );

  return v_challenge;
end;
$ch$;

-- A duel starts the moment it is accepted (0019), so its gun goes off here rather than in
-- start_challenge — and the baselines have to be taken at the same instant, for the same reason
-- start_challenge takes them: (now - baseline) is the only figure that describes the race, and a
-- baseline taken at creation would credit whatever both people did while the invite sat unread.
create or replace function respond_to_h2h_challenge(p_challenge_id uuid, p_accept boolean)
returns social_challenges
language plpgsql
security definer
set search_path = public
as $rh$
declare
  v_challenge social_challenges;
begin
  select * into v_challenge from social_challenges
  where id = p_challenge_id and opponent_id = auth.uid() and status = 'pending';

  if v_challenge.id is null then
    raise exception 'Challenge not found or already answered.';
  end if;

  update challenge_participants
     set state = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where challenge_id = p_challenge_id and user_id = auth.uid();

  if p_accept then
    update social_challenges
    set status = 'active', starts_at = now(), ends_at = now() + make_interval(hours => window_hours)
    where id = p_challenge_id
    returning * into v_challenge;

    update challenge_participants p
       set baseline = challenge_metric_value(v_challenge.race_metric, p.user_id, v_challenge.starts_at)
     where p.challenge_id = p_challenge_id;
  else
    update social_challenges set status = 'declined' where id = p_challenge_id returning * into v_challenge;
  end if;

  return v_challenge;
end;
$rh$;

-- Backfill, deliberately narrow: only challenges that have NOT settled, so no finished race has
-- its result recomputed against a roster it never had. baseline stays 0 for anything already
-- running, which is exactly the deal those people entered — absolute totals over the window.
insert into challenge_participants (challenge_id, user_id, state, responded_at, baseline)
select sc.id, sc.created_by, 'accepted', sc.created_at, 0
from social_challenges sc
where not challenge_is_settled(sc.status) and sc.status <> 'declined'
on conflict (challenge_id, user_id) do nothing;

insert into challenge_participants (challenge_id, user_id, state, responded_at, baseline)
select sc.id, sc.opponent_id,
       case when sc.status = 'pending' then 'invited' else 'accepted' end,
       case when sc.status = 'pending' then null else sc.starts_at end,
       0
from social_challenges sc
where sc.mode = 'h2h' and sc.opponent_id is not null
  and not challenge_is_settled(sc.status) and sc.status <> 'declined'
on conflict (challenge_id, user_id) do nothing;

-- ─────────────────────────── 3 · one definition of "who is in this race" ───────────────────────────
--
-- challenge_field (0111) answers it for the settle path. The two READ paths below now ask the
-- same function, which is the whole reason it exists — three copies of the denominator is three
-- chances for the card, the watch screen and the payout to describe different races.
--
-- challenge_field's legacy arm (the whole campfire when there are no participant rows) still
-- covers everything that settled before this migration.

drop function if exists get_my_social_challenges();

create function get_my_social_challenges()
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
  window_hours int,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  winner_id uuid,
  payout_xp int,
  created_at timestamptz,
  public_name text,
  shape text,
  invited_count int,
  accepted_count int,
  my_state text
)
language plpgsql
security definer
set search_path = public
stable
as $mine$
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
    case when sc.mode = 'h2h' and not challenge_is_awaiting(sc.status)
      then social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.opponent_id else sc.created_by end,
        sc.race_metric, sc.starts_at, sc.ends_at)
      else null end as my_score,
    case when sc.mode = 'h2h' and not challenge_is_awaiting(sc.status)
      then social_challenge_score(
        case when auth.uid() = sc.opponent_id then sc.created_by else sc.opponent_id end,
        sc.race_metric, sc.starts_at, sc.ends_at)
      else null end as opponent_score,
    sc.target_count,
    -- THE FIELD, not the campfire. Was `count(*) from group_members` — the same denominator 0111
    -- removed from settlement, and the reason a subset race read "2 / 30 done" on its card.
    case when sc.mode = 'group'
      then (select count(*)::int from challenge_field(sc.id, sc.circle_id)) else null end as member_count,
    case when sc.mode = 'group' then (
      select count(*)::int from challenge_field(sc.id, sc.circle_id) f
      where (
        select count(*) from check_ins ci
        where ci.user_id = f.user_id and ci.removed_at is null
          and ci.created_at >= sc.starts_at and ci.created_at <= coalesce(sc.ends_at, now())
          and check_in_qualifies_for_challenge(ci.id)
      ) >= sc.target_count
    ) else null end as completed_count,
    sc.window_hours,
    sc.starts_at,
    sc.ends_at,
    sc.status,
    sc.winner_id,
    sc.payout_xp,
    sc.created_at,
    -- v2 columns the client could not render because they were never selected: public_name (0096)
    -- is what the card and the share card are meant to be titled with, and `shape` is what stops a
    -- collective goal drawing itself as a 1v1 VS.
    sc.public_name,
    sc.shape,
    -- The roster, summarised — enough for the tab to say "waiting on 3" and to know whether a
    -- draft has anybody in it yet, without a second round trip per card.
    (select count(*)::int from challenge_participants cp where cp.challenge_id = sc.id and cp.state = 'invited') as invited_count,
    (select count(*)::int from challenge_participants cp where cp.challenge_id = sc.id and cp.state = 'accepted') as accepted_count,
    (select cp.state from challenge_participants cp where cp.challenge_id = sc.id and cp.user_id = auth.uid()) as my_state
  from social_challenges sc
  -- left join: an h2h challenge with nobody watching has a null circle_id — an inner join here
  -- would silently drop it out of the result set entirely (migration 0032).
  left join groups g on g.id = sc.circle_id
  join profiles creator on creator.id = sc.created_by
  left join profiles opp on opp.id = sc.opponent_id
  where (
    (sc.mode = 'group' and is_group_member(sc.circle_id))
    or sc.created_by = auth.uid()
    or sc.opponent_id = auth.uid()
  )
    and sc.status != 'declined'
    -- A DRAFT IS PRIVATE UNTIL SOMEONE IS INVITED (0097).
    and (not challenge_is_draft(sc.status) or sc.created_by = auth.uid())
  order by
    (challenge_is_awaiting(sc.status) and sc.opponent_id = auth.uid()) desc,
    sc.created_at desc;
end;
$mine$;

-- ─────────────────────────── 4 · the group watch screen ───────────────────────────
--
-- Three changes, all of them things the screen was already trying to draw:
--   · the FIELD rather than group_members (see above);
--   · the SETTLED band, so a finished group race opens its final standings instead of raising
--     "not found". get_challenge_watch has allowed this since 0056 and the group twin never did,
--     which is why a duel's result page works and a campfire's is a dead end;
--   · per-person CHEERS, which CAMPFIRE_REDESIGN_SPEC asks for under each meter and which had no
--     column to read.

drop function if exists get_group_challenge_watch(uuid);

create function get_group_challenge_watch(p_challenge_id uuid)
returns table (
  challenge_id uuid,
  target_count int,
  window_hours int,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  circle_id uuid,
  circle_name text,
  public_name text,
  member_id uuid,
  member_name text,
  member_progress bigint,
  member_live_status text,
  member_cheers int,
  cheered_by_me boolean
)
language plpgsql
security definer
set search_path = public
stable
as $gw$
declare
  v_challenge social_challenges;
begin
  -- sc.status, not status: `status` is an OUT column of this function now. That is the same trap
  -- 0099 was written about — adding a name to RETURNS TABLE changes the body's namespace, not
  -- just the signature.
  select * into v_challenge from social_challenges sc
  where sc.id = p_challenge_id
    and sc.mode = 'group'
    and (challenge_is_live(sc.status) or challenge_is_settled(sc.status));
  if v_challenge.id is null then
    raise exception 'Group challenge not found or not active.';
  end if;
  if not is_group_member(v_challenge.circle_id) then
    raise exception 'Not a member of that campfire.';
  end if;

  return query
  select
    v_challenge.id,
    v_challenge.target_count,
    v_challenge.window_hours,
    v_challenge.starts_at,
    v_challenge.ends_at,
    v_challenge.status,
    v_challenge.circle_id,
    g.name,
    v_challenge.public_name,
    f.user_id,
    p.display_name,
    (
      select count(*) from check_ins ci
      where ci.user_id = f.user_id and ci.removed_at is null
        and ci.created_at >= v_challenge.starts_at and ci.created_at <= coalesce(v_challenge.ends_at, now())
        and check_in_qualifies_for_challenge(ci.id)
    ),
    live_status(f.user_id),
    (select count(*)::int from challenge_cheers cc
      where cc.challenge_id = p_challenge_id and cc.for_user_id = f.user_id),
    exists (select 1 from challenge_cheers cc
      where cc.challenge_id = p_challenge_id and cc.spectator_id = auth.uid() and cc.for_user_id = f.user_id)
  from challenge_field(p_challenge_id, v_challenge.circle_id) f
  join profiles p on p.id = f.user_id
  join groups g on g.id = v_challenge.circle_id;
end;
$gw$;

grant execute on function get_group_challenge_watch(uuid) to authenticated;

-- ─────────────────────────── 5 · a cheer reaches the person cheered ───────────────────────────

-- 'challenge_cheered' is a challenges-category event. An unmapped type falls to 'friends_social'
-- (0086's deliberate default), which would file a cheer under the wrong toggle in both
-- directions: someone who muted Challenges would still be pushed, and someone who muted Friends
-- would silently lose it.
create or replace function notification_category(p_type text)
returns text
language sql
immutable
as $nc$
  select case
    when p_type in ('friend_request', 'friend_accepted', 'friend_ranked_up', 'friend_passed_you',
                    'friend_joined', 'friend_locked_in') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone', 'challenge_cheered') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message')
      then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready')
      then 'season_rank'
    else 'friends_social'
  end;
$nc$;

-- Same signature as 0110's, so create-or-replace rather than the drop that file needed — 0110 was
-- ADDING p_note, and nothing here changes the argument list.
create or replace function cheer_challenge(p_challenge_id uuid, p_for_user_id uuid, p_note text default null)
returns int
language plpgsql
security definer
set search_path = public
as $cheer$
declare
  v_challenge social_challenges;
  v_inserted int;
  v_count int;
  v_note text;
  v_cheerer text;
  v_is_racer boolean;
  v_i_race boolean;
begin
  select * into v_challenge
  from social_challenges sc
  where sc.id = p_challenge_id and challenge_is_live(sc.status);
  if v_challenge.id is null then
    -- Also covers a COMPLETED challenge: once it settles the watch screen is read-only, so a late
    -- cheer must not land (punchlist A4 / CHALLENGE_UI_SPEC §58).
    raise exception 'Challenge not found or not active.';
  end if;

  -- The same gate the watch screen is behind (0110). Cheering was checking only whether the
  -- TARGET was in the challenge, never whether the caller was allowed to see it.
  if not can_watch_challenge(p_challenge_id) then
    raise exception 'You don''t have access to watch this challenge.';
  end if;

  -- WHO CAN BE CHEERED. Was created_by/opponent_id only — the duel's shape — so nobody in a
  -- collective or placement race could be cheered at all, and the per-person cheer count the
  -- watch screen draws had nothing behind it. The roster answers this for every shape; the duel
  -- columns stay as the fallback for challenges that predate a roster.
  v_is_racer := exists (
    select 1 from challenge_participants p
    where p.challenge_id = p_challenge_id and p.user_id = p_for_user_id and p.state = 'accepted'
  ) or p_for_user_id in (v_challenge.created_by, coalesce(v_challenge.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid));
  if not v_is_racer then
    raise exception 'That person is not in this challenge.';
  end if;

  -- Competing in it is what disqualifies you, by the same rule and now off the same roster.
  v_i_race := exists (
    select 1 from challenge_participants p
    where p.challenge_id = p_challenge_id and p.user_id = auth.uid() and p.state = 'accepted'
  ) or auth.uid() in (v_challenge.created_by, coalesce(v_challenge.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid));
  if v_i_race then
    raise exception 'You can''t cheer a challenge you''re competing in.';
  end if;

  -- Whitespace-only is not a note. Normalised to null so the constraint sees either a real
  -- message or nothing, and the reader never has to render an empty bubble.
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and length(v_note) > 140 then
    raise exception 'Keep it under 140 characters.';
  end if;

  insert into challenge_cheers (challenge_id, spectator_id, for_user_id, note)
  values (p_challenge_id, auth.uid(), p_for_user_id, v_note)
  on conflict (challenge_id, spectator_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    if p_for_user_id = v_challenge.created_by then
      update social_challenges set created_by_cheers = created_by_cheers + 1 where id = p_challenge_id;
    elsif p_for_user_id = v_challenge.opponent_id then
      update social_challenges set opponent_cheers = opponent_cheers + 1 where id = p_challenge_id;
    end if;

    -- THE PUSH THE SPEC ASKED FOR. Guarded by v_inserted, which makes it idempotent for free: one
    -- cheer per spectator per challenge is enforced by the conflict clause above, so a repeat tap
    -- inserts nothing and notifies nobody.
    --
    -- notify_event (0086/0087), not notify_push — it writes the bell row as well as the push,
    -- honours the category toggle and quiet hours, and derives the cheerer's own avatar as the
    -- leading art from p_actor_id, which is what the spec means by "leads with the cheerer's
    -- avatar". The route carries `mode` so the tap lands on the right watch variant.
    select display_name into v_cheerer from profiles where id = auth.uid();
    perform notify_event(
      array[p_for_user_id],
      'challenge_cheered',
      '🔥 ' || coalesce(v_cheerer, 'Someone') || ' cheered you on',
      v_note,
      auth.uid(),
      p_challenge_id,
      '/watch/[challengeId]',
      jsonb_build_object(
        'challengeId', p_challenge_id::text,
        'mode', case when v_challenge.mode = 'group' then 'group' else 'h2h' end),
      null, null,
      jsonb_build_object('challenge_id', p_challenge_id, 'with_note', v_note is not null)
    );
  end if;

  -- Hand back the authoritative count for the side that was cheered, so the client renders the
  -- server's number rather than a local optimistic delta it never reconciles. The two duel
  -- columns are only meaningful for a duel; for any other shape the count is the roster's, which
  -- is also what get_group_challenge_watch reads.
  if v_challenge.mode = 'h2h'
     and p_for_user_id in (v_challenge.created_by, coalesce(v_challenge.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    select case when p_for_user_id = v_challenge.created_by then created_by_cheers else opponent_cheers end
      into v_count
    from social_challenges where id = p_challenge_id;
  else
    select count(*)::int into v_count
    from challenge_cheers cc
    where cc.challenge_id = p_challenge_id and cc.for_user_id = p_for_user_id;
  end if;

  return v_count;
end;
$cheer$;

-- ─────────────────────────── 6 · deleting a challenge ───────────────────────────
--
-- CAMPFIRE_REDESIGN_SPEC: "Add a Delete challenge action (currently missing) — inside that ⋯
-- menu." Deliberately NOT a way out of a race that is running: a live challenge is a deal other
-- people are still keeping, and cancel/forfeit (0058) are the consented routes out of one. This
-- deletes something that never got going, or clears a finished row off the list.
create or replace function delete_social_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $del$
declare
  v_challenge social_challenges;
begin
  select * into v_challenge from social_challenges where id = p_challenge_id;
  if v_challenge.id is null then raise exception 'Challenge not found.'; end if;

  -- is_campfire_admin, never groups.owner_id: owner ⊂ admin, and a promoted admin must pass
  -- (handoff A's rule, 0094).
  if not (
    v_challenge.created_by = auth.uid()
    or (v_challenge.circle_id is not null and is_campfire_admin(v_challenge.circle_id, auth.uid()))
  ) then
    raise exception 'Only the person who started it, or a campfire admin, can delete it.';
  end if;

  if challenge_is_live(v_challenge.status) then
    raise exception 'That race is still running. End it with the other side first.';
  end if;

  -- challenge_participants and challenge_cheers both cascade from social_challenges (0096, 0081);
  -- bonus_xp_awards.challenge_id is ON DELETE SET NULL, so a paid-out award survives the row it
  -- came from. Deleting a settled challenge must never claw back XP that already landed.
  delete from social_challenges where id = p_challenge_id;
end;
$del$;

grant execute on function delete_social_challenge(uuid) to authenticated;

-- ─────────────────────────── 7 · the settle sweep pays once ───────────────────────────
--
-- 0111's body with ONE change; everything else below is byte-for-byte 0111 so the reward maths is
-- not re-derived by hand.
--
-- FOR UPDATE on the driving cursor. Idempotency rested entirely on the status flip happening in
-- the same transaction: read-committed lets two overlapping cron ticks both see status='active'
-- and both insert into bonus_xp_awards, paying the same challenge twice. Locking the row makes
-- the second tick wait, and read-committed then re-evaluates the WHERE against the committed row
-- — which by then says 'completed', so it skips.
--
-- A unique index on (user_id, challenge_id, reason) would be the other way to say this, but it
-- cannot be added without first deduplicating awards that have already been paid, and deleting a
-- landed XP award to satisfy a constraint is worse than the race it prevents. The sweep is the
-- only writer, so the lock is the right place for the guarantee.
create or replace function finalize_social_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $fin$
declare
  r record;
  v_my numeric;
  v_opp numeric;
  v_field_count int;
  v_completed_count int;
  v_has_roster boolean;
  v_winner uuid;
begin
  -- Band, not `status = 'active'` (0111). 0096 widened the vocabulary with 'draft', and a sweep
  -- that tests a literal keeps its old meaning silently when the vocabulary grows.
  for r in
    select * from social_challenges sc
    where challenge_is_live(sc.status) and sc.ends_at <= now()
    for update
  loop

    select exists (select 1 from challenge_participants p where p.challenge_id = r.id)
      into v_has_roster;

    if r.mode = 'h2h' then
      if v_has_roster then
        -- Progress since the gun, not lifetime totals. Evaluated as of ends_at rather than now()
        -- so a sweep that runs late settles the race that was run, not the hours after it.
        select
          coalesce(max(case when p.user_id = r.created_by
            then challenge_metric_value(r.race_metric, p.user_id, r.ends_at) - p.baseline end), 0),
          coalesce(max(case when p.user_id = r.opponent_id
            then challenge_metric_value(r.race_metric, p.user_id, r.ends_at) - p.baseline end), 0)
          into v_my, v_opp
        from challenge_participants p
        where p.challenge_id = r.id and p.state = 'accepted';
      else
        v_my := social_challenge_score(r.created_by, r.race_metric, r.starts_at, r.ends_at);
        v_opp := social_challenge_score(r.opponent_id, r.race_metric, r.starts_at, r.ends_at);
      end if;

      v_winner := case when v_my > v_opp then r.created_by
                       when v_opp > v_my then r.opponent_id
                       else null end;

      update social_challenges set status = 'completed', winner_id = v_winner where id = r.id;

      -- A draw pays nobody, as in 0034. Splitting the pot would make a deliberate tie the safest
      -- way to play a duel.
      if v_winner is not null then
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        values (v_winner, r.payout_xp, 'challenge_h2h_winner', r.id);
      end if;

      if v_has_roster then
        update challenge_participants p
           set final_value = case when p.user_id = r.created_by then v_my else v_opp end,
               final_rank = case
                 when v_winner is null then 1
                 when p.user_id = v_winner then 1
                 else 2 end,
               final_percentile = case
                 when v_winner is null then 1.0
                 when p.user_id = v_winner then 1.0
                 else 0.0 end
         where p.challenge_id = r.id;
      end if;

    else
      select count(*) into v_field_count from challenge_field(r.id, r.circle_id);

      select count(*) into v_completed_count
      from challenge_field(r.id, r.circle_id) f
      where (
        select count(*) from check_ins ci
        where ci.user_id = f.user_id and ci.removed_at is null
          and ci.created_at >= r.starts_at and ci.created_at <= r.ends_at
          and check_in_qualifies_for_challenge(ci.id)
      ) >= r.target_count;

      if v_completed_count >= v_field_count and v_field_count > 0 then
        update social_challenges set status = 'completed' where id = r.id;

        -- 'xp' is hardcoded on purpose and is NOT a stale literal: a group challenge leaves
        -- race_metric null (the 0098 insert does not set it), because the target is a count of
        -- check-ins rather than a metric race. XP is what orders the field once everyone has met
        -- the same target.
        insert into bonus_xp_awards (user_id, amount, reason, challenge_id)
        select
          ranked.user_id,
          round(r.payout_xp * placement_multiplier(ranked.placement, v_field_count)),
          'challenge_group_completion',
          r.id
        from (
          select f.user_id,
                 rank() over (order by social_challenge_score(f.user_id, 'xp', r.starts_at, r.ends_at) desc) as placement
          from challenge_field(r.id, r.circle_id) f
        ) ranked;

        if v_has_roster then
          update challenge_participants p
             set final_value = ranked.score,
                 final_rank = ranked.placement,
                 final_percentile = 1.0 - (ranked.placement - 1)::numeric / greatest(v_field_count - 1, 1)
            from (
              select f.user_id,
                     social_challenge_score(f.user_id, 'xp', r.starts_at, r.ends_at) as score,
                     rank() over (order by social_challenge_score(f.user_id, 'xp', r.starts_at, r.ends_at) desc) as placement
              from challenge_field(r.id, r.circle_id) f
            ) ranked
           where p.challenge_id = r.id and p.user_id = ranked.user_id;
        end if;
      else
        -- Nobody is paid when the field did not all finish, as in 0034. The standings are still
        -- written so an expired challenge can show what happened instead of just vanishing.
        update social_challenges set status = 'expired' where id = r.id;

        if v_has_roster then
          update challenge_participants p
             set final_value = ranked.done,
                 final_rank = ranked.placement,
                 final_percentile = 1.0 - (ranked.placement - 1)::numeric / greatest(v_field_count - 1, 1)
            from (
              select f.user_id,
                     (select count(*) from check_ins ci
                       where ci.user_id = f.user_id and ci.removed_at is null
                         and ci.created_at >= r.starts_at and ci.created_at <= r.ends_at
                         and check_in_qualifies_for_challenge(ci.id)) as done,
                     rank() over (order by (select count(*) from check_ins ci
                       where ci.user_id = f.user_id and ci.removed_at is null
                         and ci.created_at >= r.starts_at and ci.created_at <= r.ends_at
                         and check_in_qualifies_for_challenge(ci.id)) desc) as placement
              from challenge_field(r.id, r.circle_id) f
            ) ranked
           where p.challenge_id = r.id and p.user_id = ranked.user_id;
        end if;
      end if;
    end if;
  end loop;
end;
$fin$;

-- ─────────────────────────── 8 · the reward trigger uses the roster too ───────────────────────────
--
-- 0089's group arm derives participation from "locked in inside the window", which was the only
-- thing available before 0096 existed. It is now the third denominator in the system and it
-- disagrees with both of the others: somebody on the roster who never logged a session gets no
-- reward event at all, and somebody in the campfire who is NOT on the roster gets paid.
--
-- Body is 0089's. Only the group arm's participant set changed, and it falls back to 0089's own
-- derivation for any challenge with no roster (everything created before 0096).
--
-- The bell row now deep-links to /challenge-info rather than /group: 0111 gave a settled
-- challenge real standings to show, and the campfire screen has nowhere to put them.
create or replace function economy_on_social_challenge_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $econ$
declare
  v_days int;
  v_scope int;
  v_loser uuid;
  v_winner_name text;
  v_loser_name text;
  v_field uuid[];
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  v_days := greatest(1, ceil(new.window_hours / 24.0)::int);

  if new.mode = 'h2h' then
    v_scope := 1;
    if new.winner_id is not null then
      perform grant_reward(new.winner_id, 'friend_h2h', 1.0, v_days, v_scope, 0.0, true, new.id);
      -- The loser still finished the thing. Completion band only — placement 1.0 is last place.
      v_loser := case when new.winner_id = new.created_by then new.opponent_id else new.created_by end;
      perform grant_reward(v_loser, 'friend_h2h', 1.0, v_days, v_scope, 1.0, true, new.id);

      select display_name into v_winner_name from profiles where id = new.winner_id;
      select display_name into v_loser_name from profiles where id = v_loser;

      -- Two events, not one broadcast: the copy differs, and more importantly the ACTOR differs.
      -- Each side's leading art is the OTHER person's face.
      perform notify_event(
        array[new.winner_id], 'challenge_won',
        'You won',
        case when v_loser_name is not null then 'You beat ' || v_loser_name || '.' else 'You took the challenge.' end,
        v_loser, new.id,
        '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
        null, null,
        jsonb_build_object('mode', new.mode, 'outcome', 'won')
      );

      perform notify_event(
        array[v_loser], 'challenge_lost',
        'Challenge over',
        case when v_winner_name is not null then v_winner_name || ' edged it. Rematch?' else 'Rematch?' end,
        new.winner_id, new.id,
        '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
        null, null,
        jsonb_build_object('mode', new.mode, 'outcome', 'lost')
      );
    end if;
  else
    if new.circle_id is null then return new; end if;

    if exists (select 1 from challenge_participants p where p.challenge_id = new.id) then
      select coalesce(array_agg(f.user_id), '{}') into v_field
      from challenge_field(new.id, new.circle_id) f;
    else
      select coalesce(array_agg(distinct s.user_id), '{}') into v_field
      from lock_in_sessions s
      join group_members gm on gm.user_id = s.user_id and gm.group_id = new.circle_id
      where s.status = 'completed'
        and s.started_at >= new.starts_at
        and s.started_at <= coalesce(new.ends_at, now())
        and extract(epoch from (s.last_confirmed_at - s.started_at))
            >= (select value::int from economy_config where key = 'lock_in_min_seconds');
    end if;

    v_scope := coalesce(array_length(v_field, 1), 0);
    if v_scope = 0 then return new; end if;

    -- Real percentile placement needs the per-member standings 0111 now writes; wiring
    -- grant_reward to final_percentile is a reward-tuning change and stays out of a bugfix pass,
    -- so everyone still lands on the completion band rather than being handed a guessed rank.
    perform grant_reward(u, 'campfire_group', 1.0, v_days, greatest(v_scope, 1), 0.75, true, new.id)
    from unnest(v_field) u;

    -- One event to every participant. No actor: a campfire challenge settling is the campfire's
    -- doing, not any one member's, so it leads with the campfire rather than a face.
    perform notify_event(
      v_field,
      'campfire_settled',
      'Campfire challenge settled',
      'Your rewards are ready to collect.',
      null, new.circle_id,
      '/challenge-info/[challengeId]', jsonb_build_object('challengeId', new.id::text),
      null, 'rounded',
      jsonb_build_object('challenge_id', new.id, 'mode', new.mode)
    );
  end if;

  return new;
end;
$econ$;

-- Trigger definition unchanged from 0089 — same NAME and same `of status` clause, restated so
-- re-running this file is idempotent. Restating it under a different name would not replace
-- 0089's, it would add a SECOND trigger on the same table calling the same function, and every
-- settled challenge would pay its rewards twice.
drop trigger if exists social_challenges_economy on social_challenges;
create trigger social_challenges_economy
  after update of status on social_challenges
  for each row execute function economy_on_social_challenge_closed();
