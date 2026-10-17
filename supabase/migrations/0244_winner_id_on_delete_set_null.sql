-- HOTFIX: account deletion fails in production.
--
-- Symptom (reported live, and the same error that blocked demo-data cleanup):
--   update or delete on table "profiles" violates foreign key constraint
--   "social_challenges_winner_id_fkey" on table "social_challenges"
--
-- Root cause: social_challenges.winner_id references profiles(id) with NO on-delete action
-- (schema.sql ~2494 / migration 0019). Every other FK to profiles cascades or sets null; this one
-- RESTRICTs. So delete_my_account() -> `delete from profiles` is blocked for any user who has WON a
-- social challenge. The App Store reviewer never won a challenge, so deletion passed review but
-- breaks for real winners.
--
-- Fix: make the FK ON DELETE SET NULL. When a winner deletes their account, the challenge keeps its
-- history with winner_id nulled (the correct semantics — the winner is gone). This is the only
-- non-cascading FK to profiles, so it fully unblocks delete_my_account() and the cleanup paths.
--
-- Safe + additive: changes only delete behavior, touches no existing data, cannot break the live
-- app. Idempotent (drop-if-exists then add), so it is safe to run via the migration tooling even if
-- the same ALTER was applied by hand as an emergency hotfix first.
--
-- LEDGER DISCIPLINE: verify the current max applied migration + the schema_migrations ledger in PROD
-- before applying; number sequentially; never hand-edit the ledger.

alter table public.social_challenges
  drop constraint if exists social_challenges_winner_id_fkey;

alter table public.social_challenges
  add constraint social_challenges_winner_id_fkey
  foreign key (winner_id) references public.profiles (id) on delete set null;
