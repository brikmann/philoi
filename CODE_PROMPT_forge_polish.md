# Code Prompt — Forge polish (copy + center the strike + CTA tail) + rarity chime ladder

**Forge logic is confirmed correct on-device** (throw items in → guaranteed random unowned next-tier item; closed rungs read correctly; sell salvage works). This is a **pure polish pass** — do NOT touch the forge algorithm, eligibility, or the drop/grant path. Four items. §1–§3 are client/OTA on `integration-wave1` (one branch, one Metro, no rebuild). §4 is an audio-asset swap (assets provided separately).

---

## §1 · Kill the stale-AI-slop copy on the Forge screen — let the visuals carry it
`src/app/forge.tsx`. The screen is **text-heavy** — the "WHAT YOU'LL GET" block is two dense paragraphs, and the empty states ("No epics to spare…", "Every mythic is yours…") are long. Noah: *"reads like stale AI slop copy (lots of text) even though the visuals should be doing more of the work."*

**Do — cut, don't rewrite-longer:**
- **"WHAT YOU'LL GET" block:** compress to **one short line**. The essential facts are: *a random {next-tier} you don't own · never a duplicate · never embers*. Drop the "flame, particle, card, halo, whatever the Forge spits out, one of the N still missing…" enumeration and the "Season and Flame Pass items can never be forged… Relics are earned, not fuel" paragraph — move that to a tiny secondary/muted line or an (i) tooltip, not body copy on the main flow. The colored `{next-tier}` word + the mystery `?` output slot already communicate "random next-tier item."
- **Empty states** ("No epics to spare", "No rares to spare", "Every mythic is yours"): keep the **one-line verdict** ("No rares to spare." / "Every mythic is yours.") and the single action (Open the Shop / pick another rung), cut the explanatory second paragraph to a short muted line. The 0-eligible state doesn't need three sentences.
- Keep the rung selector, the input slots + `?` output, the eligible-count line ("Ready — one uncommon you don't own, guaranteed"), and the footer ("The Forge is free — the items are the cost.") — those are tight and good.

**Done:** the Forge screen reads lean — the slots/rarity color/`?` do the explaining, prose is one line per block, no multi-sentence AI-explainer paragraphs.

## §2 · Center the hammer strike — it renders at the bottom, should be mid-screen
`src/components/economy/forge-strike.tsx` + `src/app/forge.tsx`. The strike animation plays **anchored to the bottom of the screen**. Root cause: `forge-strike.tsx`'s `stage` style is `justifyContent: 'flex-end'` + `paddingBottom: 40`, and every piece (anvil `bottom:66`, hammer `bottom:106`, sparks, flash) is absolutely measured **from the stage's bottom edge** (see the comment at ~line 206). Mounted in `forge.tsx`'s `strikeWrap` (`flex:1`), the stage fills the screen so that bottom edge = bottom of the phone.

**Do:** keep the composition intact (anvil-at-base-of-its-own-block, hammer above, sparks radiating) but **center the whole block vertically**. Cleanest: give the `stage` a **bounded height** (~240–260px, enough to contain hammer `bottom:106` + spark travel) instead of filling flex, and center it — e.g. set `strikeWrap` to `justifyContent:'center', alignItems:'center'` and the `stage` to a fixed height/width rather than `flex-end` fill. Then move `forgingKicker` (currently `top:90`) to sit just **above the now-centered stage** rather than up near the status bar. Verify the closing flash still washes the kicker (z-order unchanged: kicker under strike).
- Optional sharpen (Noah: *"could be sharper and more impactful"*): a touch more hammer travel/scale on impact, a crisper flash, slightly punchier spark burst — tasteful, don't overdo. Respect `reduceMotion`.

**Done:** the hammer + anvil strike plays **centered** on screen (kicker above it), not pinned to the bottom; impact reads a bit crisper; reduce-motion still honored.

