# Phase 4 — IAP test plan (#71)

Two layers of verification, and they catch different things.

**Layer 1 — `npm run check:iap`** proves the two halves of the *codebase* agree: the app's product
ids/amounts vs the webhook's map. Runs in a second, no deps, exits non-zero on drift. It **cannot**
see App Store Connect, so a codebase that agrees with itself and disagrees with the store passes.

**Layer 2 — the sandbox purchase** is the only thing that proves a real customer gets what they paid
for. Nothing below is optional before taking real money.

---

## Canonical products — App Store Connect is the source of truth

| Pack | Embers | Product id | Type |
|---|---|---|---|
| Remnant | 500 | `app.philoi.embers.500` | Consumable |
| Pile | 1,200 | `app.philoi.embers.1200` | Consumable |
| Stack | 2,600 | `app.philoi.embers.2600` | Consumable |
| Hoard | 7,000 | `app.philoi.embers.7000` | Consumable |
| Forge Pass | — (entitlement `forge_pass`) | `app.philoi.forge_pass.season` | Non-renewing |

These ids live in exactly three places, all kept in step by `npm run check:iap`:

- `src/lib/economy/forge-pass.ts` → `EMBER_PACKS`
- `src/lib/economy/iap.ts` → `FORGE_PASS_PRODUCT_ID`
- `supabase/functions/revenuecat-webhook/index.ts` → `EMBERS_BY_PRODUCT` + `FORGE_PASS_PRODUCT_ID`

**Prices are not in the codebase at all.** The app renders the store's localized `priceString`, so
prices are set once in App Store Connect and are correct in every country. An em-dash on a pack tile
means the offering hasn't loaded — never a fallback literal, because a quoted price that differs
from the charge is worse than no price.

---

## Before any sandbox run

1. `npm run check:iap` → must print `✓ IAP ids aligned`.
2. The four ember products + the Pass exist in App Store Connect with **exactly** the ids above.
3. RevenueCat: products imported, a `forge_pass` entitlement attached to `app.philoi.forge_pass.season`,
   and all five in the **current offering** (the app reads `offerings.current` — a product outside it
   is invisible to the paywall).
4. `REVENUECAT_IOS_KEY` set in `.env`, and a native build cut (Expo Go can't do real purchases).
5. The webhook is deployed and its secret matches RevenueCat's Authorization header.

---

## Sandbox matrix

Create a Sandbox Apple ID in App Store Connect → Users and Access → Sandbox. Sign into it on the
device under Settings → App Store → Sandbox Account.

| # | Action | Expected |
|---|---|---|
| 1 | Buy each of the 4 ember packs | Balance rises by **exactly** the table amount. Success screen names the right pack. |
| 2 | Buy the Forge Pass | Premium lane unlocks; Level 0 grants the Emberfall Ascendant Flare + Forge Flame + 1,000 embers. |
| 3 | Cancel at the Apple sheet | Nothing granted, no error dialog, no navigation. |
| 4 | Airplane mode mid-purchase | Nothing granted. Reconnect → grant lands, or Restore recovers the Pass. |
| 5 | Delete + reinstall, sign in | Pass still owned (entitlement is tied to the Supabase user id, not the device). |
| 6 | **Restore Purchases** (Settings + paywall) | Pass returns. Ember packs do **not** — they're consumables, already spent into a balance. |
| 7 | Buy the Pass twice | Second attempt reports already-owned. Balance and inventory unchanged. |
| 8 | Sign out → sign in as user B | B does **not** inherit A's Pass. |
| 9 | Buy the Pass outside the season window | Refused. `grant_forge_pass` raises; nothing charged-and-lost. |

### Webhook-level checks (curl, no device needed)

Verified already on the live function — re-run after any redeploy:

| Case | Expected |
|---|---|
| Wrong/absent `Authorization` | `401` |
| Secret not configured on the project | `500` (fail-closed, never open) |
| `GET` | `405` |
| Ignored type (`BILLING_ISSUE`, `EXPIRATION`) | `200 {"ignored":…}` — a 500 would make RevenueCat retry forever |
| Unknown product id | `200 {"unknownProduct":…}`, granted nothing, **logged as an error** |
| `$RCAnonymousID:…` app_user_id | `200 {"unmatchedUser":…}`, granted nothing, logged |
| **Same event id delivered 3×** | Embers move **once**. One `ember_ledger` row, one `iap_grants` row. |

The idempotency case is the one that matters most — RevenueCat retries until it gets a 2xx, so a
non-idempotent handler double-grants on any network blip.

---

## Verifying a grant landed

```sql
select event_id, product_id, embers_granted, granted_pass, created_at
from iap_grants order by created_at desc limit 10;

select balance from ember_wallet where user_id = '<uuid>';
```

`iap_grants` keeps the full RevenueCat payload. When someone says "I paid and got nothing", that row
is the only thing that settles it — and if there is no row, the purchase never reached us.

---

## Known gaps — decide before general release

- **Refunds and expirations are not handled.** The webhook logs and ignores them. Revoking a
  cosmetic someone is wearing, or clawing back embers already spent on a box, needs a product
  decision about what a negative balance means.
- **Ember packs cannot be reconciled.** `reconcile_my_forge_pass` only ever restores the Pass, because
  it can re-read an entitlement. A missing consumable has to be settled by hand from `iap_grants` —
  guessing would mean any client claiming a lost pack gets one.
- **Android/Play Billing** is a later pass; only the iOS key is wired.
