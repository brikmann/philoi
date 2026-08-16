# Code prompt — align IAP product ids + amounts to App Store Connect (#71, money-critical)

Noah created the real IAP products. The hardcoded ids/amounts in the code are stale and **do not match**
— left as-is, purchases charge the card and grant the wrong amount or nothing (the webhook has an
"UNKNOWN PRODUCT → granted nothing" path). App Store Connect is the source of truth. Update all three
places to the canonical set below.

## Canonical products (App Store Connect = truth)
| Pack (name) | Embers | Product id |
|---|---|---|
| Remnant | 500 | `app.philoi.embers.500` |
| Pile | 1,200 | `app.philoi.embers.1200` |
| Stack | 2,600 | `app.philoi.embers.2600` |
| Hoard | 7,000 | `app.philoi.embers.7000` |
| **Forge Pass** | — (entitlement) | `app.philoi.forge_pass.season` |

Prefix is `app.philoi.…` (was `philoi.…`). Ember **amounts changed** (were 1200/3000/6500/15000).
Forge Pass keeps the reusable-across-seasons id but gains the `app.` prefix.

## 1 · `src/lib/economy/forge-pass.ts` (the Buy Embers list, ~L332–335)
Replace the four ember rows with:
```ts
{ key: 'remnant', embers: 500,   name: 'Remnant', productId: 'app.philoi.embers.500' },
{ key: 'pile',    embers: 1_200, name: 'Pile',    productId: 'app.philoi.embers.1200' },
{ key: 'stack',   embers: 2_600, name: 'Stack', best: true, productId: 'app.philoi.embers.2600' },
{ key: 'hoard',   embers: 7_000, name: 'Hoard',   productId: 'app.philoi.embers.7000' },
```
**Price:** drop the hardcoded `price: '$1.99'` strings — pull the localized `priceString` from the
RevenueCat **offering/package** at runtime instead. Then Noah sets prices once in App Store Connect
Monday and the screen reflects them per-country with no code change. (Keep a hardcoded string only as a
pre-fetch fallback if you must.) Re-confirm which tier carries `best: true` — kept on Stack for now.

## 2 · `src/lib/economy/iap.ts` (L31 + the L22 comment)
```ts
export const FORGE_PASS_PRODUCT_ID = 'app.philoi.forge_pass.season';
```
Update the comment that references `philoi.forge_pass.s1` to the new string.

## 3 · `supabase/functions/revenuecat-webhook/index.ts` (L21–27)
```ts
const FORGE_PASS_PRODUCT_ID = 'app.philoi.forge_pass.season';
const EMBERS_BY_PRODUCT: Record<string, number> = {
  'app.philoi.embers.500': 500,
  'app.philoi.embers.1200': 1_200,
  'app.philoi.embers.2600': 2_600,
  'app.philoi.embers.7000': 7_000,
};
```

## 4 · Update the pairing test
`PHASE4_IAP_TESTING.md` asserts the client ids == the webhook map. Update its expected ids/amounts to
the canonical set so the test still guards the pairing.

## Not in this change (Monday, gated by the paid agreement)
- Setting the four ember **prices** + creating the products in App Store Connect (needs the app record,
  which needs the Paid Apps agreement Active).
- Creating the **Forge Pass** IAP as exactly `app.philoi.forge_pass.season`.
- Then in RevenueCat: products + `forge_pass` entitlement + offering use these exact ids.

## Verify
`tsc` + lint. Grep the repo for `philoi.embers.` and `forge_pass.season` → every hit should now carry the
`app.` prefix and the new amounts. No stray `.3000/.6500/.15000` left anywhere.
