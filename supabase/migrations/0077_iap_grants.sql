-- Real-money grants (#71 · Phase 4). The RevenueCat webhook is the ONLY thing that may call these.
--
-- The client is never trusted with a grant. It can observe that a purchase succeeded and show an
-- optimistic screen, but the embers and the entitlement are written here, from a webhook the app
-- cannot forge. A client that could credit its own balance is a client that prints money.
--
-- IDEMPOTENCE IS THE WHOLE DESIGN. RevenueCat retries a webhook until it gets a 2xx, and it will
-- happily deliver the same event twice on a network blip. Every grant is keyed on RevenueCat's own
-- event id, so the second delivery is a no-op instead of a second 15,000 embers.


-- ───────────────────────────── the receipt ledger ─────────────────────────────
--
-- One row per RevenueCat event we have acted on. This is deliberately NOT `ember_ledger` with a
-- different reason: ember_ledger.ref is a uuid and RevenueCat event ids are opaque strings, and
-- overloading that column would have meant either mangling their ids or losing the link back to the
-- receipt entirely.
create table if not exists iap_grants (
  -- RevenueCat's event id. PRIMARY KEY is the idempotency guarantee — a retry hits this and stops.
  event_id text primary key,
  user_id uuid references profiles (id) on delete set null,
  event_type text not null,
  product_id text not null,
  -- What we actually did, for support and for reconciling against RevenueCat's own dashboard.
  embers_granted int not null default 0,
  granted_pass boolean not null default false,
  season_id text,
  -- The raw event, kept verbatim. When a user says "I paid and got nothing", this is the only
  -- record that can settle it, and a parsed subset always turns out to be missing the one field
  -- that mattered.
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists iap_grants_user_idx on iap_grants (user_id, created_at desc);

alter table iap_grants enable row level security;

-- No policy at all: this table is service-role only. Users see the RESULT of a purchase in their
-- balance and inventory; the receipt itself carries store metadata they have no reason to read and
-- support has every reason to trust.


-- ───────────────────────────── the grant ─────────────────────────────

/**
 * Apply one RevenueCat event. Returns what it did, so the webhook can log a useful line.
 *
 * Called ONLY by the revenuecat-webhook edge function running as service role. Not granted to
 * `authenticated` — see the revoke at the bottom.
 *
 * `p_event_id` is RevenueCat's; inserting it first is what makes this safe to call twice. The
 * insert is the lock: if it conflicts, we return early having granted nothing, and the webhook
 * still answers 200 so RevenueCat stops retrying a delivery we have already honoured.
 */
create or replace function grant_iap_purchase(
  p_event_id text,
  p_user uuid,
  p_event_type text,
  p_product_id text,
  p_embers int,
  p_is_pass boolean,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := season_config() ->> 'id';
  v_granted_pass boolean := false;
  v_granted_embers int := 0;
begin
  if p_user is null then
    raise exception 'No such user for this purchase';
  end if;

  insert into iap_grants (event_id, user_id, event_type, product_id, payload, season_id)
  values (p_event_id, p_user, p_event_type, p_product_id, p_payload, v_season)
  on conflict (event_id) do nothing;

  if not found then
    -- Already honoured. Not an error: this is the retry path, and it is the common one.
    return jsonb_build_object('duplicate', true, 'embers', 0, 'pass', false);
  end if;

  if p_is_pass then
    -- grant_forge_pass (0074) re-checks season_phase() itself and also fires the Level 0 unlock.
    -- Letting it own both means a purchase that somehow lands outside the window fails loudly here
    -- rather than quietly entitling someone to a season that isn't running.
    perform grant_forge_pass(p_user, v_season);
    v_granted_pass := true;
  end if;

  if coalesce(p_embers, 0) > 0 then
    perform economy_move_embers(p_user, p_embers, 'iap', null);
    v_granted_embers := p_embers;
  end if;

  update iap_grants
  set embers_granted = v_granted_embers, granted_pass = v_granted_pass
  where event_id = p_event_id;

  return jsonb_build_object('duplicate', false, 'embers', v_granted_embers, 'pass', v_granted_pass);
end;
$$;

revoke all on function grant_iap_purchase(text, uuid, text, text, int, boolean, jsonb) from public, authenticated;


-- ───────────────────────────── reconcile ─────────────────────────────

/**
 * The safety net for "the store charged me but the webhook never landed."
 *
 * The client may call this — it is the one IAP function `authenticated` can reach — but notice what
 * it cannot do: it takes no amount, no product, and no event id. It only ever grants the PASS, only
 * for the caller's own account, only inside the season window, and only if they don't already have
 * it. There is no argument a malicious client could pass to get embers or someone else's
 * entitlement out of it.
 *
 * Embers are deliberately NOT reconcilable. They are consumables with no entitlement to re-read, so
 * "I paid and got no embers" has to be settled from iap_grants by a human. Guessing would mean any
 * client that claimed a missing pack got one.
 */
create or replace function reconcile_my_forge_pass()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := season_config() ->> 'id';
  v_owns boolean;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  select owns_premium into v_owns
  from forge_pass_state where user_id = v_user and season_id = v_season;

  if coalesce(v_owns, false) then
    return jsonb_build_object('changed', false, 'owns_premium', true);
  end if;

  -- Only honour a reconcile if a webhook DID record a pass purchase for this user this season. The
  -- store's word reaches us through RevenueCat, not through the app, so without a receipt on file
  -- this is just a client asserting it paid.
  if not exists (
    select 1 from iap_grants
    where user_id = v_user and granted_pass and season_id = v_season
  ) then
    return jsonb_build_object('changed', false, 'owns_premium', false, 'reason', 'no receipt on file');
  end if;

  perform grant_forge_pass(v_user, v_season);
  return jsonb_build_object('changed', true, 'owns_premium', true);
end;
$$;


-- ───────────────────────── resolving a RevenueCat app_user_id ─────────────────────────
--
-- The client configures RevenueCat with the Supabase user id as appUserID, so the webhook's
-- app_user_id IS a profiles.id in the normal case. This exists to fail SAFELY when it isn't — an
-- anonymous RevenueCat id ($RCAnonymousID:...) from a purchase made before login would otherwise
-- cast-error inside the webhook and look like an outage.
create or replace function profile_id_for_app_user(p_app_user_id text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  begin
    v_id := p_app_user_id::uuid;
  exception when invalid_text_representation then
    return null;
  end;

  return (select id from profiles where id = v_id);
end;
$$;
