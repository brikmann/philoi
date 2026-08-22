-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- CINDY — the AI coach (CINDY_SPEC.md, APP_BLOCKER_SPEC §C/§C2/§C-safety, GCAL_INTEGRATION_SPEC).
--
-- ONE backend serves three surfaces (CINDY_SPEC "same brain"): Cindy's home bubble + chat (warm),
-- the Focus Nudge intercept (protective), and re-engagement pushes. This migration owns the
-- storage + the CONTEXT ASSEMBLER; the Sonnet call itself lives in supabase/functions/ai-coach.
--
-- 🔒 THE FIREWALL, RESTATED. Nothing in this file grants XP, embers, rank, or a cosmetic. The
-- coach's *actions* are not implemented here at all — they run on the client through the exact
-- same RPCs the UI already calls, under the user's own JWT, so every economy rule and RLS policy
-- applies to Cindy identically to a tap. There is deliberately no security-definer "coach acts"
-- function: giving the coach a privileged write path is the one thing that could break Rule 0.
--
-- 🔒 OWN DATA ONLY. get_coach_context() is auth.uid()-scoped with no user parameter. It is not
-- possible to ask it for somebody else's context, so "Cindy learns in the background" can only
-- ever mean the caller's own rows (CINDY_SPEC: "aggregating your own data, not surveillance").
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────── consent + settings ─────────────────────────────
-- Cindy reads a lot of personal data and sends it to a server-side model, so she is OFF until the
-- user says yes. No row = not consented (the client shows the explainer), rather than a default
-- that would opt people in by omission.
create table if not exists coach_settings (
  user_id uuid primary key references profiles (id) on delete cascade,
  enabled boolean not null default true,
  /** When they accepted the "what Cindy reads" copy. Null = never consented; the app must not
   *  call the coach at all in that state. */
  consented_at timestamptz,
  /** Separate from `enabled`: someone can want the chat but not the proactive home bubble. */
  home_bubble_enabled boolean not null default true,
  voice_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table coach_settings enable row level security;
drop policy if exists coach_settings_rw_own on coach_settings;
create policy coach_settings_rw_own on coach_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────────────────────────── the conversation ─────────────────────────────
-- One rolling thread per user. Cindy is a friend you keep talking to, not a support ticket that
-- starts fresh each time — the continuity IS the persona, and it is what lets "thanks cindy"
-- (mock 115 frame 3) land as a reply rather than as a cold open.
create table if not exists coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  /** Which surface produced it — 'chat' | 'home' | 'intercept' | 'reengagement'. Stored so the
   *  routing split (CINDY_SPEC "the core split") is auditable after the fact: a heavy-voiced
   *  message with surface='home' is a bug, and this column is how it gets caught. */
  surface text not null default 'chat' check (surface in ('chat', 'home', 'intercept', 'reengagement')),
  /** The action Cindy proposed or the receipt of one she performed, e.g.
   *  {"tool":"start_session","input":{...},"status":"done"}. Null for plain talk. */
  action jsonb,
  /** 'voice' when the turn came through ElevenLabs — text is still the record either way. */
  modality text not null default 'text' check (modality in ('text', 'voice')),
  created_at timestamptz not null default now()
);

create index if not exists coach_messages_user_idx on coach_messages (user_id, created_at desc);

alter table coach_messages enable row level security;
-- Read + delete own ("clear chat"). No client INSERT policy: every message is written by the
-- edge function under the service role after the model has actually produced it, so a client
-- cannot forge an assistant turn and then quote it back as if Cindy had said it.
drop policy if exists coach_messages_read_own on coach_messages;
create policy coach_messages_read_own on coach_messages for select to authenticated
  using (user_id = auth.uid());
drop policy if exists coach_messages_delete_own on coach_messages;
create policy coach_messages_delete_own on coach_messages for delete to authenticated
  using (user_id = auth.uid());

