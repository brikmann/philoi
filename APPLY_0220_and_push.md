# RUNBOOK — apply 0220 + push integration-wave1 (Noah's steps; prod is yours)

`0220_a_pass_holders_name_burns.sql` is committed on `integration-wave1` but NOT applied to prod, so today only your
own name burns — everyone else renders plain until this lands. Per MIGRATIONS.md, **apply the migration and push the
branch together.** You already dry-ran it clean (rolled-back txn: both checks passed, returned the one current pass
holder). Ledger discipline below — no bare `db push`, never hand-edit `schema_migrations`.

Project ref: `coaqgcquzywadrghzbfj` · branch `integration-wave1`.

## 1 · Take the writer lease + confirm the ledger is clean
```powershell
npx supabase migration list --linked
```
Expect: `0219` shows applied on **both** Local and Remote; `0220` shows **Local only** (blank Remote). If anything
below 0220 is missing on Remote, stop — apply in order, oldest first. (If another session holds the writer lease, wait
for it; don't force.)

## 2 · Apply 0220 to prod (single file, then record it — not `db push`)
```powershell
npx supabase db query --linked -f supabase/migrations/0220_a_pass_holders_name_burns.sql
npx supabase migration repair --status applied 0220 --linked
```
The `db query -f` runs the file's SQL on prod; the `repair` records 0220 as applied in the ledger **without** touching
`schema_migrations` by hand.

## 3 · Verify it took
```powershell
npx supabase migration list --linked
```
`0220` now shows applied on **both** Local and Remote. Then sanity-check the function returns the current holder — call
the batched pass-holder function with your own uuid (and a non-holder's) and confirm it flags only the holder. If it
returns the one pass holder and errors on nothing, it's live.

## 4 · Push the branch (your action — my push is classifier-blocked)
```powershell
git push origin integration-wave1
```
Push AFTER the apply succeeds, so the ledger and the remote branch move together (MIGRATIONS.md rule). Don't
`git add -A` — everything's already committed in your six narrow commits; this is just the push.

## If step 2 errors
The dry-run passed in a rolled-back txn, so a failure here is almost certainly a **lease/permission** or a **duplicate
object** (0220 partly applied earlier). Do NOT re-run blindly. Re-check `migration list`; if the function already
exists on Remote, skip `db query` and go straight to `migration repair --status applied 0220`. Paste me the error and
I'll read it.

## After this
- Build 7 (native — the burning-name Inter 900 font can't OTA) carries the funnel client code.
- SealBadge (permanent flex) is the fast-follow: `CODE_PROMPT_seal_badge.md` — OTA-safe, migration (0221) deferred
  until someone actually reaches L100.
