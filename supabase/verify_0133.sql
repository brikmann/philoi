-- Verification for 0133 (#144) — the Pass grants what the season owes, not what the client asked.
--
-- SAFE TO RUN AGAINST PRODUCTION: everything happens inside a transaction that ends in ROLLBACK,
-- and `philoi.suppress_push` is set for the duration.
--
--   npx supabase db query --linked -f supabase/verify_0133.sql
--
-- Expected output — any other value is a regression:
--
--   track rows seeded              | 215
--   track levels covered           | 100
--   every level pays both lanes    | yes
--   L50 premium bundle             | halo-emberfall-mythic + sfx-emberfall-strike
--   L100 free bundle               | hephaestus + title-s1-the-relentless
--   drip L7 free / L77 premium     | 20 / 100
--   SPOOF embers granted           | 20             <- the season's amount, NOT the 999999 asked for
--   SPOOF wallet delta             | 20
--   SPOOF mismatch recorded        | yes
--   LEGIT embers granted           | 20
--   LEGIT no mismatch recorded     | yes
--   unknown level 500 refused      | yes
--   pass_level_rewards not an RPC  | yes

begin;
set local philoi.suppress_push = 'on';

create temp table _o(step text, detail text);

-- ─────────────────────── the track itself ───────────────────────

insert into _o select 'track rows seeded', count(*)::text from pass_track_rewards where season_id = 'S1';
insert into _o select 'track levels covered', count(distinct level)::text from pass_track_rewards where season_id = 'S1';

insert into _o
select 'every level pays both lanes',
       case when count(*) = 0 then 'yes' else 'NO — ' || count(*)::text || ' gaps' end
from (
  select l.level, ln.lane
  from generate_series(1, 100) l(level)
  cross join (values ('free'), ('premium')) ln(lane)
  where not exists (
    select 1 from pass_track_rewards t
    where t.season_id = 'S1' and t.level = l.level and t.lane = ln.lane
  )
) gaps;

insert into _o
select 'L50 premium bundle', string_agg(item_key, ' + ' order by ord)
from pass_track_rewards where season_id = 'S1' and level = 50 and lane = 'premium';

insert into _o
select 'L100 free bundle', string_agg(coalesce(box_key, item_key), ' + ' order by ord)
from pass_track_rewards where season_id = 'S1' and level = 100 and lane = 'free';

insert into _o
select 'drip L7 free / L77 premium',
       (select embers::text from pass_track_rewards where season_id='S1' and level=7  and lane='free')
       || ' / ' ||
       (select embers::text from pass_track_rewards where season_id='S1' and level=77 and lane='premium');

-- ─────────────────────── the claim, spoofed and legitimate ───────────────────────
--
-- Season phase is 'upcoming' until Sept 10, and claim_pass_level refuses outside the window, so the
-- window is opened for this transaction only. Everything else about the claim is real.
do $probe$
declare
  v_user uuid;
  v_before bigint;
  v_after bigint;
  v_res jsonb;
  v_cfg jsonb;
begin
  select id into v_user from profiles order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- Open the season for this transaction. Rolled back with everything else.
  select value into v_cfg from economy_config where key = 'season';
  update economy_config
     set value = jsonb_set(jsonb_set(v_cfg, '{starts_at}', to_jsonb((now() - interval '1 day')::text)),
                           '{ends_at}', to_jsonb((now() + interval '30 days')::text))
   where key = 'season';

  -- A real level-1 position: enough XP for level 1, free lane, no premium needed.
  insert into forge_pass_state (user_id, season_id, pass_xp, owns_premium)
  values (v_user, 'S1', 100000, true)
  on conflict (user_id, season_id) do update set pass_xp = 100000, owns_premium = true;
  delete from pass_claims where user_id = v_user and season_id = 'S1' and tier in (7, 8);

  -- ── SPOOF: level 7 free pays 20 embers. Ask for 999,999. ──
  select coalesce(sum(delta), 0) into v_before from ember_ledger where user_id = v_user;
  v_res := claim_pass_level(7, 'free', '[{"kind":"embers","embers":999999}]'::jsonb);
  select coalesce(sum(delta), 0) into v_after from ember_ledger where user_id = v_user;

  insert into _o values ('SPOOF embers granted',
    (select coalesce(sum(delta),0)::text from ember_ledger
      where user_id = v_user and reason = 'forge_pass' and created_at >= now() - interval '1 minute'));
  insert into _o values ('SPOOF wallet delta', (v_after - v_before)::text);
  insert into _o values ('SPOOF mismatch recorded',
    case when exists (select 1 from pass_claim_mismatches
                       where user_id = v_user and level = 7 and claimed::text like '%999999%')
         then 'yes' else 'NO' end);

  -- ── LEGIT: level 8 free, asking for exactly what the season owes. ──
  select coalesce(sum(delta), 0) into v_before from ember_ledger where user_id = v_user;
  v_res := claim_pass_level(8, 'free', pass_level_rewards('S1', 8, 'free'));
  select coalesce(sum(delta), 0) into v_after from ember_ledger where user_id = v_user;

  insert into _o values ('LEGIT embers granted', (v_after - v_before)::text);
  insert into _o values ('LEGIT no mismatch recorded',
    case when not exists (select 1 from pass_claim_mismatches where user_id = v_user and level = 8)
         then 'yes' else 'NO' end);

  -- ── a level the season does not define ──
  begin
    perform claim_pass_level(500, 'free', '[{"kind":"embers","embers":10}]'::jsonb);
    insert into _o values ('unknown level 500 refused', 'NO — it was granted');
  exception when others then
    insert into _o values ('unknown level 500 refused', 'yes');
  end;
end;
$probe$;

-- ─────────────────────── the helper is not an RPC ───────────────────────

insert into _o
select 'pass_level_rewards not an RPC',
       case when bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) then 'NO — exposed' else 'yes' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'pass_level_rewards';

select step, detail from _o order by step;

rollback;
