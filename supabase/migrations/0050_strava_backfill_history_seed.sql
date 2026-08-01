-- Fix: "I connected Strava and nothing showed up under my lock-ins."
--
-- Root cause: strava-backfill walks activities `after` strava_connections.last_synced_at, and that
-- column defaulted to now() at connect time (migration 0038). So the first backfill only ever
-- pulled activities recorded AFTER the moment of connecting — a user's existing/recent runs were
-- never imported, and unless the real-time webhook happened to fire for a brand-new activity,
-- their journal stayed empty. (The auto-post-to-campfire flag is unrelated — the check_ins row is
-- created before, and independent of, any campfire posting.)
--
-- Fix: seed the cursor 14 days in the past so connecting imports recent history. The (user_id,
-- source, external_id) unique index (0038) makes re-processing already-imported activities a
-- harmless no-op, so nudging the cursor backward can never create duplicates.

-- New connections start 14 days back instead of "right now".
alter table strava_connections
  alter column last_synced_at set default (now() - interval '14 days');

-- One-time catch-up for connections that already exist (e.g. anyone who connected before this
-- migration): rewind any cursor that's newer than 14 days ago so their NEXT app-open backfill
-- pulls the last ~2 weeks of runs. `least(...)` guarantees we only ever move a cursor BACKWARD,
-- never forward — someone who has already synced further back keeps their position.
update strava_connections
set last_synced_at = least(last_synced_at, now() - interval '14 days');
