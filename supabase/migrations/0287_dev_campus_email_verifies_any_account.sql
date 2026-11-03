-- 0287 — brik8334@mylaurier.ca may be verified on ANY number of accounts (widens 0197).
--
-- WHY. 0197 exempted one (account × address) pairing, so every other test account Noah makes still
-- hits "This school email is already linked to another Philoi account." He has one real campus inbox
-- and needs to verify as many test accounts against it as he likes, for now (2026-10-27).
--
-- THE EXEMPTION IS NOW THE ADDRESS, not the pairing: rows holding brik8334@mylaurier.ca are left out
-- of the unique index entirely. Every other address is indexed exactly as 0136 indexed it.
-- verify_uni_code carries the same address and skips its pre-check for it.
--
-- TO REVERT: restore 0197's index (and its edge-function pairing) in a new file. Note that by then
-- several rows may hold this address verified, so the 0136 form would fail to build until they are
-- cleared.

drop index if exists profiles_unique_verified_university_email;

create unique index profiles_unique_verified_university_email
  on profiles (lower(university_email))
  where university_email_verified is true
    and lower(university_email) <> 'brik8334@mylaurier.ca';

comment on index profiles_unique_verified_university_email is
  'One Philoi account per verified campus email (0136), minus ONE dev address (0287: brik8334@mylaurier.ca, any account). verify_uni_code pre-checks for friendly copy; THIS decides the race.';

-- ────────────────────────────────────────── assertions ──────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'profiles_unique_verified_university_email'
       and indexdef ilike '%brik8334@mylaurier.ca%'
       and indexdef not ilike '%bebfadf0%'
  ) then
    raise exception '0287: the address-wide exemption index is not in place';
  end if;
end;
$$;
