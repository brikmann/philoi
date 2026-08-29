-- 0136 — one campus email verifies one account, enforced by the database.
--
-- 🔴 THE HOLE. verify_uni_code's success path is a bare
--     update profiles set university_email = ..., university_email_verified = true where id = auth.uid()
-- with no uniqueness check anywhere, and 0062 (which added both columns) added no constraint. So
-- one working @school.ca inbox verifies an UNLIMITED number of Philoi accounts: send yourself a
-- code, enter it, sign out, sign in as someone else, enter the same address, verified again. Every
-- campus board, every university leaderboard and every "only students with a real @domain get in"
-- claim in the verify copy rests on a check that was never made.
--
-- DEFENCE IN DEPTH, and this file is the authoritative half. The Edge Function gains a pre-check in
-- the same pass, but a pre-check is a read followed by a write and therefore a race: two devices
-- verifying the same address inside the same second both read "not taken" and both write. Only a
-- unique index decides that race, which is why the constraint is the thing that has to exist and
-- the pre-check is only there to turn a 23505 into friendly copy most of the time.
--
-- WHY PARTIAL, AND WHY lower(). Partial on `university_email_verified is true` because an
-- UNVERIFIED university_email is just a string somebody typed — two people can both have typed the
-- same one, and neither has proven anything, so constraining that would reject honest input for no
-- integrity gain. lower() because the column is not citext: verify_uni_code lowercases before
-- writing (index.ts line 25), but 0062 never forced it and nothing stops a future writer or a
-- manual fix from storing mixed case, at which point Brik8334@ and brik8334@ would be two rows.
-- The index is on the folded value so case can never be the crack it slips through.

-- ─────────────────────────── preflight: refuse to run over live duplicates ───────────────────────────
--
-- The bug has been live, so production may already hold profiles that share a verified address —
-- and it does (see below). `create unique index` would fail on them anyway, with a bare
-- "could not create unique index ... Key (lower(university_email))=(...) is duplicated", which
-- names one email and tells whoever is running `db push` nothing about what to do next.
--
-- 🔴 THIS MIGRATION DELIBERATELY DOES NOT AUTO-RESOLVE. Un-verifying somebody is a real loss —
-- it locks them out of both campus boards — and picking a winner by created_at is a guess dressed
-- up as a rule. Noah decides who keeps it; this raises with the list and the exact statement.
--
-- As of 2026-08-29 there is exactly ONE duplicate group in production, and all three profiles are
-- Noah's own test accounts on brik8334@mylaurier.ca:
--   0dafcd2b… @brikmnn    created 2026-07-25   87 sessions   ← oldest, the obvious keeper
--   2bb0ff4f… @brkmnn     created 2026-07-28   78 sessions
--   8ea039f5… @brkmnnnnnn created 2026-08-29    1 session
-- No third-party account is affected. The keep-the-earliest resolution is spelled out in the
-- raise's hint and has to be run — and agreed — before this file will apply.
do $$
declare
  v_dups text;
  v_groups int;
begin
  select count(*), string_agg(t.email || ' (' || t.n || ' accounts)', ', ' order by t.n desc)
    into v_groups, v_dups
  from (
    select lower(university_email) as email, count(*) as n
    from profiles
    where university_email_verified is true
      and university_email is not null
    group by lower(university_email)
    having count(*) > 1
  ) t;

  if v_groups > 0 then
    raise exception
      'Cannot enforce one-account-per-university-email: % address(es) are verified on more than one profile: %',
      v_groups, v_dups
    using hint =
      'Decide who keeps each address BEFORE re-running. To keep the earliest-created profile and '
      'un-verify the rest: with ranked as (select id, row_number() over (partition by lower(university_email) order by created_at) rn from profiles where university_email_verified is true and university_email is not null) update profiles p set university_email_verified = false from ranked r where r.id = p.id and r.rn > 1; '
      '-- this only clears the FLAG; university_email is left in place so the address is still on the row for support.';
  end if;
end;
$$;

-- ────────────────────────────────── the constraint ──────────────────────────────────
--
-- `if not exists` so a re-run after a partial push is a no-op rather than a duplicate-name error.
-- Not `concurrently`: that cannot run inside the transaction a migration executes in, and profiles
-- is small enough that the brief write lock is not worth splitting this across two deploys.
create unique index if not exists profiles_unique_verified_university_email
  on profiles (lower(university_email))
  where university_email_verified is true;

comment on index profiles_unique_verified_university_email is
  'One Philoi account per verified campus email (0136). verify_uni_code pre-checks for friendly copy; THIS is what actually decides the race between two simultaneous verifications.';
