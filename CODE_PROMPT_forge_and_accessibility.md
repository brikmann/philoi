# Code Prompt — add the Forge + fold the AccessibilityService into the build

Two additions to the wave build. They're very different sizes: #1 is a merge + a flag + a Play-review decision; #2 is a **net-new crafting subsystem** (no backend exists yet). Read the flags before running — each has a decision that's Noah's, not the agent's.

Branch off the current wave branch (`worktree-focus-nudge`).

---

## 1 · Fold the Focus Nudge AccessibilityService into the main build

Today the Android Focus Nudge (instant app-blocker, #155) lives on its own branch and is gated OFF by a build-time flag, specifically so the closed-test build ships clean and isn't held up by Google's review. Noah wants it in the main build.

**Do:**
- Merge `worktree-focus-nudge-android` (3 commits on `worktree-focus-nudge`) into the wave branch. It carries the AccessibilityService, the curated app picker (`modules/philoi-focus-nudge/android-guarded-apps.json`), the config plugin, and the `.easignore` fix.
- Turn the build-time flag **on** for the target build profile in `eas.json` — add `"FOCUS_NUDGE_ANDROID": "1"` to that profile's `env`. (The flag drives both the config plugin's manifest generation and the JS gate; Play reads the manifest, so a JS constant wouldn't work — see the #155 build notes.)

**DECIDED (Noah): keep the AccessibilityService IN the Android test build — it's a key feature testers must exercise.** So set `FOCUS_NUDGE_ANDROID=1` on the profile the Android test build ships from (`preview`, and `production`), NOT only production. The service is part of what testers evaluate.

**🔴 Operational consequence — plan for it, it's not a blocker but it has lead time.** A build whose manifest declares AccessibilityService needs the **Play sensitive-permission declaration** and goes through Google's **extended review** before it's distributable on that track (up to several weeks). So the test build is only usable by testers once that clears. To keep the lead time from surprising the timeline:
- Record the **demo video** (disclosure → enable → nudge firing) against the flag-on build, and fill `PLAY_ACCESSIBILITY_DECLARATION.md` — do this the moment the AAB is up, since the review clock starts on upload. Getting these ready now shortens the wait.
- If Noah wants *some* testers on the build **before** the accessibility review clears, the **Internal testing** track has far lighter review than the closed track — a flag-on build can reach a small internal group quickly to exercise Focus Nudge, while the 12×14-day closed test (#68) runs its course. Offer this as the fast path; it's not required.
- **Report which profiles you set the flag on**, and confirm a flag-off build (if any profile keeps it off) still produces a clean manifest.

**Done =** the AccessibilityService code is merged into the wave tree; the flag is set per Noah's chosen profile; a flag-off build still produces a clean manifest (no `<service>`, no `<queries>`); a flag-on build declares exactly what the declaration claims (`typeWindowStateChanged` only, `canRetrieveWindowContent=false`).

---

## 2 · The Forge (mocks 155 / 156)

**The design is settled (Noah).** The Forge is NOT a new currency or crafting economy — there are **no scraps as a separate resource, no costs, no yields to tune.** "Scraps" just means **unwanted cosmetics you already own.** The Forge siphons the existing item economy: feed it duplicate/unwanted cosmetics, get a higher-rarity cosmetic. Relics are never forged (they're earned via secret/Greek or discipline/work). Backend is still net-new (there's no craft RPC today), but bounded — it's an inventory-combine, not a resource system.

### 2a · The mechanic (confirmed)
**Tier-up combine:** consume **N owned cosmetics of the same rarity → 1 cosmetic of the next rarity up.** The output tier is *guaranteed*; the "rarity-gambled reveal" (mock 155's hammer strike) is *which* item of that tier you get — random from that rarity's pool. The user picks the reforge path at the top of the screen (mock 155's selector — keep it).

Ratios (Noah, confirmed — 5 for the first step, ×3 every step after, all the way to Mythic):
| Feed | Get |
|---|---|
| 5 × Common | 1 × Uncommon |
| 3 × Uncommon | 1 × Rare |
| 3 × Rare | 1 × Epic |
| 3 × Epic | 1 × Legendary |
| 3 × Legendary | 1 × Mythic |

(Noah's shorthand wrote "3 U → 1 E"; read as the full ladder above since Rare is a real cosmetic tier — do not skip Rare. Mythic IS forgeable, it's the top output.)

Rules:
- Inputs must be **owned cosmetics of the selected rarity** (any families — a flame + a card + a particle of the same rarity are interchangeable fuel). Relics are never eligible. Legendary is a valid input (3 Legendary → 1 Mythic); Mythic is only ever an output, never an input.
- The N inputs are **consumed** (removed from inventory); one next-rarity cosmetic is granted.
- **Output is ONLY ever an item you don't already own** (Noah's final call — not "prefer un-owned," *only* un-owned; no dupe-salvage fallback). The forge never pays embers in place of an item and never rolls a dupe. Matches mock 155's on-screen promise ("a random Epic you don't own").
  - **Edge — you own the whole target tier:** if the user already owns every droppable item at the target rarity, there is nothing un-owned to forge toward, so that rung is **disabled** — the RPC rejects with a clear reason (e.g. `tier_complete`), and the client greys the rung and explains ("You own every Epic — nothing to forge toward"). It is NOT allowed to fall back to salvaging into embers.
  - **⚠ Amendment to the built 0138:** the shipped RPC currently *prefers* un-owned with a dupe-salvage fallback. Change the roll to draw only from the un-owned subset of the target-rarity drop pool, and replace the salvage fallback with the `tier_complete` rejection above. Keep the season/relic/starter input gates and the consume-in-one-transaction guarantee untouched. Re-run the rolled-back test harness (the 12× `3L→1M` case now also asserts the output is never already owned, and add an all-owned case that must reject).

### 2b · The optional second mode — NOT in this build unless Noah says so
The "shove in mixed rarities → gamble → maybe pop an Epic/Legendary, slim odds" idea is **a separate addition**, per Noah. Do **not** build it here. If wanted later it's its own mode with its own odds table (a real gamble, unlike the deterministic tier-up above). Leave a clean seam for it but ship only the tier-up combine now.

### 2c · Build
- **Migration (additive, wave rule — restate nothing):** a `forge_combine(rarity, item_ids[])` RPC — `SECURITY DEFINER`, **server-authoritative**, **REVOKEd from anon**, EXECUTE to `authenticated` only (same discipline as the #151 revoke / #144 validation). The server: verifies the caller owns exactly the required N items of that rarity and that they're cosmetics (not relics), consumes them, rolls a random cosmetic of the next rarity from the catalog, grants it, and returns it for the reveal. Reject wrong counts / wrong rarity / unowned / relic inputs. Idempotent per call; no way to consume items without granting, or vice-versa (do it in one transaction).
- **Client screen `src/app/forge` (`/forge`), per mock 155:** the reforge-path selector → pick which owned items to feed → forge → **hammer-strike reveal** of the result. Reuse the existing reward-reveal / box-open reveal; it reads the RPC's authoritative result and never re-grants. Show the user's eligible items per rarity so they can pick fuel.
- **Entry points, per mock 156:**
  - Drawer **Rewards** group gets its Forge row — already scaffolded in `src/components/nav/app-drawer.tsx` (the comment says it's "one line the day the screen ships"), `PhiloiIcon name="forge"` (anvil exists), plus mock 158's `.mrow.forge` ember treatment.
  - A **Forge shortcut in Inventory** (mock 156 frame 2) — natural on a dupe/unwanted item ("send to Forge").

### 2d · 🔴 Season / Emberfall items are NEVER forgeable — in or out (hard requirement)
Forging must not be able to **mint** a season-exclusive mythic (breaking the season grind's exclusivity) or **consume** a hard-earned season item by accident. Both are covered by one principle: **the forge operates solely over the loot-box drop pool.**

- **Output pool = the box drop pool for the target rarity** (the same pool `0069`/`0090` define, e.g. the mythic entries `flame-stormforge`, `particle-void-smoke`, `flare-zeus-wrath`, `flare-inferno`, `halo-hades`). Season items are granted with a season source (`economy_grant_cosmetic(..., 'forge_pass' | 'earned', ...)` — e.g. `flare-emberfall-ascendant`) and are **never in the drop pool**, so `3 Legendary → 1 Mythic` can only ever roll a drop-pool mythic, never Emberfall Ascendant or any season/Flame-Pass exclusive. Reuse the box's pool as the single source of truth — do not hand-list it.
- **Input eligibility = drop-pool items only.** An owned item whose provenance is season/exclusive (grant `source` in `forge_pass`/`earned`, or, equivalently, whose key isn't in the drop pool) is **not eligible fuel** and cannot be selected or consumed. Verify the owned-cosmetic row records its grant `source`; gate on it. This also keeps starter/default-loadout items (#88) from being fed if they're outside the drop pool — flag that edge case if it bites.
- The client screen must not even *show* season/exclusive items as selectable fuel, and the RPC must **reject** them server-side regardless of what the client sends (defence in depth — a crafted call must not strip someone's Emberfall mythic).

**Done =** `/forge` renders mock 155; feeding N same-rarity owned cosmetics forges one of the next rarity with the hammer-strike reveal (server-authoritative, inputs consumed, full C→U→R→E→L→M ladder, Mythic as top output, relics rejected); **season/Emberfall-coded items can neither be produced nor consumed by the forge** (output drawn from the box drop pool, season-sourced items rejected as input); the drawer Forge row and the Inventory shortcut both reach it. Mixed-rarity gamble mode is deliberately NOT included.

---

## Guardrails
- Forge economy RPCs follow the post-#151 rule: `SECURITY DEFINER`, server decides cost/reward, `REVOKE ... FROM anon`, EXECUTE to `authenticated` only. Prove it both directions.
- Migrations additive-only (wave rule): restate no existing function; prove `prosrc` before/after removes nothing.
- §1 flag is DECIDED: on for the Android test build (`preview` + `production`). The accessibility review lead time is expected and accepted — just get the declaration + demo video ready on upload so it doesn't stall.
