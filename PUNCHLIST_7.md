# Punchlist 7 — shop polish (as-built review)

The shop landed and works, but three things off the on-device pass. All JS/asset work → OTA.

## 1 · Too much explanatory text — trim it
The shop reads text-heavy; every section has a paragraph of rules. Cut/shorten so the UI carries it and
detailed rules move to a "?" info sheet. Specifics:

- **Featured · Buy Direct footer** — "A guaranteed item costs more than the gamble. Earned titles, medals,
  relics and Pass-exclusives are never for sale." → **"Guaranteed costs more than the gamble. Earned & Pass
  items never for sale."** (or move to a "?").
- **Loot Boxes footer** — "Published odds on every box. Every box can also be earned — none is
  purchase-only." → **"Odds published · every box is also earnable."**
- **Buy Embers footer** — "Real-money purchases aren't wired up yet. Embers you earn by locking in already
  buy everything here." → **cut** (it's already said by the "coming soon" dialog + the greyed prices).
- **Bottom line** — "Cosmetics and currency only. Nothing here buys XP, rank, streaks, or a place on any
  leaderboard." → **"Cosmetics only — never XP, rank, or standing."**
- **Item detail** — "Buying it outright costs more than gambling for it in a box — that's the price of
  certainty. Salvages back for 🔥 X." → **"Cheaper in a box. Salvages for 🔥 X."**
- General rule: one short line per section max; the long-form economy rules live behind an info "?" icon,
  not inline on the shop.

## 2 · Cosmetic art didn't land — build it from the mocks
Every cosmetic is rendering as a **generic placeholder** (pill shapes for cards, a plain ring for halos, a
flag for banners, a speaker glyph for audio). The real vector art was specced in **mocks 61 / 63 / 64 / 65**
(item-art highflex / flames-particles / profile-identity / audio-sfx-medals). Wire each cosmetic to render
its **specced art by `id`** (data-driven from ITEM_CATALOG), not a type-generic placeholder — the art is the
whole product. Featured cards, box-open reveals, inventory tiles, and the item detail all pull the same art.

## 3 · Hollow-ember graphic — replace the 🔥 emoji
The ember currency + the daily-fire completion collectible currently render as a **generic flame emoji**.
Replace with the proper **hollow-ember graphic** (design in `design-mocks/86-ember-graphic.html`): a glowing
coal/ember token, used everywhere embers appear (the top-right balance chip, box costs, salvage payouts, the
Buy-Embers packs, and the daily-fire "collect your ember" reward). Ship it as an SVG/component so it recolors
and scales cleanly, replacing every `🔥` used as the ember symbol.

## Ship
All JS + one new ember asset → OTA. Text trims are quick; the cosmetic-art wiring is the bigger lift (but
it's rendering, not new data — the catalog + art refs already exist).
