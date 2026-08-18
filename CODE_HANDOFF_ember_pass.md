# Code handoff — Ember polish pass (pre-launch, ship Aug 20)

One map for this pass. Each item points to the mock + spec that has the detail; this doc is the **order,
dependencies, and acceptance**. Most is OTA; two items are the one native EAS build.

> **Naming — "Forge Pass" → "Flame Pass" (display only).** Rename the **user-facing label** everywhere it's
> shown (screen titles, the hamburger item, season-track copy, marketing). **Keep all internal identifiers as
> `forge_pass`** — `forge-pass.ts`, `grant_forge_pass`, the RevenueCat entitlement `forge_pass`, and the
> product id `app.philoi.forge_pass.season`. They're not user-visible; renaming them churns the App
> Store / RevenueCat setup and DB functions for no benefit.

---

## 0 · Deploy first — unblocks several items below
Run **`DEPLOY_migrations_0062-0075.sql`** (SQL Editor) or `supabase db push`. This is the prerequisite for
the ember-unification, challenges, equip, Flame Pass, season gating. Nothing in §4 works until this lands.

## 1 · The design language — `DESIGN_LANGUAGE_EMBER.md`  (OTA, do FIRST — everything else consumes it)
Establish the app-wide system, then build the rest on top:
- **Flame = logo/brand** (app icon, splash, wordmark lockup); retire the campfire vector.
- **Deep-purple** radial bg on every screen; **ember-gradient CTA with black text** as THE primary button
  everywhere; **crisp ember token** (`design-mocks/86`) as the only currency symbol (retire 🔥 / hollow).
- **Rank/XP bars fill in the current tier's colour; the forward element (daily fire / `~time`) is ember
  orange** (§7).
- Ship shared primitives — `<FlameLogo>`, `<EmberToken>`, `<PrimaryButton>`, bg + colour tokens — and do
  **one reskin sweep** so screens consume tokens, not copies.

## 2 · Three screens — `design-mocks/92-home-done-dailyfire.html`  (OTA)
- **Home:** the **flame / lock-in hub — no longer campfire-centric** (drop the campfire swipe). Emberfall
  season pill **centered** + a **hamburger** top-right → **Campfires · Friends · Inventory · Shop
  (market-stall icon) · Flame Pass · Settings** (Campfires = friend group chats, first in the list).
  Persistent **bottom nav: Home · Leaderboards · Challenges · Profile**. Pulsing **flame hero**. Under it:
  **hexagon rank badge**
  (division numeral inside, tier-tinted) + a wide **XP bar in the tier colour** with **today's fire encased
  inside as the orange zone** ("620 XP to today's fire").
- **Done (lock-in complete):** flame replaces the campfire vector; clean summary (XP, duration, rank
  progress). **No "+50 fire bonus".**
- **Daily fire:** deep purple, **roaring flame** + sparks, **"You're on fire, {first name}"** (white +
  ember emphasis, **no yellow**), **crisp ember tokens** flying into the balance.
- **Logo:** flame as app icon + "philoi" wordmark lockup.

## 3 · Lock-in Live Activity — `CODE_PROMPT_lockin_pill.md` + `design-mocks/91-lockin-pill.html`  (NATIVE)
iOS **Live Activity** (Lock Screen + Dynamic Island) + Android **ongoing notification** (Notifee) + the
**in-app lock-in screen**. Division-targeted rank bar (tier colour) + **orange projection** (`~time`).
**The in-app pill is RETIRED** — no floating header on other pages. **Cut this as its own native build NOW
(the polish) — decoupled from RevenueCat (§6).** Supersedes #73.

## 4 · Ember unification  (post-deploy, OTA)  — see the note in mock 92
Not two currencies — a deploy gap. `0062-0075` already grants daily-fire embers into the same `ember_wallet`
(the `daily_fire_economy` trigger, `economy_move_embers(..., 'flame_meter')`). After §0 deploy:
1. point **`FlameMeterComplete`** at the `ember_wallet` balance (not the old `daily_fire` count);
2. **one-time backfill** the ~25 orphaned daily-fire embers into the wallet;
3. swap the hollow-outline ember → the **crisp token** everywhere (balance chip, costs, daily-fire reward).

## 5 · IAP product-id alignment — `CODE_PROMPT_iap_id_alignment.md`  (code-only, do anytime)
Align `forge-pass.ts` / `iap.ts` / the webhook to the real App Store ids: embers
`app.philoi.embers.500 / .1200 / .2600 / .7000` (amounts 500/1,200/2,600/7,000), Flame Pass
`app.philoi.forge_pass.season`. Prices come from the RevenueCat offering, not hardcoded. Update the pairing
test.

## 6 · RevenueCat integration — `CODE_PROMPT_phase4_revenuecat.md`  (NATIVE; DECOUPLED — its own later build)
Build the code now against placeholder keys per the "Start NOW" section (SDK integration, webhook, paywall
hooks). **NOT in the polish build (#1)** — RevenueCat rides its **own separate native build** after
Monday's paid agreement is Active. Decoupled so the polish ships now.

---

## Build order & channel
1. **§0 deploy** → 2. **§1 design language** → 3. **§2 three screens** + **§4 ember unification** + **§5 IAP
   ids** (all OTA / code) → 4. **native EAS build #1 — NOW, the polish** = **§3 Live Activity** (ActivityKit
   + Notifee). **RevenueCat (§6) is DECOUPLED** → a **separate later native build** after Monday's agreement,
   so the polish doesn't wait on it.
- Target: a clean **TestFlight / preview build before Aug 20**.

## Then (Noah + Claude): screen-by-screen UI inspection
After this builds, we walk **every screen** against the design language + function (deep-purple bg, ember
CTA, crisp token, flame, rank bars) and fix anything off — the final pre-launch QA before the Aug 20 ship.
