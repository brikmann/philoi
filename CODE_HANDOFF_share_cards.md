# Code handoff — Share-card pass (retention loop) + leaderboard reskin + season titles

Self-contained build pass. Three linked pieces: (A) the leaderboard podium reskin, (B) the five share cards that
drive the growth loop, (C) the season-title system the season card depends on. Build A→B→C.

**Coordination (see `CODE_COORDINATION.md`):** don't edit the mocks/specs — flag disagreements in chat. Commit
before cutting any build so nothing in the working tree is lost.

**Reference files (source of truth):**
- `design-mocks/95-leaderboard-reskin.html` — Greek-pillar podium
- `design-mocks/96-share-cards.html` — fire / lock-in / rank-up / unlock cards (+ single-card season, superseded by 97)
- `design-mocks/97-season-reward-split.html` — **APPROVED** season card (2-screen split)
- `SEASON_TITLES_SPEC.md` — the title ladder + gods + lore + data model
- `design-mocks/88-flare-auras.html` / `FLARES_SPEC.md` — the `emberfall` effect reused as the season aura
- `design-mocks/66-placement-titles-by-scope.html` — scope rules the titles layer onto

Baseline tokens everywhere: deep-purple gradient · `FlameLogo` (never campfire vector/emoji) · crisp `EmberToken`
for currency · ember-gradient black-text CTA.

---

## A. Leaderboard reskin — `(tabs)/leaderboards.tsx`  (mock 95)
- Replace the parchment podium with **fluted Greek pillars** (capital + grooved shaft + base) in **tier metals**:
  gold (#1, tallest), silver (#2), bronze (#3). Vertical fluting = subtle dark grooves; cylindrical sheen via a
  horizontal light-center gradient. **No ember floor-glow** (removed — the columns carry it).
- Avatars keep a **tier-coloured ring + rank medallion**; names + XP in the tier colour. Tabs, 4th-place list,
  and nav unchanged.

---

## B. Share cards — the retention loop
Five exported story cards (9:16), each mapped to a component. **Every card** carries the shared footer: the
**philoi wordmark + the sharer's rank in a hex + `philoi.app · @handle`** — so each share is an install prompt with
a status stamp. Rarity/tier colours stay semantic.

**Share triggers (where each fires):**
- fire → **share icon next to the streak on Home**
- lock-in → **Share on the done / daily-fire screen**
- rank-up → **on the rank-up celebration**
- season → **on the season-standing screen**
- unlock → **on the unlock / box-open reveal**

**B1 · `fire-share-card`** — streak flex. Coal-bed heat fire + big "N DAY STREAK" + "kept the fire alive."

**B2 · `lock-in-share-card`** — proof-of-work. `FlameLogo` + "2h 14m" + "LOCKED IN" + session name · date.
(No "deep work, no breaks" line.)

**B3 · `rank-up-share-card`** — tier climb. Tier-metal hexagon badge + "GOLD I" + "climbed a tier." (No tier path line.)

**B4 · `unlock-share-card`** — rare cosmetic flex. The item's own effect/visual front & center (e.g. Zeus' Wrath
lightning) + **item name + description pulled from the cosmetics catalog (`catalog.ts`)** — do NOT hardcode copy.
(No "equipped on lock-in" line.)

**B5 · `season-standing-share-card` → BUILD THE SPLIT (mock 97, approved).** Two screens (swipeable pair in-app,
and/or two separately shareable stories), **both wearing the Emberfall aura** (reuse the existing `emberfall`
`FlareEffect` as the full-bleed animated background — lava pool at the bottom + embers raining from the top):
  - **Screen 1 — Placement:** the person's **EQUIPPED flame** (logo silhouette recoloured by their flame ramp —
    use `EquippedFlameSvg`) with **"TOP 1%"** burning inside it; underneath, **university + absolute rank of the
    pool** ("🎓 MIT · #300 of 30,000" — real rank / real cohort size, not just a %); then season effort
    (hours locked in · XP); "your rewards →".
  - **Screen 2 — Rewards:** "FORGED THIS SEASON" + a reward **list** (icon tile + name + rarity sub), **permanent
    items first** (Title, Banner — purple accent) then loot (Chest, Embers).
  - **Data-bind everything to reality:** the placement %, rank, cohort size, the earned **title** (from C), its
    rarity, and the **actual granted reward bundle** (end-of-season placement rewards). Nothing hardcoded.

---

## C. Season titles — `SEASON_TITLES_SPEC.md` (full detail there)
Season-exclusive, permanent placement titles; a new themed set each season; **never reused** (that's the flex).

**Season 1 "Emberfall" ladder** (band → title → rarity):
- **#1 Surtur** · Mythic (Global #1 = 1-OF-1, animated gold→red, "· Global" / "· \<Uni\>")
- **#2 Agni** · Mythic
- **#3 Helios** · Mythic
- **Top 1% Built Different** · Legendary
- **Top 10% Firebreather** · Epic
- **Top 25% Certified Firestarter** · Rare
- **Top 50% Warming Up** · Uncommon
- below 50% → no title

Two classes: **podium (#1–3) = mythological flame deities** (each with a significance **description** shown on the
title — see spec), **percentiles = Gen-Z flexes**. Scope modulates rarity (Global cut one notch hotter; Global #1
animated 1-of-1), per mock 66. Vs-Unis campus titles (Prometheus' Disciples, etc.) stay collective.

**Impl:** per-season title table `(season_id, band, title, rarity, banner_asset, description)`; grant on season
finalize by each user's final band per scope (title + banner + loot); profile title picker (owns across seasons);
the season card + profile read title/description/rarity from the table.

---

## Acceptance
- [ ] Leaderboard: fluted tier-metal pillars, no floor-glow, tier rings + medallions.
- [ ] All 5 cards: shared footer (wordmark + rank-in-hex + philoi.app), correct per-card content, share triggers wired.
- [ ] Unlock card name/desc from catalog; season card placement/title/rewards from real data.
- [ ] Season card = the split (mock 97), equipped-flame placement, Emberfall aura on both screens.
- [ ] Season titles table seeded with the S1 ladder incl. god descriptions; grant-on-finalize; profile + card render it.
