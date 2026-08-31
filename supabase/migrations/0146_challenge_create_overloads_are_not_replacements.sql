-- 0146 · Appending a parameter is not a replacement.
--
-- 0145 gave create_h2h_challenge, create_group_challenge and create_placement_challenge two new
-- defaulted parameters (p_grade_target, p_course_code) with `create or replace function`. That is
-- not a replace. Postgres keys a function on its argument types, so an appended parameter defines
-- a SECOND function and leaves the original standing. Prod has been carrying two overloads of each
-- since 0145 landed.
--
-- The consequence is not cosmetic. Both overloads default everything past the third parameter, so
-- a call supplying the pre-0145 argument set satisfies BOTH, and Postgres refuses to guess:
--
--   ERROR: 42725: function create_h2h_challenge(uuid, unknown, integer) is not unique
--   HINT:  Could not choose a best candidate function.
--
-- Verified against prod with EXPLAIN (which parses and plans without executing) on all three.
--
-- Why nobody has seen it yet: src/lib/api/social-challenges.ts always sends both grade terms,
-- `input.gradeTarget ?? null`, so PostgREST is handed a key set only the new overload accepts and
-- resolves it uniquely. The current build is fine. Any install predating that client change sends
-- the old key set and gets the ambiguity — challenge creation fails outright — and runtimeVersion
-- is still `sdkVersion`, so `eas update` cannot reach those installs. A tester on an older build
-- would simply find that they cannot start a race.
--
-- ─────────────────────────── WHAT THIS MIGRATION DOES ───────────────────────────
--
-- Drops the three superseded signatures. Nothing else. It is ledger-additive and runs no DDL
-- against the surviving functions — their prosrc must be byte-identical across this migration.
--
-- Checked before writing, against prod:
--   · No server-side caller. A prosrc scan across every function in `public` for
--     create_(h2h|group|placement)_challenge returned zero rows, so the only callers are clients.
--   · The survivors already default p_grade_target and p_course_code, and require only their first
--     three parameters (pronargs - pronargdefaults = 3). This matters more than the drop itself:
--     removing the stale signature cures the ambiguity, but had the survivor NOT defaulted those
--     two, an old-shape call would merely trade "is not unique" for "function does not exist" —
--     the same break wearing a different error. It does default them, so every caller — old build,
--     new build or direct SQL — now lands on exactly one function. The assertion below re-proves
--     this rather than trusting this paragraph.
--   · Both overloads carry identical ACLs (authenticated=X among them), so dropping one takes no
--     execute grant with it. No re-grant is needed and none is issued here.

drop function if exists create_h2h_challenge(
  uuid, text, integer, uuid, integer, text, timestamptz, timestamptz
);

drop function if exists create_group_challenge(
  uuid, integer, integer, integer, text, timestamptz, timestamptz
);

drop function if exists create_placement_challenge(
  uuid, text, integer, integer, text, timestamptz, timestamptz
);

-- ─────────────────────────── PROOF, NOT ASSERTION-BY-COMMENT ───────────────────────────
--
-- MIGRATIONS.md asks that a migration ship something a later session can re-run to prove its
-- effect is actually live. Catalog facts only — this executes none of the three functions.

do $assert$
declare
  r record;
  v_expected text[] := array['create_h2h_challenge','create_group_challenge','create_placement_challenge'];
  v_name text;
  v_count int;
begin
  foreach v_name in array v_expected loop
    select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;

    if v_count <> 1 then
      raise exception '0146: % has % overloads on this database, expected exactly 1. An ambiguous call cannot be resolved by Postgres and challenge creation will fail for some callers.',
        v_name, v_count;
    end if;
  end loop;

  -- The survivor must still be reachable by a caller that supplies only the original three
  -- arguments, or this migration has replaced one break with another.
  for r in
    select p.oid as fn_oid,
           p.proname,
           p.pronargs - p.pronargdefaults as required_args,
           pg_get_function_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(v_expected)
  loop
    if r.required_args <> 3 then
      raise exception '0146: % requires % arguments, expected 3. A pre-0145 call omitting the grade terms would no longer resolve. Args: %',
        r.proname, r.required_args, r.args;
    end if;

    if r.args not like '%p_grade_target numeric DEFAULT%' or r.args not like '%p_course_code text DEFAULT%' then
      raise exception '0146: % is missing a defaulted grade term — the surviving overload is the wrong one. Args: %',
        r.proname, r.args;
    end if;

    -- The oid form, deliberately. The text form takes a signature of TYPES, while
    -- pg_get_function_identity_arguments returns names alongside them ("p_opponent_id uuid, ..."),
    -- so building the string version raises 42601 "syntax error at or near uuid" instead of
    -- answering the question. That is exactly how this migration failed its first push.
    if not has_function_privilege('authenticated', r.fn_oid, 'EXECUTE') then
      raise exception '0146: authenticated cannot execute %. The drop took a grant with it.', r.proname;
    end if;
  end loop;

  raise notice '0146: one overload each, three required args, grade terms defaulted, execute intact.';
end;
$assert$;

comment on function create_h2h_challenge(uuid, text, integer, uuid, integer, text, timestamptz, timestamptz, numeric, text) is
  'The only create_h2h_challenge. 0145 appended p_grade_target/p_course_code with CREATE OR REPLACE, which created a second overload rather than replacing this one; 0146 dropped the 8-argument original. Appending a parameter is never a replace — drop the old signature in the same migration.';
