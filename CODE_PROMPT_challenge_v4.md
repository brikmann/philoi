# Code Prompt — Challenge v4 (settlement doesn't record/pay/reveal, stale status, one-time goals, dupes, UI)

From Noah's on-device run (two videos). On `integration-wave1`; §1/§4b/§5 touch migrations (additive, one push path, report snapshot age), rest client/OTA. Report broken-vs-working per item.

## §1 · 🔴🔴 A finished duel records NO standings → no payout, no reveal
The head-to-head "Test" challenge (Most lock-in time) **ended and the feed says "You won · You beat Noah Brikman"** — but the challenge-info screen reads **"No standings were recorded for this one,"** no reward reveal (rays + embers + box) fired, and it's unclear XP/embers were paid. Root cause chain: **settlement isn't writing the winner/standings**, so `grant_reward` never runs, so the settlement watcher has nothing to reveal.
- **Trace the finalize path** for a head-to-head / most-lock-in-time race (the `finalize_social_challenges` cron + the settlement functions, 0122/0127-era — same area as the earlier inverted-winner bug). A finished duel must **record placement + winner_id + standings**, then **pay the winner** (embers + box + the "Winner takes +200 XP").
- Once standings are recorded, confirm the **`ChallengeSettlementWatcher`** picks it up and **fires the reward reveal** (full-screen rays + the actual embers/box) — the challenge dopamine loop. Verify on device: win a duel → it pays → the reveal fires.
- **Report what was actually missing** (settlement not writing standings? grant not firing? watcher not seeing it?) — this has regressed before, so pin the exact layer.

