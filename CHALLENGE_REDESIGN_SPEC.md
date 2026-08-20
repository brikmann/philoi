# Challenge system — redesign + algorithm spec

Global-nav review (Aug 20). Challenge *creation* is done; this covers the **bugs**, the **actual challenge
algorithm**, and the **viewing redesign**. Answers to "do we have X in stock" up top.

## 0. Already in stock (reuse, don't rebuild)
- **Won/Lost/Redemption XP arc → YES.** `design-mocks/47-challenge-reward.html` (result screen: burst + placement
  + headline + standings strip + reward rows) + **`CHALLENGE_REWARD_COPY.md`** (full outcome copy: Rank 1/2/3 +
  percentile pools; 1v1-duel winner *and* loser with close-loss "rematch" tone). **Built as design, never wired.**
- **Success screens → partially.** Mock 47 = won-challenge + campfire placement; `flame-meter-complete` = daily
  goal; mock 48 = end-of-season settlement. The screens exist; they just need to **fire on the right events**.
- Other existing mocks: 12 (challenges tab), 36 (challenge hero), 37 (active marker), 44/45 (watch), 46 (pick
  members), 98 (challenges empty/create redesign).

## A. Bugs (Code)
1. **Sign-in replays the rank-up animation.** Re-authenticating fires the rank-up celebration. Cause: the rank-up
   trigger compares the loaded rank against an empty/default baseline on session restore, reads it as a jump.
   **Gate it to only fire on a live rank increase during a session — never on login / initial hydrate.**
2. **Leaderboard #1 crown is an emoji (👑).** Replace with a **native vector crown** (SVG, on-brand gold) — no emoji.
3. 🔴 **Self / personal goals (e.g. steps) are broken.** Two bugs: (a) icon is a raw **shoe emoji**, not a vector/
   ember icon; (b) progress isn't **tracked** (stuck 0 / 10,000, 0%) and completion **rewards nothing**. Wire the
   goal to its data source (Health steps / lock-in time) + credit progress + grant the reward on completion.
   (Depends on the algo, §B.) Also: "Resets at midnight **UTC**" should be **user-local midnight**.
4. **Watch screen:** bare/poor header, and **Cheer is unlimited-click** (went 7 → 0, no cap). Give it the ember
   header treatment, and **rate-limit cheer** (one per user per challenge, or a cooldown) with an authoritative count.

## B. Challenge algorithm (the "actual algo")
**Types & metrics**
- **1v1 duel** (friend) — metric = **Most XP** or **Most lock-in time**, window 24h / 3d / 1wk.
- **Group** (friends, ≤ N) — same metrics, many players.
- **Personal goal** — a target (10,000 steps/day, X h locked in), **auto-tracked** (Health / lock-in) or manual.
- **Campfire challenge** — whole-campfire, **percentile** placement.

**Tracking**
- On start, snapshot the player's baseline metric; accrue the **delta** over the window from the source of truth
  (XP from `check_ins`, lock-in time from sessions, steps from Health). Store `challenge_progress` per participant.
- Personal daily goals reset at **user-local midnight**; progress = today's source value vs target.

**Resolution (at window end)**
- Compare accrued metric; highest wins. **Ties** → tiebreak (first to reach the value, then most lock-in time).
- **Placement tier** per `CHALLENGE_REWARD_COPY.md`: 1v1 → Rank 1 / Rank 2; group ≤8 → Rank 1/2/3 then percentile;
  campfire / uni / season → percentile (Top 1→5→10→25→50→<50), absolute podium overrides if literally top-3.

**Rewards (per `REWARD_ECONOMY.md`, granted server-side, idempotent)**
- **Winner** → the staked XP ("Winner +200 XP", scales with effort, capped for fairness) + placement reward
  (embers / box / badge by tier).
- **Loser / lower placement** → consolation (rematch-tone copy, small or zero XP — no punishment).
- **Personal daily goal** → daily reward (embers / XP) on hitting the target.
- **Campfire placement** → percentile reward on settlement.
- **Anti-cheese:** effort-capped; a challenge can't be farmed for unbounded XP.

**Events that must fire a result/success screen** (wire mock 47 / flame-meter-complete):
- duel/group resolved → **result arc** (win or loss, mock 47 + copy).
- personal daily goal hit → **success** (flame-meter-complete style).
- campfire challenge settled → **placement** result (mock 47 percentile).

## C. Viewing redesign (mocks)
1. **Challenges tab = two tabs: `Personal` | `Friends`.**
   - **Friends:** active duels/group challenges (the VS card, redesigned) + incoming invites (accept/decline).
   - **Personal:** personal goals with real progress (steps, hours) — vector icons, live bars, reward on the row.
2. **Redesigned active-challenge (VS) card — MINIMAL.** Avatars, the **XP-lead bar**, the lead line, time left.
   **No reward/XP text on the card** (drop "Winner +200 XP", "+50 embers on complete", etc.). Tap → Challenge info.
6. **NEW: Challenge info screen.** All the rules + rewards live here, not on the card — type, metric, duration,
   **winner reward**, tiebreak, campfire-watching, and (for personal goals) target · source · reset · reward-on-
   complete. Keeps the browse surface clean; the details are one tap away. (See mock 102 v2.)
3. **Accepted challenge on Home** — when one's active it should be a **proper card that supersedes the daily fire**,
   not the tiny "vs … · 3d left" chip it is now.
4. **Result arc** — wire **mock 47** on win/loss/placement using `CHALLENGE_REWARD_COPY`.
5. **Watch screen** — ember header + capped cheer + (completed → read-only "final" state, per CHALLENGE_UI_SPEC §58).

**New mocks to build:** (1) challenges tab with Personal/Friends tabs + redesigned VS card + personal-goal rows,
(2) the Home "active challenge" card, (3) the refreshed Watch screen. **Reuse mock 47** for the result arc.
