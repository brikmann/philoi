# Agent task — apply the reviewed campfire bugfixes

Runs **after** the diagnostic pass (`AGENT_PROMPT_bugfix_campfire.md`) and **after Noah's review**. The
diagnostic agent worked on branch `fix/campfire-pass` and wrote `CAMPFIRE_BUG_LEDGER.md` with a `[ ] approve`
box per bug. Your job: finalize **only the approved fixes**, cleanly, and get the branch ship-ready.

## Status — ALL 22 items approved (Noah, this pass)
Every campfire ledger item is approved. Items 1–2 and 4–20 are **already applied + committed** on
`fix/campfire-pass` (`53dc9c5`) — keep them. #10 is a verified no-op. #21 (pre-existing lint) and #22 (campfire
flame glyph, step 1's file) stay untouched. **Nothing to revert.**

🔴 **The one net-new build: item #3** — `ChallengeRewardScreen` + `ChallengeWinShareCard` were diagnosed
*not fixed*. Build them now per **`DECISION_reward_screen_and_goal_drip.md` (#3)**: fire-once on first settled
view (new `challenge_participants.reward_seen_at` + forward-only migration), new `get_challenge_reward` RPC
reading the real `grant_reward` payload, share reachable from standings. Then the branch is ready to integrate.
(Item #6 — goal-picker chips — is on the **sweep** ledger, not here.)

## Inputs
- `CAMPFIRE_BUG_LEDGER.md` — the numbered ledger. **Only entries Noah checked `[x] approve` are in scope.**
  Ignore/discard the rest.
- Noah may have added notes on an entry ("fix is wrong, do X instead", "also handle Y"). **His notes override
  the original proposed fix** — follow them.
- The `fix/campfire-pass` branch with the diagnostic agent's work-in-progress diffs.

## What to do
1. **Read the ledger first.** List back which entries are approved (`[x]`), which are rejected (`[ ]` or struck),
   and any notes — so the scope is explicit before you touch code.
2. For each **approved** entry:
   - If the diagnostic agent's diff matches the approved intent (and Noah's notes) → keep/clean it up.
   - If Noah's notes changed the approach → **redo the fix** his way.
   - One focused commit per bug, message referencing the ledger number (e.g. `campfire #3: unclip VS card avatars`).
3. For each **rejected** entry → **revert** the diagnostic agent's changes for it so nothing unapproved rides
   along. Verify the revert didn't break an approved fix that depended on it (flag if it did).
4. Reconcile shared files (e.g. `challenge-card.tsx`, `campfire-header.tsx`, `use-challenge-watch.ts`) that
   multiple entries touched — make sure reverting a rejected item didn't strand an approved one.

## Guardrails (unchanged)
- **Don't weaken RLS / `auth.uid()` scoping;** reward math stays server-authoritative; honor economy firewalls
  (grades/milestones = 0 XP, Cindy grants nothing, AI custom goal free).
- Migrations forward-only — new number, never edit an applied one.
- **Do not run** `supabase db push` / `functions deploy` / `eas build` — list those as deploy-gated for Noah.
- Match mocks 110–114 for anything visual.
- If bug #1 (campfire flame glyph) is approved and `AGENT_PROMPT_global_flame_icon.md` is also in flight, they
  both touch the flame components — coordinate so they don't conflict; flag any overlap rather than guessing.

## Verify before you hand back
- `npx tsc --noEmit` clean; lint clean (known ~25 React-Compiler warnings excepted).
- App boots; walk the full challenge loop (create → invite/accept → active → settle → reward → share) and the
  watch + campfire-interior screens — confirm each approved fix actually resolves its bug on device/simulator.
- Before/after screenshots for every visual fix.

## Deliver
- Updated `CAMPFIRE_BUG_LEDGER.md`: each approved entry marked **DONE** with the final commit hash; rejected
  entries marked **reverted**.
- The branch ready to merge (state it's green), the list of files + new migrations, and the **deploy-gated**
  steps Noah still needs to run.
