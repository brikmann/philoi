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
