# Code handoff — Campfire + Challenges (consolidated)

One pass across the campfire section and the challenge system. Build **Phase 1 (visual) first** — it's the
"stop it looking vibe-coded" win and is low-risk — then the logic/features. Everything here is student-side
**B2C**; the prof/B2B2C layer is explicitly **deferred to S2** (calendar) and **not in scope**.

**⚠ Coordination (READ FIRST):** clear any stuck `.git/index.lock` and commit the outstanding tree before you
build. One writer per branch; don't edit the mocks/specs — flag disagreements in chat.

**Source of truth**
- `CAMPFIRE_REDESIGN_SPEC.md` — campfire visual (Phase 1) + logic (Phase 2)
- `CHALLENGE_V2_SPEC.md` — challenge v2 (metrics, member ticker, custom time, public name/milestone, AI goal,
  photos/video, watch share card, post-challenge results, placement)
- `CHALLENGE_REDESIGN_SPEC.md` · `CHALLENGE_REWARD_ALGO.md` · `REWARD_ECONOMY.md` — challenge lifecycle + reward engine
- `NOTIFICATIONS_SPEC.md` — cheer push, campfire events · `PROFILE_SPEC.md §G` — milestones (grade tie)
- Mocks: **110** (campfire main) · **111** (watch/report/cheer) · **112** (every campfire screen) ·
  **113** (challenge v2) · **114** (placement)

---

## PHASE 1 — Campfire visual (build first) — `CAMPFIRE_REDESIGN_SPEC.md` §Phase 1, mocks 110/111/112
- **Header** cohesive ember rebuild: banner art lands as bg · heat flame (coal-bed states) · **kill the blue
  gear** · **Lock-in → top-right pill** · **hamburger → options sheet**.
- **Feed** full-screen swipe · crisp ember cards (drop old bold-orange) · redesigned round text field + ember
  send · chat docked bottom.
- **Challenges tab** — group goal renders as a goal, duel as VS (no mixing). **Manage via ⋯ kebab (not trash)**,
  includes **Delete challenge**.
- **Watch** (mock 111): per-person metric meters, leader crowned, real name/avatar; **cheer count under each**.
- **Report** (mock 111): ember restyle, CSAE kept.
- **Screens map:** mock 112 shows every screen (edit/invite/join/join-requests/create/delete confirm) — bring
  them all to the ember language; delete confirms use the **ember dialog** (not the OS gray alert).
- **Bugs / fixes:**
  - 🔴 **Join requests SQL "column reference \"id\" is ambiguous"** — qualify the column.
  - 🔴 **Watch SQL "status is ambiguous"** — qualify (already in PUNCHLIST_22).
  - 🔗 **Domain → `philoi.app`** on invite + join link + deep link; **drop the raw URL line**.
  - **CTAs sit above the bottom safe area** (send/save/share/submit/cheer not flush to the edge).

## PHASE 2 — Challenge logic — `CAMPFIRE_REDESIGN_SPEC.md` §Phase 2 + `CHALLENGE_REDESIGN_SPEC.md`
- 🔴 **Lifecycle** — challenges must **not auto-start**: created → pending/invited → accepted → live → settled.
- 🔴 **Admin roles** (owner/admin vs member): only admins edit/delete campfire + challenges, approve joins,
  **start** challenges.
- 🔴 **Type mismatch** — fix model→render so a group goal never renders as a 1v1 VS.
- **"You vs Opponent"** → bind the real participant (name + avatar).
- **Watch push actually fires** (currently in-app only) — PUNCHLIST_22 P0 #3.
- **Reward arc wired** — settle → placement → reward (mocks 47/103 + `CHALLENGE_REWARD_ALGO`), server-side + idempotent.

## CHALLENGE V2 — features — `CHALLENGE_V2_SPEC.md`, mocks 113/114
- **Three shapes:** Duel · Collective goal · **Placement (ranked, percentile)** (mock 114).
- **Metrics:** Lock-in time · Volume · Distance · **✨ AI custom goal** (dropped XP as redundant with time).
- **Member ticker** — invite a subset → they accept → admin starts.
- **Custom time** — 1d/1w/1mo presets + **calendar** for arbitrary spans (semester).
- **Public name** + **milestone tie** — named challenge (e.g. "BU111 grade") races on lock-in time; the grade
  is a **self-reported milestone** (PROFILE_SPEC §G), 🔒 **firewalled — no XP for the grade**.
- **✨ AI custom goal (FREE, rate-limited)** — 🔴 **server-side Sonnet** parses a fuzzy goal → structured config
  (metric · source · win · checkpoints); **never let the client define "winning."** **Free for everyone** (it
  feeds the competitive loop → paywall = pay-to-win); cost via a **uniform rate limit**, not Flame Pass.
- **Photos / videos** — challenge-tied lock-in nudges "post a photo or clip (≤30s)"; media shows in the watch
  feed, **video thumbnail (poster frame) is the public preview** + play control; each is **cheerable**.
- **Watch share card** — story card of the live race + watch deep link ("come cheer us on").
- **Post-challenge results** — duel win / collective complete / named-milestone / **placement** (rank +
  percentile band → scaled reward: embers + box + class-stamped badge). All shareable.

## Cheer + report wiring — `CAMPFIRE_REDESIGN_SPEC.md` §Watch/§Report, `NOTIFICATIONS_SPEC.md`
- **Cheer:** capped (one/person/challenge) + authoritative · optional **note composer** · fires
  **"🔥 {name} cheered you on{: note}"** push+bell (cheerer avatar, taps to challenge).
- **Report:** on submit **emails the admin** — "{reporter} reported {campfire} for {reason}" (via Resend);
  CSAE escalated.

## Deferred — NOT in scope
- **Prof / B2B2C** (class dashboards, reward hooks, consent) → **S2**, gated on Laurier IT (calendar).
- **"Cindy" AI assistant** → backlog (`IDEA_CINDY_ASSISTANT.md`).

## Open decisions (confirm before those bits)
- [x] AI custom-goal gating: **free + uniform rate limit** (decided — no paywall; paywalling = pay-to-win).
- [ ] Metric set final = time / volume / distance / AI (XP dropped as a race).
- [ ] Challenge earn-tuning numbers land from `CHALLENGE_REWARD_ALGO`.

## Acceptance
Per-area acceptance lives in each spec (`CAMPFIRE_REDESIGN_SPEC` Phase-1 list, `CHALLENGE_V2_SPEC` acceptance,
`CHALLENGE_REDESIGN_SPEC` A–D). Ship Phase 1 first and verify on device; then Phase 2 + v2.
