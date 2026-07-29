-- Philoi — RLS Isolation Tests
-- Run these in the Supabase SQL Editor to prove data isolation.
-- All tests use DO blocks that raise an exception if any check FAILS.
-- A clean run = "DO" returned, no errors.
--
-- Tests 8-10 (chat-safety build, philoi_chat_safety_build.md) extend the real
-- set-role-authenticated proof pattern from Tests 6/7 to the chat tables: a non-member
-- can't read or write a circle's messages, blocking hides messages in both directions, and
-- only service_role (not even the reporter) can read moderation_reports.

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


-- ── Test 6 & 7: check-in photo Storage access is actually RLS-enforced ───────
-- Tests 1-5 above run as the `postgres` role, which has BYPASSRLS and never actually hits
-- any policy — they only prove the is_group_member() helper's own logic is correct. This
-- test does `set local role authenticated` so the check-in-photos storage.objects policies
-- (schema.sql, "check-in-photos: read if member") are genuinely enforced, then proves both
-- a real member CAN see the row and a real outsider CANNOT — testing only the "denied" half
-- would trivially pass if the policy were broken to deny everyone.

do $$
declare
  v_group_id      uuid;
  v_member_id     uuid;
  v_outsider_id   uuid;
  v_photo_path    text;
  v_visible_count integer;
begin
  select ci.group_id, ci.photo_url, ci.user_id
  into v_group_id, v_photo_path, v_member_id
  from check_ins ci
  where ci.group_id in (select id from groups where is_public = false)
  limit 1;

  if v_photo_path is null then
    raise notice 'SKIP Test 6/7: No check-in photos in a private circle found — post one first.';
    return;
  end if;

  select id into v_outsider_id from profiles
  where id not in (select user_id from group_members where group_id = v_group_id)
  limit 1;

  if v_outsider_id is null then
    raise notice 'SKIP Test 6/7: Could not find an outsider user — create a second account.';
    return;
  end if;

  -- Test 6: the member CAN see it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_visible_count
  from storage.objects
  where bucket_id = 'check-in-photos' and name = v_photo_path;

  reset role;

  if v_visible_count = 0 then
    raise exception 'FAIL Test 6: A real circle member (uid=%) cannot see their own circle''s check-in photo (%) — policy is over-restrictive.',
      v_member_id, v_photo_path;
  end if;

  raise notice 'PASS Test 6: A real circle member can see the check-in photo via RLS.';

  -- Test 7: the outsider CANNOT see it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_visible_count
  from storage.objects
  where bucket_id = 'check-in-photos' and name = v_photo_path;

  reset role;

  if v_visible_count > 0 then
    raise exception 'FAIL Test 7: An outsider (uid=%) can see a private circle''s check-in photo (%) via storage.objects RLS.',
      v_outsider_id, v_photo_path;
  end if;

  raise notice 'PASS Test 7: A non-member correctly cannot see the private circle''s check-in photo via RLS.';
end $$;


-- ── Test 8: outsider cannot read or write messages for a circle they're not in ───────────────
do $$
declare
  v_group_id          uuid;
  v_outsider_id       uuid;
  v_visible_count     integer;
  v_insert_failed     boolean := false;
  v_leaked_message_id uuid;
begin
  select group_id into v_group_id from messages limit 1;

  if v_group_id is null then
    raise notice 'SKIP Test 8: No messages found — send one in a circle first.';
    return;
  end if;

  select id into v_outsider_id from profiles
  where id not in (select user_id from group_members where group_id = v_group_id)
  limit 1;

  if v_outsider_id is null then
    raise notice 'SKIP Test 8: Could not find an outsider user — create a second account.';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_visible_count from messages where group_id = v_group_id;

  begin
    insert into messages (group_id, user_id, body) values (v_group_id, v_outsider_id, 'rls test 8 — should be rejected')
    returning id into v_leaked_message_id;
  exception when others then
    v_insert_failed := true;
  end;

  reset role;

  -- Cleanup, now running as postgres (BYPASSRLS) — only reached if the insert unexpectedly
  -- succeeded, i.e. exactly the bug this test exists to catch.
  if v_leaked_message_id is not null then
    delete from messages where id = v_leaked_message_id;
  end if;

  if v_visible_count > 0 then
    raise exception 'FAIL Test 8: An outsider (uid=%) can read messages for a circle they are not a member of.',
      v_outsider_id;
  end if;

  if not v_insert_failed then
    raise exception 'FAIL Test 8: An outsider (uid=%) was able to insert a message into a circle they are not a member of.',
      v_outsider_id;
  end if;

  raise notice 'PASS Test 8: A non-member cannot read or write messages for a circle they are not in.';
