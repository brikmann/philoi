# One branch, one push path

Prod has exactly one migration ledger. Two Claude sessions pushing to it from
sibling worktrees have corrupted that ledger twice:

1. **Number collision.** Two branches both claimed the next free number. The
   duplicate version silently rolled back, and the CLI blamed the
   `schema_migrations` INSERT rather than the collision.
2. **Ledger clobber.** `0139_forge_outputs_only_unowned` ran against prod — the
   amendment is live in `forge_combine`'s body — but its ledger row went
   missing. The ledger read `0136,0137,0138,0140`. Two sessions then gave
   flatly contradictory accounts of prod, because one had read the ledger and
   the other had read the schema, and neither had read both.

## The rule

**Migrations are written on feature branches and pushed from ONE branch only.**

- Do **not** run `supabase db push` from a sibling worktree. Copy the `.sql`
  onto the push branch and push from there.
- Claim your version number by creating the file on the push branch *first*.
  A number is taken the moment the file exists, not when it is applied.
- Before pushing, `supabase migration list --linked` must show `local == remote`
  with no phantom rows. If it doesn't, stop — reconcile before adding to the pile.

## Appending a parameter is not a replacement

`create or replace function` replaces a function only when the argument types
are identical. Postgres keys a function on its signature, so **adding a
parameter — even one with a default — defines a SECOND function and leaves the
original standing.** The migration succeeds, the new body is live, and the old
one is still there underneath it.

This has now bitten three times. In 0145 it reached prod: the three
`create_*_challenge` RPCs each gained `p_grade_target`/`p_course_code` and each
ended up with two overloads. Because both defaulted everything past the third
parameter, a pre-0145 argument set satisfied *both*, and Postgres refused to
choose — `42725 ... is not unique`. Challenge creation was broken for every
install older than the client change, and OTA could not reach them. 0146 fixed
it by dropping the stale signatures.

When you change a function's parameters or return type:

- **Drop the old signature explicitly, in the same migration**, with its full
  argument type list: `drop function if exists f(uuid, text, integer);`
  A bare `drop function f()` will not find an overload.
- **Check what defaults the survivor has.** Dropping the stale signature cures
  the ambiguity, but if the survivor doesn't default the new parameters, an
  old-shape call flips from "is not unique" to "does not exist" — the same
  break wearing a different error. Required-argument count is
  `pronargs - pronargdefaults`; it must still admit every existing caller.
- **Count the overloads afterwards.** One name, one row in `pg_proc`, unless
  you deliberately meant otherwise:
  `select proname, count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' group by 1 having count(*) > 1;`
- **Re-grant nothing you didn't lose.** Grants live per signature. Check the
  survivor's ACL rather than reflexively re-issuing grants.

`EXPLAIN select f(...)` is the cheap test for all of this: it parses and plans
without executing, so ambiguity and no-such-function both surface without the
function ever running.

## Assertions must be reachable

A migration that ships a `do $assert$` block is only as good as the path that
block takes. 0146's first push failed *inside its own assertion* — it called the
text form of `has_function_privilege`, whose signature argument is types only,
and built the string from `pg_get_function_identity_arguments`, which includes
parameter names. The pre-flight had run the block against the pre-migration
state, where the first guard raises immediately, so the broken line was never
reached.

Dry-run the whole migration against the state it will actually meet:

```bash
m=supabase/migrations/NNNN_whatever.sql
{ echo "begin;"; cat "$m"; echo; echo "rollback;"; } > /tmp/dryrun.sql
npx supabase db query --linked -f /tmp/dryrun.sql
```

Wrap it from the shell — `\i` is a psql meta-command and does nothing through
the Management API that `db query --linked` speaks. This runs every statement in
order against real prod state, exercises the branches a pre-flight cannot reach,
and leaves nothing behind. **Confirm the rollback took** — re-check the thing the
migration would have changed — before concluding anything from a clean run.

## When the ledger and the schema disagree

Establish ground truth before touching anything. They are two independent
questions and you must ask both:

- **Is the ledger row there?**
  `select version, name from supabase_migrations.schema_migrations order by version;`
- **Is the object actually applied, with the right body?**
  `pg_get_functiondef` / `prosrc`, `pg_indexes.indexdef`,
  `information_schema.columns`. "A function by that name exists" is not proof —
  an amendment migration can be missing while its base is present. Diff the live
  `prosrc` against the file, and run any self-assertions the migration ships with.

Then, per migration:

| State | Action |
|---|---|
| Object live, ledger row missing/wrong | `supabase migration repair --status applied <version>` — ledger-only, runs no DDL |
| Ledger row present, object correct | Leave it |
| Ledger row present, object **missing or wrong body** | 🔴 STOP and ask a human. Something is recorded as applied but its schema effect isn't there |

**Never `db push` to "apply" a repair.** Repair exists precisely so that nothing
re-runs. Re-running DDL against a mismatched ledger is how the damage compounds.

Confirm the fix touched only the ledger: `md5(prosrc)` of the affected functions
must be **unchanged** across the repair.

PITR is on (7-day window), so you are recoverable — but verify before acting;
don't act to see what happens.
