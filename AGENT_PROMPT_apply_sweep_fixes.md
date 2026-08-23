# Agent task — apply the reviewed app-sweep bugfixes

Runs **after** the diagnostic pass (`AGENT_PROMPT_bugfix_sweep.md`) and **after Noah's review**. The diagnostic
agent worked on branch `fix/app-sweep` and wrote `APP_BUG_LEDGER.md` with a `[ ] approve` box per bug. Finalize
**only the approved fixes**.

## Inputs
- `APP_BUG_LEDGER.md` — numbered ledger. **Only `[x] approve` entries are in scope.** Discard the rest.
- Noah's inline notes on an entry **override** the original proposed fix — follow them.
- The `fix/app-sweep` branch with the diagnostic agent's work-in-progress diffs.

## What to do
1. **Read the ledger first** and list back: approved, rejected, and any override notes — make scope explicit
   before touching code.
2. Each **approved** entry: keep/clean the matching diff, or **redo it Noah's way** if his notes changed the
   approach. One focused commit per bug, message referencing the ledger number.
3. Each **rejected** entry: **revert** its changes so nothing unapproved ships; confirm the revert didn't break
   an approved fix that depended on it (flag if it did).
4. Reconcile shared files multiple entries touched.

## Guardrails
- 🔴 **Stay out of the campfire/challenge/watch surface** — owned by the campfire apply agent. If an approved
  entry needs a change there, **flag it for that agent** instead of editing (prevents branch collision).
- Don't weaken RLS / `auth.uid()` scoping; reward math server-authoritative; honor firewalls (grades/milestones
  = 0 XP, Cindy grants nothing, AI custom goal free).
- Migrations forward-only. **Do not run** `db push` / `functions deploy` / `eas build` — list them deploy-gated.

## Verify
- `npx tsc --noEmit` + lint clean (known ~25 React-Compiler warnings excepted); app boots.
- Re-walk each approved bug's repro and confirm it's resolved; before/after screenshots for visual fixes.

## Deliver
- Updated `APP_BUG_LEDGER.md`: approved entries marked **DONE** + final commit hash; rejected marked
  **reverted**.
- Branch ready to merge (state it's green), files + new migrations, and the **deploy-gated** steps for Noah.
