# Punchlist 18 — reskin, screen-by-screen (the rest of RESKIN_COVERAGE)

Main loop (Home · lock-in · done · daily-fire · campfire view · heat states) is P0–P6 in PUNCHLIST_17.
This walks **every remaining screen**. Baseline for all = the token sweep: **deep-purple gradient bg ·
`FlameLogo` (never campfire vector / emoji) · crisp `EmberToken` for currency · ember-gradient black-text
CTA (`#F2A33C→#E0612C`, text `#3a1608`) · hexagon rank badge + tier-colour/ember XP bar where rank shows**.
Below = only the **per-screen specifics** on top of that baseline. ⚠ = bespoke, don't flatten.

## Tabs (remaining)
- **`leaderboards.tsx`** — podium. ⚠ **Decision:** the cream/parchment podium columns read off-brand on the
  purple. Recolour the three columns to **tier metals** (gold/silver/bronze) or a dark on-brand plinth; keep
  the 1/2/3 medallions. Confirm with Noah before building. Rank pips = hexagon badges.
- **`challenges.tsx`** — challenges list. Gradient bg; card = ember surface; friend/goal toggle stays
  ember-orange; VS avatars keep rank pips.
- **`profile.tsx`** — own profile. Mirror Home's **hexagon badge + combined XP bar**; ember token for balance;
  lock-in grid tiles on ember surfaces.

## Auth / onboarding
- **`sign-in.tsx`** — `FlameLogo` hero on gradient; primary = ember CTA; OAuth buttons keep provider colours.
- **`setup-handle.tsx`** — onboarding (handle/uni/consent). Gradient; flame; ember CTA; inputs on `#20182f`.
- **`auth/callback.tsx` · `strava-auth.tsx`** — spinners only → gradient bg + flame spinner.
- **`account-disabled.tsx`** — gradient + flame + plain message, muted.

## Social · campfires · friends
- **`add-friend.tsx`** — was a cream-root straggler (now fixed by root `ScreenBackground`); verify bg shows.
  Search field on ember surface; result rows w/ rank pip + ember CTA "Add".
- **`people.tsx`** — people list; rows on ember surfaces, rank pips.
- **`friend-profile.tsx`** — ⚠ **mirror `profile.tsx` exactly** (hexagon badge + XP bar, same layout) so
  viewing someone looks identical to your own, minus edit controls.
- **`campfires.tsx`** — campfire list (now reached from hamburger). Each card carries the **campfire heat
  flame** (mock 93) at small size + member count.
- **`group/[groupId]/index.tsx`** — the member view = **mock 94** (P6). 
- **`group/[groupId]/join-requests.tsx`** — request rows w/ rank pip; approve = ember CTA, decline = ghost.
- **`group/[groupId]/invite.tsx` · `edit.tsx` · `leaderboard.tsx` · `group/create.tsx`** — gradient; the
  group leaderboard mirrors the tab leaderboard styling; create/edit forms on ember surfaces.
- **`join.tsx`** — join-via-link preview = the **join preview (mock 62)** styling.

## Lock-in · activity
- **`lock-in/[checkInId].tsx`** — a single lock-in detail; flame (heat/equipped ramp), ember surfaces.
- **`activity/[checkInId].tsx`** — ⚠ **synced Strava lock-in — KEEP the "Powered by Strava" orange mark**
  (their brand terms). Ember-ify the frame around it, NOT the Strava logo/attribution text.
- **`lock-in-history.tsx`** — history list on gradient; tiles = ember surfaces.

## Challenges · goals
- **`challenge/create.tsx`** — mostly styled already; confirm ember CTA + gradient; trophy/flag icons ember.
- **`challenge-change/[requestId].tsx` · `goal/create.tsx` · `watch/[challengeId].tsx`** — gradient + ember
  surfaces; consent/accept = ember CTA.

## Economy · shop · Flame Pass
- **`shop/index.tsx`** — gradient; ember token everywhere for prices; Emberfall/season pill consistent.
- **`shop/box/[boxKey].tsx` · `shop/item/[itemId].tsx`** — detail pages; drop-odds bars keep rarity colours
  (blue/purple/gold/red) — those are rarity semantics, not theme.
- **`shop/open.tsx`** — ⚠ **keep the loot-box open choreography**; only swap the currency to `EmberToken` and
  frame to gradient. (Box-crack reveal untouched — see below.)
- **`inventory/index.tsx` · `inventory/[itemId].tsx`** — grid + loadout; rarity colours kept; equip = ember CTA.
- **`forge-pass.tsx`** — Flame Pass (display rename done; internal `forge_pass`); track on gradient; ember
  token for reward tiers; premium column keeps its accent.
- **`paywall.tsx` · `purchase-success.tsx`** — ember CTA; success = flame + ember token (no campfire vector).

## Settings · account · misc
- **`settings.tsx`** — was flat bg → gradient; rows on `#20182f`; the amber row-icons stay.
- **`settings-notifications.tsx` · `connected-apps.tsx` · `edit-profile.tsx` · `campus.tsx`** — same rows-on-
  ember-surface treatment; toggles ember-orange; connected-apps keeps provider logos.
- **`university-leaderboard.tsx`** — same leaderboard styling as the tab (incl. the podium decision above).
- **`legal.tsx` · `report.tsx` · `health-connect-rationale.tsx`** — utility: gradient bg + text tokens only.

## Celebrations · animations · share cards
- **`rank-up-celebration.tsx`** — ⚠ **KEEP** the RANK_REWORK forge/tier-flash/audio; only align its bg +
  tokens; do NOT flatten into the flat reskin.
- **`box-crack.tsx`** — ⚠ keep the crack/reveal choreography.
- **Share cards** (`fire-share-card` · `lock-in-share-card` · `rank-up-share-card` · `season-standing-share-
  card` · `unlock-share-card`) — ⚠ each is its own exported-image composition; they inherit `FlameLogo` +
  `EmberToken`, but **review each frame** (public/social-facing) — flag for a dedicated pass, don't assume.

## How to run it
Tick each on device against the baseline + its note. The only items needing a **design decision before build**
are: **(1) the leaderboard podium recolour**, and **(2) the share-card frames** (their own pass). Everything
else is mechanical token application Code can do straight through.
