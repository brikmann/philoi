# Deploy runbook — ship the migration batch (0062–0069)

**Why:** the whole batch is coded but unshipped (and untracked in git). One push closes four bugs:
uni-verification email (0062), study/gym challenge sync (0068), box-open "expected JSON array" (0069),
inventory rarity/season fields (0067).

---

## Step 0 — commit first (Code, no credentials needed)
The migrations are untracked (`git status` shows `??`). Commit them so they can't be lost:
```
git add supabase/migrations/ supabase/functions/
git commit -m "economy + challenge + uni-verify migrations (0062–0069) + edge functions"
```

## Step 1 — link the project (needs your Supabase access token)
No `supabase/config.toml` exists yet, so the repo isn't linked.
```
# get an access token: Supabase dashboard → Account → Access Tokens → generate
export SUPABASE_ACCESS_TOKEN=<paste>
supabase link --project-ref coaqgcquzywadrghzbfj      # confirm this ref matches your dashboard URL
```

## Step 2 — see what's actually pending (read-only, safe)
```
supabase migration list        # shows Local vs Remote — the unshipped ones have no remote timestamp
```

## Step 3 — push (needs the DB password)
```
supabase db push               # applies every pending migration in order; prompts for DB password
```
The batch is safe to re-run if any were already applied: tables use `create table if not exists` and
functions use `drop if exists` + `create` / `create or replace`.

## Step 4 — deploy the edge functions (uni verification)
Migrations don't cover the Edge Functions:
```
supabase functions deploy send_uni_code
supabase functions deploy verify_uni_code
```

## Step 5 — verify (in the Supabase SQL editor)
```sql
-- all four should return one row:
select proname from pg_proc where proname in
  ('open_loot_box','sync_challenge_from_lock_ins','get_inventory');
-- open_loot_box must be the jsonb overload:
select proname, pg_get_function_arguments(oid) from pg_proc where proname = 'open_loot_box';
--   expect: p_box_id uuid, p_pool jsonb   (NOT text[])
```
Then on-device: open a box (should roll cleanly), and sync a study/gym challenge.

---

## Fallback if the CLI isn't available
Run each migration's SQL by hand in **Supabase dashboard → SQL Editor**, in filename order
0062 → 0069, then paste the two edge-function bodies via `supabase functions deploy` from anywhere
with the CLI. Downside: the migration-history table won't record them, so a later `db push` may report
them as pending again (harmless given the idempotent guards, but noisy). The CLI push is cleaner.