## §3 · Remove the "· N Xs make a Y" tail on the item-detail Forge CTA
`src/app/inventory/[itemId].tsx` line ~248. The button currently renders:
`Send to the Forge · {need} {rarity}s make a {into}` → e.g. *"Send to the Forge · 3 epics make a legendary."*
Noah wants the tail gone. **Make the CTA just `Send to the Forge`** (keep the forge icon). The rung math is explained on the Forge screen itself; the item CTA doesn't need it.

**Done:** the item-detail forge button reads `Send to the Forge` with no "N Xs make a Y" suffix.

---

## §4 · Rarity unlock-chime ladder — more substance as it climbs (audio-asset swap)
`src/lib/sound.ts` reveal ladder: `reveal-common` … `reveal-mythic` (assets in `assets/sounds/reveal/`). Noah: *"Uncommon through Legendary read as progressively fancier 'dings' while Mythic is the only one with substance."* The escalation is too flat — the mid tiers are all thin dings; only Mythic has body.

**This is an asset re-author, not code** (files are already wired + preloaded). Replace the four mid-tier files so each rarity gains **weight/body** as it climbs, not just brightness:
- **common** — stays dry/flat (cardboard flip, no reward feel). Unchanged.
- **uncommon** — a real *ding* but with a short warm tail (not just a click).
- **rare** — add a low fundamental under the chime so it has some chest, brighter chord.
- **epic** — noticeably more body: a bloom/pad under the strike, longer tail.
- **legendary** — should already feel *substantial* — a resonant hit with a sustained shimmer, near-Mythic weight (this is the one Noah feels is under-delivering most).
- **mythic** — keep its ethereal drone as the apex (unchanged); legendary should approach it, not tie it.
Same length discipline as the rest (fire once per open, mono 44.1k, peak −1 dBFS). New files drop in at the existing paths/names — no `sound.ts` change unless a filename changes.

**Done:** playing the ladder top-to-bottom, each tier is an audible step up in *substance* (not just pitch), legendary lands with real weight, mythic stays the apex.

---

## §5 · Add an Equip option on the unlock reveal
Noah: *"add an equip option when you unlock a new item."* Audit the three reveals; **the Forge reveal is the gap** — box-open already has it.

