# The Forge — cosmetic crafting (analysis + spec)
_Combine low-rarity items into higher ones. Fits the Hephaestus theme, drains inventory bloat, and — critically — mints no currency._

## Why it works (economy)
We just flooded inventories with commons/uncommons (pass cosmetics + box dupes) and made salvage a pittance on purpose. That leaves junk feeling worthless. Forging fixes it **without touching the ember economy**:
- **It's a pure sink.** Forging **destroys N items to create 1** — no embers minted, ever. Strictly safer than salvage (which mints embers). The more people forge, the *fewer* items in circulation.
- **It gives junk a point.** A common you'd have salvaged for 10 embers is now a building block toward a cosmetic you actually want. Two valid outlets coexist: **salvage** (quick pittance embers) or **forge** (slow path to better cosmetics).
- **It can't be an ember exploit.** With low salvage, forging-for-embers is *strictly worse* than salvaging directly: 405 commons salvage for ~4,050 embers, but forged up to one Mythic that salvages for only 250. So nobody forges for currency — they forge for the **cosmetic**. Exactly what we want.

## The ladder (your ratios)
| Forge | Inputs | = commons |
|---|---|---|
| Common → Uncommon | **5** commons | 5 |
| Uncommon → Rare | **3** uncommons | 15 |
| Rare → Epic | **3** rares | 45 |
| Epic → Legendary | **3** epics | 135 |
| Legendary → Mythic | **3** legendaries | 405 |

So a Mythic costs **405 commons** of raw material — a real long-haul goal, not a quick craft. That's healthy: it's aspirational for f2p without being a shortcut.

## Rules that keep it safe
1. **Season-exclusive (paid) mythics are NOT forgeable.** Forge output pulls only from the **earnable** pool. This is the one hard guard — otherwise you'd craft your way past the paywall. The pass's exclusive mythics stay pass-only.
2. **Mixed inputs, RANDOM output (not player-chosen).** Inputs can be **any items of the required rarity** (mix flames, cards, particles — whatever junk you have). The output is a **random item of the next rarity you don't own — any type**. Deliberately not a pick: letting people choose the type removes the reason to reroll and hands them exactly what they want every time. Randomness is what makes **Stoke (reroll)** meaningful and keeps the forge from being a precise crafting shortcut.
3. **Dupe-protected.** The roll only ever hands you an item you don't own; if you own everything in the next rarity, the forge is blocked (nothing to gain).
4. **Stoke = optional reroll (not a fee to forge).** The base forge is **free** — the consumed items are the cost. **Stoke** lets you pay a small ember amount to **reroll the result once** if you don't like what the forge produced. Purely optional, and the only reason it works as a sink is that output is random. Can ship at 0 and tune.
5. **Earned/forged items still can't be re-sold above their salvage** (existing rule) — no buy-low/forge/sell-high loop.

## How it plays out for a player
- Casual: salvages junk for a trickle of embers, occasionally forges a stack of commons into an uncommon they like. Inventory stays tidy.
- Grinder: hoards dupes, forges up the chain over a season toward an **earnable Mythic** — a genuine flex that cost time, not money. Great retention hook.
- Whale: still buys the pass for **season-exclusive mythics** (unforgeable) + convenience embers. Forging doesn't touch that.

## Monetization read
- **Doesn't cannibalize the premium draw** — the exclusives people pay for can't be forged.
- **Adds a long-term f2p aspiration** (craft to a Mythic), which is a retention win.
- **Reduces salvage-driven ember minting** — every item forged is an item *not* salvaged into embers, so it gently *tightens* the currency rather than loosening it.

## Thematic fit
Call it **The Forge** — Hephaestus' domain. You already have Anvil of Hephaestus (relic), Hephaestus' Chest (box), the ember/forge language. "Bring your scraps to the forge and hammer them into something greater" writes itself.

## Entry point — a destination, not buried
The Forge is a distinct, themed feature (Hephaestus), so it deserves a **home for it**, plus a contextual shortcut:
- **Primary: "The Forge" in the home/hamburger menu** — its own destination so it's discoverable and feels like a place you go, not a hidden inventory action. Reinforces the ember/forge identity.
- **Shortcut: a Forge action in the Inventory** — since you forge your items, a "Forge" entry alongside Salvage lets you jump straight in while managing cosmetics.
Both land on the same screen (mock 155). Recommend building the menu destination as the front door and the inventory shortcut as a convenience.

## Build notes
- `forge_cosmetic(input_keys[])` server RPC: validate inputs are owned + correct rarity + count, consume them (delete from `cosmetics_owned`), roll a **random unowned item of the next rarity, any type, from the earnable pool only**, grant it. `stoke_reroll(forge_id)` optionally charges embers (`economy_move_embers(..., 'forge')`, add enum value) to re-roll the last result once.
- **Inventory action "Forge"** (alongside Salvage) **+ "The Forge" menu entry**, both → the forge screen: pick recipe tier → select the required count of inputs → forge → reveal (with optional stoke reroll).
- Reuse the reward-reveal animation for the forged result.
