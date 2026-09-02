# Code Prompt — reconcile the prod migration ledger (verify-first), consolidate, commit

Two parallel sessions hand-applied and hand-edited prod `schema_migrations` and now give **conflicting accounts** of it (forge session: `…0138 forge_combine, 0139 forge_outputs_only_unowned`; Agora session: `0137, 0138, 0140, no 0139`). The prod schema and its ledger have almost certainly drifted. **Nobody knows the real state — establish it before touching anything.**

## §0 · FREEZE
- **Do NOT `db push`, do NOT hand-edit `schema_migrations`, do NOT re-run any DDL** until §1–§3 are done. A push right now could silently skip a needed migration or re-run one against a mismatched ledger.
- PITR is **on** (7-day window) — you're recoverable, but verify before acting, don't act to see what happens.
- Everything here is read-only until §3, and §3 uses `supabase migration repair` (ledger-only), never a DDL re-run.

## §1 · Establish ground truth (READ-ONLY)
Query prod directly and report a table. Two independent things per migration: **is the ledger row there**, and **is the object actually applied**.

1. **The ledger:** `select version, name from supabase_migrations.schema_migrations order by version;` — the actual rows, verbatim.
2. **The objects (does the DDL's result exist, with the right body?):**
   - `0136` — the partial unique index `profiles_unique_verified_university_email` exists?
   - `0137` — `get_my_unseen_challenge_rewards()` exists?
   - `0138` — `forge_combine` exists?
   - `0139` — does `forge_combine`'s body contain the **outputs-only-unowned / no-salvage-fallback + `tier_complete`** logic (i.e. the amendment is live), or the pre-amendment version?
   - `0140` — `agora_posts.attachments` column exists? `create_agora_post` overload count + does it have the `p_attachments` param?
   - Pull each function's source (`pg_get_functiondef`) so "applied" means "the right body," not just "a function by that name exists."
3. **Report, per 0136–0140:** ledger row present (Y/N, and under what version number) · object applied with correct body (Y/N) · which branch/worktree holds the file. Flag every mismatch. **Do not fix anything yet — report first.**

## §2 · One unified branch with all five files
Gather the migration files onto a single branch so files, ledger, and prod finally agree:
- `0136` (email unique index), `0137` (unseen challenge rewards) — untracked in the device-smoke tree.
- `0138_forge_combine`, `0139_forge_outputs_only_unowned` — forge branch.
- `0140_agora_multi_attachment` — Agora branch.
Filenames' leading numbers **must match the ledger versions** they'll be repaired to. If two files ever claim the same number, the lower-priority one renumbers to the next free slot — but given the ledger is already `…0140`, the target is a clean `0136,0137,0138,0139,0140`.

## §3 · Reconcile the ledger to reality (ledger-only, no re-runs)
Using the §1 table, for each migration:
- **Object live + ledger row missing/wrong** → `supabase migration repair --status applied <version>` to record it as applied **without running it**. This is the ONLY safe way to fix "the function is deployed but the ledger forgot" — it touches the ledger, not the schema. (This is why the forge session correctly refused `--status reverted` on applied migrations earlier.)
- **Ledger row present + object correct** → leave it.
- **Ledger row present + object MISSING or wrong body** → 🔴 STOP and report to Noah. That means a migration is recorded as applied but its schema effect isn't there (or an amendment didn't land) — do not guess; that's a real divergence needing a human call, possibly a targeted re-apply.
- After: `supabase migration list` must show **local == remote**, every version's name matching its file, no phantom rows and no pending files. Re-verify the object proofs from §1 still hold. **Never `db push` to "apply" a repair** — repair is the whole point precisely so nothing re-runs.

## §4 · Prevent recurrence
This has bitten twice (number collision, then ledger clobber) because two sessions pushed to the same prod DB. From now: **one branch, one push path.** Note this in the branch's README/AGENTS or a short `MIGRATIONS.md` so the next session doesn't `db push` from a sibling worktree.

## §5 · Minor UI fix (safe)
`src/components/agora-card.tsx:208` — `styles.card` has `marginBottom: Spacing.two` but `cardInner` (the equipped-card branch) has none, so plain posts get 24px between them and cosmetic-card authors get 16px. Delete that one `marginBottom` line for a uniform 16px (the feed separator now owns the spacing; only two call sites, both fine). `tsc`/lint should stay clean.

## §6 · Commit (once the lease clears)
The `f77e8afb` git writer lease was still held. **Once it's expired/stale (don't force-clear a live lease)**, commit the uncommitted Agora work + the migration-file consolidation from §2 on the unified branch, in logical chunks, repo-style messages. Confirm nothing is stranded across worktrees (`git status` in each) and `tsc --noEmit` is clean.

## Done =
A single reported table of ledger-vs-reality for 0136–0140; the ledger repaired to match live objects with **no DDL re-run** (or a clear STOP-and-report if an object is genuinely missing); `supabase migration list` clean (local == remote, names aligned); all five migration files on one branch; the card-spacing line removed; everything committed with nothing stranded; and a one-push-path note so this can't recur.
