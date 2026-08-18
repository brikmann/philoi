# Punchlist 16 — Ember reskin, round 2 (what didn't land)

The first pass did ~50%. The primitives exist (`ScreenBackground`, `FlameLogo`, `EmberToken`,
`PrimaryButton`, `HomeXpBar`) — the rest is **composition + wiring the sweep to completion**, not new systems.
Verified from on-device screenshots (Aug 17).

## ✅ Landed — keep
- **Android ongoing notification** — chronometer + progress bar + tap → returns to the lock-in screen. The
  marquee of the pass. Only gap = its small icon (§7).
- **Ember-gradient CTAs, toggles, selected states** (Return to lock-in, Send, Settings switches).
- **Emberfall pill centered + hamburger + hexagon rank badge + rank bar** on the lock-in screen.
- **Gradient background** on Leaderboards + the lock-in screen.

## Gaps to finish (all OTA)

### 1 · Gradient background is not universal — put it on EVERY screen
It landed on Leaderboards + the lock-in screen but **not** Settings, Profile, Challenges, or campfire chat
(those are flat dark). Wrap every screen in **`ScreenBackground`** (the deep-purple radial
`radial-gradient(120% 62% at 50% 6%, #2c1b36, #161320 56%)`). Decision: **gradient everywhere — no flat-dark
screens.** Audit each route for a raw dark `View` bg and swap it.

### 2 · The custom flame never replaced the campfire vector
The home / lock-in hero still renders the **old campfire logo** (flame on crossed logs). Swap it for
**`FlameLogo`** (the clean custom flame glyph, ember gradient) on the hero, and retire the campfire vector
app-wide — the flame is the brand mark now (the iOS app icon already uses it).

### 3 · mock 92 screens didn't land — build them (`design-mocks/92`)
- **Session-complete (done) screen:** flame hero (not campfire), clean XP / duration / rank summary, **no
  "fire bonus" line**.
- **Daily fire screen:** deep-purple, **roaring flame**, **"You're on fire, {first name}"** (white + ember
  emphasis, **no yellow**), **crisp ember tokens** flying into the balance.

### 4 · Home IA change didn't land
Bottom nav still leads with **Campfires** as the first tab, and Campfires is **not** in the hamburger. Per
the new IA: bottom nav = **Home · Leaderboards · Challenges · Profile**; **Campfires moves into the
hamburger** (first item: Campfires · Friends · Inventory · Shop · Flame Pass · Settings). Make the **Home**
tab the flame / lock-in hub; drop the campfire swipe.

### 5 · Combined XP bar (daily-fire zone) not wired
The home rank bar is a plain single fill. Wire **`HomeXpBar`** (already built, `eeaf615`) into the home rank
row: tier-colour fill + the **vivid-orange daily-fire zone encased inside** ("X XP to today's fire"), next to
the hexagon badge.

### 6 · Crisp ember token not swapped in feeds
Campfire chat + lock-in cards still show the old ember. Swap every ember symbol to **`EmberToken`** (mock 86
coal) app-wide — balance chips, feed cards, costs, daily-fire reward.

### 7 · Android notification small icon = placeholder square
Android small-notification icons **must be a white silhouette on transparent** — the OS masks/tints them, so
a full-colour logo renders as the square you're seeing. Ship a monochrome **flame silhouette** as the small
icon (e.g. `ic_stat_philoi`) and set it on the notification; keep the colour flame only for the app icon /
large icon.

## Also — still to verify (not in these shots)
- **iOS Live Activity / Dynamic Island** isn't confirmed yet. Cut the **development build** (per
  NATIVE_BUILD_CONFIG) and verify the Lock Screen card + Dynamic Island render + the timer self-counts on a
  real iPhone (14 Pro+ for the Island).
