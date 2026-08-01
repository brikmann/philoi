# Philoi — Forge Pass (season track)

*The season-long progression track that dispenses embers, boxes, badges, and season-exclusive cosmetics as you lock in. It's the spine that ties the whole reward economy (REWARD_ECONOMY.md) together over a season. Mock: `68-forge-pass.html`. Build: Step 21k.*

## Model — the Forge Pass IS the core paid product
- **Seasonal subscription (~$8.99/season · auto-renews each season · cancel anytime).** Subscribing unlocks the **Premium** track for the current season and **renews into each new season's Pass automatically** unless cancelled — so it's **recurring per-season revenue**, charged once per season (a *seasonal* charge, NOT the old monthly Ignite/Blaze tiers, which are dropped). Paid model = **the seasonal Pass + ember packs** (shop). That's it.
- **Two lanes:** **Free** (everyone who plays earns tiers + free-lane rewards) + **Premium** (active subscribers). Subscribe **any time** in the season — premium rewards for every tier you've **already climbed unlock retroactively**.
- **Lapse behavior:** if you cancel / a season isn't renewed, you **keep everything already earned** (cosmetics are yours forever), you just don't get that season's premium track or exclusive set. Re-subscribe any time to rejoin the current season.
- **100 tiers** per season.
- **One shared season clock** with the leaderboard/season-reward reset (REWARD_ECONOMY §4b) and the 3× season-XP finale. When the season rolls, the Pass resets and re-themes.
- **Season theme reskins the Pass.** S1 = *Emberfall*: the exclusive cosmetic set + banner + capstone are all Emberfall-branded. Each season ships a new exclusive set.
- **No tier-skip purchases at launch** — buying progress cuts against the "earn it by showing up" ethos. (Optional later; flagged, not planned.)

## Progression — Pass XP is its OWN currency (NOT rank XP)
- **Separate from rank XP — on purpose.** You do **not** grind rank XP to climb the Pass. Ranks stay a long, meaningful climb (Infernal is thousands of hours *by design*); if the Pass shared that XP, either ranks would trivialize or the Pass would be unreachable. So the Pass fills from **achievements**, which rewards *daily play* without touching the rank curve.
- **Earned via achievements / checkpoints** — small daily / weekly / season goals, each worth a chunk of **Pass XP** (see below). Everything is a discrete "did the thing" checkpoint, not a raw-hours meter.
- **Verified-effort only** (Step 18): achievements only fire off already-counted, verified lock-ins — sub-30s sessions and self-reported junk don't qualify.
- **Tier cost — gentle ramp** in Pass XP (early tiers cheap for momentum). Representative total ≈ 40,000 Pass XP to max tier 100. **Server-tunable**, no client math.
- **Design target:** a player who does **a few achievements most days** finishes ~tier 100 by season end; a casual player reaches ~30–50; the **free lane always gives everyone a real haul**.

## Pass XP — the achievement system
Achievements are the *only* source of Pass XP. Three cadences; representative values (all server-tunable):

**Daily** (reset every day · each claimable **once/day** — this is the cap that keeps progression about consistency, not marathoning):
| Achievement | Pass XP |
|---|---|
| First lock-in of the day | 50 |
| 3 lock-ins today | 75 |
| A deep session — 90+ min in one lock-in | 100 |
| A gym lock-in | 60 |
| Try a different goal type than yesterday | 40 |
| Lock in with a friend / in a campfire | 50 |

**Weekly** (reset weekly):
| Achievement | Pass XP |
|---|---|
| 6 active days this week | 300 |
| 10 hours locked in this week | 250 |
| 5 gym sessions this week | 200 |
| Win a challenge | 200 |
| Hit your weekly goal | 150 |

**Season / milestone** (one-time):
| Achievement | Pass XP |
|---|---|
| Reach a new rank this season | 500 |
| Finish a full campfire challenge | 300 |
| 30-day streak | 500 |

