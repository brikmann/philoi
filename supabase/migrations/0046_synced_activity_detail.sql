-- Profile / activity detail for a synced lock-in (PHILOI_UI_SPEC.md §17b's third cross-integration
-- surface, design-mocks/40 frame 3): "tap a synced activity to revisit route, splits, and the
-- photos you took on that lock-in, with a one-tap Open on Strava."
--
-- RENUMBERED from 0043 to 0046: concurrent Punchlist-2 work claimed 0043 (daily_streak_decay) and
-- 0044 (leaderboard_punchlist2) after this file was written, and supabase_migrations keys on the
-- version alone — two files sharing a version means the second one's ledger INSERT fails and its
-- whole transaction rolls back. Nothing here depends on 0040-0045, so running last is safe.
--
-- A SIDE table rather than more columns on check_ins, for two reasons: check_ins is already wide
-- and every one of these fields is null for the manual lock-ins that are the overwhelming
-- majority; and Strava's API Agreement obliges us to be able to delete their activity data
-- cleanly on disconnect — one `delete from synced_activity_details where user_id = ...` does
-- that without touching the lock-in itself (which is the user's OWN record of having shown up,
-- and stays).
create table if not exists synced_activity_details (
  check_in_id uuid primary key references check_ins (id) on delete cascade,
  -- Denormalized from check_ins so the RLS policy below is a plain column compare instead of a
  -- join on every read, and so the disconnect-time purge above is a single-table delete.
  user_id uuid not null references profiles (id) on delete cascade,
  -- Google-encoded polyline (Strava's map.summary_polyline) — decoded and drawn as an SVG path
  -- client-side (see src/lib/polyline.ts); no map SDK, so this stays OTA-shippable.
  route_polyline text,
  -- Strava's splits_metric, trimmed to the per-km fields the detail screen actually renders.
  splits jsonb,
  calories numeric,
  elevation_gain_m numeric,
  -- Strava's device_name — needed for the Garmin attribution the brand guidelines require when
  -- an activity is Garmin-sourced (§17b brand compliance).
  device_name text,
  created_at timestamptz not null default now()
);

create index if not exists synced_activity_details_user_idx on synced_activity_details (user_id);

alter table synced_activity_details enable row level security;

-- Owner-only, deliberately NARROWER than check_in_photos' "own rows + circle-mates' rows": a
-- campfire-mate sees the synced lock-in's summary stats on the feed card and deep-links to
-- Strava itself for anything more (that's what "View on Strava" is for). Detailed route/split
-- data for another athlete never needs to be served out of our database, so it isn't.
drop policy if exists "synced_activity_details: read own" on synced_activity_details;
create policy "synced_activity_details: read own" on synced_activity_details for select using (
  user_id = auth.uid()
);

-- No insert/update/delete policy: rows are written only by the strava-webhook / strava-backfill
-- Edge Functions under the service role (which bypasses RLS), never by a client — same trusted-
-- write pattern as check_in_photos' stop_lock_in_session().

-- Disconnecting Strava now also drops the Strava-derived activity data we cached (their API
-- Agreement's data-handling terms, §17b brand/policy compliance). Same signature, so a plain
-- CREATE OR REPLACE is safe here. Deliberately does NOT touch the check_ins themselves: those
-- are the user's own record of having shown up and remain theirs after a disconnect — what goes
-- is Strava's route/split/device data, which is the part we only ever held on Strava's terms.
create or replace function disconnect_my_strava()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from synced_activity_details where user_id = auth.uid();
  delete from strava_connections where user_id = auth.uid();
end;
$$;
