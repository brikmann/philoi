# Grade Challenge Reward Spec (LOCKED)
_Reward for hitting grade X in course Y. Calibrated to stay exciting without inflating the ember economy._

## The problem with raw ember scaling
The draft table paid 50–1,000 **embers** per course. Run it forward: a science student taking 5 courses, averaging a C, clears ~5 **Rare/Epic** grade challenges a semester = **~1,000–2,500 embers + 5 boxes + pass XP**, i.e. **~$30–40 of ember-shop value** — while the season pass is **$8.99** and the biggest ember pack is ~$12.99. Free grinding out-earning the paid tiers **devalues the pass and inflates the currency**. Embers are the farmable/purchasable resource, so they're the wrong thing to hand out in bulk.

## The fix — shift value off embers
Grades stay a flagship reward, but the value moves to things that **don't** inflate the currency:
- **The box** is the headline (a cosmetic gacha — vanity, not currency; salvaging to embers is lossy).
- **XP** is generous (it fuels the Flame Pass, which is progression, not a spendable resource — safe to be big).
- **A relic** caps the top (prestige: earned-only, non-tradeable, **0 economic value**).
- **Embers are a token**, not the prize.

## Achievement tier (grade → rarity)
Base from grade; **STEM (+1 tier)** vs Humanities (+0). Cap at Mythic.

| Grade | Humanities base | STEM (+1) |
|---|---|---|
| 50–59% | Uncommon | Rare |
| 60–69% | Rare | Epic |
| 70–79% | Epic | Legendary |
| 80–89% | Legendary | Mythic |
| 90%+ | Mythic | **Mythic + Guaranteed Relic** |

STEM 90%+ can't go past Mythic, so the extra difficulty converts into a **guaranteed Mythic relic** (prestige) instead of a higher box.

## Payout per rarity (recalibrated — economy-safe)
| Rarity | Box | Embers | Pass XP |
|---|---|---|---|
| Uncommon | Ignition Crate | 20 | 150 |
| Rare | The Furnace | 40 | 300 |
| Epic | Vessel of Hestia | 75 | 500 |
| Legendary | Hephaestus' Chest | 150 | 900 |
| Mythic | Promethean Vault | 300 | 1,500 |
| **STEM 90%+** | Promethean Vault **+ Mythic Relic** | 500 | 3,000 |

Embers are ~5–15× lower than the draft; XP and boxes carry the "feels big" weight; the relic is the marquee at the top.

## Honor rules still apply (from the challenge verification model)
Grades are **honor-class**:
- **Vouched** (1–2 classmates confirm) → **full box tier, −10% embers/XP.**
- **Unvouched** → **box −1 tier, −20% embers/XP.**
Combined with the low base embers, a course pays a token amount either way.

## Anti-farm caps
- **One grade challenge per course per term.** Can't re-run the same course.
- **Settles at term end** (semester cadence), not weekly — so no fast farming loop.
- Course-code required (already in the challenge spec); unknown codes default to Humanities.

## Fixed semester math (the whole point)
Same student — 5 STEM courses, C average (50–59% → Uncommon +1 = **Rare**):
- **Vouched:** 5 × (Furnace + 40 embers + 300 XP) = **200 embers + 5 low boxes + 1,500 XP** for the whole semester.
- **Unvouched:** box −1 → 5 × (Ignition + 32 embers) = **~160 embers + 5 base boxes.**

**~160–200 direct embers per semester** vs a pass that grants thousands — the grade layer no longer out-values the paid tiers. Boxes dilute *cosmetics* slightly (low tiers), not the currency; XP just moves people up the pass (where we *want* engagement). A genuinely elite result (STEM 90%+) still earns a Mythic **relic** — huge prestige, zero economic footprint.

## Flame Pass ember faucet — stop paying embers per level
The pass is the biggest faucet once XP is boosted (fast leveling, ~100 levels a season). **Any** per-level ember reward compounds into absurdity: even a token **40/level × 100 = 4,000 embers ≈ $52** of value for finishing an **$8.99** pass. So the model is wrong, not just the number.

