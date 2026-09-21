-- 0197 — one dev pairing is exempt from one-account-per-university-email (0136).
--
-- WHY. 0136 is right for production: a verified campus email belongs to exactly one account. But
-- Noah's only real campus inbox is brik8334@mylaurier.ca, and it is already verified on his main
-- account (@brikmnn), so no test account can ever verify against a real inbox again — every reset
-- leaves the address "taken".
--
-- THE EXEMPTION IS ONE HARDCODED PAIRING, by user id AND address, and nothing else:
--   bebfadf0-a898-4724-991e-62506e451ec8  (spikeythedoge@gmail.com, @brkmnnnn)  ×  brik8334@mylaurier.ca
-- That row may hold the address verified alongside whoever else holds it. It is left out of the
-- index entirely, so it neither blocks anyone nor is blocked. Every other (account, address) is
-- indexed exactly as 0136 indexed it. The exempt account verifying ANY OTHER address is still
-- constrained — the predicate matches the address too, not just the id.
--
-- The edge function (verify_uni_code) carries the same pairing and additionally requires is_dev
-- on the caller. is_dev is deliberately NOT in this predicate: a partial-index predicate that
-- flips with a flag makes a later `is_dev = false` fail with a bare 23505 on an unrelated update.
--
-- DO NOT WIDEN THIS INTO A LIST. A second exemption is a second decision; make it in its own file.

drop index if exists profiles_unique_verified_university_email;

create unique index profiles_unique_verified_university_email
  on profiles (lower(university_email))
  where university_email_verified is true
    and not (
      id = 'bebfadf0-a898-4724-991e-62506e451ec8'::uuid
      and lower(university_email) = 'brik8334@mylaurier.ca'
    );

comment on index profiles_unique_verified_university_email is
  'One Philoi account per verified campus email (0136), minus ONE dev pairing (0197: spikeythedoge@gmail.com × brik8334@mylaurier.ca). verify_uni_code pre-checks for friendly copy; THIS decides the race.';

-- ─────────────────────────────── is_dev on Noah's three accounts ───────────────────────────────
--
-- The verify_uni_code exemption is is_dev-gated, and the exempt account was created without it.
-- Noah asked for all three of his accounts to be dev (2026-09-21):
--   0dafcd2b… noahbrikman@gmail.com     @brikmnn
--   2bb0ff4f… spikeythedoge1@gmail.com  @brkmnn   (already is_dev)
--   bebfadf0… spikeythedoge@gmail.com   @brkmnnnn
-- By id, not email, so this is a no-op on any database where these accounts do not exist.
-- 0196's lock_profile_privilege_flags only refuses anon/authenticated; migrations run as postgres.
update profiles
   set is_dev = true
 where id in (
   '0dafcd2b-8766-4052-83be-59de4a87fd92'::uuid,
   '2bb0ff4f-7292-4ca5-b746-bdfe8528cf0f'::uuid,
   'bebfadf0-a898-4724-991e-62506e451ec8'::uuid
 )
   and is_dev is not true;

-- ────────────────────────────────────────── assertions ──────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'profiles_unique_verified_university_email'
       and indexdef ilike '%bebfadf0-a898-4724-991e-62506e451ec8%'
       and indexdef ilike '%brik8334@mylaurier.ca%'
  ) then
    raise exception '0197: the narrowed uniqueness index is not in place';
  end if;
end;
$$;