-- ───────────────────────────── the proactive home bubble ─────────────────────────────
-- Cached, not generated per render. Home mounts constantly; generating on every mount would be
-- both expensive and incoherent (a different greeting each time you swipe back). One row per
-- user, regenerated when it goes stale or the context materially moves.
create table if not exists coach_home_bubble (
  user_id uuid primary key references profiles (id) on delete cascade,
  message text not null,
  /** 'celebrate' | 'reengage' | 'checkin' | 'rest' — the warm intents only. The protective
   *  intents ('reinforce'/'wellbeing') are structurally unable to land here: the edge function
   *  hardcodes surface='home' for this row and the home prompt does not offer them. */
  intent text not null,
  /** Cheap staleness key over the inputs that would change the message (streak, today's minutes,
   *  active session, next deadline). Same digest = the message still fits, don't spend a call. */
  context_digest text,
  dismissed_at timestamptz,
  generated_at timestamptz not null default now()
);

alter table coach_home_bubble enable row level security;
drop policy if exists coach_home_bubble_read_own on coach_home_bubble;
create policy coach_home_bubble_read_own on coach_home_bubble for select to authenticated
  using (user_id = auth.uid());
-- Dismiss is the one client write ("not now" on the bubble); the message text itself is
-- service-role only, same reasoning as coach_messages.
drop policy if exists coach_home_bubble_dismiss_own on coach_home_bubble;
create policy coach_home_bubble_dismiss_own on coach_home_bubble for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────────────────────────── rate limiting ─────────────────────────────
-- The coach is FREE (CINDY_SPEC: "never paywall the coach's brain"), which is exactly why it
-- needs a ceiling — the cost control has to be a rate limit rather than a paywall. One row per
-- user per UTC day; the edge function increments before it calls the model.
create table if not exists coach_usage (
  user_id uuid not null references profiles (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  text_calls int not null default 0,
  bubble_calls int not null default 0,
  /** Voice is metered in seconds, not calls — ElevenLabs bills by audio, and a single long
   *  rambling turn costs more than ten short ones. Confirmed free-but-capped, not premium. */
  voice_seconds int not null default 0,
  primary key (user_id, day)
);

alter table coach_usage enable row level security;
drop policy if exists coach_usage_read_own on coach_usage;
create policy coach_usage_read_own on coach_usage for select to authenticated
  using (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- THE DATA MASTERMIND (CINDY_SPEC "reads the full model")
--
-- One round trip returning one jsonb document. Deliberately NOT `returns table (...)`: a
-- RETURNS TABLE column list shadows same-named columns inside the body, which has bitten this
-- schema before — a scalar jsonb return has no column list to collide with.
--
-- Everything here is derived, never stored: the coach warehouses nothing. Each call reads live
-- rows, hands them to the model, and keeps only the resulting message.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
drop function if exists get_coach_context();
create or replace function get_coach_context()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_profile record;
  v_rank record;
  v_next record;
  v_xp_rate numeric;
  v_rate_sessions int;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'get_coach_context: not authenticated';
  end if;

  select p.display_name, p.handle, p.university, p.timezone, p.current_streak, p.longest_streak,
         p.embers, p.daily_goal_mode, p.created_at
    into v_profile
  from profiles p where p.id = v_user;

  -- ── rank + the ladder math, which is what turns "how far to Hero?" into a number ──
  -- rank_tier_for_score/universal_score are the same pair get_my_ranks uses, called directly so
  -- this reads p_user's rank rather than depending on an auth.uid()-scoped helper.
  select t.tier, t.division, universal_score(v_user) as score
    into v_rank
  from rank_tier_for_score(universal_score(v_user)) t limit 1;

  -- The user's measured XP/hour over 30 days. Mirrors src/lib/api/xp-rate.ts EXACTLY (>= 60s,
  -- non-null duration, not removed) — if these two drift, Cindy and the lock-in pill would quote
  -- different numbers for the same question, which is worse than either being slightly off.
  select coalesce(sum(c.xp_earned), 0) / nullif(sum(c.duration_seconds) / 3600.0, 0), count(*)
    into v_xp_rate, v_rate_sessions
  from check_ins c
  where c.user_id = v_user
    and c.created_at >= now() - interval '30 days'
    and c.removed_at is null
    and c.duration_seconds is not null
    and c.duration_seconds >= 60;

  -- Fewer than 3 timed sessions is not a rate, it's noise (same floor as xp-rate.ts). Null here
  -- makes the model say "once you've got a few sessions logged" instead of inventing a pace.
  if coalesce(v_rate_sessions, 0) < 3 then
    v_xp_rate := null;
  end if;

  select rt.tier, rt.division, rt.cumulative_xp_required
    into v_next
  from rank_thresholds rt
  where rt.cumulative_xp_required > coalesce(v_rank.score, 0)
  order by rt.cumulative_xp_required asc
  limit 1;

  v_result := jsonb_build_object(
    'generated_at', now(),

    'profile', jsonb_build_object(
      'display_name', v_profile.display_name,
      'first_name', split_part(coalesce(v_profile.display_name, ''), ' ', 1),
      'handle', v_profile.handle,
      'university', v_profile.university,
      'timezone', v_profile.timezone,
      'local_time', to_char(now() at time zone coalesce(v_profile.timezone, 'UTC'), 'YYYY-MM-DD HH24:MI (Dy)'),
      'current_streak', v_profile.current_streak,
      'longest_streak', v_profile.longest_streak,
      'embers', v_profile.embers,
      'member_since', v_profile.created_at
    ),

    -- ── RANK + THE XP LADDER ──
    -- The whole ladder ships with the context, not just the current rung: "how much to reach
    -- Hero" needs every threshold between here and Hero, and shipping the table is far cheaper
    -- and more reliable than teaching the model to ask for each rung.
    'rank', jsonb_build_object(
      'tier', v_rank.tier,
      'division', v_rank.division,
      'score', round(coalesce(v_rank.score, 0)::numeric, 1),
      'next_tier', v_next.tier,
      'next_division', v_next.division,
      'xp_to_next', case when v_next.cumulative_xp_required is null then null
                        else round((v_next.cumulative_xp_required - coalesce(v_rank.score, 0))::numeric, 0) end,
      'xp_per_hour', case when v_xp_rate is null then null else round(v_xp_rate::numeric, 0) end,
      'xp_rate_sessions', v_rate_sessions,
      'ladder', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'tier', rt.tier, 'division', rt.division, 'cumulative_xp', rt.cumulative_xp_required
               ) order by rt.rank_index), '[]'::jsonb)
        from rank_thresholds rt
      )
    ),

    -- ── SESSIONS: what's happening right now, and the recent shape of their effort ──
    'active_session', (
      select jsonb_build_object(
               'id', s.id, 'goal_type', s.goal_type, 'goal_detail', s.goal_detail,
               'circle_id', s.circle_id, 'started_at', s.started_at,
               'minutes_so_far', round(extract(epoch from (now() - s.started_at)) / 60.0)
             )
      from lock_in_sessions s
      where s.user_id = v_user and s.status = 'active'
      order by s.started_at desc limit 1
    ),

    'recent_sessions', (
      select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
                 'at', c.created_at, 'type', c.goal_type, 'detail', c.goal_detail,
                 'minutes', round(c.duration_seconds / 60.0), 'xp', c.xp_earned
               ) as x
        from check_ins c
        where c.user_id = v_user and c.removed_at is null
          and c.created_at >= now() - interval '14 days'
        order by c.created_at desc limit 25
      ) s
    ),

    -- Rolled up so the model doesn't have to sum 25 rows to answer "how am I doing this week" —
    -- and so it can compare this week against the user's own norm rather than a generic one.
    'effort', jsonb_build_object(
      'today_minutes', (
        select coalesce(round(sum(c.duration_seconds) / 60.0), 0) from check_ins c
        where c.user_id = v_user and c.removed_at is null
          and c.created_at >= date_trunc('day', now() at time zone coalesce(v_profile.timezone, 'UTC'))
      ),
      'week_minutes', (
        select coalesce(round(sum(c.duration_seconds) / 60.0), 0) from check_ins c
        where c.user_id = v_user and c.removed_at is null and c.created_at >= now() - interval '7 days'
      ),
      'prev_week_minutes', (
        select coalesce(round(sum(c.duration_seconds) / 60.0), 0) from check_ins c
        where c.user_id = v_user and c.removed_at is null
          and c.created_at >= now() - interval '14 days' and c.created_at < now() - interval '7 days'
      ),
      'total_hours', (
        select coalesce(round(sum(c.duration_seconds) / 3600.0, 1), 0) from check_ins c
        where c.user_id = v_user and c.removed_at is null
      ),
      'hours_since_last_session', (
        select round(extract(epoch from (now() - max(c.created_at))) / 3600.0, 1) from check_ins c
        where c.user_id = v_user and c.removed_at is null
      ),
      -- By type, so "lock in on classes to reach Hero" can be answered about STUDY specifically
      -- rather than about all effort averaged together.
      'by_type_30d', (
        select coalesce(jsonb_object_agg(t.goal_type, t.minutes), '{}'::jsonb) from (
          select c.goal_type, round(sum(c.duration_seconds) / 60.0) as minutes
          from check_ins c
          where c.user_id = v_user and c.removed_at is null
            and c.created_at >= now() - interval '30 days'
          group by c.goal_type
        ) t
      )
    ),

    -- ── GOALS + CHALLENGES + STANDINGS ──
    'goals', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', g.id, 'type', g.type, 'label', g.label, 'cadence', g.cadence,
               'current_streak', g.current_streak
             )), '[]'::jsonb)
      from goals g where g.user_id = v_user and g.archived_at is null
    ),

    'challenges', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ch.id, 'type', ch.type, 'label', ch.label, 'target', ch.target,
               'unit', ch.unit, 'period', ch.period, 'progress', ch.progress,
               'pct', case when ch.target > 0 then round(100.0 * ch.progress / ch.target) else null end,
               'period_start', ch.period_start, 'completed_at', ch.completed_at
             )), '[]'::jsonb)
      from challenges ch
      where ch.user_id = v_user and ch.completed_at is null
    ),

    -- ── COSMETICS: inventory, what's equipped, and what it would take to unlock the rest ──
    -- The equipped flame is Cindy's own appearance (CINDY_SPEC: "customizing a flame = dressing
    -- up your companion"), so she genuinely needs to know what she's wearing.
    'equipped', (
      select coalesce(jsonb_object_agg(e.slot, e.cosmetic_key), '{}'::jsonb)
      from equipped_loadout e where e.user_id = v_user
    ),
    'owned_cosmetics', (
      select coalesce(jsonb_agg(co.cosmetic_key), '[]'::jsonb)
      from cosmetics_owned co where co.user_id = v_user
    ),

    -- Live progress toward the relic conditions economy_evaluate_relics() actually checks. These
    -- numbers are what make "what do I need to unlock X" a receipt instead of a guess; the
    -- condition TEXT ships from the client catalog, the PROGRESS ships from here.
    'unlock_progress', jsonb_build_object(
      'longest_streak', v_profile.longest_streak,
      'completed_session_hours', (
        select coalesce(round(sum(extract(epoch from (s.last_confirmed_at - s.started_at))) / 3600.0, 1), 0)
        from lock_in_sessions s where s.user_id = v_user and s.status = 'completed'
      ),
      'peak_tier', v_rank.tier,
      'best_season_percentile', (
        select round(min(100.0 * ss.rank / greatest(ss.board_size, 1)), 1)
        from season_standings ss where ss.user_id = v_user
      )
    ),

    -- ── MILESTONES (PROFILE_SPEC §G) — 🔒 zero XP, and the model is told so in the prompt ──
    'milestones', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'kind', m.kind, 'headline', m.headline, 'at', m.created_at
             ) order by m.created_at desc), '[]'::jsonb)
      from (select * from milestones where user_id = v_user order by created_at desc limit 10) m
    ),
    -- The receipts a new milestone would be stamped with, so Cindy can say "backed by your 41h"
    -- BEFORE posting rather than discovering the numbers afterwards.
    'milestone_effort', (
      select jsonb_build_object(
        'hours', coalesce(round(sum(c.duration_seconds) / 3600.0), 0),
        'lockins', count(*),
        'streak', v_profile.current_streak
      )
      from check_ins c where c.user_id = v_user and c.removed_at is null
    ),

    -- ── THE BELL ──
    'notifications', jsonb_build_object(
      'unread', (select count(*) from notification_events n where n.user_id = v_user and n.read_at is null),
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'type', n.type, 'title', n.title, 'body', n.body, 'at', n.created_at,
                 'read', n.read_at is not null
               ) order by n.created_at desc), '[]'::jsonb)
        from (select * from notification_events where user_id = v_user
              order by created_at desc limit 12) n
      )
    ),

    -- ── CAMPFIRES ── membership only. Never other members' private rows: Cindy is scoped to the
    -- caller, and a circle she can name is not a circle she can read into.
    'campfires', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', g.id, 'name', g.name, 'role', gm.role
             )), '[]'::jsonb)
      from group_members gm join groups g on g.id = gm.group_id
      where gm.user_id = v_user
    )
  );

  return v_result;
