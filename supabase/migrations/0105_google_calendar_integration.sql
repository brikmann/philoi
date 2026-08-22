-- Google Calendar, read-only (GCAL_INTEGRATION_SPEC.md) — the school administrative layer the AI
-- coach reasons over: real exams, assignment deadlines, class blocks and free/busy, instead of
-- guesses. Same server-side shape as Strava (0035) and Whoop (0036) — the client secret never
-- reaches the app, and these tables are written ONLY by the gcal-* Edge Functions (service role).
--
-- TWO THINGS ARE DELIBERATELY DIFFERENT from the fitness connections:
--
-- 1. THE REFRESH TOKEN IS ENCRYPTED AT REST, not stored raw. A calendar grant reads every
--    commitment in someone's life, so a database dump alone must not yield a usable token. The
--    AES-256-GCM key lives in the Edge Function secret GCAL_TOKEN_ENC_KEY — Postgres never sees
--    it, which is the whole point (pgcrypto with a key stored in the same database would not buy
--    this). See supabase/functions/_shared/token-crypto.ts.
--
-- 2. WE DO NOT WAREHOUSE THE CALENDAR. There is no events table. The window is fetched
--    server-side at AI-message time and kept only in google_calendar_window_cache, a
--    minutes-long, normalized ({title,start,end,allDay}) cache that exists to keep one lock-in
--    session from hammering Google — not to accumulate a history. Rows carry expires_at, are
--    purged on read, and are deleted outright on disconnect.

-- ── The grant ───────────────────────────────────────────────────────────────────────────────
-- No RLS policies at all — deliberately, exactly as strava_connections/whoop_connections. Every
-- read/write goes through the Edge Functions (service role, bypasses RLS) or the two owner-scoped
-- RPCs below; the client never queries this table directly, so there is no policy shape that
-- could ever hand it a token, encrypted or not.
create table if not exists google_calendar_connections (
  user_id uuid primary key references profiles (id) on delete cascade,
  -- AES-256-GCM ciphertext ("v1.<iv>.<ciphertext>"), NOT a bearer token. Access tokens are never
  -- stored at all: gcal.ts mints a short-lived one per fetch and drops it.
  refresh_token_encrypted text not null,
  -- Which Google account this is, so Connected Apps can show the member WHICH calendar they
  -- linked (they may hold several). Shown only to its owner, never to another user.
  google_email text,
  -- What Google actually granted. Recorded so a fetch can refuse (and ask for re-consent)
  -- instead of firing a request Google would 403.
  scopes text not null default '',
  connected_at timestamptz not null default now(),
  -- Rate limiting (spec: "rate-limit"): a rolling hourly counter, so a chatty coach session can
  -- never turn into unbounded Google traffic for one member.
  last_fetched_at timestamptz,
  fetch_count integer not null default 0,
  fetch_window_started_at timestamptz not null default now()
);

alter table google_calendar_connections enable row level security;

-- ── The brief window cache ──────────────────────────────────────────────────────────────────
create table if not exists google_calendar_window_cache (
  user_id uuid primary key references profiles (id) on delete cascade,
  window_from timestamptz not null,
  window_to timestamptz not null,
  -- The NORMALIZED window only: [{title,start,end,allDay,calendar,busy}]. No attendees, no
  -- descriptions, no locations, no conferencing links, no ids — none of it is fetched.
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table google_calendar_window_cache enable row level security;

create index if not exists google_calendar_window_cache_expires_idx
  on google_calendar_window_cache (expires_at);

-- ── Owner-scoped RPCs ───────────────────────────────────────────────────────────────────────
-- Safe to expose to the owner: connected state + which Google account, never the token.
-- The out-params are named account_email / linked_at rather than google_email / connected_at on
-- purpose — a RETURNS TABLE out-param sharing a name with a column of the table the body reads
-- silently shadows that column inside the body (see 0036's same note).
drop function if exists get_my_google_calendar_status();
create function get_my_google_calendar_status()
returns table (connected boolean, account_email text, linked_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (select 1 from google_calendar_connections gc where gc.user_id = auth.uid()),
    (select gc.google_email from google_calendar_connections gc where gc.user_id = auth.uid()),
    (select gc.connected_at from google_calendar_connections gc where gc.user_id = auth.uid());
$$;

-- Local disconnect — forgets Philoi's own record and drops the cached window immediately.
--
-- This does NOT revoke the grant on Google's side; only the gcal-disconnect Edge Function can do
-- that (it holds the decryption key and calls Google's revoke endpoint), and that is the path the
-- app takes. This RPC is the fallback for when that call fails: a member who taps "Disconnect"
-- must ALWAYS end up disconnected in Philoi, even if Google is unreachable — and a connection row
-- with no token behind it is useless anyway, since the next fetch would just delete it.
drop function if exists disconnect_my_google_calendar();
create function disconnect_my_google_calendar()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from google_calendar_window_cache where user_id = auth.uid();
  delete from google_calendar_connections where user_id = auth.uid();
end;
$$;
