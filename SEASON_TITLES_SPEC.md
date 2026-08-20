# Season Titles — spec (season-exclusive placement honors)

**Concept.** Every season has its **own permanent title set**, themed to that season's name. A title is earned
at **season close** by your **final placement band**, is **permanent**, and is worn on your **profile** + stamped
on the **season-standing share card** (mock 97). A new season ships a **new themed ladder** — retired titles stay
in your trophy case and can **never be re-earned**. That non-repeatability is the whole point: "I was there for
Emberfall" means something forever.

## Placement bands → Season 1 "Emberfall" ladder
Ascension reads bottom→top (kept a flame → rose above everyone):

| Placement | S1 title | Rarity | Notes |
|-----------|----------|--------|-------|
| **#1** | **Surtur** | Mythic | Norse world-flame (ends the world at Ragnarök) — the apex. Global #1 = **1-OF-1**, animated gold→red, "**· Global**"; per-uni "**· \<Uni\>**". |
| **#2** | **Agni** | Mythic | Hindu god of fire. Podium — 2nd in the whole scope. |
| **#3** | **Helios** | Mythic | Greek titan of the sun. Podium — 3rd in the whole scope. |
| **Top 1%** | **Built Different** | Legendary | Global-1% reads one rarity notch hotter than campus-1% (per mock 66). |
| **Top 10%** | **Firebreather** | Epic | |
| **Top 25%** | **Certified Firestarter** | Rare | |
| **Top 50%** | **Warming Up** | Uncommon | "kept a flame all season." |
| below 50% | — | — | no title (participation ≠ a title). |

*Tone: **two classes**. The **podium (#1–3) are mythological flame deities** — Mythic, singular, resonant with the
Greek/pantheon world (cf. the collective **Prometheus' Disciples** uni title). The **percentile bands are Gen-Z
flexes** — punchy, meme-literate, brand-safe. The top 3 read like gods; everyone else reads like the group chat.*

### Podium lore — the "why it matters" (shown on the title: tooltip · earn card · profile)
- **Surtur — #1.** The fire-giant of Ragnarök, whose flaming sword outshines the sun and burns the world to ash so
  the next can rise. There is only ever **one**. This season, it's you.
- **Agni — #2.** The divine fire the gods themselves speak through — alive in every hearth and every offering,
  never once extinguished. Second to none but the world-ender, Surtur.
- **Helios — #3.** The Titan who hauls the sun across the sky each day — the blaze every mortal looks up to.
  Third of three, behind only Surtur and Agni — and still a god.

*(Percentile titles can carry a one-liner too, but the gods are where the lore earns its keep.)*

These **replace** the old generic per-band titles (Ascended / The Untouchable, etc.) on the individual boards —
those were scope-generic; season titles are the exclusive, dated version.

## Scope handling (keep mock 66's rules)
- Titles come off the **individual boards** (My Uni + Global). **Global** placement is the elite cut and bumps
  rarity one notch vs the same cut on a single campus; **Global #1** is the animated 1-of-1.
- **Campfire** board stays the small local honor (Epic-capped "Campfire Champion") — season flavor optional.
- **Vs-Unis** (collective) campus titles — Prometheus' Disciples / Keepers of the Flame / Champions of Academia —
  stay as-is for S1; can be season-themed in a later pass.

## Reward pairing per band (with the title)
Each band grants **Title (permanent) + Banner (permanent, season art) + loot (box + embers)** scaling with the
band — bind to the existing end-of-season placement rewards. The share card (mock 97) lists all of them; permanent
items (title, banner) render first.

## Future-season naming pattern (so S2+ is quick)
Every season is **never-reused** (that's the exclusivity). Two rules travel; the words don't:
- **Percentiles = fresh Gen-Z flexes.** e.g. **S2 "Frostforge":** Warming Up→**Cold Open** · Certified Firestarter→
  **Certified Menace** · Firebreather→**Sub-Zero** · Built Different→**Him/Her**.
- **Podium (#1–3) = mythological deities themed to the season's element** (Mythic). S1 Emberfall → flame gods
  (Surtur / Agni / Helios). S2 Frostforge → frost deities, e.g. **#3 Boreas · #2 Skaði · #1 Ymir**. Never reuse a
  deity across seasons; pick the apex/most-singular for #1.

## Implementation notes for Code
- **Per-season title table**: `(season_id, band, title, rarity, banner_asset, description)`. Bands: `rank_1|
  rank_2|rank_3|p1|p10|p25|p50`. The `description` is the significance blurb (above) — shown on the title.
- **Grant on season finalize**: compute each user's final band **per scope**, grant the matching title as a
  permanent owned honor (plus banner + loot).
- **Display**: profile title picker (owned titles across all seasons); season-standing card pulls the just-earned
  title + rarity; Global #1 animates.
- **Copy is data**, not hardcoded — the card / profile read the title string from the table for the user's band.
