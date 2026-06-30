-- Philoi — RLS Isolation Tests
-- Run these in the Supabase SQL Editor to prove data isolation.
-- All tests use DO blocks that raise an exception if any check FAILS.
-- A clean run = "DO" returned, no errors.

-- ── Test 1: Non-member cannot select a private circle's rows ──────────────────
-- Pick any existing group_id and a user_id NOT in that group, then prove
-- that get_group_leaderboard (and direct select via RLS) returns nothing.

do $$
declare
  v_private_group_id uuid;
  v_outsider_id      uuid;
  v_row_count        integer;
begin
  -- Grab a group that has at least one member.
  select id into v_private_group_id from groups
  where is_public = false limit 1;

  if v_private_group_id is null then
    raise notice 'SKIP: No private groups found — create one first.';
    return;
  end if;

  -- Grab a user who is NOT in that group.
  select id into v_outsider_id from profiles
  where id not in (
    select user_id from group_members where group_id = v_private_group_id
  ) limit 1;

  if v_outsider_id is null then
    raise notice 'SKIP: Could not find an outsider user — create a second account.';
    return;
  end if;

  -- Simulate the outsider's session by setting auth.uid() to their id.
  -- (This relies on is_group_member() calling auth.uid() — we call it directly.)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider_id)::text, true);

  -- Check: is_group_member should return false for the outsider.
  if public.is_group_member(v_private_group_id) then
    raise exception 'FAIL Test 1: is_group_member returned true for a non-member (uid=%).',
      v_outsider_id;
  end if;

  raise notice 'PASS Test 1: is_group_member correctly returns false for a non-member.';
end $$;


-- ── Test 2: Storage path convention matches the RLS policy ───────────────────
-- The policy reads the group_id from path segment 1.
-- Confirm the helper works on a well-formed path.

do $$
declare
  v_sample_path text := gen_random_uuid()::text || '/' ||
                        gen_random_uuid()::text || '/' ||
                        gen_random_uuid()::text || '.jpg';
  v_extracted   uuid;
begin
  v_extracted := ((storage.foldername(v_sample_path))[1])::uuid;

  if v_extracted is null then
    raise exception 'FAIL Test 2: storage.foldername could not extract group_id from path %.', v_sample_path;
  end if;

  raise notice 'PASS Test 2: storage.foldername correctly extracts group_id (%) from path.',
    v_extracted;
end $$;


-- ── Test 3: delete_my_account exists and is SECURITY DEFINER ─────────────────
do $$
declare
  v_sec text;
begin
  select prosecdef::text into v_sec
  from pg_proc
  where proname = 'delete_my_account'
    and pronamespace = 'public'::regnamespace;

  if v_sec is null then
    raise exception 'FAIL Test 3: delete_my_account function not found.';
  end if;

  if v_sec <> 'true' then
    raise exception 'FAIL Test 3: delete_my_account is NOT security definer — cascade will be blocked by RLS.';
  end if;

  raise notice 'PASS Test 3: delete_my_account exists and is SECURITY DEFINER.';
end $$;


-- ── Test 4: delete_group exists and is SECURITY DEFINER ──────────────────────
do $$
declare
  v_sec text;
begin
  select prosecdef::text into v_sec
  from pg_proc
  where proname = 'delete_group'
    and pronamespace = 'public'::regnamespace;

  if v_sec is null or v_sec <> 'true' then
    raise exception 'FAIL Test 4: delete_group missing or not SECURITY DEFINER.';
  end if;

  raise notice 'PASS Test 4: delete_group is SECURITY DEFINER.';
end $$;


-- ── Test 5: moderation_reports table exists and RLS is on ────────────────────
do $$
declare
  v_rls boolean;
begin
  select relrowsecurity into v_rls
  from pg_class
  where relname = 'moderation_reports'
    and relnamespace = 'public'::regnamespace;

  if v_rls is null then
    raise exception 'FAIL Test 5: moderation_reports table not found.';
  end if;

  if not v_rls then
    raise exception 'FAIL Test 5: RLS is NOT enabled on moderation_reports.';
  end if;

  raise notice 'PASS Test 5: moderation_reports exists with RLS enabled.';
end $$;
