# Monetization setup — prereqs checklist (Phase 4 IAP)

Real-world setup Noah does (not Code). Do them in this order; the slow one is flagged.

## 1 · Apple Developer Program  (skip if you already have it)
- Enroll at developer.apple.com/programs — **$99/yr**.
- Choose **Individual** (fast — just Apple ID + payment). **Organization** needs a D-U-N-S number and
  takes longer; not worth it for a solo launch.

## 2 · ⏳ App Store Connect → Agreements, Tax & Banking  (THE BOTTLENECK — start today)
appstoreconnect.apple.com → **Business** (Agreements, Tax, and Banking):
- Sign the **Paid Applications agreement**.
- **Banking:** add the bank account payouts go to.
- **Tax:** you're Canadian selling on a US-based store → complete the **W-8BEN** (claims the Canada–US
  treaty rate so you're not over-withheld ~30%) + the **Canadian GST/HST Form 506** (needs a Business
  Number + RT — get one by registering for GST/HST as a sole proprietor; see **BUSINESS_SETUP_CANADA.md**).
  Get this right or payouts stall.
- **Contacts:** fill primary / financial / technical / legal.
- ✅ **Done when the Paid Apps agreement shows "Active."** You cannot create a paid IAP until then — this
  is why it's step 2 and why you start it now (bank/tax verification can take a few days).

## 3 · App record + bundle id
- App Store Connect → Apps → **+ New App**.
- The **Bundle ID must exactly match your Expo `ios.bundleIdentifier`** (check with Code / app.config).
  It's set once and can't change — get it right.

## 4 · Create the In-App Purchases
Everything is granted server-side (the webhook), so keep the product types simple:
- **Forge Pass** → **Consumable**, id e.g. `app.philoi.forgepass.s1`. On purchase the webhook grants the
  season entitlement; the account carries it, so no "restore" needed. (Alt: a Non-Renewing Subscription
  if you want Apple to model the season expiry — but Consumable + server-grant is cleaner.)
- **Ember packs** → **Consumables**, e.g. `app.philoi.embers.1200 / .3000 / .6500 / .15000`.
- Each IAP needs: product id, reference name, price, localized name + description, and a review
  screenshot. IAPs are reviewed **with** your app version → mark them "Ready to Submit."

## 5 · RevenueCat
- Create the account (free tier is fine) → a **Project** → add an **iOS app** (your bundle id).
- **Connect to App Store:** add the App Store Connect **API key** (server notifications) + the in-app
  purchase **shared secret**.
- Add **Products** matching your App Store product ids.
- Create an **Entitlement** called `forge_pass` and attach the Forge Pass product. (Ember packs need no
  entitlement — they're consumables granted server-side.)
- Create an **Offering** (the packages the paywall shows).
- Copy the **iOS public SDK key** → hand to Code.
- **Webhook:** Settings → Integrations → Webhooks → point it at the Supabase edge-function URL Code
  builds, with the auth header. RevenueCat → webhook → `grant_forge_pass` / `economy_move_embers`.

## 6 · Hand to Code
Give Code: the **iOS public SDK key**, the **product ids**, and the **webhook URL + secret** wiring.
Code does the `react-native-purchases` integration + the edge function + the native EAS build.

## Dependency map
- **#2 gates #4** (no paid products until Paid Apps is Active) → start #2 first.
- **Bundle id** must match across Expo ↔ App Store Connect ↔ RevenueCat.
- IAP products are reviewed with the app; **sandbox testing works before that** (create a sandbox tester
  in App Store Connect → Users and Access → Sandbox).
- You also need a **privacy policy URL** for the app submission — ties into the domain-cleanup task (#91,
  host it at philoi.app/privacy).
