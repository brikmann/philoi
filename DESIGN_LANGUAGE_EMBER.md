# Philoi design language — "Ember" (apply GLOBALLY)

The look approved in mocks **91** (pill) and **92** (home / done / daily fire) is the app-wide system, not
one-off screens. Every screen adopts it. Reference: `design-mocks/91-lockin-pill.html`,
`design-mocks/92-home-done-dailyfire.html`, ember token `design-mocks/86-ember-graphic.html`.

## 1 · Brand mark / logo — the flame
The **flame glyph** (the simple flame from 91/92) becomes the **Philoi logo**. Use it as:
- the **app icon** + splash, the home tab glyph, loading/empty states, and the **wordmark lockup**
  (flame + lowercase **"philoi"**).
- **Retire the campfire vector** as the brand/logo everywhere it still appears.
- Ship it as one SVG component (ember gradient fill) that scales; the home/done/daily-fire heroes are just
  this glyph at large size with the glow/flicker (roar on daily fire).

## 2 · Colour tokens
- **Screen bg (deep purple):** `radial-gradient(120% 62% at 50% 6%, #2c1b36, #161320 56%)`. This is THE
  background — no washed-out lighter variants (fixes the daily-fire screen).
- **Surfaces / borders:** `#1b1726` cards, `#241c38` borders/chips.
- **Ember gradient (primary/brand):** `#E0612C → #F2A33C → #FFD27A` (135° for fills, vertical for the flame).
- **Text:** `#FFF6EC` primary, `#a99cbd` muted.
- **Ember/gold accent text:** `#FFD27A`. **Rank accent:** `#4FB0E5`.

## 3 · Primary CTA (global button)
Every primary action uses the **same button**: ember-gradient fill `linear-gradient(135deg,#F2A33C,#E0612C)`,
**black/near-black text `#3a1608`, bold**, radius 15, soft ember glow (`0 4px 16px rgba(224,97,44,.45)`),
with a **subtle pulse** on the main action of a screen. Lock in · Collect · Post · Buy · Continue — all this
button. **Secondary = ghost** (muted `#a99cbd` text, no fill). No blue/grey primary buttons anywhere.

## 4 · Ember currency — one token
The **crisp ember token** (live coal, charred rim + glowing core, mock 86) is the **only** ember symbol —
balance chips, item/box costs, salvage payouts, daily-fire reward, ember packs. **Retire every `🔥` emoji
and the hollow-outline ember** used as currency. One component that recolors + scales.
- Keep **flame (brand/hero/logo) and ember (currency) visually distinct** — flame = the app, ember = money.

## 5 · Home = every section one tap
Home surfaces all main destinations without a menu dive: **friends** (top-left), **shop** (top-right, with
the **Emberfall** advert pill extending out of it), **inventory** (new grid icon, top-right), **settings**,
the **lock-in** CTA, and **campfires via swipe**. Inventory is the new addition — a one-tap entry from home.

## 6 · Apply globally — a reskin sweep, not per-screen
Do one pass over **every** screen:
- swap old **campfire vectors → the flame** (and set the flame as app icon/logo);
- swap **`🔥` / hollow ember → the crisp ember token**;
- restyle **all primary buttons** to the ember-gradient / black-text CTA;
- unify **backgrounds** to the deep-purple radial;
- headers/celebrations use white text with ember-gradient emphasis (no flat yellow — fixes "You're on
  fire").

Package as a small set of shared primitives (`<FlameLogo>`, `<EmberToken>`, `<PrimaryButton>`, bg + colour
tokens) so screens consume tokens, not copies.
