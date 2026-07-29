-- Strava (PHILOI_UI_SPEC.md §17, CODE_BUILD_PROMPTS.md's fitness-sync note) — the third and
-- last device/service source, cross-platform (iOS + Android), OAuth-based. The client secret
-- never reaches the app: strava_connections is written ONLY by the strava-oauth-exchange and
-- strava-sync Supabase Edge Functions (service role), which are the only things that ever see a
-- Strava access/refresh token. The client only ever calls those two functions and reads back
-- get_my_strava_connection_status() — never the raw table.

-- Two new personal-challenge types Strava actually has a metric for. 'custom' already existed
-- for anything freeform; these two are first-class because Strava sync needs to know which
-- activity type (Run vs Ride) and unit (km) to reduce to, which a freeform 'custom' unit string
-- can't reliably tell it.
alter table challenges drop constraint if exists challenges_type_check;
alter table challenges add constraint challenges_type_check
  check (type in ('steps', 'gym_visits', 'study_hours', 'custom', 'run_distance', 'ride_distance'));

-- No RLS policies at all — deliberately. Every read/write goes through the Edge Functions
-- (service role, bypasses RLS) or the two RPCs below; the client never queries this table
-- directly, so there's no policy shape that would ever need to allow it a raw token.
create table if not exists strava_connections (
  user_id uuid primary key references profiles (id) on delete cascade,
  athlete_id bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  connected_at timestamptz not null default now()
);

alter table strava_connections enable row level security;

-- Safe to expose to the owner: connected state + athlete id, never the tokens themselves.
create or replace function get_my_strava_connection_status()
returns table (connected boolean, athlete_id bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (select 1 from strava_connections where user_id = auth.uid()) as connected,
    (select sc.athlete_id from strava_connections sc where sc.user_id = auth.uid()) as athlete_id;
$$;

-- Client-triggered disconnect — clears Philoi's own record only. This can't revoke the token on
-- Strava's side; that's the athlete's own Strava account settings (My Apps), same caveat as the
-- HealthKit/Health Connect "Disconnect" actions.
create or replace function disconnect_my_strava()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from strava_connections where user_id = auth.uid();
end;
$$;
