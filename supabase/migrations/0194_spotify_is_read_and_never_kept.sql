-- 0194 — Spotify is read, and never kept.
--
-- CODE_PROMPT_spotify_backend.md §1 — the "Your music → Spotify" row in mock 206. v1 is connect +
-- read the currently-playing track for the lock-in music chip; transport control is deferred.
--
-- A deliberate copy of google_calendar_connections (0105), renamed. Same server-side shape as
-- Strava (0035), Whoop (0036) and gcal: the client secret never reaches the app, the refresh
-- token is AES-256-GCM ciphertext whose key (SPOTIFY_TOKEN_ENC_KEY, its own secret — not gcal's)
-- lives only in the Edge Functions, access tokens are never stored, and this table is written
-- ONLY by the spotify-* Edge Functions with the service role.
--
-- Columns match what spotify-oauth-exchange upserts and _shared/spotify.ts reads/updates.
--
-- ─────────────────────────────── WHAT IS NOT HERE ───────────────────────────────
--
-- • No listening history, and no now-playing cache. spotify-now-playing fetches live and the
--   client polls it; nothing about what someone listens to accumulates in Postgres.
-- • No RLS policies — deliberately, exactly as 0105. Every read/write is a service-role Edge
--   Function or the owner-scoped status RPC, so there is no policy shape that could ever hand a
--   client a token, encrypted or not. Table privileges are also revoked from anon/authenticated
--   as a second wall: RLS-with-no-policy already returns nothing, this makes it an error instead.
-- • No local-disconnect fallback RPC. gcal needed one because its disconnect calls Google's revoke
--   endpoint, which can fail; Spotify has no token-revoke endpoint, so spotify-disconnect is a
--   plain service-role delete with nothing external to fail on.

create table if not exists spotify_connections (
  user_id uuid primary key references profiles (id) on delete cascade,
  -- AES-256-GCM ciphertext ("v1.<iv>.<ciphertext>"), NOT a bearer token.
  refresh_token_encrypted text not null,
  -- Which Spotify account this is, shown to its owner only.
  spotify_user_id text,
  display_name text,
  -- What Spotify actually granted, so a read can refuse instead of firing a request Spotify 403s.
  scopes text not null default '',
  connected_at timestamptz not null default now(),
  -- Rolling hourly rate limit, same as gcal: a chatty poll cannot become unbounded Spotify traffic.
  last_fetched_at timestamptz,
  fetch_count integer not null default 0,
  fetch_window_started_at timestamptz not null default now()
);

alter table spotify_connections enable row level security;

revoke all on table spotify_connections from anon, authenticated;

-- ── Owner-scoped status ─────────────────────────────────────────────────────────────────────
-- Connected state + which Spotify account, never the token. The out-params are account_name /
-- linked_at rather than display_name / connected_at on purpose: a RETURNS TABLE out-param sharing a
-- name with a column the body reads silently shadows that column (0036, 0105).
drop function if exists get_my_spotify_status();
create function get_my_spotify_status()
returns table (connected boolean, account_name text, linked_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (select 1 from spotify_connections sc where sc.user_id = auth.uid()),
    (select sc.display_name from spotify_connections sc where sc.user_id = auth.uid()),
    (select sc.connected_at from spotify_connections sc where sc.user_id = auth.uid());
$$;

revoke all on function public.get_my_spotify_status() from public, anon;
grant execute on function public.get_my_spotify_status() to authenticated;
