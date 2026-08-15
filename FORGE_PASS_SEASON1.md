# Forge Pass — Season 1: Emberfall (v1-ready spec)

Full schematic: `design-mocks/89-forge-pass-100.html` (renders all 100 levels + the Level-0 unlock and
prestige loop). This is the balanced, v1-shippable version of Noah's roadmap with the six fixes applied.

## Season window — HARD date gate
**Season 1 is live only Sept 10 → Dec 23, 2026** (Laurier + Waterloo Fall term).
- Before Sept 10: the pass is **not active / not purchasable**; no Forge XP accrues to it.
- Dec 23: season **closes** — the level track freezes, a short claim window follows, then unclaimed
  rewards expire and Season 2 begins. Mythic season-exclusives never re-issue (that's their value).
- Store the window in `economy_config` (season = {id, starts_at, ends_at}); gate purchase + XP on it.

## The six fixes (vs the raw roadmap)
1. **Streak Shield removed.** It's pay-for-standing and breaks the "cosmetics only — never streaks,
   rank, or standing" promise. Gone.
2. **Every level rewards something.** Off-levels (non-multiples of 5) give an ember drip so 1→2→3
   always pops. Named cosmetics on the 5s, Mythics on 25/50/75/100.
3. **Existing cosmetic types only.** Everything maps to types already in the catalog (flame, flare,
   particle, title, banner, card, halo, audio, sfx, box, embers, medal). Net-new types (app icon,
   animated avatar frame, focus-timer skin, 3D trophy, haptic profile, leaderboard-colour, etc.) are
   **deferred to Season 2** — too much new art+engineering for the Aug-20 v1.
4. **Auras = flares.** L25 and L75 "plasma aura" rewards are **Mythic Flares** (FLARES_SPEC) — app-wide
   while equipped, in-app only. Flares are the marquee premium unlocks.
5. **Ember budget set deliberately** (below) so the pass doesn't nuke shop scarcity.
6. **XP curve defined** (below).

## XP curve (needs one playtest tune)
- Per-level XP ramps ~**250** (early) → ~**1,500** (late); **≈ 85,000 XP** to hit Level 100.
- Forge XP earns from lock-ins (study/workout minutes), completing challenges, and daily activity —
  NOT from buying anything.
- **Design target:** a daily-engaged student (~1 focused hour/day + challenges) reaches ~100 by Dec 23;
  casual ≈ 40–60; heavy users hit 100 early → prestige loop. Tune the constants against real lock-in
  XP rates before locking the season.

## Ember budget (reconcile with final box prices)
- **Free track ≈ 3,300 embers** + boxes + a couple cosmetics + the Apex title.
- **Paid track ≈ 10,000 embers** + a stack of boxes + every listed cosmetic + 4 Mythics.
- ⚠️ Sanity-check against box direct-buy prices: if a box ≈ 1,200 embers, 10k ≈ 8 boxes of value. Decide
  whether that "the pass pays for itself" framing is intended, then finalize the drip constants.

## Level 0 — instant unlock (drives the purchase)
Buy the pass → immediately: 🔥 **Emberfall Ascendant Flare** (the season's ONE Mythic flare — the marquee
buy hook) + **"Forge Flame"** (season flame) + **1,000 Embers.** (All cosmetic/currency — no advantage.)

## Off-level ember drip (every non-5 level)
| Phase | Levels | Free | Paid |
|---|---|---|---|
| Crucible | 1–25 | 20 | 40 |
| Arena | 26–50 | 30 | 60 |
| Pantheon | 51–75 | 40 | 80 |
| Transcendent | 76–100 | 50 | 100 |

## Named levels (multiples of 5) — Free / Paid
**Crucible (1–25):**
- 5 · Common Box / Uncommon Box + Uncommon Flame
- 10 · Uncommon Box / Rare Box + Rare Title
- 15 · 50 Embers / 250 Embers + Rare Focus Audio
- 20 · Uncommon Box / Rare Box + Epic Banner
- **25 · MYTHIC #1** · Rare Box / **Emberfall Banner** (Mythic season banner)

**Arena (26–50):**
- 30 · Uncommon Box / Rare Box + 500 Embers
- 35 · 75 Embers / Epic Card + 250 Embers
- 40 · Rare Box / Epic Box + Epic Particle
- 45 · Rare Box / Epic Halo + 500 Embers
- **50 · MYTHIC #2** · Epic Box / **Emberfall Halo** (Mythic) + Mythic start-sting SFX **"Emberfall Strike"**

**Pantheon (51–75):**
- 55 · Epic Box / Legendary Box + 750 Embers
- 60 · Rare Box / Legendary Title "Dialed In" (glow)
- 65 · 125 Embers / Legendary Ambient Audio
- 70 · Epic Box / Legendary Banner + 1,000 Embers
- **75 · MYTHIC #3** · Epic Box / **Emberfall Profile Card** (Mythic — profile + leaderboard flex)

**Transcendent (76–100):**
- 80 · Legendary Box / Mythic Box + 1,500 Embers
- 85 · Epic Box / Legendary Particle "Falling Ash"
- 90 · 200 Embers / Legendary **"Emberfall Relic"** (showcase — the relic drops to a later tier)
- 95 · Legendary Box / Mythic Box + 2,000 Embers
- **100 · THE APEX** · Legendary Box + Title **"The Relentless"** *(free-pass completion title)* / 👑
  **Season Crown**: **"Emberfall Crown"** Mythic Medal (profile + campus leaderboards) + Title
  **"Forged in Ember"** *(paid-pass completion title, gold-glow)*

  → The two completion titles: **"The Relentless"** = hit L100 on the free track · **"Forged in Ember"**
  = hit L100 on the paid track. The Emberfall Ascendant Flare is the L0 instant unlock, so it is NOT a
  milestone reward — L25/L75 carry a Mythic **Banner + Profile Card** (the highest-visibility flexes)
  instead. The Relic drops to a later Legendary tier (L90). Only one Emberfall flare exists.

## Post-100 prestige loop
Every 5 levels past 100: Free **100 Embers** · Paid **Prestige Cache** (10% a random legacy
Legendary/Mythic cosmetic, 90% **1,000 Embers**). Keeps whales engaged to Dec 23 without new art.

## End-of-season placement rewards (season close · Dec 23)
Exclusive, **never-reissued** rewards granted at close by your final standing on the **season
leaderboard** (per university, ranked by season Forge XP / activity). Cosmetics + embers only — no
advantage carried forward. Emberfall-coded, permanent, one-time grant into inventory at `ends_at`.

| Placement (per campus) | Reward |
|---|---|
| **#1 — Season Champion** | Exclusive Mythic "Emberfall Sovereign" cosmetic + permanent "Emberfall Champion" title + Champion medal + 5,000 Embers |
| **Top 10** | Legendary exclusive + "Emberfall Elite" title + 2,500 Embers |
| **Top 1%** | Epic exclusive + "Emberfall Ascendant" title + 1,500 Embers |
| **Top 10%** | Rare Box + "Emberfall Contender" title + 750 Embers |
| **Top 50%** | 500 Embers + "Emberfall Initiate" title |
| **Reached L100** | "Emberfall Centurion" medal (regardless of placement) |
| **Any pass level** | Emberfall participation medal |

- **Inter-university flex** (optional v1): a global Laurier-vs-Waterloo board; the #1 at each campus +
  the overall #1 get an extra "#1 at [school]" badge — strong share-card fuel.
- Never re-issued → the season's biggest prestige / FOMO driver; wire a Champion share card.
- Needs a standings snapshot at `ends_at` + a one-time grant job (relates Leaderboard 2.0, #46).

## Build notes
- All rewards resolve to existing catalog ids + embers + boxes → the season track is DATA, not new
  systems. Ships OTA (the screen is mock 87). Only the $9.99 unlock waits on RevenueCat (#71).
- The 3 Mythic Flares/Flame + Apex Medal are new *catalog entries* (art), not new *types*.