**Wellbeing guardrail (non-negotiable).** Because daily achievements are **once-per-day**, you *cannot* grind the Pass by marathoning — the deep-session achievement rewards **one** good 90-min block, not ten. Progress comes from **showing up consistently and varying your goals**, exactly the habit the app exists to build. No "season ends in 3h!" pressure — gentle reminders only.

## Reward lanes
- **Free lane:** a reward at **milestone tiers** (5/10/25/50/75/90/100) + embers sprinkled between; two free-exclusive cosmetics; a free capstone at 100. Everyone who plays a season walks away with real stuff.
- **Premium lane:** a reward at **every tier** (that's the value) — mostly embers + boxes, the **season-exclusive cosmetic set** at milestones, a monthly-feel **ember stipend** spread across tiers, boxes scaling Kindling → Promethean, a **Legendary** milestone and a **Mythic capstone**, plus a **completionist badge** at 100.

### The Emberfall set (S1 premium-exclusive — never in boxes, never re-issued)
A themed cosmetic set only obtainable from this season's premium Pass:
- **Emberfall Flame** (exclusive colourway) · **Emberfall Halo** · **Emberfall Card** texture · **Emberfall Banner** · title **"Kindled by Emberfall"** · capstone **"Emberfall Ascendant"** God-Flare (Mythic, tier 100).
- These are added to ITEM_CATALOG.md tagged `source: forge-pass-S1` (earn-only, season-locked). Future seasons ship their own set.

### Representative tier map (100 tiers — milestones shown; unlisted premium tiers = embers or a small box)
| Tier | Free lane | Premium lane |
|---|---|---|
| 1 | 10 embers | **Emberfall Flame** + 25 embers |
| 5 | Kindling box | 50 embers + Emberfall Card |
| 10 | 25 embers | Ignition box + **Emberfall Halo** |
| 25 | Uncommon box | Furnace box + 200 embers |
| 50 | free-exclusive **Title** | **Emberfall Banner** + Hephaestus' Chest (Legendary box) |
| 75 | 50 embers | Furnace box + 500 embers |
| 90 | Kindling box | Vessel of Hestia box + "Kindled by Emberfall" title |
| **100** | a Rare flame (free capstone) | **CAPSTONE:** "Emberfall Ascendant" God-Flare (Mythic) + **"S1 Completionist"** badge + Promethean Vault |

## Ethics & wellbeing (non-negotiable)
- **Cosmetics + currency only** (Rule 0). Premium is a paid **cosmetic** track — it never sells rank, XP, standing, or leaderboard position. Embers only buy cosmetics.
- **Effort-gated** by verified XP (Step 18) — the Pass fills off already-counted real work, never self-reported junk.
- **No burnout incentives.** Tier costs are calibrated so completion reflects a *consistent* healthy habit, not marathoning; the effort economy's short-lock-in floors + diminishing returns (Step 18) already blunt grinding. **No aggressive "season ends in 3h!" FOMO** that would pressure unhealthy sessions — gentle season-end reminders only.
- **Free lane always meaningful** — no reward that matters is locked behind money beyond the subscription perk; anyone can earn a good season haul free.

## Build hooks (Step 21k)
- Data-driven **tier table** (server config: XP-per-tier curve + per-tier free/premium rewards). Client only reads it.
- **Claim flow:** claimed rewards grant into the Inventory (21a/21i) via the same grant path; premium rewards gated on a **Pass-ownership check** (does the user own THIS season's Pass) — buying mid-season retroactively unlocks premium for all already-climbed tiers.
- **Pass XP engine:** an `achievements` system (server-authoritative) that detects checkpoint completion off verified lock-in events and credits Pass XP; daily/weekly rows reset on their cadence; each daily is once-per-day. Pass XP is a distinct ledger from rank XP.
- Shares the **season clock** + season-close logic with grantReward (21d); Pass reset + re-theme on season roll.
- Entry from the **shop** (mock 56 banner) and/or a dedicated Pass tab; update the shop banner to read **Tier X / 100**.
