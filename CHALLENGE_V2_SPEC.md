# Challenge system v2 — richer create + photos + AI goals + post-challenge

Extends the challenge redesign. Pre-challenge (create), intra-challenge (photos/share), post-challenge
(rewards). Mock **113**. Builds on CHALLENGE_REDESIGN_SPEC, CAMPFIRE_REDESIGN_SPEC, CHALLENGE_REWARD_ALGO,
PROFILE_SPEC §G (milestones).

## 1 · Create — richer setup (mock 113 §1, placement in mock 114)

### Three challenge shapes
- **Duel** — 1v1.
- **Collective goal** — whole house passes together (pass/fail; everyone earns).
- **Placement (ranked)** — **everyone competes, everyone gets a rank** (#7 of 48), settled by **percentile**.
  For a whole campfire / **class** over a long window (a semester). The class case: a **prof/admin** in a
  course campfire (the "For a class?" toggle) sets "Most lock-in time for the semester" and the whole class is
  auto-entered and races for placement. **Scope scales the reward** (6-person campfire < 48-person class <
  uni/season) using the **existing percentile bands** (Top 1/5/10/25/50) from `CHALLENGE_REWARD_ALGO` /
  `REWARD_ECONOMY` — it's that engine, scoped to a class over a custom span. Effort metric (time/volume/
  distance), never grades. Ties → first-to-reach then most lock-in.
  - **Placement can also rank on the ✨ AI custom goal** (premium) — the whole class competes on an AI-parsed
    metric with checkpoints/proof, ranked by it. Same percentile settlement.

### Metrics (races) — consolidated
Drop the XP/time redundancy: **XP correlates with lock-in time**, so don't offer both. The race options:
- **⏱ Lock-in time** (the universal effort metric — study/read/work/meditate/general)
- **🏋 Volume** (gym — total weight lifted, from fitness sync)
- **🏃 Distance** (run — from fitness sync)
- **✨ Custom goal (AI)** — premium (below)

### Public name
A challenge has a **user-set public name** ("Morning grind", "BU111 grade"). Shown on the card, watch, and
share. Distinct from the metric.

### Member ticker (invite a subset)
Currently it's all-or-nothing. Add a **member multi-select** — pick specific campfire members (search +
toggle), not the whole house. Selected members get an **invite notification → accept**, then **admin starts**
the challenge (ties to Phase-2 lifecycle/admin roles). Non-selected members aren't in it.

### Custom time + calendar
- Quick presets: **1 day · 1 week · 1 month** (presets auto-adjust the D/M/Y unit).
- **Custom → a calendar picker** for arbitrary start + end (whole **semester**, a month, three months).
  Store explicit start/end timestamps; the race window = that span.

### ✨ AI custom goal (FREE — utility, not flex)
- User types a fuzzy goal ("First to reach a 225 lb bench press"). **Sonnet parses it** into a trackable
  definition: **metric · source (synced data or self-log + photo proof) · win condition · checkpoints**. User
  can edit any parsed line before confirming.
- Makes ambiguous personal goals trackable. Where live tracking isn't possible, AI schedules **self-report /
  photo-proof checkpoints**.
- 🔓 **FREE for everyone.** It feeds the competitive loop (XP/embers/placement), so **paywalling it would be
  pay-to-win**, which "pay to flex" exists to prevent. Flame Pass stays cosmetics; this is utility.
- **Cost control = a uniform rate limit** (a sensible cap on AI parses per user, same for everyone — do NOT
  tie the cap to Flame Pass, that reintroduces pay-to-win).
- Needs the AI backend (server-side Sonnet call to parse the goal → structured challenge config; do NOT trust
  the client to define what "winning" means).

### Public name + self-reported outcome (milestone tie)
Some goals can't be tracked live — e.g. **a course grade** ("BU111 grade"). Handle it:
- The **race metric defaults to ⏱ lock-in time** (you compete on the *effort*).
- The **outcome is a self-reported milestone** announced at the end (the grade), tied to PROFILE_SPEC §G.
- 🔒 **Firewalled:** the grade earns **no XP/embers/rank** — only the effort race pays out. The grade is a flex,
  not currency.

## 2 · During the race — photos + share (mock 113 §2)

### Challenge photos & clips
- When someone posts a **lock-in that's tied to a challenge**, nudge: **"Post a photo or clip?"** → attach a
  **photo or a short video (≤30s)** (gym PRs especially want a clip).
- Media appears in the **watch feed** (and challenge feed) — photos inline, **videos with a play control** —
  each **cheerable**. Feeds the social/cheer metric; makes a challenge a battle worth watching.
- Optional; skippable. Stored per challenge-participant post. (Video: transcode/compress, cap length + size.)
- **Video thumbnail is public-facing** — auto-generate a **poster frame** and show it as the preview
  everywhere the post appears (watch feed, challenge feed, share), with a play control over it, so people see
  the clip before tapping. Same visibility as the challenge itself (visible to its participants/watchers).

### Watch share card
- A **story/share card** from the watch: the challenge name + the **live race snapshot** (your meter vs
  theirs) + **"Come cheer us on"** + a **watch deep link** (`philoi.app/w/{code}`). Lets people pull friends
  in to spectate/cheer ("hey guys, cheer on my friend").

## 3 · Post-challenge — results + rewards (mock 113 §3)
Fire when the window closes. Apply **CHALLENGE_REWARD_ALGO** (server-side, idempotent). Three result shapes:
- **Duel win** — winner arc: Winner XP (effort-scaled, capped) + small embers + rarity box; loser → rematch,
  **no penalty**. (mock 47 lineage.)
- **Group goal complete** — whole-house win: **everyone earns** embers + a shared **badge**; member avatars.
- **Named / milestone challenge** — effort reward for the lock-in-time race + an **optional "announce your
  result" → post a milestone** (self-reported grade, firewalled, no XP).
- **Placement (ranked)** (mock 114) — your **rank + percentile band** (#5 of 48 · Top 10%) → scaled reward
  (embers + rarity box + a **class-stamped badge**, e.g. "BU111 · Top 10%"). Podium for the top 3. Bigger pool
  = hotter reward.
All results **shareable** (share card).

## Small fixes (applied)
- Removed the "she's 3,200 lb behind" cheer-compose subtext (obvious).
- **CTAs sit above the bottom safe area** — Send challenge · Light campfire · Share invite · Save changes ·
  Submit report · Send cheer are lifted off the very bottom edge (add bottom padding above the home indicator).

## Open decisions
- [x] **AI custom goal gating** — **FREE** for everyone, uniform rate limit (not tied to payment). Paywalling
      = pay-to-win. (Decided.)
- [ ] Metric set final = Lock-in time / Volume / Distance / AI custom (XP dropped as a race) — OK?

## Acceptance
- [ ] Create: public name · metrics (time/volume/distance/AI) · member ticker (subset invite→accept→admin
      start) · duration presets + calendar (custom spans).
- [ ] AI custom goal parses server-side into metric/source/win/checkpoints; premium-gated.
- [ ] Named challenge races on lock-in time + ties a self-reported milestone (grade), firewalled.
- [ ] Challenge-tied lock-ins nudge a photo; photos show in watch + are cheerable.
- [ ] Watch share card generates with the live race + watch link.
- [ ] Post-challenge fires the right result (duel/group/named) with algorithm-applied rewards; all shareable.