## §2 · 🔴 Stale "ending soon" status on finished challenges
On **Watch** (`src/app/watch/[challengeId].tsx`) and **Challenge info** (`src/app/challenge-info/[challengeId].tsx`), a challenge that has clearly ENDED ("Final · this challenge has ended") still shows **"Most lock-in time · ending soon"** and **"Duration 72h · ending soon."** Fix the status derivation: a challenge past its end / settled reads **"Ended" / "You won" / "Final"**, never "ending soon." The header, the Duration row, and the metric line must all reflect the finished state. (Also seen: one challenge's info = "That challenge isn't available any more." — make an expired/settled challenge open to its result, not a dead end.)

## §3 · Show the rewards on the Challenge screen + History (not just the big animation)
After you win, the reward reveal is the *only* place the rewards appear. On the **main Challenges screen History** and the **finished challenge card / challenge-info**, surface **what you earned** — embers + box + XP — as part of the result, so it's a durable record, not a one-time animation. (Depends on §1 recording standings first.) Every settled challenge should read its verdict + its rewards.

## §4 · Personal goals: duplicates + wrong-unit copy
- **§4a · Wrong-unit label.** In the Personal list, **"Cold plunges" shows "0 / 1 bath"** — it inherited the wrong unit. Each goal's progress must use **its own metric/unit** (pushups, plunges, steps…), not a stray "bath". Fix the label/unit binding in the goal card (`(tabs)/challenges.tsx`).
- **§4c · 🔴 Delete/archive isn't reachable on the goal cards.** Noah: "you can't delete a challenge." The logic all EXISTS — `deleteChallenge` (`lib/api/challenges.ts`) → the `delete_challenge` RPC (0112); `ChallengeCard` already receives `onDeleted` in the Personal list (`challenges.tsx:254`); social challenges have "Delete challenge" in `challenge-manage-sheet.tsx`; goals have "Archive goal" in `goal-card.tsx`. The bug is **the affordance isn't surfaced/obvious on the daily-goal cards**, so there's no visible way to fire it. **Make delete/archive reachable + obvious on every personal goal/challenge card** — a visible per-card action (a ⋯/settings menu, swipe-to-delete, or a small delete/archive control on the card) that calls the existing delete/archive path. This is how Noah removes the duplicate dailies in §4b. Confirm it works end-to-end (tap → confirm → row gone).
- **§4b · Multiple copies of daily goals.** The Personal tab shows a pile of near-duplicate dailies. Enforce the dedup from `CODE_PROMPT_challenge_v3.md` §B — **one active goal per (user, metric, cadence)** — and collapse/block the duplicates (especially auto-tracked ones that share one data source). Report which were true duplicates vs distinct.

## §5 · Add a "one-time" goal cadence (not just Daily / Weekly)
On the goal/challenge create screen (`src/app/challenge/create.tsx`, the "How often" selector), you can only pick **Daily or Weekly** — every goal is forced to recur. Add a **"Once" / "One-time"** option: a single non-recurring target that **does not reset** at midnight/Sunday and completes permanently when hit. Needs the create UI option + the goal model/cadence (a non-resetting type) + the progress/reset logic to skip it.

## §6 · Challenge UI cleanup (after the above)
Once settlement/status/rewards are correct, tidy the challenge surfaces: consistent finished-result card (verdict + rewards + rematch), correct tense/status copy everywhere ("won"/"ended", never "ending soon" on a finished one), and the standings actually shown. Reference `CODE_PROMPT_challenge.md` §4 + mocks 98/148. Keep the good bits (vs-avatars, two-colour bar, "You lead by X" on live cards).

## §7 · Seed a live TEST duel so Noah can watch the reward fire
After §1 is fixed, create a **real one-time head-to-head duel** on prod that will settle with a clear winner, so Noah can verify the victory reward reveal (rays + embers + box + XP) fires end-to-end. **Do NOT fake the reveal — let the real settlement + grant_reward + watcher path produce it; that's the whole point of the test.**

**The duel (a custom-count race Cindy recognizes — matches the custom-challenge spec, mock 140):**
- **Metric:** a **custom count** — **push-ups** (manually logged, so the outcome is deterministic and not dependent on device sync).
- **Cindy phrasing** (what makes it a valid custom challenge under our specs): *"Challenge @brkmnn to a push-up duel — most push-ups logged wins."*
- **Name:** "Push-up Duel" (or let the metric name it).
- **Participants:** creator/winner = **Noah's main, @brikmnn**; opponent = **the alt, spikeythedoge1 / @brkmnn**. Both auto-enrolled/accepted (per R5 — creator is a participant).
- **Type:** Duel / head-to-head, **Most push-ups** (higher count wins).
- **Winner takes:** the standard duel reward — **embers + a box + +200 XP** — so the full reveal has all three to show.
- **Duration / settle time:** **ends ~20–30 minutes from when you deploy it** (aim for the next :45 or :00 that's comfortably in the future — today is Sept 2; if 3:45pm has passed by the time §1 is built, pick the next round time and tell Noah the exact settle time). Short, one-time window.

**Force @brikmnn to win, honestly:** seed the two participants' logged counts so **@brikmnn leads** at settle — e.g. **@brikmnn = 25 push-ups logged, @brkmnn = 8** (just write the participants' logged progress; do not touch `winner_id`/standings — let `finalize_social_challenges` compute the winner from the counts, so the test actually exercises §1's fixed settlement).

**Verification checklist (what Noah should see when it settles):**
1. At the settle time, the duel finalizes and **records standings** (winner = @brikmnn) — no "No standings recorded."
2. **@brikmnn is paid**: embers + box + +200 XP land in the ledger.
3. The **reward reveal fires** on @brikmnn's device: full-screen rays + the embers + the box (openable) — the challenge dopamine loop.
4. The Watch/challenge-info screen reads **"Ended / You won"**, not "ending soon."
5. The **History** entry shows the earned rewards (§3).

Report the challenge id + the exact settle time so Noah can be watching @brikmnn's device when it fires.

## Guardrails + Done
- §1 is the priority 🔴 — a won challenge must record standings, pay (embers+box+XP), and fire the reveal. §2 stale status, §3 rewards-in-history, §4 dupes+unit, §5 one-time cadence, §6 cleanup.
- Migrations additive (§1 settlement, §4b dedup, §5 cadence) — report snapshot age before any prod push; restate nothing.
- Reference: Noah's two recordings (finished duel with "No standings recorded" + "ending soon" on the ended Watch screen; Personal tab with duplicate dailies + "Cold plunges → 0/1 bath").