end;
$$;

revoke all on function get_coach_context() from public;
grant execute on function get_coach_context() to authenticated;

-- ───────────────────────────── usage metering ─────────────────────────────
-- Called by the edge function under the service role BEFORE the model call, so a burst of
-- parallel requests can't each read "0 used" and all proceed. Returns the post-increment count;
-- the caller compares it against the surface's cap and refuses if it's over.
drop function if exists coach_bump_usage(uuid, text, int);
create or replace function coach_bump_usage(p_user uuid, p_kind text, p_amount int default 1)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into coach_usage (user_id, day, text_calls, bubble_calls, voice_seconds)
  values (
    p_user, (now() at time zone 'utc')::date,
    case when p_kind = 'text' then p_amount else 0 end,
    case when p_kind = 'bubble' then p_amount else 0 end,
    case when p_kind = 'voice' then p_amount else 0 end
  )
  on conflict (user_id, day) do update set
    text_calls   = coach_usage.text_calls   + case when p_kind = 'text' then p_amount else 0 end,
    bubble_calls = coach_usage.bubble_calls + case when p_kind = 'bubble' then p_amount else 0 end,
    voice_seconds = coach_usage.voice_seconds + case when p_kind = 'voice' then p_amount else 0 end
  returning case p_kind when 'text' then text_calls when 'bubble' then bubble_calls else voice_seconds end
  into v_count;

  return v_count;
end;
$$;

revoke all on function coach_bump_usage(uuid, text, int) from public;
revoke all on function coach_bump_usage(uuid, text, int) from authenticated;

-- Convenience read for the client ("you've used 12 of 40 messages today") — own row only.
drop function if exists get_my_coach_usage();
create or replace function get_my_coach_usage()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select jsonb_build_object(
              'text_calls', u.text_calls,
              'bubble_calls', u.bubble_calls,
              'voice_seconds', u.voice_seconds)
     from coach_usage u
     where u.user_id = auth.uid() and u.day = (now() at time zone 'utc')::date),
    jsonb_build_object('text_calls', 0, 'bubble_calls', 0, 'voice_seconds', 0)
  );
$$;

revoke all on function get_my_coach_usage() from public;
grant execute on function get_my_coach_usage() to authenticated;
