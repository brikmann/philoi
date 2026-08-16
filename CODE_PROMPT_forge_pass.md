# Code prompt — Forge Pass (Season 1: Emberfall) + Flares + placement rewards

Consolidated handoff. Full detail lives in: **FORGE_PASS_DESLOP.md** (screen) · **FORGE_PASS_SEASON1.md**
(rewards) · **FLARES_SPEC.md** (aura) · mocks **87** (screen), **88** (flares), **89** (all 100 levels).
Most of this ships OTA; the only native dependencies are the $9.99 IAP (RevenueCat) and the Live
Activity pill.

## Copy rule
The Forge Pass uses **"Level"** everywhere (the RANK system keeps "Tier" — never collide the two).

---

## 1 · The Forge Pass screen (de-slop) — mock 87, FORGE_PASS_DESLOP.md — OTA
Tap the Forge Pass icon on Home → this screen.
- **Molten-seam levels track:** a vertical seam lit below your level / cold iron above (the rail IS the
  progress bar). Two lanes: **Free** (left) · **Premium-locked** (right, warm border + 🔒 until owned).
- **Real cosmetic art** per reward tile, pulled by catalog id (same source as the shop, PUNCHLIST_7). No
  stock/emoji icons.
- **States:** claimed (dimmed ✓) · current (pulsing forge node + Claim CTA) · upcoming (cold) ·
  premium-locked (🔒 → upgrade prompt). Tap a tile → reward detail sheet.
- **Mythic milestone** every 25 (25/50/75/100): bigger violet anvil node.
- Header = season name + Level N + molten XP bar + countdown. One gold "$9.99" upgrade strip. One Claim
  CTA. Reskin over existing season-track data (#48) → **OTA**; the $9.99 unlock lights up with RevenueCat.

## 2 · Season 1 "Emberfall" reward data — FORGE_PASS_SEASON1.md, mock 89
- **100 levels, Free + Paid. Every level rewards something** — ember drips on off-levels; named cosmetics
  on multiples of 5; Mythics on 25/50/75/100. **No Streak Shield** (cosmetics only, never streaks/
  standing). **Existing catalog types only** (new art, not new types).
- **Level 0 instant unlock (on purchase):** 🔥 Emberfall Ascendant Flare + "Forge Flame" + 1,000 Embers.
- **Mythic set:** L25 Emberfall Banner · L50 Emberfall Halo + "Emberfall Strike" SFX · L75 Emberfall
  Profile Card · L90 (Legendary) Emberfall Relic · L100 Emberfall Crown medal.
- **Completion titles:** "The Relentless" = finish the FREE track · "Forged in Ember" = finish the PAID
  track.
- **Post-100 prestige loop** (every 5 levels: Free 100 embers · Paid Prestige Cache).
- New catalog entries (art only): Emberfall Ascendant Flare, Banner, Halo, Strike SFX, Profile Card,
  Relic, Crown medal, Forge Flame, + the two titles.

## 3 · Season date gate — HARD
Season 1 = **Emberfall, live Sept 10 → Dec 23 2026** (Laurier + Waterloo Fall term). Store
`{id, starts_at, ends_at}` in `economy_config`; gate **purchase + XP accrual** on the window. Before
Sept 10: not active/purchasable. Dec 23: close → short claim window → unclaimed expire → Season 2.

## 4 · Flares = the app-wide perimeter aura — FLARES_SPEC.md, mock 88
- **No free aura.** A flare = **`FlarePerimeter({ colour, effect })`** overlay mounted at the app ROOT →
  a FAINT glow on EVERY page while a flare is equipped. Per-flare colour + signature effect
  (`effect ∈ smoke·zaps·falling·flames·plasma·glow`), low particle counts.
- Emberfall Ascendant = ember/orange perimeter; Void Smoke = purple+smoke; Zeus' Wrath = white+zaps;
  Stormforge = blue pulse+zaps; Toxic = green falling droplets; Inferno = red+flames; etc.
- In-app overlay is **OTA-capable** (Phase 5 / pull into v1 if time — it's the marquee flare reward). The
  Live Activity pill (#87) tints to the equipped flare's colour for out-of-app coordination (native, v1.1).

## 5 · End-of-season placement rewards — Phase 3b, FORGE_PASS_SEASON1.md
At close (Dec 23), grant EXCLUSIVE, never-reissued rewards by final standing on the season leaderboard
(per university, ranked by season Forge XP): #1 Champion (Mythic + title + medal + 5k embers) · Top 10 ·
Top 1% · Top 10% · Top 50% · reached-L100 "Emberfall Centurion" medal · participation medal.
Emberfall-coded, cosmetics + embers only. Snapshot standings at `ends_at` + a one-time grant job +
Champion share card. Data/JS + a scheduled close job → OTA.

## Ship order
1. **v1 (OTA):** the screen (§1) + Season data (§2) + date gate (§3). $9.99 unlock activates with
   RevenueCat (§/ #71, native).
2. **Flares in-app overlay (§4):** Phase 5, OTA — pull forward into v1 if the schedule allows.
3. **Live Activity pill (#87):** v1.1 (native widget extension).
4. **Placement rewards (§5):** build now, fires as the scheduled close job on Dec 23.

## Decisions — 2 resolved, 1 still open
1. **RESOLVED — trim PAID embers to ~10,000** (tables currently sum to 13,350). Cut the largest named
   ember bonuses (halve the +1k/+1.5k/+2k chunks) + shave late off-level drip; keep paid off-levels > free.
2. **RESOLVED — placement ranks by cumulative SEASON Forge Pass XP** (prestige past L100 counts;
   level-150-overall outranks level-100). SEPARATE board from the global Bronze→Primordial rank
   (universal_score / 0066). Code's season-XP board is correct — keep it.
3. **OPEN — XP-per-level curve** (250→1,450 = 85k) still untuned vs real earn rates; tune post-launch.

## Before you finish
`git add` the mocks + specs; tsc + lint; the season track + placement are DATA + a scheduled job, not
new systems.
