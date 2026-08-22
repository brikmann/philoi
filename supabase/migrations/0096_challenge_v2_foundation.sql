-- Handoff B, Phase 2 — the challenge subsystem's foundation: lifecycle, participants, shapes,
-- metrics, admin gating.
--
-- THE GAP THIS FILLS: there is no challenge_participants table. 0065 says so out loud ("Group mode
-- has no participants table") and works around it by deriving participation from lock-in sessions
-- inside the campfire during the window. That derivation cannot express any of v2:
--   - the MEMBER TICKER invites a SUBSET, so being in the campfire no longer implies being in the race;
--   - PLACEMENT needs a per-person rank over a known field, not "whoever happened to lock in";
--   - the WATCH screen needs per-person meters with a real name and avatar;
--   - the LIFECYCLE needs somewhere to record who accepted.
-- All four are the same missing row.

-- ───────────────────────── 1 · participants ─────────────────────────

create table if not exists challenge_participants (
  challenge_id uuid not null references social_challenges (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  -- The lifecycle, per person: invited -> accepted (or declined). The CHALLENGE's own status is
  -- separate and covers the race itself; a challenge can be live while one invitee never answered.
  state text not null default 'invited' check (state in ('invited', 'accepted', 'declined')),
  /** Metric value at the moment the race started. Progress is (current - baseline), which is what
   * makes a mid-semester join fair and stops a challenge from crediting work done before it. */
  baseline numeric not null default 0,
  /** Final settled figures, written once at settlement so a result page is a read of what was
   * decided rather than a re-derivation that could drift as later sessions land. */
  final_value numeric,
  final_rank int,
  final_percentile numeric,
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (challenge_id, user_id)
);

create index if not exists challenge_participants_user_idx
  on challenge_participants (user_id, challenge_id);

alter table challenge_participants enable row level security;

-- Readable by anyone who can see the challenge's campfire — the watch screen shows every racer to
-- every spectator, so per-row privacy here would contradict the feature.
drop policy if exists challenge_participants_read on challenge_participants;
create policy challenge_participants_read on challenge_participants
  for select to authenticated using (
    exists (
      select 1
      from social_challenges c
      join group_members gm on gm.group_id = c.circle_id
      where c.id = challenge_participants.challenge_id and gm.user_id = auth.uid()
    )
  );

-- No client write policy: joining, accepting and declining all go through the RPCs below, which
-- enforce who may do what and when.

-- ───────────────────────── 2 · admin gating ─────────────────────────

-- ADMIN GATING IS HANDOFF A’S, and is consumed rather than duplicated.
--
-- A owns campfire roles and shipped is_campfire_admin(p_group_id, p_user_id default auth.uid()) in
-- 0094_campfire_roles_and_join_request_fix.sql, widening group_members.role to
-- (owner,admin,member). I had written my own is_challenge_admin() against the roles that
-- existed at the time; it is deleted here in favour of theirs.
--
-- Two predicates for "may this person manage a campfire" is one too many: they would agree today
-- and drift the first time either side changed, and the failure mode is silent — an admin who can
-- start a challenge but not edit it, or vice versa.
--
-- A’s explicit instruction, followed: gate on is_campfire_admin, never on groups.owner_id, because
-- owner ⊂ admin and a promoted admin must pass.
--
-- ORDERING: this file is 0096; A holds 0094 (roles) and 0095 (report-alert readback), so their
-- is_campfire_admin exists before anything here calls it. This file has been renumbered TWICE now
-- — 0094 -> 0095 -> 0096 — because two sessions picking the next free number independently keeps
-- landing on the same one. Two migrations sharing a leading version silently roll back, and the
-- CLI blames the schema_migrations INSERT rather than the real cause.


-- ───────────────────────── 3 · shapes, metrics, lifecycle ─────────────────────────

-- The three v2 shapes. `mode` stays for the existing rows and the code still reading it; `shape`
-- is the v2 vocabulary. Kept as a SEPARATE column rather than widening mode's check, because every
-- existing query filtering mode = 'h2h' must keep meaning "duel" and would silently match nothing
-- if the values were renamed underneath it.
alter table social_challenges add column if not exists shape text
  check (shape is null or shape in ('duel', 'collective', 'placement'));

-- Backfill from mode so every existing row has a shape and the UI never has to handle a null.
update social_challenges set shape = case when mode = 'h2h' then 'duel' else 'collective' end
where shape is null;

/** The user-set public name — "Morning grind", "BU111 grade". Distinct from the metric, shown on
 * the card, the watch screen and the share card. */
alter table social_challenges add column if not exists public_name text;
alter table social_challenges drop constraint if exists social_challenges_public_name_len;
alter table social_challenges add constraint social_challenges_public_name_len
  check (public_name is null or char_length(public_name) <= 60);

/**
 * The v2 metric set: lock-in time, volume, distance, AI custom goal.
 *
 * XP IS DROPPED FROM CREATION but stays VALID in the constraint. The spec's reasoning for dropping
 * it is that XP correlates with lock-in time, so offering both is redundant — that is a decision
 * about what to OFFER, and it does not make already-running XP races invalid. Converting them to
 * lockin_time would change what a live race measures halfway through, which is worse than briefly
 * carrying a legacy value. The client stops offering 'xp' immediately; the value can be removed
 * from this constraint once no unsettled challenge uses it.
 */
alter table social_challenges drop constraint if exists social_challenges_race_metric_check;
alter table social_challenges add constraint social_challenges_race_metric_check
  check (race_metric is null or race_metric in ('lockin_time', 'volume', 'distance', 'ai', 'xp'));

/** The AI-parsed goal definition (metric · source · win condition · checkpoints), written by the
 * SERVER after Sonnet parses the user's free text. Never written by the client — see the spec's
 * "do NOT trust the client to define what winning means". */
alter table social_challenges add column if not exists ai_config jsonb;

-- Explicit start/end for arbitrary spans (a semester). window_hours stays for the presets and for
-- every existing row; ends_at is what the race actually reads, so a custom span needs no new
-- concept downstream.
alter table social_challenges add column if not exists starts_on timestamptz;
alter table social_challenges add column if not exists ends_on timestamptz;

/**
 * The v2 lifecycle: draft -> invited -> live -> settled, with the legacy values still accepted.
 *
 * NO AUTO-START is the point (the spec's first 🔴). Today a group challenge sets starts_at
 * immediately at creation — "no invite step" — so it begins whether or not anyone agreed to it.
 * v2 requires an admin to start it after invitees accept.
 *
 * The legacy values are kept in the constraint for the same reason as 'xp': there are live rows
 * using them, and a status rename mid-flight would strand every challenge currently running.
 * 'active' and 'live' are treated as the same state by the reads below.
 */
alter table social_challenges drop constraint if exists social_challenges_status_check;
alter table social_challenges add constraint social_challenges_status_check
  check (status in (
    'draft', 'invited', 'live', 'settled',                       -- v2
    'pending', 'active', 'completed', 'declined', 'expired'      -- legacy, still in flight
  ));

/** One place deciding whether a challenge is running, so the two vocabularies cannot diverge. */
create or replace function challenge_is_live(p_status text)
returns boolean language sql immutable as $$ select p_status in ('live', 'active'); $$;

/** Likewise for finished. */
create or replace function challenge_is_settled(p_status text)
returns boolean language sql immutable as $$ select p_status in ('settled', 'completed', 'expired'); $$;

-- ───────────────────────── 4 · lifecycle RPCs ─────────────────────────

/**
 * One metric's lifetime value for a user, as of a moment.
 *
 * Everything the race measures is a cumulative total, so progress is always
 * (value_now - value_at_start) and each metric needs exactly one expression here. Volume and
 * distance read the fitness-sync tables the goals path already fills; 'ai' returns 0 because an
 * AI-parsed goal is settled from its own checkpoints, not from a running total.
 */
create or replace function challenge_metric_value(p_metric text, p_user uuid, p_at timestamptz)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    case p_metric
      when 'lockin_time' then (
        select sum(extract(epoch from (s.last_confirmed_at - s.started_at)))
        from lock_in_sessions s
        where s.user_id = p_user and s.status = 'completed' and s.started_at <= p_at
      )
      -- Total weight moved: sum(weight x reps) across every set. Bodyweight sets carry a NULL
      -- weight (0037's own note), and they contribute 0 rather than dropping the row — a session
      -- of pull-ups should not silently vanish from a volume race, it genuinely moved no external
      -- load.
      when 'volume' then (
        select sum(coalesce(ws.weight, 0) * ws.reps)
        from workout_sets ws
        join workout_exercises we on we.id = ws.workout_exercise_id
        join workouts w on w.id = we.workout_id
        where w.user_id = p_user and ws.created_at <= p_at
      )
      -- Metres, straight off the check-in the fitness sync writes (0038).
      when 'distance' then (
        select sum(c.distance_m) from check_ins c where c.user_id = p_user and c.created_at <= p_at
      )
      -- XP is no longer offered at creation but is still measurable for races already running on it.
      when 'xp' then (
        select sum(c.xp_earned) from check_ins c where c.user_id = p_user and c.created_at <= p_at
      )
      -- An AI-parsed goal is settled from its own checkpoints, not from a running total, so there
      -- is deliberately no cumulative expression for it.
      else 0
    end, 0);
$$;

grant execute on function challenge_metric_value(text, uuid, timestamptz) to authenticated;


/**
 * Invite a subset of the campfire — the member ticker.
 *
 * Admin-gated, and the challenge must not have started: adding racers to a live placement race
 * would hand the newcomer a baseline taken after everyone else's, which is either unfair to them
 * or exploitable by them depending on which way the metric runs.
 */
create or replace function invite_challenge_members(p_challenge uuid, p_user_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
  v_n int;
begin
  select * into v_c from social_challenges where id = p_challenge;
  if v_c.id is null then raise exception 'Challenge not found.'; end if;
  if not is_campfire_admin(v_c.circle_id, auth.uid()) then
    raise exception 'Only campfire admins can invite to a challenge.';
  end if;
  if challenge_is_live(v_c.status) or challenge_is_settled(v_c.status) then
    raise exception 'That challenge has already started.';
  end if;

  -- Only real members of the campfire. Without this an admin could invite anyone in the app by id.
  insert into challenge_participants (challenge_id, user_id)
  select p_challenge, u
  from unnest(p_user_ids) u
  where exists (select 1 from group_members gm where gm.group_id = v_c.circle_id and gm.user_id = u)
  on conflict (challenge_id, user_id) do nothing;

  get diagnostics v_n = row_count;

  update social_challenges set status = 'invited' where id = p_challenge and status = 'draft';
  return v_n;
end;
$$;

grant execute on function invite_challenge_members(uuid, uuid[]) to authenticated;

/** Accept or decline your own invite. Deliberately not admin-gated — this is the one lifecycle
 * action that belongs to the invitee rather than to whoever runs the campfire. */
create or replace function respond_to_challenge_invite(p_challenge uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  update challenge_participants
     set state = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where challenge_id = p_challenge and user_id = auth.uid() and state = 'invited';
  if not found then
    raise exception 'No open invite for you on that challenge.';
  end if;
end;
$$;

grant execute on function respond_to_challenge_invite(uuid, boolean) to authenticated;

/**
 * Start the race — admin only, and the moment every baseline is taken.
 *
 * Baselines are captured HERE rather than at creation, which is the whole reason no-auto-start
 * matters: the window between "someone made a challenge" and "everyone agreed to race" can be days,
 * and crediting that period to whoever happened to be grinding would decide the race before it
 * began.
 */
create or replace function start_challenge(p_challenge uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c social_challenges;
begin
  select * into v_c from social_challenges where id = p_challenge;
  if v_c.id is null then raise exception 'Challenge not found.'; end if;
  if not is_campfire_admin(v_c.circle_id, auth.uid()) then
    raise exception 'Only campfire admins can start a challenge.';
  end if;
  if challenge_is_live(v_c.status) then raise exception 'Already running.'; end if;
  if challenge_is_settled(v_c.status) then raise exception 'That challenge is over.'; end if;

  if not exists (
    select 1 from challenge_participants p where p.challenge_id = p_challenge and p.state = 'accepted'
  ) then
    raise exception 'Nobody has accepted yet.';
  end if;

  -- Anyone who never answered is dropped rather than carried: a race with a permanently 'invited'
  -- row can never be complete, and the placement denominator would count someone who never ran.
  delete from challenge_participants where challenge_id = p_challenge and state = 'invited';

  update challenge_participants p
     set baseline = challenge_metric_value(v_c.race_metric, p.user_id, now())
   where p.challenge_id = p_challenge;

  update social_challenges
     set status = 'live',
         starts_at = now(),
         starts_on = coalesce(starts_on, now()),
         ends_at = coalesce(ends_on, now() + make_interval(hours => window_hours))
   where id = p_challenge;
end;
$$;

grant execute on function start_challenge(uuid) to authenticated;

