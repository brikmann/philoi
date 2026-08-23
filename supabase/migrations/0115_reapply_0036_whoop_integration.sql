-- 0115 — re-apply 0036, which is recorded as applied but never actually ran.
--
-- `supabase migration list --linked` shows 0036 with a matching remote entry, so `db push` skips
-- it and will keep skipping it forever. None of it is actually there:
--
--   to_regclass('public.whoop_connections')  -> null
--   pg_proc where proname like '%whoop%'     -> 0 rows
--   challenges_type_check                    -> still 0035's list, stopping at 'ride_distance'
--
-- For contrast, 0035 (strava_connections + 2 functions) is fully present, and a sweep of every
-- other migration's headline object — challenge_participants (0096), challenge_periods (0072),
-- goal_day_awards (0083), milestones (0093), notification_events (0086), equipped_loadout (0070),
-- google_calendar_connections (0105), profiles.timezone (0084), profiles.bio (0091),
-- challenge_cheers.note (0110), coach_usage (0101) — found all of them present. 0036 is the only
-- one in this state, so this is one bad row in schema_migrations, not a systemic problem.
--
-- WHAT IT COSTS TODAY: the missing check-constraint arm is the visible half. src/app/challenge/
-- create.tsx offers Workout minutes, Strain and Sleep as goal metrics, and inserting any of the
-- three fails outright —
--
--   new row for relation "challenges" violates check constraint "challenges_type_check"
--
-- — so three of the metrics in the picker cannot be created at all. The missing table and RPCs
-- are quieter: get_my_whoop_connection_status is called behind a try/catch that returns false
-- (src/lib/api/fitness-challenge-sync.ts), so a sleep goal silently falls back to the phone's
-- health store instead of Whoop, while disconnect_my_whoop has no such guard and raises.
--
-- Done as a NEW forward-only migration rather than `supabase migration repair --status reverted
-- 0036` + re-push: repair rewrites history to claim something that did not happen, and the repo's
-- rule is that an applied migration is never edited or re-run. Everything below is idempotent, so
-- if 0036 is ever partially applied by hand first, this still lands clean.
--
-- The body is 0036's, verbatim apart from `create table if not exists` already being there and
-- the RLS enable being made conditional.

-- ───────────────────────────── the three Whoop metrics ─────────────────────────────

-- Whoop has NO step count — it measures strain, heart rate, workouts, sleep and recovery — so
-- these are the metrics Whoop can actually verify. Steps stays HealthKit/Health Connect;
-- run/ride distance stays Strava.
alter table challenges drop constraint if exists challenges_type_check;
alter table challenges add constraint challenges_type_check
  check (type in (
    'steps', 'gym_visits', 'study_hours', 'custom',
    'run_distance', 'ride_distance',
    'workout_minutes', 'strain', 'sleep_hours'
  ));

-- ───────────────────────────── the connection record ─────────────────────────────

-- No RLS policies at all — deliberately, exactly as strava_connections. Every read/write goes
-- through the Edge Functions (service role, bypasses RLS) or the two RPCs below; the client never
-- queries this table directly, so there's no policy shape that would ever need to hand it a raw
-- token.
create table if not exists whoop_connections (
  user_id uuid primary key references profiles (id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scopes text not null default '',
  connected_at timestamptz not null default now()
);

alter table whoop_connections enable row level security;

-- ───────────────────────────── the two owner-scoped RPCs ─────────────────────────────

-- Safe to expose to the owner: connected state + which scopes they granted, never the tokens.
-- The out-params are named connected/granted_scopes and the body qualifies every column with the
-- `wc` alias — a RETURNS TABLE out-param named `scopes` would silently shadow
-- whoop_connections.scopes inside the body.
drop function if exists get_my_whoop_connection_status();
create function get_my_whoop_connection_status()
returns table (connected boolean, granted_scopes text)
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (select 1 from whoop_connections wc where wc.user_id = auth.uid()) as connected,
    coalesce((select wc.scopes from whoop_connections wc where wc.user_id = auth.uid()), '') as granted_scopes;
$$;

-- Client-triggered disconnect — clears Philoi's own record only. This can't revoke the grant on
-- Whoop's side; that's the member's own Whoop account settings, same caveat as the
-- HealthKit/Health Connect/Strava "Disconnect" actions.
drop function if exists disconnect_my_whoop();
create function disconnect_my_whoop()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from whoop_connections where user_id = auth.uid();
end;
$$;
