# Philoi — Build Hand-off (start here)

*Single entry point for the v1 rebuild + redesign. Read this first, then the specs. If any two docs disagree on UI, `PHILOI_UI_SPEC.md` wins. Pixel-exact screen designs live in `design-mocks/` — open those alongside the spec.*

---

## Read in this order

1. **`PHILOI_UI_SPEC.md`** — UI source of truth (20 sections; map below). Build the look and every screen from this.
2. **`design-mocks/`** — the approved screen mockups as standalone HTML. **You can't render these — read each one as SOURCE.** Every exact value is inline: hex colors, px sizes, border-radii, and `@keyframes` animation timings. Translate that CSS directly into React Native styles + Reanimated animations to match each screen. (A human opens them in a browser for the visual; you extract the numbers from the file.) The spec's prose + these mocks together are the design.
3. **`V1_BUILD_SPEC.md`** — feature scope, priorities (P0/P1/P2), build sequence.
4. **`UI_REDESIGN_SPEC.md`** — the *why* behind the design (direction, living-flame, copy register). Context, not step-by-step.
5. **`ONBOARDING_FIXES.md`** — two P0 activation bugs, already applied to `_layout.tsx`; verify + test.
6. **`admin/DASHBOARD_FIXES.md`** — analytics fixes for the separate admin app.

## `PHILOI_UI_SPEC.md` — section map

1 Tokens (twilight palette) · 2 Type (Inter) · 3 Flame logo · 4 Living-flame system · 5 Campfire home (swipe) · 6 Campfire lock-in screen · 7 Components · 8 Impl notes · 9 Navigation/motion · 10 Campfire field (overview) · 11 Rank-up forge (Bronze→Infernal) · 12 Campfire interior + lock-in flow · 13 Running lock-in session · 14 Create campfire + class campfires · 15 Leaderboards · 16 Challenges · 17 Fitness integrations · 18 Profile · 19 Settings · 20 Splash / sign-in.

## Locked decisions (don't relitigate)

- **Naming:** circles → **Campfires**; home = **Camp**. Copy-only — no schema change.
- **Core loop:** the **Lock-in** — one-tap timed session (goal picker → session → Stop posts to the campfire chain → XP → rank).
- **Look:** twilight-purple dark theme default; **Inter** (replaces Fredoka/Nunito); the **campfire flame is the logo** (vector in §3).
- **XP model:** each lock-in feeds the **campfire's shared level** *and* the user's **personal rank** (hexagon tiers Bronze→Silver→Gold→Diamond→**Infernal**, animated rank-up forge).
- **On-ramp:** goals at the **user** level; campfires **purely social + discoverable/searchable**; **class campfires** for course study-halls.
- **Photos = lock-ins only** (no general composer camera).
- **Leaderboard:** rank *people* not campfires; XP is the true sort; streaks separate; scopes = your campfires / your uni / vs. unis; per-campfire local board too.
- **Copy register:** heat, never cozy.

## Build sequence

1. **[P0] Bugs** — onboarding fixes (verify), OAuth branding (must read **Philoi**, not Aspire OS / supabase — see the splash §20), loading hang, keyboard avoidance.
2. **Design system** — twilight tokens + Inter + flame logo into `theme.ts` / `philoi_brand_kit.md` (spec §1–4). Also **regenerate the full icon set from the §3 flame vector** — app icon, Android adaptive icon, splash icon, and web **favicon** (`assets/images/`) — so every icon matches the new logo (on the plum/twilight background, no transparency).
3. **Core lock-in loop** — goal picker → running session → Stop → campfire chain, + XP/personal rank + campfire level (§6, §11–13). *Make this feel great first.*
4. **Campfires + discovery** — home swipe, field overview, create campfire (incl. class), discoverable search, solo campfire (§5, §10, §12, §14).
5. **Leaderboards** (§15) → **Challenges** (§16, H2H first).
6. **Profile + Settings + Splash** (§18–20).
7. **Fitness integrations** last / Phase 2 (§17) — HealthKit + Health Connect first, Strava behind its review gate.

**Also in this build:** wire up **EAS Update** (`expo-updates` + channel) so future JS fixes ship OTA — the last reinstall-forcing build.

## Open items (need Noah)

- Final flame logo curves (working vector in §3 is safe to build against).
- Pronunciation on splash: "fee-loy" (Ancient) vs "fee-lee" (Modern) — §20.
- Helper-status verification for class campfires (v1 = self-declared).

## Reality check (unchanged)

This is a big v1. Ship P0 bugs + the core lock-in loop first and let the rest follow — don't build all 20 sections before anyone touches it. And the one thing that validates all of it is still the retention test: one person locking in three days, unprompted.
