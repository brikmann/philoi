# Philoi build sequence — Logic first, then UI
_The order to build in. Phase 1 is all backend/logic/data. Phase 2 is all UI, each item placed after the logic it renders. Nothing in Phase 2 should start before its Phase-1 dependency ships. Grounded in the actual tree (migrations to 0118). See LOGIC_SCOPE_BEFORE_UI.md for the built-vs-spec detail._

Legend: ✅ shipped · ✍️ spec only, needs build · 🔧 drafted, not shipped · 🐛 bug/blocker

---

# PHASE 1 — LOGIC (backend, data, migrations)

### 1.1 · Ship the drafted logic batch → migrations 0119+ 🔧
The reward/relic/rank surfaces render these states, so they come first.
1. **Relic progress feeder** — steps→km + feed every discipline ladder (`0119`). *Relics are earned today but nothing feeds progress.*
2. **`session_complete` push** — Strava-style session-done notification (`0120`).
3. **Rank-up reward grant** — embers + box on division/tier up (`0121`; `rank_up_events` already recorded, grant missing).
4. **H2H tie** — verify draw pays both across group shapes, not just 1v1 (`0122`).
5. **Verify Forge-Pass ember grant + home surfacing** actually fires (`0124`).

### 1.2 · Clear logic blockers 🐛
No point building UI on broken flows.
6. Deploy `0069` — box opens throw "expected JSON array" (loot-box open broken).
7. Fix ×10 vault crash at results screen.
8. Fix gym lock-in → purple splash freeze.
9. Flip `FITNESS_SYNC_ENABLED=true` — Strava stuck on "coming soon".

### 1.3 · Economy correctness (config/logic) 🔧
10. Rescale salvage values (~10× down) + reduce Flame Pass ember faucet + grade-reward calibration — per GRADE_REWARD_SPEC / economy notes. Config-level; do before the shop/inventory UI so numbers are final.

### 1.4 · New social & feature backends ✍️ (build order = lightest first / dependency order)
11. **The Agora backend** — `agora_posts` + `agora_comments`; feed query over milestones + posts at friends/campus/public. *Substrate (milestones 0093 + cheers + can_see_milestone) already shipped — smallest lift.*
12. **DMs / Ping backend** — 1:1 message tables (today `messages` is campfire-scoped) + Ping types. *"Ping" is currently just the challenge friend-picker.*
13. **Vouching / wagered rewards backend** — `challenge_vouches`, collusion caps, ember stake/wager settlement.
14. **Forge crafting backend** — `forge_cosmetic()` / `stoke_reroll()` (salvage exists; the craft-up sink doesn't).
15. **Cindy challenge-authoring governance** — metric taxonomy, `lockin_types`, roles, bidirectional proposals (Cindy *coach* is built; *authoring* is spec-only).
16. **Grade rewards + Class Goal Tracker / Grade Calculator** — honor/vouch verification, course-code modifiers.

### 1.5 · XP integrity 🔧
17. Effort multiplier on session XP (ipsative + anti-cheese) + active-session detection.

### 1.6 · Launch-track (parallel, not blocking UI)
- Uni verification deploy (Resend domain/secret/test) · RevenueCat native build (IAP) · Family Controls entitlement on App ID + 3 extensions · getphiloi.com retirement (#137).

---

# PHASE 2 — UI (each after its Phase-1 dependency)

### 2.1 · Navigation shell (foundation — everything hangs off it)
1. **Single side-drawer nav** + custom vector icon set, inactive grey → active orange (mocks 157–161). Groups: Play · Social · Rewards · Settings. **Forge and Settings are both main-menu items.** The Forge has no stash of its own — it **pulls from your Inventory**.

### 2.2 · Cosmetics land in-app  ‹dep: 1.2, 1.3›
2. Flames / flares / SFX / audio / cards / banners / halos render from the equipped loadout (mocks 118–160). EmberIcon component + swap 🔥 currency everywhere.

### 2.3 · Reward & economy UI  ‹dep: 1.1, 1.2, 1.3›
3. Loot-box open polish (×5 open, remove telegraph), inventory rarity sort + condense boxes, real purchase toast + inventory refetch, Buy Direct weekly rotation + countdown, reward-reveal / fly-to-account animations (mocks 131/136/137).

### 2.4 · Home & Profile  ‹dep: 1.1 relics/rank›
4. Home: remove "recent lock-ins", let flame + pass space breathe, trim top space during a lock-in. Profile: full lock-in history view, Forge-Pass achievements on home.

### 2.5 · Campfire & Challenge UI  ‹dep: 1.1, 1.4 vouching/cindy›
5. Campfire visual redesign lands, SocialChallengeCard matches mocks, completed challenges clickable + history folder, rework goal/challenge-setup ("Track this automatically?") UI (mocks 112–114, 140–150).

### 2.6 · Settings  ‹dep: 1.1 push›
6. Notification toggles (per-type, matching the push events), general cleanup, in-app Feedback & Contact form.

### 2.7 · The Agora UI  ‹dep: 1.4 #11›
7. Feed screen + Friends/Laurier/Waterloo/All filters + composer + cheer/comment + auto-surfaced milestone cards (mocks 160, 162). Menu entry already scoped (161).

### 2.8 · Leaderboard 2.0  ‹dep: 1.1 rank›
8. Leaderboard 2.0 + friend profile + search + Watch surface.

### 2.9 · Messaging UI  ‹dep: 1.4 #12›
9. DMs + Ping (types + composer destinations), message button on friend profile (mocks 151–153).

### 2.10 · Remaining feature UIs  ‹dep: their backends 1.4 #13–16›
10. Vouching flow (141–142) · Forge crafting (155–156) · Cindy authoring (143–150) · Grade tracker / calculator.

### 2.11 · Live surfaces
11. Live session notification (persistent + tappable) · Live Activity lock-in pill (lock screen + Dynamic Island).

---

## The short version
**Logic:** ship the drafted 0119+ batch → clear the 🐛 blockers → finalize economy numbers → build the new backends Agora → DMs → vouching → Forge → Cindy-authoring → grades → XP integrity.
**UI:** nav shell → cosmetics → reward/economy → home/profile → campfire/challenge → settings → **Agora** → leaderboard → messaging → remaining features → live surfaces.
**First concrete step:** turn the drafted 0119–0122 into real migrations and deploy them.
