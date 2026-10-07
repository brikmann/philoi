-- 0235 — One Philoi account per Strava athlete.
--
-- strava_connections is keyed by user_id, and nothing stopped a second Philoi account linking the
-- same Strava athlete. strava-webhook resolves the athlete with
-- `.eq('athlete_id', owner_id).maybeSingle()`: two rows make that an error, the function reads it
-- as "no connection" and returns 200, so every activity for that athlete was dropped in real time.
-- Prod hit this on 2026-10-07 when one person linked the same Strava account from both of their
-- Philoi logins.
--
-- The link is by athlete_id, never by email, so a Strava account and a Philoi login with different
-- addresses is fine and stays fine. What this forbids is TWO Philoi accounts holding ONE athlete.
-- strava-oauth-exchange now releases the athlete from any other account before it upserts, so a
-- reconnect from a different login moves the link rather than colliding with this index.
--
-- Refuses rather than picking a winner: if duplicates exist when this runs, which account keeps
-- the athlete is a decision for a person, not for a migration.

do $guard$
declare
  v_dupes text;
begin
  select string_agg(athlete_id::text, ', ') into v_dupes
    from (select athlete_id from strava_connections group by athlete_id having count(*) > 1) d;
  if v_dupes is not null then
    raise exception '0235: athlete(s) % are linked to more than one account — choose one and delete the rest first', v_dupes;
  end if;
end;
$guard$;

create unique index if not exists strava_connections_athlete_id_key on strava_connections (athlete_id);
