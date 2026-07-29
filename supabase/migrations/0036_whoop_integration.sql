-- Whoop (PHILOI_UI_SPEC.md §17, CODE_BUILD_PROMPTS.md 19d) — the fourth source, cross-platform
-- (iOS + Android), OAuth 2.0. Same shape as Strava (0035): the client secret never reaches the
-- app, whoop_connections is written ONLY by the whoop-oauth-exchange and whoop-sync Supabase Edge
-- Functions (service role, the only things that ever hold a Whoop access/refresh token), and the
-- client only ever calls those two plus the two owner-scoped RPCs below.

-- Three new personal-challenge types, chosen for METRIC FIT (§17): Whoop has NO step count — it
-- measures strain, heart rate, workouts, sleep and recovery — so these are the metrics Whoop can
-- actually verify. Steps stays HealthKit/Health Connect; run/ride distance stays Strava.
--   workout_minutes — summed duration of scored Whoop workouts in the window (unit: minutes)
--   strain          — summed Whoop day-strain (0–21 per cycle) across the window (unit: strain)
--   sleep_hours     — summed actual sleep (light + SWS + REM, naps excluded) (unit: hours)
alter table challenges drop constraint if exists challenges_type_check;
alter table challenges add constraint challenges_type_check
  check (type in (
    'steps', 'gym_visits', 'study_hours', 'custom',
    'run_distance', 'ride_distance',
    'workout_minutes', 'strain', 'sleep_hours'
  ));

-- No RLS policies at all — deliberately, exactly as strava_connections. Every read/write goes
-- through the Edge Functions (service role, bypasses RLS) or the two RPCs below; the client never
-- queries this table directly, so there's no policy shape that would ever need to hand it a raw
-- token.
--
-- `scopes` records what the member actually granted, so a sync can refuse (and ask for a
-- re-consent) instead of firing a request Whoop would 403 — Philoi requests only the scope a
-- given challenge's metric needs (§17 minimal scopes), so a connection made for a workout
-- challenge legitimately has no read:sleep.
create table if not exists whoop_connections (
  user_id uuid primary key references profiles (id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scopes text not null default '',
  connected_at timestamptz not null default now()
);

alter table whoop_connections enable row level security;

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
