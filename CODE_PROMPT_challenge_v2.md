# Code Prompt — Challenge v2: land the gated work, then build the gaps

Two phases, in order. **Phase A** gets the finished-but-uncommitted lifecycle live (the yellow in mock 169). **Phase B** builds the four v2 gaps (the red). Reference `CAMPFIRE_BUG_LEDGER.md` (the diagnosis + the exact deploy steps) and mock 169 (the flow) throughout. **Stop and report** at any branch conflict or migration-number collision rather than forcing it.

**Out of scope — do NOT build here:** Cindy-authored challenges and vouching (mocks 140–150). That's a separate layer on top of Create; it is not part of this flow.

🔒 **Reward firewall (unchanged):** the result screen reads what `grant_reward` already paid. Never re-derive a reward figure client-side.

---

## PHASE A · Turn the yellow green (commit + deploy)

The whole campfire/challenge pass is **written, tsc-clean, uncommitted on `add-marketing-site`**, tangled with other agents' work in the shared tree (see the ledger's *Process deviation*). Get it committed and the migrations deployed.

1. **Isolate + commit** the challenge/campfire files only (the ledger's *Files changed* list) — do not sweep in the flame/Cindy/icon work sitting in the same tree. If the git-writer lease is held, wait or ask; don't clear it.
2. **Deploy the migrations in order:** `0112 → 0113 → 0114 → 0115 → 0116`. **0116 must go after 0114** (it captures `grant_reward`'s return; before 0114, `grant_reward` raises 42883 and every reveal shows placement + XP with no rewards). 0113–0115 live on `fix/app-sweep`, so **both branches must be merged before the push.**
   - ⚠️ **Re-verify 0116 is still the next free migration number** at integration — 0113–0115 were claimed on the other branch; two migrations sharing a leading version roll back silently.
3. **Verify** with the ledger's sanity queries: roster == field denominator; every racer on a post-0114 settlement carries a reward payload; the first cron tick after `FOR UPDATE` produces exactly one `bonus_xp_awards` row per racer.
4. **Smoke the reveal:** settle a duel and a group race → winner and a non-winner each see the reward reveal **once**, then standings on re-open; the `challenge_won` push deep-links to it.

Result: mock 169's yellow boxes (reward reveal, the deploy-gated spine) are now live.

---

## PHASE B · Build the four red gaps

### B1 · Custom durations (mostly UI)
- **File:** `src/app/challenge/create.tsx` (`DURATION_OPTIONS` ~line 61).
- **Now:** only `24h / 3d / 1w`. `starts_on` / `ends_on` already exist and `start_challenge` already honours them.
- **Build:** add **1 day / 1 week / 1 month** presets **and a custom date picker** (start → end). Validate end > start, cap the max span. Send `starts_on`/`ends_on` on create. No new migration — the server path exists.

### B2 · Group public-name field (pure UI)
- **File:** `create.tsx` group branch (the public-name input currently renders only in the h2h branch, ~line 315).
- **Now:** a group challenge always sends a null `public_name`, even though every surface *reads* it (ledger item 15).
- **Build:** render the same public-name input in group mode and send it. One-line-of-plumbing change; no backend.

### B3 · Placement / ranked shape (UI + backend)
- **Reference:** mock 114. The `shape` column + `'placement'` type already exist; **nothing creates or settles one.**
- **Build:**
  - **Create:** add Placement as a third shape (alongside h2h/group), with its own create path — a ranked race over N invitees where finish = rank, not win/lose.
  - **Settle:** teach settlement to rank the field (1st..Nth) for `shape = 'placement'` and pay per placement band (reuse `placementTier()` / the percentile logic already feeding standings). Route through `challenge_field` like the other shapes.
  - **Standings/info:** `challenge-info` already branches on `shape` — add the placement branch (podium / ranked list, not a 1v1 VS or a collective house-hero).
  - New migration if settlement needs a ranked arm; keep it on the `challenge_field` denominator.

### B4 · Wire the box "Open" from the result (needs a challenge→box link)
- **Now:** the reward box lands in inventory, but `ChallengeRewardScreen`'s `onOpenBox` is undefined because `grant_reward`'s insert records **no challenge reference**, so `/shop/open` (which needs a `loot_boxes` row **id**) can't recover *which* box was this challenge's (ledger item 3, last bullet).
- **Build (recommended):** a small migration so `grant_reward` records `challenge_id` (or returns the new `loot_boxes.id`) on the box it mints; capture that id into `reward_payload`; then wire `onOpenBox` → `/shop/open` with that id. **Flag the alternative** (latest-unopened-box-of-that-key heuristic) if you'd rather avoid the migration — but the id link is clean and unambiguous.

---

## Order & guardrails
- **Phase A before B** — building on an undeployed spine wastes the verification.
- **B2 → B1 → B4 → B3** by ascending effort (public-name is one line; placement is the real build).
- Every settlement path stays on `challenge_field` (one definition of "who is in this race"). Don't reintroduce a `group_members` denominator.
- Report: what committed + which migrations deployed (and their final numbers), the three sanity-query results, and which red gaps landed vs flagged.
