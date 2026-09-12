-- A live "locked in with you" count (CODE_PROMPT_live_presence_counter.md).
--
-- Someone at the gym seeing "1,000+ locked in on Fitness right now" is part of something. That is
-- the whole feature. Everything below exists to make that number (a) cheap, (b) true, and (c)
-- absent until it is worth showing.
--
-- ── (a) CHEAP — WHY THIS IS NOT REALTIME PRESENCE ──────────────────────────────────────────
--
-- Realtime Presence fans a full roster diff out to EVERY subscriber on EVERY join and leave:
-- O(events x subscribers). At a few thousand concurrent lock-ins that is hundreds of millions of
-- messages a month. The count is an aggregate — nobody needs the roster to render "540" — so the
-- server keeps the count and broadcasts ONE coalesced message to the whole channel, on a GLOBAL
-- wall-clock 30s cadence, only when the number changed.
--
-- The shared clock is the entire saving and it is not an implementation detail. A per-user 30s
-- timer (30s from each client's own subscribe) would force a separately-timed message per client
-- and put the cost straight back at per-event fan-out. One tick, one message, every subscriber.
-- Quiet half-minutes send nothing at all.
--
-- ── HOW A LEAVE IS DETECTED ────────────────────────────────────────────────────────────────
--
-- Heartbeat + reaper, not a disconnect event. A phone that is force-quit, run out of battery or
-- driven into a tunnel never gets to say goodbye, and a count that only ever decrements on a
-- polite exit drifts upward forever — the classic stale-presence bug, and it is worse than no
-- count at all because it is a number that is WRONG rather than small. So: the client beats every
-- ~45s while locked in and foregrounded, and the tick reaps anything that has not beaten inside
-- lockin_presence_config.stale_seconds (90s). Three missed beats and you are out.
--
-- ── (b) TRUE — NO FABRICATED NUMBERS ANYWHERE IN THIS FILE ─────────────────────────────────
--
-- There is no seed, no floor multiplier, no "+ 40 to look busy". A fake 1,000 is a trust bomb: it
-- reads as a lie the first time a member cross-checks it against the campfire they can see. What
-- this file does instead is pick the widest HONEST framing that clears a threshold — right now,
-- else today, else this week; campus if campus is denser, else global — and label it with exactly
-- what it counted. "today" means today.
--
-- ── (c) ABSENT UNTIL IT IS WORTH SHOWING ───────────────────────────────────────────────────
--
-- "3 studying right now" signals a dead app and does the opposite of what the pill is for. Below
-- the threshold the RPC returns display='floor' and the client shows a call to be first. The gate
-- IS the on-switch: no app update, no launch-day flag to remember, and it lights per category and
-- per campus independently. The counts are logged into lockin_presence_samples on every tick
-- regardless of what any member can see, which is how we learn density has arrived before they do.

-- ─────────────────────────── §1 · config, so the switch is server-side ───────────────────────────
--
-- Singleton. The client never reads this table; it reads whatever the RPC decided. That is
-- deliberate — a threshold the client evaluates is a threshold that needs an app release to move,
-- and this one has to be movable on the day density arrives.
create table if not exists lockin_presence_config (
  id boolean primary key default true check (id),
  -- auto: threshold-gated (the default, and the only mode a member should ever meet).
  -- force_off: pill hidden entirely and the tick stops broadcasting — the kill switch.
  -- force_on: show the real number however small. Testing only; it is the one mode that can put
  --           "2 studying right now" on a screen.
  mode text not null default 'auto' check (mode in ('auto', 'force_off', 'force_on')),
  -- Below this, no number is shown. 8 is the smallest count that reads as "a room" rather than
  -- "the three of us"; it is a product judgement and it is here so it can be changed without a build.
  floor_threshold int not null default 8 check (floor_threshold >= 0),
  -- Three missed 45s beats less a little slack. Longer and a force-quit lingers in the count;
  -- much shorter and a GC pause or a slow network drops a member who is sitting right there.
  stale_seconds int not null default 90 check (stale_seconds between 45 and 600),
  updated_at timestamptz not null default now()
);

insert into lockin_presence_config (id) values (true) on conflict (id) do nothing;

-- ─────────────────────────── §2 · who is locked in this instant ───────────────────────────
--
-- Deliberately NOT a column on lock_in_sessions. A beat is a write every 45s per active member
-- against a table that is read on the home screen, the campfire timeline and every profile; putting
-- it on the session row would churn that row's heap page (and every index on it) for a number
-- nothing on those screens reads. One narrow row per locked-in member, and it is the only thing the
-- reaper has to sweep.
create table if not exists lockin_presence (
  -- One live session per member is already the rule (lock_in_sessions has one active row per user),
  -- so the member IS the key — and it makes the beat a single idempotent upsert with no way to
  -- accumulate two rows for one person and double-count them.
  user_id uuid primary key references profiles (id) on delete cascade,
  session_id uuid not null references lock_in_sessions (id) on delete cascade,
  category text not null check (category in ('study', 'fitness')),
  activity text,
  -- SNAPSHOT of profiles.university at beat time, not a join. The campus scope is read once per
  -- tick over every live row; joining profiles there would be a join per tick forever to answer a
  -- question whose answer cannot change mid-session.
  university text,
  started_at timestamptz not null default now(),
  last_beat_at timestamptz not null default now(),
  constraint lockin_presence_shape check (
    (category = 'study' and activity is null)
    or (category = 'fitness' and activity in ('cardio', 'strength'))
  )
);

-- The reaper's predicate.
create index if not exists lockin_presence_beat_idx on lockin_presence (last_beat_at);
-- The tick's group-by and the RPC's campus filter.
create index if not exists lockin_presence_scope_idx on lockin_presence (university, category, activity);

-- ─────────────────────────── §3 · what was last broadcast, per topic ───────────────────────────
--
-- This table is what makes "only when the count changed" possible: the tick compares the number it
-- just computed against the number it last SENT, not against the number it computed last time.
-- Without it every tick is a message and the 30s cadence saves nothing at all.
create table if not exists lockin_presence_snapshot (
  topic text primary key,
  -- Counts only. The timestamp is added on the way out, because including it here would make every
  -- payload differ from the last one and defeat the comparison.
  counts jsonb not null,
  sent_at timestamptz not null default now()
);

-- ─────────────────────────── §4 · the instrument ───────────────────────────
--
-- Sampled on every tick regardless of display mode, because the question "is it dense enough to
-- show anyone yet" cannot be answered from a feature that is hidden until it is dense enough to
-- show someone. Written only when the breakdown CHANGED or five minutes have passed, so a quiet
-- night is a handful of rows rather than 2,880.
create table if not exists lockin_presence_samples (
  id bigint generated always as identity primary key,
  sampled_at timestamptz not null default now(),
  study int not null,
  cardio int not null,
  strength int not null,
  total int not null,
  -- {"Wilfrid Laurier University": {"study": 4, "cardio": 0, "strength": 1}, ...} — campus-by-campus
  -- seeding needs to see which campus lit up, not just that someone did.
  by_campus jsonb not null default '{}'::jsonb
);

create index if not exists lockin_presence_samples_at_idx on lockin_presence_samples (sampled_at desc);

-- Server-only, all four. Aggregate counts leave through the RPC and the broadcast; the rows
-- themselves say WHO is locked in right now and never leave at all. RLS on with no policy is the
-- statement of that; the revokes are the belt to its braces, since a future `grant ... on all
-- tables` would otherwise quietly open these.
alter table lockin_presence_config enable row level security;
alter table lockin_presence enable row level security;
alter table lockin_presence_snapshot enable row level security;
alter table lockin_presence_samples enable row level security;

revoke all on lockin_presence_config from anon, authenticated;
revoke all on lockin_presence from anon, authenticated;
revoke all on lockin_presence_snapshot from anon, authenticated;
revoke all on lockin_presence_samples from anon, authenticated;

-- ─────────────────────────── §5 · one definition of "which line is this" ───────────────────────────
--
-- Three display keys, and they deliberately OVERLAP: 'gym' is a subset of 'fitness'. A member doing
-- strength work sees "N at the gym right now" (strength only — the specific, relatable room), a
-- member doing cardio sees "N locked in on Fitness right now" (cardio AND strength — the wider,
-- denser number, because there is no honest way to make a cardio-only count bigger than it is).
--
-- Every count in this file goes through these two functions so the predicate cannot drift between
-- the live number, the windowed number and the broadcast. A 'today' count that means something
-- subtly different from the 'right now' count it replaces is the bug this prevents.
create or replace function lockin_key_matches(p_key text, p_category text, p_activity text)
returns boolean
language sql
immutable
as $fn$
  select case p_key
    when 'study' then p_category = 'study'
    when 'fitness' then p_category = 'fitness'
    when 'gym' then p_category = 'fitness' and p_activity = 'strength'
    else false
  end;
$fn$;

-- The (category, activity) a row resolves to, for rows written before 0182 gave them their own
-- columns. MUST match 0182's own backfill: gym -> fitness/strength, run -> fitness/cardio,
-- everything else -> study. A drift here does not error, it just quietly counts a lock-in into the
-- wrong room.
create or replace function lockin_pair_of(p_category text, p_activity text, p_goal_type text)
returns table (category text, activity text)
language sql
immutable
as $fn$
  select
    coalesce(p_category,
      case when p_goal_type in ('gym', 'run') then 'fitness' else 'study' end),
    case
      when coalesce(p_category, case when p_goal_type in ('gym', 'run') then 'fitness' else 'study' end) <> 'fitness'
        then null
      else coalesce(p_activity, case when p_goal_type = 'run' then 'cardio' else 'strength' end)
    end;
$fn$;

-- ─────────────────────────── §6 · topics ───────────────────────────
--
-- Hashed rather than the university's own name, because a topic is a public string: subscribing is
-- how you receive, so anything in the name is readable by anyone who can guess it. The count itself
-- is fine to be public — it is an aggregate and nothing else — but a channel list that enumerates
-- which universities are on Philoi is a different disclosure, and there is no reason to make it.
create or replace function lockin_presence_topic(p_campus text)
returns text
language sql
immutable
as $fn$
  select case
    when p_campus is null or btrim(p_campus) = '' then 'lockin-presence:global'
    else 'lockin-presence:campus:' || md5(lower(btrim(p_campus)))
  end;
$fn$;

-- ─────────────────────────── §7 · the two counts ───────────────────────────

-- CONCURRENCY. Heartbeat-backed, so it answers "right now" and not "started a session at some
-- point and may well have gone home".
create or replace function lockin_live_count(p_key text, p_campus text, p_stale_seconds int)
returns int
language sql
stable
security definer
set search_path = public
as $fn$
  select count(*)::int
  from lockin_presence lp
  where lp.last_beat_at > now() - make_interval(secs => p_stale_seconds)
    and lockin_key_matches(p_key, lp.category, lp.activity)
    and (p_campus is null or lp.university = p_campus);
$fn$;

-- THE WIDE, HONEST NUMBER. Distinct members who have locked in since p_since — completed sessions
-- from check_ins, UNION the ones still running. The union is not padding: someone who is locked in
-- at this moment has unarguably locked in today, and leaving them out would make "today" smaller
-- than "right now" at exactly the moments the pill is most worth showing.
create or replace function lockin_window_count(p_key text, p_campus text, p_since timestamptz, p_stale_seconds int)
returns int
language sql
stable
security definer
set search_path = public
as $fn$
  select count(distinct u)::int from (
    select ci.user_id as u
    from check_ins ci
    join profiles p on p.id = ci.user_id
    cross join lateral lockin_pair_of(ci.category, ci.activity, ci.goal_type) pair
    where ci.created_at >= p_since
      and ci.removed_at is null
      and lockin_key_matches(p_key, pair.category, pair.activity)
      and (p_campus is null or p.university = p_campus)
    union
    select lp.user_id
    from lockin_presence lp
    where lp.last_beat_at > now() - make_interval(secs => p_stale_seconds)
      and lockin_key_matches(p_key, lp.category, lp.activity)
      and (p_campus is null or lp.university = p_campus)
  ) s;
$fn$;

-- Midnight in the caller's own zone. Reuses 0084's validated user_local_date rather than a second
-- zone-handling path, so an unparseable zone written by some client degrades to UTC here exactly
-- the way it does for the daily goal rollover.
create or replace function lockin_local_day_start(p_tz text)
returns timestamptz
language sql
stable
set search_path = public
as $fn$
  select (user_local_date(p_tz)::timestamp) at time zone
    coalesce((select name from pg_timezone_names where name = p_tz), 'UTC');
$fn$;

-- ─────────────────────────── §8 · the pill's whole brain, server-side ───────────────────────────
--
-- The client renders what comes back and decides nothing. That is the requirement, and it is what
-- keeps the number honest: there is no client-side path that could widen a window without widening
-- the label with it, or nudge a count upward, because the client is never given the raw material to
-- do either.
create or replace function get_active_lockin_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_cfg lockin_presence_config%rowtype;
  v_session lock_in_sessions%rowtype;
  v_category text;
  v_activity text;
  v_key text;
  v_campus text;
  v_tz text;
  v_day_start timestamptz;
  v_since timestamptz;
  v_window text;
  v_count int;
  v_scope text := null;
  v_picked_window text := null;
  v_picked_count int := null;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_cfg from lockin_presence_config where id;

  select p.university, coalesce(p.timezone, p.notification_prefs ->> 'timezone')
    into v_campus, v_tz
  from profiles p
  where p.id = v_uid;

  -- Contextual to the session the caller is IN. Not a parameter: a client that could name its own
  -- category could ask for whichever of the three numbers happened to be biggest, and the line
  -- would stop describing the room the member is actually sitting in.
  select * into v_session
  from lock_in_sessions
  where user_id = v_uid and status = 'active'
  limit 1;

  if not found then
    return jsonb_build_object('display', 'hidden', 'reason', 'no_active_session');
  end if;

  select pair.category, pair.activity into v_category, v_activity
  from lockin_pair_of(v_session.category, v_session.activity, v_session.goal_type) pair;

  v_key := case
    when v_category = 'study' then 'study'
    when v_activity = 'strength' then 'gym'
    else 'fitness'
  end;

  if v_cfg.mode = 'force_off' then
    return jsonb_build_object('display', 'hidden', 'reason', 'force_off', 'key', v_key);
  end if;

  v_day_start := lockin_local_day_start(v_tz);

  -- Narrowest window first, and campus before global WITHIN a window. Liveness is what the pill is
  -- for — "right now" is the thing that makes someone feel accompanied — so a live number that
  -- clears the bar always beats a bigger number from a wider window. Campus wins ties because "at
  -- Laurier" is a room you can picture and "globally" is not.
  foreach v_window in array array['now', 'today', 'week'] loop
    v_since := case v_window when 'today' then v_day_start when 'week' then v_day_start - interval '6 days' end;

    if v_campus is not null then
      v_count := case v_window
        when 'now' then lockin_live_count(v_key, v_campus, v_cfg.stale_seconds)
        else lockin_window_count(v_key, v_campus, v_since, v_cfg.stale_seconds)
      end;
      if v_count >= v_cfg.floor_threshold or (v_cfg.mode = 'force_on' and v_count > 0) then
        v_scope := 'campus';
        v_picked_window := v_window;
        v_picked_count := v_count;
        exit;
      end if;
    end if;

    v_count := case v_window
      when 'now' then lockin_live_count(v_key, null, v_cfg.stale_seconds)
      else lockin_window_count(v_key, null, v_since, v_cfg.stale_seconds)
    end;
    if v_count >= v_cfg.floor_threshold or (v_cfg.mode = 'force_on' and v_count > 0) then
      v_scope := 'global';
      v_picked_window := v_window;
      v_picked_count := v_count;
      exit;
    end if;
  end loop;

  if v_picked_window is null then
    -- Nothing cleared the bar anywhere. Return the "be first" state and NOT the small number that
    -- produced it — a count is either worth showing or it is not, and a 3 shown apologetically is
    -- still a 3 on the screen.
    return jsonb_build_object(
      'display', 'floor',
      'key', v_key,
      'campus', v_campus,
      -- The one bit of the suppressed number that is safe to hand over, and the difference
      -- between two very different sentences: "be the first to light the fire" is a lie if
      -- somebody else is already sitting there. A boolean, not a count — "you are not alone"
      -- carries the warmth without putting a 2 on the screen.
      'alone', lockin_live_count(v_key, null, v_cfg.stale_seconds) <= 1,
      'threshold', v_cfg.floor_threshold,
      'mode', v_cfg.mode
    );
  end if;

  return jsonb_build_object(
    'display', 'count',
    'key', v_key,
    'count', v_picked_count,
    'window', v_picked_window,
    'scope', v_scope,
    'campus', case when v_scope = 'campus' then v_campus end,
    -- The client subscribes to whatever this names and never constructs a topic itself, which is
    -- what lets the campus topic be a hash the client has no way to compute.
    'topic', case when v_scope = 'campus' then lockin_presence_topic(v_campus) else lockin_presence_topic(null) end,
    -- Only a 'now' number is what the broadcasts carry. A client holding a 'today' number must
    -- ignore them rather than swap a windowed count for a live one under the same label.
    'live', v_picked_window = 'now',
    'threshold', v_cfg.floor_threshold,
    'mode', v_cfg.mode
  );
end;
$fn$;

-- ─────────────────────────── §9 · the tick ───────────────────────────
--
-- The one shared clock. Everything in this file that says "within 30s" means this function.
create or replace function tick_lockin_presence()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cfg lockin_presence_config%rowtype;
  v_zero jsonb := jsonb_build_object('study', 0, 'cardio', 0, 'strength', 0, 'fitness', 0, 'total', 0);
  v_sent int := 0;
  v_global jsonb;
  v_by_campus jsonb := '{}'::jsonb;
  v_last lockin_presence_samples%rowtype;
  r record;
begin
  select * into v_cfg from lockin_presence_config where id;

  -- THE REAPER. Two ways out of the count, and the second one is the one that matters: a member
  -- whose session ended is gone on the next tick whether or not their phone ever managed to say so.
  -- Without the not-exists arm, a stop that raced a network drop would sit in the count until its
  -- heartbeat aged out, showing someone as locked in for 90s after they walked out of the gym.
  delete from lockin_presence lp
  where lp.last_beat_at < now() - make_interval(secs => v_cfg.stale_seconds)
     or not exists (
       select 1 from lock_in_sessions s
       where s.id = lp.session_id and s.status = 'active'
     );

  -- One pass over the live rows for every number this tick needs.
  with live as (
    select lp.university, lp.category, lp.activity
    from lockin_presence lp
    where lp.last_beat_at > now() - make_interval(secs => v_cfg.stale_seconds)
  )
  select
    jsonb_build_object(
      'study', count(*) filter (where l.category = 'study'),
      'cardio', count(*) filter (where l.category = 'fitness' and l.activity = 'cardio'),
      'strength', count(*) filter (where l.category = 'fitness' and l.activity = 'strength'),
      'fitness', count(*) filter (where l.category = 'fitness'),
      'total', count(*)
    ),
    coalesce(
      (select jsonb_object_agg(u.university, u.counts)
       from (
         select l2.university,
           jsonb_build_object(
             'study', count(*) filter (where l2.category = 'study'),
             'cardio', count(*) filter (where l2.category = 'fitness' and l2.activity = 'cardio'),
             'strength', count(*) filter (where l2.category = 'fitness' and l2.activity = 'strength'),
             'fitness', count(*) filter (where l2.category = 'fitness'),
             'total', count(*)
           ) as counts
         from live l2
         where l2.university is not null
         group by l2.university
       ) u),
      '{}'::jsonb)
  into v_global, v_by_campus
  from live l;

  -- ── THE SAMPLE (the instrument) ──
  -- Written whatever the display mode is, including force_off. This is the number that tells us the
  -- gate is about to open, and it has to exist before anyone can see it.
  select * into v_last from lockin_presence_samples order by sampled_at desc limit 1;
  if v_last.id is null
     or v_last.total <> (v_global ->> 'total')::int
     or v_last.study <> (v_global ->> 'study')::int
     or v_last.cardio <> (v_global ->> 'cardio')::int
     or v_last.strength <> (v_global ->> 'strength')::int
     or (v_last.sampled_at < now() - interval '5 minutes' and (v_global ->> 'total')::int > 0)
  then
    insert into lockin_presence_samples (study, cardio, strength, total, by_campus)
    values (
      (v_global ->> 'study')::int,
      (v_global ->> 'cardio')::int,
      (v_global ->> 'strength')::int,
      (v_global ->> 'total')::int,
      v_by_campus
    );
  end if;

  delete from lockin_presence_samples where sampled_at < now() - interval '90 days';

  if v_cfg.mode = 'force_off' then
    -- Kill switch: no client is subscribed, so a broadcast is a message paid for and thrown away.
    return 0;
  end if;

  -- ── THE BROADCAST ──
  -- One message per CHANGED topic. The union with the snapshot table is what lets a count reach
  -- ZERO: a campus that emptied has no live rows to iterate, so without its stale snapshot row it
  -- would simply stop being mentioned and every subscriber would sit on the last number it ever
  -- saw. The pill has to tick DOWN, which means the last change is the one that must be sent.
  for r in
    select t.topic, coalesce(t.counts, v_zero) as counts
    from (
      select lockin_presence_topic(null) as topic, v_global as counts
      union all
      select lockin_presence_topic(k) as topic, v_by_campus -> k as counts
      from jsonb_object_keys(v_by_campus) k
      union all
      -- Emptied topics: known to the snapshot, absent from this tick's live rows.
      select s.topic, null::jsonb
      from lockin_presence_snapshot s
      where s.topic <> lockin_presence_topic(null)
        and s.topic not in (select lockin_presence_topic(k2) from jsonb_object_keys(v_by_campus) k2)
        and s.counts <> v_zero
    ) t
  loop
    -- ONLY ON CHANGE. A quiet half-hour is zero messages.
    if not exists (select 1 from lockin_presence_snapshot s where s.topic = r.topic and s.counts = r.counts) then
      perform realtime.send(
        r.counts || jsonb_build_object('at', now()),
        'counts',
        r.topic,
        -- Public. The payload is four integers and nothing else; making it private would need a
        -- realtime.messages RLS policy per campus topic to protect a number that is already on
        -- screen for everyone who can open the app.
        false
      );
      insert into lockin_presence_snapshot (topic, counts, sent_at)
      values (r.topic, r.counts, now())
      on conflict (topic) do update set counts = excluded.counts, sent_at = excluded.sent_at;
      v_sent := v_sent + 1;
    end if;
  end loop;

  return v_sent;
end;
$fn$;

-- ─────────────────────────── §10 · the client's two writes ───────────────────────────

-- The heartbeat. Takes the session id and NOTHING else: category, activity and campus are all read
-- from the row and the profile, so a client cannot report itself into a category it is not in — the
-- one way a member could have inflated someone else's number.
create or replace function beat_lockin_presence(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_session lock_in_sessions%rowtype;
  v_category text;
  v_activity text;
  v_campus text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_session
  from lock_in_sessions
  where id = p_session_id and user_id = v_uid and status = 'active';

  if not found then
    -- The session ended (or was never theirs). Beating for a dead session is how a count drifts, so
    -- treat it as the goodbye the client did not get to send rather than as an error to surface —
    -- there is nothing the member could do about it and nothing to tell them.
    delete from lockin_presence where user_id = v_uid;
    return;
  end if;

  select pair.category, pair.activity into v_category, v_activity
  from lockin_pair_of(v_session.category, v_session.activity, v_session.goal_type) pair;

  select p.university into v_campus from profiles p where p.id = v_uid;

  insert into lockin_presence (user_id, session_id, category, activity, university, started_at, last_beat_at)
  values (v_uid, p_session_id, v_category, v_activity, v_campus, v_session.started_at, now())
  on conflict (user_id) do update
    set session_id = excluded.session_id,
        category = excluded.category,
        activity = excluded.activity,
        university = excluded.university,
        started_at = excluded.started_at,
        last_beat_at = now();
end;
$fn$;

-- The goodbye. Best-effort and not the mechanism the count depends on — the reaper in §9 is — but
-- it turns "B stopped" into a decrement on the next tick instead of up to stale_seconds later.
create or replace function end_lockin_presence(p_session_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  delete from lockin_presence
  where user_id = v_uid
    -- Guarded on the session so a stale "goodbye" from a screen that was unmounting cannot cancel
    -- the presence of a session the member has ALREADY started since.
    and (p_session_id is null or session_id = p_session_id);
end;
$fn$;

revoke all on function lockin_live_count(text, text, int) from public;
revoke all on function lockin_window_count(text, text, timestamptz, int) from public;
revoke all on function tick_lockin_presence() from public;
revoke all on function get_active_lockin_counts() from public;
revoke all on function beat_lockin_presence(uuid) from public;
revoke all on function end_lockin_presence(uuid) from public;

grant execute on function get_active_lockin_counts() to authenticated;
grant execute on function beat_lockin_presence(uuid) to authenticated;
grant execute on function end_lockin_presence(uuid) to authenticated;

-- ─────────────────────────── §11 · the shared clock ───────────────────────────
--
-- '30 seconds' rather than a cron expression: pg_cron 1.6 fires sub-minute schedules on a fixed
-- offset from the minute, which is exactly the property the whole design rests on — :00 and :30 for
-- every subscriber at once, not 30s after whenever each one happened to subscribe.
select cron.unschedule('philoi-lockin-presence-tick')
where exists (select 1 from cron.job where jobname = 'philoi-lockin-presence-tick');

select cron.schedule(
  'philoi-lockin-presence-tick',
  '30 seconds',
  $job$select tick_lockin_presence();$job$
);

do $assert$
begin
  if not exists (select 1 from cron.job where jobname = 'philoi-lockin-presence-tick') then
    raise exception 'presence tick is not scheduled — the pill would never move';
  end if;
  -- The overlap is the point of the three keys and the thing most likely to be "tidied" later.
  if not (lockin_key_matches('fitness', 'fitness', 'strength') and lockin_key_matches('gym', 'fitness', 'strength')) then
    raise exception 'gym must be a subset of fitness';
  end if;
  if lockin_key_matches('gym', 'fitness', 'cardio') then
    raise exception 'cardio is not the gym line';
  end if;
  -- 0182's mapping, restated as an assertion because a drift here miscounts silently rather than failing.
  if (select pair.category from lockin_pair_of(null, null, 'gym') pair) <> 'fitness'
     or (select pair.activity from lockin_pair_of(null, null, 'run') pair) <> 'cardio'
     or (select pair.category from lockin_pair_of(null, null, 'custom') pair) <> 'study' then
    raise exception 'pre-0182 goal_type mapping does not match the 0182 backfill';
  end if;
end
$assert$;
