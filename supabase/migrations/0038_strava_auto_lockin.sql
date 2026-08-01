-- Auto lock-in from a synced Strava activity, real-time (PHILOI_UI_SPEC.md §17b/§13,
-- CODE_BUILD_PROMPTS.md). Reuses the existing check_ins pipeline end to end: a qualifying
-- Strava activity becomes an ordinary check_ins row (source='strava'), so it inherits XP,
-- streak, the daily flame-meter cap, and feed rendering for free — nothing new to build for any
-- of that, only the "how does a Strava activity turn into one" and "how does it get posted" parts.

-- Device-verified sources this app can create a lock-in from, and the dedup key that keeps
-- re-processing the same external activity (webhook + backfill both firing) from ever creating
-- a duplicate — the single most important correctness property here, so it's the unique index,
-- not just application logic.
alter table check_ins add column if not exists source text not null default 'manual'
  check (source in ('manual', 'strava', 'healthkit', 'health_connect'));
alter table check_ins add column if not exists external_id text;
alter table check_ins add column if not exists distance_m numeric;

create unique index if not exists check_ins_source_external_id_idx
  on check_ins (user_id, source, external_id) where external_id is not null;

-- Backfill cursor (the poll-on-app-open safety net) — "activities newer than this" per
-- connection, so a repeat backfill never re-walks the athlete's whole history.
alter table strava_connections add column if not exists last_synced_at timestamptz not null default now();

-- Per-user-per-campfire consent to auto-post a synced workout (§17b's "never post to a fire not
-- opted in" — this is publishing on the user's behalf, so it's opt-in, default off, same
-- RPC-gated write pattern as the other group_members self-flags (set_my_helper_flag etc.) rather
-- than a direct client update policy.
alter table group_members add column if not exists auto_post_synced boolean not null default false;

create or replace function set_my_auto_post_synced(p_group_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update group_members
  set auto_post_synced = p_enabled
  where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- Strava's push-subscription API allows exactly ONE subscription per API application (not per
-- user) — this is that singleton record, written once by strava-webhook-setup (an admin-run
-- Edge Function, service role) and read by strava-webhook to validate the handshake's
-- verify_token. No client-facing policy — nothing here is ever meant to be queried by the app.
create table if not exists strava_webhook_subscription (
  id bigint primary key,
  callback_url text not null,
  verify_token text not null,
  created_at timestamptz not null default now()
);

alter table strava_webhook_subscription enable row level security;
