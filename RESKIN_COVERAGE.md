# Ember reskin — full screen coverage (nothing implied, everything listed)

## Audit status — commit `13fc3ee` (round 2)
- **Gradient bg:** 37 → **45/46** (lock-in/index intentionally keeps IMMERSIVE_BG). Fixed via a single
  root-mounted `<ScreenBackground>` behind a **transparent** navigator (covers the 9 that painted their own
  `Colors.cream` roots + every future route).
- **Stock/campfire flames:** **0** (all swapped to `FlameSvg`). The `(tabs)/index` "CAMPFIRE" audit hit is a
  false positive (stale component name `CampfireFlameStage`, now draws the flame).
- **Flame Pass rename:** done, **display-only**; `forge_pass` entitlement + `app.philoi.forge_pass.season`
  + `/forge-pass` route untouched.
- **Still open (do NOT tick):** (1) done screen `flame-completion-card` not rebuilt to mock 92 *(and confirm
  `flame-meter-complete` daily-fire got the mock-92 treatment)*; (2) **share cards** frames not reviewed;
  (3) **⚠ keep-intact** screens (activity/Strava, shop/open, box-crack, rank-up-celebration) untouched but
  **unverified on device**. Audit script: `scratchpad/audit.js` (re-runnable).


Every route + celebration/share component in the app. The reskin = apply `ScreenBackground` (gradient),
`FlameLogo`, `EmberToken`, `PrimaryButton`, and the design tokens to **each**. This is the tick-list — a
screen isn't "done" until it's checked here. Special-case screens keep their own design and only take the
tokens (flagged **⚠ keep**).

Round-1 status where known from the Aug-17 screenshots is noted; everything else = **not verified**.

## Tabs
- [ ] `(tabs)/index.tsx` — **Home** (flame hero, hexagon+XP bar, Emberfall pill, hamburger). *R1: partial.*
- [ ] `(tabs)/leaderboards.tsx` — Leaderboard (podium). *R1: gradient ok.*
- [ ] `(tabs)/challenges.tsx` — Challenges list. *R1: flat bg.*
- [ ] `(tabs)/profile.tsx` — **Profile** (own). *R1: flat bg.*
- [ ] `(tabs)/_layout.tsx` — tab bar (Home · Leaderboards · Challenges · Profile; Campfires → hamburger).

## Auth / onboarding
- [ ] `sign-in.tsx` — sign in
- [ ] `auth/callback.tsx` · `strava-auth.tsx` — OAuth returns (mostly spinners — bg only)
- [ ] `setup-handle.tsx` — **onboarding** (handle / uni / consent)
- [ ] `account-disabled.tsx`

## Social · campfires · friends
- [ ] `add-friend.tsx` — **add / friend requests**
- [ ] `people.tsx` — people list
- [ ] `friend-profile.tsx` — **viewing someone's profile**
- [ ] `campfires.tsx` — campfires list (now reached from the hamburger)
- [ ] `group/[groupId]/index.tsx` — **campfire chat** (feed of lock-ins). *R1: old ember icons.*
- [ ] `group/[groupId]/join-requests.tsx` — **join / friend requests**
- [ ] `group/[groupId]/invite.tsx` · `group/[groupId]/edit.tsx` · `group/[groupId]/leaderboard.tsx` · `group/create.tsx`
- [ ] `join.tsx` — join via link

## Lock-in · activity
- [ ] `lock-in/index.tsx` — **lock-in screen** (flame + timer + **flare**, no rank bar) ⚠ flare/flame rules
- [ ] `lock-in/[checkInId].tsx` — a lock-in detail
- [ ] `activity/[checkInId].tsx` — **viewing a synced Strava lock-in** ⚠ **keep Strava's required "Powered by
  Strava" + orange logo** (their brand terms) — ember-ify the frame, NOT the Strava mark
- [ ] `lock-in-history.tsx` — history

## Challenges · goals
- [ ] `challenge/create.tsx` — new challenge. *R1: mostly styled.*
- [ ] `challenge-change/[requestId].tsx` · `goal/create.tsx` · `watch/[challengeId].tsx`

## Economy · shop · Flame Pass
- [ ] `shop/index.tsx` — shop
- [ ] `shop/box/[boxKey].tsx` · `shop/item/[itemId].tsx`
- [ ] `shop/open.tsx` — **loot-box open animation** ⚠ keep the reveal choreography; swap in ember token/frame
- [ ] `inventory/index.tsx` · `inventory/[itemId].tsx` — inventory & loadout
- [ ] `forge-pass.tsx` — **Flame Pass** season track (display rename; internal `forge_pass`)
- [ ] `paywall.tsx` · `purchase-success.tsx`

## Settings · account · misc
- [ ] `settings.tsx` — settings. *R1: flat bg.*
- [ ] `settings-notifications.tsx` · `connected-apps.tsx` · `edit-profile.tsx` · `campus.tsx`
- [ ] `university-leaderboard.tsx`
- [ ] `legal.tsx` · `report.tsx` · `health-connect-rationale.tsx` — utility (bg + text tokens; minimal)

## Celebrations · animations · share cards (components, not routes)
- [ ] `rank-up-celebration.tsx` — **rank-up animation** ⚠ **keep** the RANK_REWORK forge/tier-flash/audio;
  only align its bg + tokens, do NOT flatten it into the ember reskin
- [ ] `flame-meter-complete.tsx` — **daily-fire complete** (mock 92 redesign applies here)
- [ ] `flame-completion-card.tsx` — session-complete / "done" (mock 92 applies)
- [ ] `box-crack.tsx` — box-open reveal ⚠ keep choreography
- [ ] Flame components: `flame-icon` · `lock-in-flame` · `session-flame` · `campfire-flame(-stage)` →
  replace campfire vector with `FlameLogo`
- [ ] `hexagon-badge.tsx` · `rank-projection-bar.tsx` — reused by home/profile (tier colour + orange projection)
- [ ] `ember-icon.tsx` → the crisp `EmberToken` everywhere
- [ ] Share cards (exported images): `fire-share-card` · `lock-in-share-card` · `rank-up-share-card` ·
  `season-standing-share-card` · `unlock-share-card` — flame/ember/gradient, but each is its own composition

## The rule for "done"
A screen passes when: **gradient bg · flame (no campfire vector) · crisp ember token · ember-gradient
black-text CTA**, and any bespoke system on it (rank-up, flare, box-open, Strava attribution) is intact.
This list doubles as the **pre-launch UI inspection** — walk every box on device before Aug 20.
