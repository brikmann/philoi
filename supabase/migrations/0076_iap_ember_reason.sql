-- Adds 'iap' to the ember_reason enum, and does NOTHING else.
--
-- This is its own migration for a hard Postgres reason, not for tidiness: a value added by
-- ALTER TYPE ... ADD VALUE cannot be USED until the transaction that added it commits. `supabase db
-- push` runs each migration file in its own transaction, so splitting the add (here) from the first
-- use (0077) is what makes both work. Putting them together produces
-- "unsafe use of new value 'iap' of enum type ember_reason" and the whole push rolls back.
--
-- Why a new reason rather than reusing one: the ember ledger is append-only and exists for
-- auditability and anti-fraud (0064 §1). Real money entering the economy has to be
-- distinguishable from an earned stipend or a season payout at a glance — "how many embers were
-- BOUGHT this month" should not require joining back to a receipts table to answer.

alter type ember_reason add value if not exists 'iap';
