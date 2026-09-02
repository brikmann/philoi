# Code Prompt — reward-loop sign-off: dedup, apply, cleanup, commit, balance, goal-day gap

Closes out the five-section reward/email batch (built, uncommitted on `worktree-device-smoke`). Five items: three ops (with Noah in the loop where destructive), one verification, one code gap. Do them in this order — commit (§4) only after the rest lands cleanly.

---

## 1 · Dedup + apply migrations 0136 + 0137 to prod

Migration `0136` (unique verified-email index) refuses to apply because prod has one duplicate: `brik8334@mylaurier.ca` verified on three profiles, **all Noah's own** — `@brikmnn` (2026-07-25, 87 sessions), `@brkmnn` (07-28, 78), `@brkmnnnnnn` (08-29, 1). No third-party account is affected.

- **Keep the earliest/real account** `@brikmnn`; **unverify the other two** (`university_email_verified = false`, `university_email = null` on `@brkmnn` and `@brkmnnnnnn`). Run this as the explicit dedup statement 0136's error prints — do not blanket-null everyone.
- **Backup posture first (PITR is off):** report the age of the latest daily snapshot to Noah before touching prod, and get his explicit go. Then a rollback-wrapped dry-run against prod schema (the integrator's pattern), then apply.
- Push **0136 + 0137 together**. `0137` (`get_my_unseen_challenge_rewards()`) is additive.
- **Verify after:** the same campus email can't verify a second account (returns the `email_taken` 409); the unique index exists; a legit fresh verification still succeeds.

---

## 2 · One-time cleanup of Noah's OWN inflated ladders (his accounts only)

The forward-only fix (§4 of the prior prompt) stops *new* backfill inflation but leaves existing `user_step_days` + `relic_progress` intact, so Noah's test accounts still show the instant-unlocked distance relic. Give him a clean forward-only start **on his accounts only**:

- Scope strictly to Noah's handles (`@brikmnn` / `@brkmnn` / `@brkmnnnnnn` — confirm with him which account he's testing the relic on). **Never touch any other user's ladders** — that was the explicit constraint.
- For those user ids: delete their `user_step_days` rows (or those dated before their connect day), reset/delete their `relic_progress`, then re-run `economy_evaluate_relics()` for them so the ladders rebuild from the forward-only data.
- This is destructive and per-account — confirm the target handle with Noah before running.

---

## 3 · Confirm the balance-refresh surface

The wallet-refresh pub/sub refreshes every mounted `EmberPill` — but **home has no ember pill** (pills are on Shop, Inventory, Flame Pass, box/item detail). Noah reported the balance "not updating" after a goal completion, so confirm what he was actually looking at:

- Trace where a goal/lock-in completion lands the user and what balance element is visible there. If the **payout/reveal screen** (goal-streak-reward-screen / the burst moment) shows an embers figure, make sure *that* reads the new balance, not a stale prop.
- If the completion surface genuinely has no balance element, the reveal itself should display the awarded amount **and** the new total, so the user sees the change even without a pill.
- Verify on-device: finish a goal → the reveal shows the award, and any pill surface opened right after shows the updated balance with no reload.

---

## 4 · Clear the git lease and commit

Nothing is committed — another Claude session (`f77e8afb`) holds the git writer lease; the work sits uncommitted on `worktree-device-smoke`.

- **Only once Noah confirms that session is done/dead**, clear the lease and commit.
- **Reconcile with the directly-applied device-smoke fixes** so none are lost — these were edited straight into the tree outside this batch: the root `SafeAreaProvider` drawer-crash fix (`_layout.tsx`), the Cindy tap-ring fix (`cindy-flame-press.tsx`), and the rank-projection off-by-one (`rank-projection-bar.tsx` + `live-activity-sync.tsx`). Make sure the commit includes them (or rebases cleanly onto whatever branch carries them) — check `git status`/`git diff` across the worktrees before committing so nothing is stranded.
- Commit in logical chunks (email/§1, reward-reveal/§2, height/§3, backfill/§4, watcher/§5, plus the direct fixes), messages in the repo's style.

---

## 5 · 🐛 Fix the goal-day payout gap (pre-existing, #167)

Found underneath §2 of the prior batch: `economy_award_goal_day` is **only ever called from `logChallengeProgress`** (the manual-log path). Goals completed by `sync_challenge_from_lock_ins` or the Strava Edge Function **never bank a goal-day payout at all** — a whole class of completion silently pays nothing.

- Route those completion paths through `economy_award_goal_day` (or the shared award the manual path uses) so a goal met via lock-in-sync or a Strava activity banks the same goal-day embers.
- **Server-authoritative and idempotent** — `economy_award_goal_day` already banks once per local day; make sure wiring it into a second path can't double-award for the same goal-day (manual + sync on the same day must pay once). Additive migration if it's SQL-side; restate nothing (wave rule, prove `prosrc` removes nothing).
- Feed the payout into the same reveal queue (`goal-reveal-queue.ts`) the manual/auto-sync path now uses, so these completions also celebrate.
- **Verify:** complete a goal via a synced lock-in (and, if testable, a Strava activity) → embers bank exactly once and the reveal fires.

---

## Guardrails
- §1 and §2 are destructive prod changes — snapshot-age report + Noah's explicit go before each (PITR off).
- §4 waits on Noah confirming the other session is dead; do not force-clear a live lease.
- §5 migration additive-only; no double-award.

## Done =
Dedup applied and 0136+0137 live (same email → one account); Noah's own ladders reset to a clean forward-only start; the post-completion balance/reveal reflects the award on-device; the batch (plus the direct fixes) is committed with nothing stranded; and goals completed by sync/Strava bank their goal-day payout exactly once and celebrate.
