# Forge Pass — de-slop spec (levels screen)

Visual: `design-mocks/87-forge-pass-deslop.html`. This is the screen you land on when you tap the Forge
Pass icon.

## Why the current one reads as AI slop
A flat grid of generic reward cards with stock icons, no theme, no hierarchy, no sense of a *track*.
Fix = give it one cohesive metaphor, real cosmetic art, and clear reward states.

## The metaphor: a molten seam being forged
The progress track is a **vertical molten seam** running up through the levels. Below your current level
it's **lit** (orange→ember gradient); above, it's **cold iron** (grey). The rail *is* the progress bar —
no separate bar needed in the track. It reads as "the forge is climbing with you."

## Screen anatomy (top → bottom)
1. **Header (identity):** "FORGE PASS" wordmark (molten gradient), season name + countdown ("Season I ·
   First Flame — 23 days left"), your **Level N** big, and a molten XP bar to the next level
   ("1,240 / 2,000 XP").
2. **Upgrade strip** (only if you don't own the pass): one gold banner — "Unlock the Forge Pass · $9.99"
   → RevenueCat. Disappears once owned.
3. **Two-lane track:** each level row = **Free reward (left)** · **forge node (center, level #)** ·
   **Premium reward (right, warm-bordered + 🔒 until the pass is owned)**. Lane headers "FREE / PREMIUM"
   pinned above.
4. **Milestone levels (every 25 — 25/50/75/100):** a bigger **violet anvil node** + a hero cosmetic on both lanes (a
   flame / flare / aura), a small "★ MILESTONE ★" flag. Gives the track landmarks to climb toward.
5. **Claim CTA:** one gold "Claim Level N reward" button; "Claim all" when several are pending.

## Reward tile — the art is the product
Each tile = **real cosmetic art** (the mock uses gradient swatches as placeholders) + name + `RARITY ·
TYPE`. Pull the art by catalog id (same source as the shop, PUNCHLIST_7). No stock/emoji icons — that's
the single biggest slop tell.

## States (must be unmistakable)
- **Claimed:** dimmed tile + green ✓, seam lit through it.
- **Current level:** pulsing forge node (glowing orange) + the Claim CTA active.
- **Upcoming:** cold node, muted tiles, cold seam.
- **Premium-locked:** warm border + 🔒; tapping prompts the upgrade.
- Tap any tile → a reward detail sheet (big art, name, rarity, lore, Claim).

## Data / behavior
- Levels + rewards come from the season track (`forge-pass.ts` / #48). Free vs premium reward per level.
- XP fills from lock-ins / activity (existing pass-XP). Claiming grants the cosmetic/embers/box into
  inventory (`equipped_loadout` / `cosmetics_owned`).
- Owning the pass unlocks the premium lane retroactively (claim everything already earned).

## Scope note
JS/UI only (OTA) — the *screen* is a reskin + real-art wiring over the existing season-track data. The
only native dependency is the **$9.99 unlock**, which rides the RevenueCat build (#71). Ship the screen
in v1; the buy button lights up when RevenueCat lands.