**Fix — leveling unlocks cosmetics, not currency:**
- **Every level unlocks a cosmetic** (flame colour, particle, card, halo, etc.). Since salvage is now a pittance, a cosmetic is **near-zero ember value** — it's vanity. This is the bulk of the pass and it's inflation-safe.
- **Embers only at milestone levels (every 10):** ~**40 embers + a box** per milestone. Ten milestones a season → **~400 embers total on the free track**, not per level.
- **Premium track ($8.99):** the free rewards **plus season-exclusive mythic cosmetics** (the real draw) and richer milestone embers (~150 each) → roughly **~1,200–1,500 embers/season**. That's fine — they paid, it's gated behind a full season, and the exclusivity is what sells it.

**Free-player season budget across ALL sources** (pass ~400 + grades ~160–200 + lock-ins/dailies) targets **~600–800 embers total** — comfortably **under one pass's worth**, so paying is always the faster path to the shop. Mocks 129/136/138 updated: level-up shows the **cosmetic** unlocked; embers appear on the milestone reveal.

## Box contents & salvage — the real leak (fix this or the rest is moot)
A box's value isn't its direct embers — it's the **cosmetic inside, which salvages to embers**. Current `salvage_embers` (`0064` / `rarity.ts`):

`common 40 · uncommon 90 · rare 200 · epic 420 · legendary 900 · mythic 2000`

So a Mythic box (80–89% STEM) opens to a Legendary/Mythic cosmetic that **salvages for 900–2,000 embers by itself** — dwarfing the 300 direct payout. At this scale a single hard course is ~$8–20 of value, which breaks even with / beats the $8.99 pass. **This is the dominant faucet, and it's inconsistent** with the token grade/pass embers I set (~40).

**Fix: salvage is a dupe-protection pittance, not a currency mint.** Rescale it ~10× down so it matches the tightened earning and converting cosmetics→embers is always a bad trade (you keep cosmetics for vanity, you buy embers if you want embers):

| Rarity | Salvage now | Salvage → |
|---|---|---|
| Common | 40 | 10 |
| Uncommon | 90 | 20 |
| Rare | 200 | 40 |
| Epic | 420 | 70 |
| Legendary | 900 | 120 |
| Mythic | 2000 | 250 |

This is a **single `economy_config` change** (`salvage_embers`), and it applies to **paid box opens too** — which is *good*: you can no longer buy boxes, salvage dupes, and mint embers. Boxes are for cosmetics; embers come from the shop.

**Re-run the math after the fix:** an 80–89% STEM Mythic box = a Legendary cosmetic (kept for the flex) + ~120 salvage *if* dupe'd + 300 direct + XP ≈ **~400–500 ember-equiv, most of it a cosmetic you keep** — roughly half a pass for a genuinely hard result, not $10+ of liquid currency.

**Two guards on cosmetic dilution:**
1. **Earned/grade/pass boxes never drop the season-exclusive mythics** — those stay pass-paid-only, so the top of the cosmetic ladder can't be farmed.
2. Salvage-low means flooding mid-tier cosmetics doesn't flood *embers*; it just makes Epics common, which is fine (vanity, not power).

> Bottom line: the ember economy has to run at **one consistent scale**. Earning (grades ~40, pass ~40/level, salvage ~10–250) now all sit in the same range, the shop stays the meaningful sink, and no free source out-values what people pay.

## Monetization framing (why this coexists with the pass)
Different value props, so they don't cannibalize:
- **Flame Pass ($8.99):** season-**exclusive mythic cosmetics** (unearnable elsewhere) + convenience embers. Sells **exclusivity + speed**.
- **Grade challenges:** boxes + XP + **prestige relics**. Sells **achievement**, not currency.
The top of the cosmetic ladder (season mythics) stays paid-exclusive; grades reward you with the *feeling* and the *flex*, not a pile of spendable embers.

> Net: keep the grade→rarity ladder and STEM bump exactly as shown; **swap the ember scaling for the recalibrated table**, keep XP/boxes generous, add the guaranteed relic at STEM 90%+, apply the honor/vouch discount, and cap to one-per-course-per-term settled at term end.
