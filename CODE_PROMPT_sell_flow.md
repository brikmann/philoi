# Code Prompt — Branded sell confirm + sell-reward ember loop (mock 100)

Replace the grey **system `Alert`** sell flow with the two on-brand frames in **`design-mocks/100-sell-flow.html`**: (1) a Philoi-brand confirm screen, and (2) a sell-reward where the embers **drift up into the top-right balance** and the balance ticks up — the same ember loop already scoped for rewards. Client/OTA on `integration-wave1` (one branch, one Metro, no rebuild, no economy change — reuses `salvageCosmetic`).

**Where it all lives:** `src/app/inventory/[itemId].tsx`. Today `confirmSell()` (~line 101) fires a native **`Alert.alert('Sell {name}?', 'Selling is permanent. You'll get 🔥 {payout}.')`**, and on success a second **`Alert.alert('Sold', '{name} became 🔥 {embers}.')`**. Both grey iOS dialogs — replace both. The payout is `SALVAGE_EMBERS[item.rarity]` (`@/lib/economy/rarity`); the sell itself is `salvageCosmetic(item)` (`@/lib/api/inventory`, returns the real embers granted). **Do not touch the RPC or payout math** — presentation only.

---

## §1 · Frame 1 — branded confirm (replaces the `Alert`)
Per mock 100 frame 1. On-screen Philoi-brand confirm, not a system dialog:
- **Item art at top** — the item's `ItemArt` (the flame/cosmetic) on the twilight radial, centered near the top. **No name/rarity label under it** (the art + the question carry it).
- **Centered question:** **"Sell {item.name} for 🔥 {payout} embers?"** with **`{item.name}` colored by its rarity** (epic → the epic purple `#C79BE8`; use the existing rarity→color map / `RarityLabel` color source so each rarity tints correctly — common/uncommon/rare/epic/legendary/mythic), and the **🔥 {payout}** amount in ember (`#FFD27A`).
- **Subline** (muted, small): "Selling unequips it and is permanent." Keep the sharper wording for the **permanent/earned/one-of-one** cases the current code already special-cases (`permanent` / `source === 'earned'`) — carry those exact stakes sentences over as the subline instead of the default, so a season-stamped or earned item still reads its stronger warning.
- **Buttons pinned bottom:** primary **Sell · 🔥 {payout}** (amber→coral gradient, `onEmber` text), secondary **Keep it** (ghost). Sell → runs the salvage; Keep → dismisses.
- Match the mock's spacing/type. Reuse `ScreenBackground`, `PrimaryButton`, the brand tokens in `src/constants/theme.ts`.

**Confirm gate:** the current `needsConfirm` gate (permanent OR earned OR epic+) can stay — low-rarity throwaway commons/uncommons may still sell without the confirm screen. **But the reward loop (§2) plays on EVERY sell**, confirmed or instant. (If you'd rather always show the confirm for consistency, flag it for Noah — don't silently change the gate.)

## §2 · Frame 2 — sell reward: item dissolves into smoke, embers rise as the payout
Per mock 100 frame 2. After `salvageCosmetic` resolves (it returns the real embers), play a brief reward beat — not another route, a lightweight overlay on the item screen — then dismiss to inventory. **The theme (Noah): the item dissolves into smoke and the embers lift off it as the currency you get back — you forge items *from* embers, so selling returns them to smoke + embers.**
- **The dissolve:** the item's art (the same `ItemArt` from the confirm) **dissolves into smoke** — fades + blurs + drifts up slightly while **soft smoke wisps curl off it and rise** (grey-lavender, blurred, rising and fading). This replaces "the item just vanishes."
- **The ember loop lifts OFF the item:** a burst of ember particles **rises off the dissolving item and drifts up to the top-right balance pill**, and the **balance ticks up by {embers}** and pulses as they land. Origin is the item's position (embers come off *it*), target is the balance chip (`EmberBalance` in `src/components/economy/economy-bits.tsx`). Reuse the existing drift primitives — `src/components/drifting-embers.tsx` / the `Drifter` in `flare-perimeter.tsx` / the existing `EmberFlight` the flow already imports — don't build new particle code.
- **Copy:** **"+{embers}"** big in ember with the ember icon, **"Sold {item.name}"** under it, fading in as the dissolve completes. **No "Embers added to your balance" subline.** **Done** (ghost) dismisses to `/inventory`.
- Smoke can be a few soft blurred views animating up/out (Reanimated), or a lightweight particle emitter — keep it cheap; respect reduce-motion (skip smoke + ember flight, just count the balance up).
- **Balance authority:** the real new balance comes from the server — after the salvage, call `requestInventoryRefresh()` (`@/lib/economy/wallet-refresh`) so the pinned balance reconciles to the server value (same pattern goal-streak/settlement use). The tick-up is the *animation*; the landed value must be the wallet's, not a client-derived `before + payout` (see the goal-streak-reward "balance had nowhere to land" note, #161).
- **Reduce-motion:** honor it — if reduce-motion is on, skip the particle flight and just count the balance up (or a simple "+{embers}" + refresh), no drift.

---

## §3 · Round-2 fixes (Noah on-device)
The sell flow is built and working (`src/components/economy/sell-flow.tsx`). Two follow-ups:

- **3a · Kill the placeholder 🔥 on the Sell button.** The flow already uses the branded `EmberIcon` (SVG) everywhere *except* the Sell CTA, where the label is a plain string: `sell-flow.tsx` line ~81 — `<PrimaryButton label={`Sell · 🔥 ${formatEmbers(payout)}`} …>`. A string label can't embed the SVG, so it falls back to the raw fire emoji. Render the **`EmberIcon`** in the button instead — either give `PrimaryButton` an optional leading-icon/`children` slot so it can show `Sell · <EmberIcon size={16}/> {payout}`, or swap this one CTA for a custom pressable that lays out text + `EmberIcon` + amount. **No raw 🔥 anywhere in the flow** — grep the file to confirm line 81 is the only one (it is) and that the fix removes it.

- **3b · Add the "sold" sound — a bonfire-smoke SFX (NOT a cash cha-ching, NOT the generic whoosh).** The flow currently plays **no** sell sound, and both the reused generic `whoosh` and a synth fire-whoosh were rejected (read as generic / electric / jet). Use the authored asset **`ember-smoke.mp3`** (session outputs — a **real bonfire-coal crackle** trimmed to ~1.4s from a licensed sample, Noah-approved; not synthesized) — it matches the dissolve-into-smoke visual in §2. Register it as a `RewardCue` (e.g. `'ember-smoke'`) in `src/lib/sound.ts` and play it once on sell, timed to the dissolve/ember-lift (alongside the existing `fireEmberLand` haptic), respecting the SFX/mute setting. **Explicitly do NOT use** the uploaded `…retro-cash-register-ka-ching…`. If the asset isn't final, wire the cue and leave it swappable.

## Done
- The grey system `Alert` sell dialog is gone; selling shows the branded confirm (item art top, rarity-colored name, ember amount, Sell/Keep).
- Every sell plays the reward loop: embers drift into the top-right balance pill, the balance ticks +{embers} and pulses, "+{embers} · Sold {name}", Done → inventory.
- Payout/RPC untouched (`SALVAGE_EMBERS` + `salvageCosmetic`); balance reconciles to the server via `requestInventoryRefresh`; reduce-motion falls back to a count-up; permanent/earned items keep their stronger warning copy.
- Reference: `design-mocks/100-sell-flow.html` (frames 1 + 2).
