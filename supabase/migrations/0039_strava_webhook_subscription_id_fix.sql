-- Fix strava_webhook_subscription's PK: it originally used Strava's own numeric subscription id
-- as the primary key, but that id isn't known until AFTER Strava's create-subscription call
-- succeeds — and Strava validates the callback URL SYNCHRONOUSLY as part of that same call (a
-- GET back to the callback with the handshake params), which means the verify_token row has to
-- already exist BEFORE the create call is made, not after. Decoupling "do we have a pending
-- verify_token" from "has Strava confirmed a subscription id yet" fixes the chicken-and-egg:
-- strava-webhook-setup now inserts the pending row first, calls Strava second, then fills in
-- strava_subscription_id once Strava responds. Table has no real data yet (first attempt failed
-- at the handshake) — a clean drop/recreate is simpler than converting the column in place.
drop table if exists strava_webhook_subscription;

create table strava_webhook_subscription (
  id bigint generated always as identity primary key,
  strava_subscription_id bigint,
  callback_url text not null,
  verify_token text not null,
  created_at timestamptz not null default now()
);

alter table strava_webhook_subscription enable row level security;
