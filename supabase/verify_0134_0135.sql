-- Verification for 0134 (#146 per-campfire banners) and 0135 (#150 per-type notification gate).
--
-- SAFE TO RUN AGAINST PRODUCTION: everything happens inside a transaction that ends in ROLLBACK,
-- and `philoi.suppress_push` is set for the duration.
--
--   npx supabase db query --linked -f supabase/verify_0134_0135.sql
--
-- Expected output — any other value is a regression:
--
--   0134 banner_item_id exists      | yes
--   0134 owner can set              | banner-emberfall
--   0134 owner can clear to null    | yes
--   0134 base hearth always allowed | yes
--   0134 unowned banner refused     | yes
--   0134 non-owner refused          | yes
--   0135 notify_event has type gate | yes
--   0135 push_raw defers to category| yes
--   0135 type_ absent  -> allowed   | true      <- nobody's behaviour changes on deploy
--   0135 type_ true    -> allowed   | true
--   0135 type_ false   -> BLOCKED   | false
--   0135 legacy key -> its category | campfires
--   0135 unmapped key -> allowed    | true      <- an unknown key never suppresses
--
-- WHY THE 0135 GATE IS TESTED AS A PREDICATE, NOT AS A SEND.
-- notify_event returns early when philoi.suppress_push is on, and it does so BEFORE it selects
-- push targets — which is exactly the code the gate lives in. Running it with suppression off to
-- observe the gate would mean actually dispatching to Expo. So this asserts two things instead:
-- that the deployed source contains the gate, and that the gate's expression evaluates correctly
-- for on / off / absent against real prefs blobs. Those are the same expression, character for
-- character.

begin;
set local philoi.suppress_push = 'on';

create temp table _o(step text, detail text);

-- ─────────────────────────── 0134 · the banner belongs to the fire ───────────────────────────

insert into _o
select '0134 banner_item_id exists',
       case when count(*) = 1 then 'yes' else 'NO' end
from information_schema.columns
where table_name = 'groups' and column_name = 'banner_item_id';

do $b$
declare
  v_owner uuid;
  v_other uuid;
  v_group uuid;
begin
  select owner_id, id into v_owner, v_group from groups order by created_at limit 1;
  select id into v_other from profiles where id <> v_owner order by created_at limit 1;

  -- Act as the owner.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- Give the owner a banner to fly, so the ownership check has something to pass on.
  insert into cosmetics_owned (user_id, cosmetic_key, slot, source, provenance)
  values (v_owner, 'banner-emberfall', 'banner', 'forge_pass', 'verification')
  on conflict do nothing;

  perform set_campfire_banner(v_group, 'banner-emberfall');
  insert into _o select '0134 owner can set', banner_item_id from groups where id = v_group;

  perform set_campfire_banner(v_group, null);
  insert into _o select '0134 owner can clear to null',
    case when banner_item_id is null then 'yes' else 'NO' end from groups where id = v_group;

  -- The base hearth is granted by DEFAULT_LOADOUT, not owned as a row, so it must pass without one.
  begin
    perform set_campfire_banner(v_group, 'banner-base-hearth');
    insert into _o values ('0134 base hearth always allowed', 'yes');
  exception when others then
    insert into _o values ('0134 base hearth always allowed', 'NO — ' || SQLERRM);
  end;

  -- A banner the owner does not own.
  begin
    perform set_campfire_banner(v_group, 'banner-emberfall-mythic');
    insert into _o values ('0134 unowned banner refused', 'NO — it was accepted');
  exception when others then
    insert into _o values ('0134 unowned banner refused', 'yes');
  end;

  -- Somebody else's campfire.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  begin
    perform set_campfire_banner(v_group, 'banner-base-hearth');
    insert into _o values ('0134 non-owner refused', 'NO — it was accepted');
  exception when others then
    insert into _o values ('0134 non-owner refused', 'yes');
  end;
end;
$b$;

-- ─────────────────────────── 0135 · the gates are in the deployed source ───────────────────────────

insert into _o
select '0135 notify_event has type gate',
       case when prosrc like '%type_'' || p_type%' then 'yes' else 'NO' end
from pg_proc where proname = 'notify_event';

insert into _o
select '0135 push_raw defers to category',
       case when prosrc like '%notification_category_for_pref_key%' then 'yes' else 'NO' end
from pg_proc where proname = 'notify_push_raw';

-- ─────────────────────────── 0135 · the gate's own semantics ───────────────────────────
-- The same expression notify_event runs, against three prefs blobs.

insert into _o
select '0135 type_ absent  -> allowed',
       coalesce(('{"master":true}'::jsonb->>('type_' || 'challenge_won'))::boolean, true)::text;

insert into _o
select '0135 type_ true    -> allowed',
       coalesce(('{"type_challenge_won":true}'::jsonb->>('type_' || 'challenge_won'))::boolean, true)::text;

insert into _o
select '0135 type_ false   -> BLOCKED',
       coalesce(('{"type_challenge_won":false}'::jsonb->>('type_' || 'challenge_won'))::boolean, true)::text;

insert into _o values ('0135 legacy key -> its category', notification_category_for_pref_key('messages'));

-- An unknown legacy key resolves to a category nobody has a pref for, and the coalesce in
-- notify_push_raw then lets the push through. Asserted because the failure mode of getting this
-- wrong is silent, total suppression of a push type.
insert into _o
select '0135 unmapped key -> allowed',
       coalesce(('{"master":true}'::jsonb->>('cat_' || notification_category_for_pref_key('not_a_key')))::boolean, true)::text;

select step, detail from _o order by step;

rollback;
