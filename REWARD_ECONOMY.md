# Philoi — Reward Economy spec (`REWARD_ECONOMY.md`)

The **how** for the reward economy. `MONETIZATION.md` is the *why* (principles, tiers, ethics); this is the data model, the scaling engine, and the grant tables that Engineering builds against. Paired with **spec §24 (Inventory)** for the screen. Built in **CODE_BUILD_PROMPTS Step 21 (21a–21e)**.

Status: **phase 2** — build behind a feature flag, ship after retention is proven.

---

## 0 · Non-negotiables (inherited)
1. **Never sell / never fake effort.** Everything here is **cosmetic or currency** — no XP, rank, streaks, PRs, or leaderboard position is ever granted *or* purchasable. XP multipliers (challenge / season) live in the **effort economy**, not here; this spec only ever grants embers, boxes, badges, cosmetics.
2. **Rides on the Step 18 verified-effort floors.** A grant may only fire off **already-counted, verified** progress. No grant off self-reported or farmed junk. If the underlying metric wasn't good enough to count for XP, it isn't good enough to pay a reward.
3. **Earned ≠ bought, always.** Earned badges carry provenance and can never be purchased — that exclusivity is their entire value.
4. **Server owns the truth.** No client-side reward math, no client-writable inventory. The client reads; the server grants.

---

## 1 · Inventory data model (21a)

Server-authoritative. Client reads via a single `getInventory(userId)`; never writes.

### `ember_wallet`
| column | type | notes |
|---|---|---|
| `user_id` | uuid PK | |
| `balance` | int | never negative; all changes via ledger |
| `updated_at` | timestamptz | |

### `ember_ledger` (append-only — auditability + anti-fraud)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `delta` | int | + earn / − spend |
| `reason` | enum | `lock_in` · `flame_meter` · `challenge_win` · `season_reward` · `box_open` · `shop_spend` · `stipend` · `admin` |
| `ref_id` | uuid null | the challenge / season / box / purchase it came from |
| `created_at` | timestamptz | |

### `owned_badges`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `badge_key` | text | FK → badge catalog |
| `source` | enum | **`earned`** \| **`paid`** — drives the visual split, never mixed |
| `provenance` | text | e.g. `"Won from vs Aidan · Most lock-in time · S1"` or `"Top 10% · Laurier · S1"` |
| `earned_at` | timestamptz | |
| `equipped` | bool | at most a set number equipped (see §5 open Q) |

### `loot_boxes`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `rarity` | enum | see §2 ladder |
| `obtained_via` | enum | `challenge` · `season` · `forge_pass` · `purchase` · `promo` |
| `provenance` | text | shown on the box before opening |
| `opened` | bool | |
| `opened_at` | timestamptz null | |

### `cosmetics_owned`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `cosmetic_key` | text | flame skin / banner / frame / hex-glow / campfire skin |
| `slot` | enum | `flame_skin` · `banner` · `frame` · `hex_glow` · `campfire_skin` · `app_icon` |
| `source` | enum | `earned` · `paid` · `box` |
| `equipped` | bool | one equipped per slot |

> **Flame-skin hard constraint (from spec §4):** a flame skin recolors the **color ramp ONLY** — never size / intensity / animation, which signal real activity. Implement as a swappable palette token under the same state logic.

---

## 2 · Loot-box rarity ladder & contents

| # | Box | Rarity | Typical contents |
|---|---|---|---|
| 1 | **Kindling** | Common | common flame-skin tints, banners, small embers |
| 2 | **Ignition Crate** | Uncommon | uncommon skins/frames, embers |
| 3 | **The Furnace** | Rare | rare skins, hex-glow variants |
| 4 | **Vessel of Hestia** | Epic | epic skins, premium frames, a shot at a cosmetic badge |
| 5 | **Hephaestus' Chest** | Legendary | legendary flame skins, animated frames, rare cosmetic badge |
| 6 | **Prometheus' Vault** | Mythic | mythic-only cosmetics, the rarest frames, guaranteed high-tier item |

**Ethics rails (MONETIZATION.md):** cosmetics-only (never effort), **published odds** per box, a **pity timer** (guaranteed rarity floor after N opens), and an **earnable path** for every box (you can win them, not only buy them). Audience skews students/minors → treat like a regulated product (Belgium/NL ban *paid* loot boxes; app stores require published odds).

---

## 3 · Reward-scaling engine (21b)

One server function — the **only** place rewards are computed. Both challenge-close and season-close call it.

```
grantReward(context) -> { embers: int, box: Rarity | null, badge: BadgeKey | null }
```

**Significance** = `difficulty × competitionScope × duration × placement`, mapped to a payout band. Higher significance → more embers + rarer box + (at the top bands) an exclusive badge.

