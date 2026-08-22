# Code prompt — Discipline Relics (per lock-in type)

New earned relic set, one per lock-in type. Builds on the **relics-are-earned** infra already shipped
(`0090_relics_earned_and_drop_pool_guard`, Trophy Hall §4 relics group). This is **additive** — new relic rows
+ new earn triggers. No new UI surface (they render in the existing Trophy Hall / Collection relic tiles).

**Source of truth:** `ITEM_CATALOG.md` §4a-2 + mock `design-mocks/108-discipline-relics.html`.

## What to add
- **7 discipline relics** (Legendary), each keyed to a lock-in type: Socrates' Scroll (Study) · Hercules'
  Might (Gym) · Pheidippides' Sandals (Run) · Calliope's Ink (Read) · Daedalus' Blueprint (Work) · Oracle's
  Stillness (Meditate) · Orpheus' Lyre (Create). Vector art per mock 108.
- **1 Mythic capstone** — **Crown of Olympus**, granted when the user holds **all** discipline relics.

## Earn logic
- Trigger = a **per-type accumulated metric** crossing its threshold (all thresholds in server config, tunable):
  - **Study · Read · Deep Work · Meditate · Create → cumulative hours** (100h) from `check_ins` / sessions.
  - **Gym → total volume lifted** (100,000 lbs) — from the fitness sync (Health/Strava).
  - **Run → total distance** (414 km — Pheidippides' Athens→Sparta round trip) — from the fitness sync.
  - Where a metric isn't available for a user (no fitness sync), fall back to cumulative hours for that type.
- Grant idempotently, same path as the §4a earned relics (no loot-box, `RELIC` stays out of drop tables).
- Capstone: on any discipline-relic grant, check if the set is complete → grant Crown of Olympus.
- Fire the existing **reward-ready / relic-earned notification** on grant (leading art = the relic), and it
  becomes a **journal entry** like other achievements.

## Profile surface (mock 107)
Show a **Discipline Relics shelf** on the profile, in the Trophy Hall area (own + other profiles): a horizontal
row of the 7 relics + the Olympus capstone. **Earned = lit** (gold/rarity glow, the relic art); **locked =
greyed with a live progress %** toward its threshold (e.g. Run 78%). Header shows the count ("3 / 7"); tap →
the full set / that relic (mock 108). Doubles as a **progress tracker** — the "chase depth in one discipline"
motivator — so it's worth surfacing on the profile, not only inside "See all".

## Extensibility
- Map each relic to its category by a `lock_in_type` key so a **new lock-in type** can drop in its own relic
  (Greek-mythic name) without a schema change. Unknown type with no relic = simply no relic yet.

## Acceptance
- [ ] 7 discipline relics + Crown of Olympus exist as earned `RELIC`s, out of all drop tables.
- [ ] Each grants at its per-type hour threshold (config-driven, tunable); capstone grants on full set.
- [ ] They render in the Trophy Hall / Collection relic tiles (rarity-glowed, tap → lore + earn metric).
- [ ] **Discipline Relics shelf on the profile** (mock 107): 7 + capstone, earned lit / locked with live
      progress %, count header, tap → set; on own + other profiles.
- [ ] Grant fires a notification + journal entry.
