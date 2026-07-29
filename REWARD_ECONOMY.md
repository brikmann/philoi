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
| `provenance` | text | e.g. `"Won from vs Aidan · Most lock-in time · S2"` or `"Top 10% · Laurier · S2"` |
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

---

## 7 · Open questions
- **Equipped-badge cap:** how many badges can a user show at once (profile + rank hex)? (Proposal: 3.)
- **Box pity-timer N** per rarity, and published odds table — needs a first pass + legal review before ship.
- **Ember earn/spend curve:** starting prices for shop cosmetics vs. earn rate, so free-user grind feels fair but paid still compelling.
- **Duplicate cosmetics from boxes:** convert to embers (dupe-protection) or allow dupes? (Proposal: auto-convert to embers.)
- **Cross-season badge display:** timeline vs. "trophy case" grid on profile.