Inputs in `context`:
- `type`: `friend_h2h` · `campfire_group` · `season`
- `difficulty`: normalized goal hardness (same difficulty signal the challenge XP algorithm uses, PUNCHLIST §5)
- `duration`: challenge / season length
- `scope`: opponent count / board size (1 for H2H, N for group, board size for season)
- `placement`: percentile + absolute rank
- `verified`: bool — **must be true or the function returns the completion floor only** (Step 18)

Payout bands (engine output, tune server-side):

| Band | Trigger (significance) | Embers | Box | Badge |
|---|---|---|---|---|
| Completion | finished, any | base | — | — |
| Casual | low | small | — | — |
| Notable | mid | med | Kindling / Ignition | — |
| Impressive | high | med-lg | Furnace / Vessel of Hestia | — |
| Elite | very high | lg | Vessel of Hestia / Hephaestus' Chest | exclusive earned |
| Apex | top of a large board / absurd long goal | xl | Prometheus' Vault | apex earned |

---

## 4 · Grant tables

### 4a · Challenge wins (21c) — called at challenge close
Ref PUNCHLIST §5, mocks 36 / 37.

**Friend H2H** — scale by `difficulty × duration`:

| Situation | Payout |
|---|---|
| Casual 24h, easy goal — win | small embers |
| Multi-day win | embers + **Kindling / Ignition** |
| **Ridiculous long goal** (e.g. most lock-in time all semester) — win | **Epic/Legendary box** (Vessel of Hestia / Hephaestus' Chest) + **exclusive earned badge** + embers |
| Redemption rematch win (prev. loser) | the base win reward **+ a small box** on top |

**Campfire (group)** — scale by `placement percentile × campfire size × difficulty`. Everyone who finishes gets the completion base; then the best tier they qualify for:

| Placement | Payout |
|---|---|
| Completed | completion embers |
| Top 50% / 25% | embers + **common/uncommon** box |
| **Top 10% (large campfire)** | **Rare/Epic** box (Furnace / Vessel of Hestia) |
| Top 3 (big fire) | **Epic/Legendary** box + earned badge |

*Percentile guard (identical to Step 18):* absolute-rank caps (top 10/3/2/1) only apply when that rank is **more selective than the 10% line** — so they bite only on big boards; small campfires use percentile tiers (never "everyone's top 10"). Rank by the **verified metric total**, never speed.

### 4b · End-of-season (21d) — called at season close, per leaderboard scope (campfire / uni / vs-unis)
Same percentile ladder → reward **rarity**. Runs **on top of** the season-XP multiplier (that multiplier is effort economy, PUNCHLIST §5; the box + badge are granted here).

| Season placement | Payout |
|---|---|
| Participated (met the Step 18 floor) | **season completion badge** (dated) + embers |
| Top 10% (uni) | **Epic** box + a **dated seasonal badge** |
| Top 10 (uni) | **Legendary** box (Hephaestus' Chest) + rarer seasonal badge |
| **Uni #1** | **Mythic** box (Prometheus' Vault) + the **apex seasonal badge** + big embers |

Seasonal badges are **dated and kept forever** across resets. **One season clock** shared with the Forge Pass reset and the leaderboard reset.

---

## 5 · Balance guardrails (21e)
- **Earned rewards skew to prestige** — exclusive earned badges (un-buyable) + modest embers/boxes. NOT ember floods, which would undercut paid packs.
- **Biggest earned payouts are rare by nature** (one uni #1 per season; ridiculous-goal wins are hard) → they don't flood the economy.
- **Paid = volume + convenience + variety + Forge Pass.** Free users earn *status*; paying buys *speed and variety*. Both economies stay healthy.
- **All amounts server-tunable** (config, not client constants) so the economy can be rebalanced post-launch without a release.

---

## 6 · Inventory screen (spec §24, 21a)
Sections, top → bottom:
1. **Embers** — balance + a small "how to earn" affordance; entry to the cosmetics shop.
2. **Badges** — earned and paid **visually separated**; tap a badge → provenance sheet. Earned badges show "Earned" + can never be bought.
3. **Boxes** — unopened boxes with rarity + provenance; tap to open → reveal animation; published-odds link.
4. **Cosmetics** — owned skins / banners / frames / glows; equip / unequip (one per slot).

Earned-vs-bought must be **unambiguous everywhere** it renders.

**Equip screen (mock 67):** the Inventory opens on a live **loadout preview** (equipped card texture + halo + flame + title + rank — "how others see you"), then a **category chip filter** (Flames · Particles · Flares · Cards · Halos · Titles · Banners · Audio · SFX · Relics · Medals) over a grid of owned items. The **equipped** item per slot is ringed + ✓. Tap an item → detail sheet (big art, `RARITY · TYPE`, lore, one-tap **Equip** that names the swap — one active per slot). **Relics + Medals** open the same sheet but are **showcase-only** (no equip button; show "earned" provenance instead). Item names/lore/art all pull from ITEM_CATALOG.md.

---

## 7 · Open questions
- **Equipped-badge cap:** how many badges can a user show at once (profile + rank hex)? (Proposal: 3.)
- **Box pity-timer N** per rarity, and published odds table — needs a first pass + legal review before ship.
- **Ember earn/spend curve:** starting prices for shop cosmetics vs. earn rate, so free-user grind feels fair but paid still compelling.
- **Duplicate cosmetics from boxes:** convert to embers (dupe-protection) or allow dupes? (Proposal: auto-convert to embers.)
- **Cross-season badge display:** timeline vs. "trophy case" grid on profile.

---

## 8 · Loot boxes — rarities, drop rates, pity, dupes (shop spec)
*Cosmetics only (Rule stands). Odds are PUBLISHED (mock 57) + pity timers guarantee progress — required given the student/minor audience. Boxes are earned OR bought.*

### 8.1 Rarity tiers → cosmetic types (Dark Arena identity)
*Named items + lore live in **ITEM_CATALOG.md** (the drop pool). The table below is the type-per-rarity map those items slot into.*
| Rarity | Colour | Cosmetic types |
|---|---|---|
| **Common** | Gray `#8a7fa6` | basic profile badges, standard title text, basic SFX |
| **Uncommon** | Green `#3DA85C` | basic flame accents, stat-tracker cards, basic avatar aura halos |
| **Rare** | Blue `#4FB0E5` | goal-typed flame colour variants (Solar Yellow, Lime Spark), metallic card textures, streak-recovery shields |
| **Epic** | Purple `#a06cd5` | animated avatar frames, custom sound packs (sub-bass focus triggers), custom session ambient audio |
| **Legendary** | Gold `#F5C542` | premium goal-flame cosmetics (Plasma Blue, Cosmic Purple), animated profile cards, exclusive Campfire banner skins |
| **Mythic** | Red/Plasma `#FF4D4D` | God-Mode Flares (Void Purple Plasma, Electric White Incandescence), animated profile badges w/ particle emitters, custom rank titles |

### 8.2 The 6 boxes — how to get · drop rates · pity
| Box | Rarity | How to get | Common | Unc | Rare | Epic | Leg | Myth |
|---|---|---|---|---|---|---|---|---|
| 🪵 **Kindling Pack** | Common | daily login streak · 1 focus block | 80.0 | 17.5 | 2.4 | 0.1 | 0 | 0 |
| 📦 **Ignition Crate** | Uncommon | weekly habit · win a 1v1 duel | 45.0 | 40.0 | 12.0 | 2.8 | 0.2 | 0 |
| 🔨 **The Furnace** | Rare | Forge Pass T15+ · Top 25% campfire challenge | 15.0 | 45.0 | 30.0 | 8.5 | 1.4 | 0.1 |
| 🏺 **Vessel of Hestia** | Epic | Gold rank · Top 10% challenge · Forge Pass milestone | 0 | 20.0 | 50.0 | 22.0 | 7.2 | 0.8 |
| 🛡️ **Hephaestus' Chest** | Legendary | Diamond rank · 1st in a full campfire · end-of-season milestone | 0 | 0 | 35.0 | 45.0 | 17.5 | 2.5 |
| ⚡ **Promethean Vault** | Mythic | Infernal rank · semester Champion · Top 1% provincial | 0 | 0 | 0 | 40.0 | 48.0 | 12.0 |

**Pity (guarantee floors):**
- **Kindling:** floor 1 Common/box · soft: Uncommon+ every 3 · hard: Rare every 10.
- **Ignition:** floor Uncommon+ · soft: Rare every 5 · hard: Epic every 15.
- **Furnace:** floor Rare+ · soft: Epic every 4 · hard: Legendary every 12.
- **Hestia:** floor Epic+ · soft: Legendary every 6 · hard: Mythic every 20.
- **Hephaestus:** floor Legendary · hard: Mythic every 8.
- **Promethean:** floor Legendary+ · hard: Mythic every 3.

### 8.3 Salvage — sell / convert any item to Embers
Any owned cosmetic can be turned back into Embers at its **salvage value = a rarity-scaled % of the box that yields that rarity**. The % **descends with rarity — 50% (Common) → 25% (Mythic), 5% per tier** — so rarer pulls return proportionally less (protects the economy and nudges players to *keep* the good stuff rather than salvage it). Used two ways:
- **Auto (dupes):** opening a cosmetic you already own auto-salvages (no wasted dupes) — replaces the old "duplicate converter".
- **Manual (sell):** sell any owned item from the Inventory (mock 67), **including EARNED titles/badges** — e.g. a "Campfire King" from a top-3 finish in a 100-person campfire (Rare) sells for **200**. Selling first **unequips** it; **once sold it's gone** (an earned title only returns by earning it again).

| Rarity | Reference box (price) | Salvage % | Embers |
|---|---|---|---|
| Common | Kindling · 80 | 50% | 40 |
| Uncommon | Ignition · 200 | 45% | 90 |
| Rare | Furnace · 500 | 40% | 200 |
| Epic | Vessel of Hestia · 1,200 | 35% | 420 |
| Legendary | Hephaestus' Chest · 3,000 | 30% | 900 |
| Mythic | Promethean Vault · 8,000 | 25% | 2,000 |

**Guards:** confirmation on any **Epic+** or **earned** item; the 1-of-1 "Ascended · Global" and dated season Medals get an extra "this is permanent" confirm. No client-side math — the salvage % per rarity is **server config**.

The descending curve keeps the biggest pulls from flooding Embers (a Mythic returns only 25%), so this sits comfortably under the §21e guardrail while still feeling fair on unwanted commons. All values remain server-tunable if the sink needs adjusting post-launch.

### 8.4 The Forge Shop (direct buy) — shop "Featured" row (mock 56)
Save Embers to **buy specific cosmetics directly** instead of pure box RNG — the deterministic path for anyone who wants a specific item.
- **Price = rarity-scaled, and HIGHER than the matching box** (a guaranteed item should cost more than a gamble). E.g. Uncommon 300 · Rare 600 · Epic 1,500 · Legendary 4,000. Always well above the salvage value (§8.3) so there's no buy→salvage arbitrage.
- **Only box-pool cosmetics** are direct-buyable. **NOT** buyable: earned titles/badges, season/placement titles, medals, relics, and **Forge-Pass-exclusive** items — prestige/exclusives must be *earned*.
- Rotates a **Featured** selection; the full catalog is reachable too. (Where earned + purchased Embers get spent; ties to the Inventory §24.)

### 8.5 Box-open animation (mocks 58 vectors → 59 sequence)
Every open plays **two stages: a tier-specific CRACK, then a universal PULSE**, then the reward reveals.

**Stage 1 — CRACK (per box, ~0.6–0.9s):**
| Box | Rarity | Crack |
|---|---|---|
| 🪵 Kindling Pack | Common | a flat chop straight down the middle, splitting the logs in half |
| 📦 Ignition Crate | Uncommon | the fuse ignites — spark races down the fuse, then the crate blows |
| 🔨 The Furnace | Rare | the grates blow out; molten light erupts through both faces |
| 🏺 Vessel of Hestia | Epic | unholy oil pours in and lights the purple flame far bigger than it already burns |
| 🛡️ Hephaestus' Chest | Legendary | the lock turns and the lid unlocks |
| ⚡ Promethean Vault | Mythic | spins incredibly fast (~3600° over ~1.5–2s) before flying open |

**Stage 2 — PULSE (universal, ~0.7s):** the box vector **turns whiter, shrinks slightly**, and **light rays break free from its center** (reads as breaking open). The rays then **flash the item's tier colour** (§8.1). Item reveals on a spring scale-in.

**×10 open:** a **card-shuffle deal** — **one box sits in the center** (the deck), then 10 copies deal off it into a **2×5 grid**, dealt **top-left → bottom-right** (~0.06s stagger). Each then runs crack + pulse in the same cascade order; dupes convert to Embers (§8.3) inline.

**Stage 3 — REWARD MENU (mock 59, always shown after the animation):** the animation is a flourish, not the payoff — it must resolve to a **rewards summary** so the player actually sees what they got.
- *Single:* a hero screen — the item art (with a **NEW** tag), name, `RARITY · TYPE`, one-line flavor, and **Equip now** / **Collect → Inventory**.
- *×10:* a **results grid** of all 10 items, each tinted + tagged by rarity/type; **dupes are dimmed with their ember payout**; header calls out the **best pull** and total dupe embers; **Collect all → Inventory**.
Fullscreen animation scale for both single and ×10.

**Share card (mock 60):** both reward menus expose a **Share** action → a 9:16 story card (same story-share pipeline as lock-ins, mocks 28/29). Single = item art in a **tier-coloured** glow, name + `RARITY · TYPE`, the **rarity odds as a flex** ("a 7.2% pull"), and a footer line of `@username · [rank hex] Rank`. ×10 = leads with the **best pull**, rest of the haul as a rarity-bordered chip strip. Tier colour + odds copy adapt to the item (Mythic → red, "0.8% pull"). No CTA line — the item + odds speak for themselves. Growth loop: rare unlocks become organic ads.

*Respect `prefers-reduced-motion`: skip the spin/shudder/ray motion, keep a simple cross-fade box→reward. All open logic (RNG, pity, dupe conversion) resolves server-side before the animation plays — the animation only visualizes a decided result, never determines it.*
