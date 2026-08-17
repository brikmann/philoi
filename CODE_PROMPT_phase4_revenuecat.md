# Code prompt — Phase 4: RevenueCat monetization (#71 · NATIVE build)

> **Scheduling (logged):** RevenueCat is **DECOUPLED from the Ember polish native build**. The polish
> (Live Activity + Notifee) rides its own native build NOW; RevenueCat rides a **separate later native
> build** after Monday's paid agreement is Active. Build the code now against placeholders; just don't
> block the polish build on it.

Wire real-money IAP: the **Forge Pass** unlock and **ember packs**. The Forge Pass gate is already wired
behind the stub and `grant_forge_pass` is ready for the webhook (per your last pass) — this connects
RevenueCat to that seam, adds the success screen, and sets up the store products. This is the one native
dependency left for v1.

## Real-world prerequisites (Noah — NOT code; the usual bottleneck)
1. **Apple:** Paid Apps agreement signed + banking & tax filled in App Store Connect. You literally
   cannot sell IAP until this is done.
2. **RevenueCat:** create the account + project; grab the iOS public SDK key.
3. **App Store Connect:** create the IAP products (list below) with pricing; mirror them in RevenueCat
   (offerings + an `forge_pass` entitlement). Product IDs must match between the two.

## Products
- **Forge Pass** — id **`app.philoi.forge_pass.season`** — **$9.99, one-time per season** (non-renewing) → grants the `forge_pass` entitlement
  for the CURRENT season only; a new season needs a new purchase. (DECISION: one-time-per-season vs an
  auto-renewing subscription. Recommend one-time — it matches "buy this season," no surprise renewals.
  Flag if you want recurring revenue instead; RevenueCat handles either via the same entitlement.)
- **Ember packs** — **consumables**: **500 / 1,200 / 2,600 / 7,000 embers** (matches the in-app Buy
  Embers screen). Product ids `app.philoi.embers.500 / .1200 / .2600 / .7000`. The webhook maps each id →
  its ember amount (500/1200/2600/7000) and grants that on purchase.

Integrity: sells cosmetics (the pass) + currency (embers) only — never XP, rank, streaks, or standing.
Consistent with the whole model.

## Client — react-native-purchases (native → EAS build)
- Add the RevenueCat Expo config plugin; `Purchases.configure({ apiKey, appUserID })` on launch, using
  the user's **Supabase user id as the RevenueCat appUserID** so entitlements map to the account.
- **Paywall entry points:** the Forge Pass "$9.99 Unlock" strip (mock 87) and the shop "Buy Embers"
  section. Fetch offerings → `purchasePackage()`.
- **Purchase success screen** on completion: Forge Pass → play the L0 instant-unlock reveal (Emberfall
  Ascendant Flare + Forge Flame + 1,000 embers); ember pack → ember-grant toast/screen.
- **Restore Purchases** button (Apple REQUIRES it) — in Settings + on the paywall.
- Handle every state: already-owned, user-cancelled, pending, network error → grant nothing on failure.

## Server — secure grant (never trust the client)
- **RevenueCat webhook → Supabase edge function** is the source of truth:
  - Forge Pass entitlement active → `grant_forge_pass(user, current_season)` (already built).
  - Ember pack → `economy_move_embers(user, +packAmount, 'iap', event_id)`.
  - **Idempotent by RevenueCat event id** so webhook retries can't double-grant.
- Client shows optimistic UI; on app focus call `Purchases.getCustomerInfo()` and, if an entitlement is
  active but the grant hasn't landed, hit a reconcile RPC. Replace the `billing.ts` stub with this.

## Season interaction
- Gate the Forge Pass purchase + grant on `season_phase()` / the Sept 10–Dec 23 window (0074). Buying
  unlocks the current season; XP accrual + level claims already gate on the same window.

## Ship + test
- Cut a **native EAS build** (react-native-purchases) → TestFlight. IAP runs in **sandbox** there:
  create a sandbox tester in App Store Connect, buy the Forge Pass + each ember pack, and verify:
  webhook grants fire, success screen shows, Restore works, entitlement maps to the right account, and a
  cancelled/failed purchase grants nothing. Confirm **no double-grant** on a webhook retry.
- App Store Connect: IAP products "Ready to Submit," attached to the app version → real purchases go
  live with the App Store release.

## Start NOW — no keys / no agreement needed (build in parallel while tax processes)
Code can build ~all of this immediately and flip the keys in later:
- Add `react-native-purchases` + the RevenueCat Expo config plugin; scaffold `Purchases.configure()`
  behind a flag, keys via env (placeholder for now).
- Replace the `billing.ts` stub with the real RevenueCat-backed impl (offerings, `purchasePackage`,
  `getCustomerInfo`, restore) — wired but gated.
- Build the **webhook edge function** (RevenueCat → `grant_forge_pass` / `economy_move_embers`,
  idempotent by event id); deploy + test against a mock RevenueCat payload.
- Wire the paywall hooks: Forge Pass "$9.99 Unlock" strip + shop Buy-Embers section → `billing.ts`, plus
  the purchase **success screen**.
- Cut the native EAS build with the SDK included so it's ready to sandbox-test.

## Waits on Noah / the agreement (env placeholders)
- RevenueCat **iOS public SDK key** + the **product ids** (from Noah's RevenueCat account).
- Real sandbox/live purchases (need the App Store IAP products → need the Paid Apps agreement Active).

## Still deferred
Android/Play Billing is a later pass. Live Activity pill stays v1.1.