**Already done (reference pattern, don't duplicate):** the single box-open reveal `src/app/shop/open.tsx` already has an **Equip {type}** primary button (~line 270) wired to an `onEquip` → `equipCosmetic(item)` with an `equipping` busy state and an error `Alert`. This is the pattern to mirror.

**The gap — `ForgeReveal` (`src/app/forge.tsx`, ~line 459–526).** The forged item is right there (`const item = result.item` — carries `id`, `rarity`, `type`, `name`, `slot`), the reveal even auditions it (`useRevealPreview`/`useRevealSting`), but the only CTAs are **"Add to inventory"** (`onDone`) and **"Forge again"** (`onAgain`). Add **Equip** as the primary action:
- Add an **`Equip {item.type.toLowerCase()}`** primary button that calls `equipCosmetic(item)` (from `@/lib/api/inventory`), with an `equipping` busy state (`Equipping…`) and an error `Alert` on failure — exactly like `shop/open.tsx`'s `onEquip`. On success, equip is done; then let the existing flow continue (drop to inventory, or show an "Equipped" confirmed state — match how box-open resolves after equip).
- Re-rank the CTAs: **Equip = primary**, **Add to inventory = secondary/ghost**, **Forge again = tertiary/ghost**. Keep "Forge again" and the inventory route intact.
- **Guard:** only show Equip if the item has an equip slot (the forge only outputs slotted cosmetics — flame/particle/card/halo — so it should always, but guard the same way inventory does so a slotless grant can't crash it, falling back to just Add-to-inventory).
- The "unknown catalog key" branch (no `result.item`) has nothing to equip — leave it as "Go to inventory."

**Multi-box menu** (`MultiMenu` in `shop/open.tsx`) stays as-is (a batch of pulls goes to inventory to equip individually) — this item is about the **single-item unlock reveal**.

**Done:** unlocking an item on the Forge reveal offers **Equip** as the primary action (busy + error handled, mirroring box-open), with Add-to-inventory / Forge-again demoted; box-open already satisfies this.

---

## §6 · Forge round-2 polish (Noah on-device — strike centering landed, "very very good"; three left)
All in the Forge. Client/OTA, no rebuild.

### 6a · Center the cosmetic art in the Forge cards/slots (currently bottom-aligned)
Noah: *"the cosmetics as they appear [should] center in the card: currently they are bottom aligned."* Note the forge recipe **`slot`** style already has `alignItems:'center', justifyContent:'center'` (forge.tsx ~line 631) — so the slot box *is* centered. The art still hugs the bottom because **`ItemArt` (`src/components/economy/item-art.tsx`) draws the cosmetic anchored to its own baseline** — flames/particles are drawn "standing on the ground," so inside a small square frame they sit low.
- Fix so the cosmetic is **vertically centered within its frame** in the Forge — the recipe input slots (`ItemArt size={30}`, ~line 304), the eligible-item picker cards (`size={34}`, ~line 402), and the output/`?` slot. Cleanest is to center the glyph inside `ItemArt`'s own box (so it's consistent everywhere it appears at chip size); if that baseline anchor is deliberate for other surfaces (the reveal hero at `size={140}`, the home flame, box-open), add a `centered`/`align="center"` prop that the Forge chips pass rather than changing the default globally.
- **Verify it didn't shift** the big reveal hero or any flame that intentionally sits on a base — check the Forge reveal (`size={140}`), inventory grid, and shop before/after.

### 6b · Play a strike sound when the anvil is hit (currently silent)
`src/components/economy/forge-strike.tsx` animates the hammer onto the anvil (`anvilHit` shared value, the impact keyframe) but **plays no sound.** An asset already exists — **`sfx-heavy-anvil-slam.mp3`** (`assets/audio/cosmetic/`, already a registered cue `'sfx-heavy-anvil-slam'` in `sound.ts`; also used by `rankup-titan-boom`). Fire a metal-strike cue **at the moment of impact** (when the hammer lands / `anvilHit` peaks), using the existing sound player. Reuse `sfx-heavy-anvil-slam` (or add a dedicated `'forge-strike'` cue pointing at the same asset so its volume/variant can be tuned independently). Respect the user's SFX/mute setting; fire once per strike, synced to the visual impact (not on mount). Reduce-motion may shorten the animation — still play the strike sound on the forge action.

### 6c · "The Forge" title → top-left (currently center)
forge.tsx header `styles.top` is a `flexDirection:'row'` with `justifyContent:'space-between'` and three children — Back (left), `titleRow` = forge icon + **"The Forge"** (middle), `EmberPill` (right) — so the title centers. Noah wants it **top-left**. Group the back chevron **and** `titleRow` together in a left-hand `View` (row, small gap) with `EmberPill` alone on the right, so space-between pushes the title to the left edge next to Back and the ember pill stays far right. Apply to every header variant in the file (the empty/closed state at ~line 224 uses the same `top`/`titleRow` — keep them consistent).

**Done (§6):** Forge cosmetics sit centered in their slots/cards (hero untouched); the anvil strike plays `sfx-heavy-anvil-slam` synced to impact; "The Forge" title reads top-left across every state of the screen.

---

## Guardrails
- Do NOT touch forge logic/eligibility/drop-grant — logic is confirmed correct. §1–§3 + §6 are presentation only; §5 reuses the existing `equipCosmetic` RPC (no economy change). §6b reuses an existing audio asset (no new file).
- One branch (`integration-wave1`), client/OTA for §1–§3, asset swap for §4 — no migrations, no rebuild.
- Keep `reduceMotion` honored on the strike; keep the reveal cues firing once per open.
