# Code prompt — re-cut ember packs + rebalance box ember prices

## A. Re-cut `EMBER_PACKS` — `src/lib/economy/iap.ts` + `src/lib/economy/forge-pass.ts`
Replace the four packs (old `embers.500/.1200/.2600/.7000`) with these. **Product IDs are now tier-named**, and the
**granted amount = base + bonus** (the total):

| Product ID | Display name | Base | Bonus | **Total granted** | Price (CAD, App Store) |
|---|---|---|---|---|---|
| `app.philoi.embers.remnant` | Remnant of Embers | 200 | — | **200** | $1.99 |
| `app.philoi.embers.pouch` | Pouch of Embers | 500 | +50 | **550** | $4.99 |
| `app.philoi.embers.chest` | Chest of Embers | 1,000 | +200 | **1,200** | $9.99 |
| `app.philoi.embers.vault` | Vault of Embers | 2,000 | +600 | **2,600** | $19.99 |
| `app.philoi.forge_pass.season` | Flame Pass | — | — | season | $8.99 |

- Update everything keyed off the old IDs: `ALL_PRODUCT_IDS`, `EMBER_PACK_BY_PRODUCT`, `emberPackForProduct`,
  the **buy-embers screen**, and `purchase-success` mapping.
- **Grant the TOTAL** (base + bonus) on purchase. In the buy UI, show the base amount with a **"+50 / +200 / +600
  bonus"** tag so the value is visible.
- Prices are **not hardcoded** — the app reads the localized store price via the RevenueCat offering. The CAD
  numbers above are only what gets entered in App Store Connect; the UI shows whatever the store returns.
- Internal tier keys: unify to `remnant / pouch / chest / vault` (retire the old Pile/Stack/Hoard keys) so the ID,
  display name, and key all agree — your call on the refactor, but the product IDs + amounts + display names above
  are fixed.

## B. Rebalance ember prices of expensive boxes (economy)
The new rate is **~120 embers per CAD** (top pack 2,600 ÷ $19.99 ≈ 130/$; entry ≈ 100/$). So any ember price ÷ ~120
≈ its real-money cost. Under the new packs, several boxes are now priced like luxury goods:
- 🔴 **Promethean Vault = 7,000 embers ≈ $54–70 real** — far too steep. Undercut it.

Do a full pass on every **ember-priced box/item** in `catalog.ts` / the shop:
- **Target:** the single priciest box should sit around **one Vault pack (~2,600 embers ≈ $20)** or below — no box
  should cost more real money than the biggest pack. Bring **Promethean Vault → ~2,000–2,600 embers** and scale the
  rest down proportionally.
- Keep the **rarity ladder** (rarer boxes cost more) but **compress the top** so nothing reads as a $50+ single buy.
- **Propose the new box/item price table for Noah to approve before applying** — this is real-money-equivalent
  tuning, not a silent change.

## Acceptance
- [ ] Four packs re-cut to the tier-named IDs + totals above; all call sites updated; bonus shown in buy UI.
- [ ] App Store Connect IDs match the code exactly.
- [ ] Box/item ember prices re-proposed against the ~120 embers/$ rate; Promethean Vault undercut; Noah signs off.