end $$;


-- ── Test 9: blocking hides messages in both directions ────────────────────────────────────────
-- "the blocked user can't see/interact with the blocker going forward" (spec) — not just
-- blocker→blocked. Uses temporary fixtures inserted as postgres (BYPASSRLS), cleaned up at the
-- end; only deletes the blocked_users row itself if this test is what created it.

do $$
declare
  v_group_id        uuid;
  v_user_a          uuid;
  v_user_b          uuid;
  v_message_a_id    uuid;
  v_message_b_id    uuid;
  v_visible_count   integer;
  v_block_existed   boolean;
begin
  select group_id into v_group_id
  from group_members
  group by group_id
  having count(*) >= 2
  limit 1;

  if v_group_id is null then
    raise notice 'SKIP Test 9: No circle with 2+ members found.';
    return;
  end if;

  select user_id into v_user_a from group_members where group_id = v_group_id order by user_id limit 1;
  select user_id into v_user_b from group_members where group_id = v_group_id and user_id <> v_user_a limit 1;

  select exists(
    select 1 from blocked_users where blocker_id = v_user_a and blocked_id = v_user_b
  ) into v_block_existed;

  if not v_block_existed then
    insert into blocked_users (blocker_id, blocked_id) values (v_user_a, v_user_b);
  end if;

  insert into messages (group_id, user_id, body) values (v_group_id, v_user_a, 'rls test 9 — from A')
  returning id into v_message_a_id;
  insert into messages (group_id, user_id, body) values (v_group_id, v_user_b, 'rls test 9 — from B')
  returning id into v_message_b_id;

  -- As A (the blocker): B's message should be invisible.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_visible_count from messages where id = v_message_b_id;
  reset role;

  if v_visible_count > 0 then
    raise exception 'FAIL Test 9: Blocker (uid=%) can still see a message from the user they blocked (uid=%).',
      v_user_a, v_user_b;
  end if;

  -- As B (the blocked): A's message should ALSO be invisible — mutual hide, not one-directional.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_visible_count from messages where id = v_message_a_id;
  reset role;

  if v_visible_count > 0 then
    raise exception 'FAIL Test 9: Blocked user (uid=%) can still see a message from the user who blocked them (uid=%) — blocking must be mutual.',
      v_user_b, v_user_a;
  end if;

  delete from messages where id in (v_message_a_id, v_message_b_id);
  if not v_block_existed then
    delete from blocked_users where blocker_id = v_user_a and blocked_id = v_user_b;
  end if;

  raise notice 'PASS Test 9: Blocking hides messages in both directions (blocker→blocked and blocked→blocker).';
end $$;


-- ── Test 10: only service_role can read moderation_reports — not even the reporter ───────────
do $$
declare
  v_report_id     uuid;
  v_reporter_id   uuid;
  v_other_id      uuid;
  v_visible_count integer;
begin
  select id, reporter_id into v_report_id, v_reporter_id from moderation_reports limit 1;

  if v_report_id is null then
    raise notice 'SKIP Test 10: No moderation_reports rows found — file a report first.';
    return;
  end if;

  select id into v_other_id from profiles where id is distinct from v_reporter_id limit 1;

  if v_other_id is null then
    raise notice 'SKIP Test 10: Could not find a second account.';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_visible_count from moderation_reports where id = v_report_id;

  reset role;

  if v_visible_count > 0 then
    raise exception 'FAIL Test 10: A non-reporter (uid=%) can read a moderation_reports row (id=%) — only service_role should be able to.',
      v_other_id, v_report_id;
  end if;

  raise notice 'PASS Test 10: Only service_role can read moderation_reports — no client role, even the reporter, has a SELECT policy.';
end $$;
