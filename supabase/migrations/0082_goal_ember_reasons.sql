-- New ember_ledger reasons for the personal-goal payout path (handoff §B).
--
-- ALONE IN ITS OWN MIGRATION ON PURPOSE. `alter type ... add value` may run inside a transaction
-- on PG 12+, but the new label cannot be USED by a statement in that same transaction — you get
-- "unsafe use of new value of enum type". supabase db push runs each migration file in its own
-- transaction, so splitting the labels out here is what lets 0083 reference them freely. Same
-- shape 0076 used when it added 'iap'.
--
-- Two reasons rather than one shared 'goal' because the weekly ceiling in 0083 is derived by
-- summing the ledger, and the drip and the milestone need to be countable together but
-- distinguishable in a user's ember history ("Daily goal" vs "7-day streak").
alter type ember_reason add value if not exists 'goal_daily';
alter type ember_reason add value if not exists 'goal_streak';
