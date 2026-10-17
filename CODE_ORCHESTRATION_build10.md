# Build 10 orchestration — parallel fix agents → one test build

Goal: fix everything from the build-9 device test (`DEVICE_TEST_TRIAGE_build9.md`) and cut build 10 for TestFlight.
Four code agents run in **file-disjoint** lanes so they don't collide on the shared repo, then a build agent cuts the
binary. Each agent: branch off `integration-wave1`, stage files **by name** (never `git add -A` — Firebase key in root,
task #175), never touch the `.p8`, never `db push` or deploy prod. Merge order at the bottom.

Priority order of importance: **Agent 1 (cosmetics/value loop) > Agent 2 (onboarding/tutorial) > Agent 3 (stability) >
Agent 4 (challenges/shop).** If time is short, 1 and 2 are the ones that make or break launch value.

---

## AGENT 1 — FULL PREMIUM COSMETIC OVERHAUL + THE REVEAL LOOP  *(highest priority — the monetization loop, launch requirement)*
**Why:** the Flame Pass only sells if cosmetics feel premium to unlock, own, and show off. This is a **full visual
overhaul of EVERY visual cosmetic in the app to "garage-quality"** — layered, animated, composited — not a touch-up.
Visual targets: **`design-mocks/235-cosmetic-premium-overhaul.html`** (the premium profile showcase + unlock + live shop
preview — the primary target) and `design-mocks/234-cosmetic-reveal-flow.html` (the four-moment loop). This lands in
build 10; it is not deferred.

**The bar (mock 235):** on a profile, all equipped cosmetics render **together and live** — CARD = animated background,
FLAME = animated flame ring on the avatar, HALO, BANNER behind the name, FLARE = perimeter aura, PARTICLE = orbiting +
rising sparks, TITLE, MEDAL/Seal beside a burning name, rank pill. One **layered renderer** composites them, and the same
renderer drives the profile, the unlock reveal, and the shop's live preview — so it lands identically everywhere and the
"how it looks on your profile" preview actually works (it didn't before — task #157 recurrence; this time verify on
device that it renders, not just in code).

**Must-render, must-load:** cosmetics not rendering has regressed before. Every equipped cosmetic must actually paint on
device (not fall back to a blank/icon), and the composited profile must load without jank on a normal student iPhone —
use GPU-friendly techniques (transforms/opacity, Reanimated, Skia if already in the tree) and Reduce-Motion fallbacks,
but do NOT cut the visual quality. If an asset is missing it must be authored, not stubbed.

**★ FIRST DELIVERABLE — a Cosmetic Preview Gallery (build this before the surfaces wire up).** A dev-gated screen that
renders EVERY cosmetic (all 11 types, every item in `catalog.ts`) with its real native renderer, grouped by type, each
labelled name + rarity. This is the review harness: Noah opens it on device (or it exports screenshots) and signs off on
the actual renders BEFORE they ship — replacing the CSS-mock review loop, which has hit its ceiling. Requirements:
- Renders the real renderer, not a placeholder — this is exactly what users will see equipped.
- Toggle per item: preview it **on a profile**, **on the lock-in screen** (flames/flares/particles), and **in a
  group chat** (banners) — the real surfaces, since a cosmetic only makes sense where it lives.
- Gate behind the existing dev flag (like the `owns_premium` audit tool, task #220) so it doesn't ship to users, OR
  make it the internal QA build only.
- Art direction for what each should look like: `design-mocks/236-cosmetic-catalog.html` (per-type intent + the locked
  structural decisions: rings encircle the avatar, flames/flares live on the lock-in screen, particles hug the avatar
  border, banners are group-chat backgrounds, profile backgrounds are RL-style with the name) and
  `design-mocks/235-cosmetic-premium-overhaul.html` (the composite). Treat the CSS as the FLOOR — real fire, lava,
  electrified plasma, and glitch should exceed it in native.
Deliver the gallery first so the craft can be reviewed and iterated on real output, then wire the same renderers into
unlock → inventory → profile → shop.

**Every cosmetic renders across its FOUR moments** — the same render component reused each time so what's sold == what's
unlocked == what's owned == what others see (it can't drift):
1. **Unlock reveal** — on drop (box open, pass level, reward): the real cosmetic rendered large + animated, rarity rays
   in the equipped flame colour, name + rarity + type-derived effect line. Feels like you *got* something. (tasks
   #161/#184/#203)
2. **Inventory** — the real render owned, rarity border, EARNED/EQUIPPED state, effect on tap.
3. **How others see/experience it** — the equipped look everywhere others encounter you: profile, leaderboard, Agora.
4. **Shop preview** — tap in shop/paywall → the real equipped render + rarity + lore + effect before buying.

**ALL 11 types from `catalog.ts` (counts) — each needs its real render, none left as a generic icon:**

| Type | count | How it renders / where it shows equipped |
|---|---|---|
| TITLE | 51 | text label under your name (font/colour styling) |
| RELIC | 13 | discipline-relic medallion in the trophy hall / profile |
| FLAME | 11 | the animated flame skin (avatar flame + burning icon) |
| CARD | 11 | the profile / share-card background + frame style |
| HALO | 9 | arc pinned above the avatar/name (mock 234) |
| FLARE | 9 | app-wide perimeter aura — colour glow around profile/screen (tasks #86/#171) |
| PARTICLE | 8 | particles floating around the avatar/profile |
| SFX | 7 | a sound sting (start/stop lock-in) — preview = play button + waveform |
| BANNER | 7 | flies behind your name / profile header |
| AUDIO | 7 | ambient/music clip — preview = play button |
| MEDAL | 6 | badges incl. the **Emberfall Seal** (burns beside your name forever) |

Read every name/rarity/lore/effect from `catalog.ts`; never invent. For **SFX/AUDIO** the "render" is auditory: the four
moments still apply, but the reveal auto-plays a preview and inventory/shop show a **play button + waveform** instead of
a static image. Effect line is derived from `type` (as in `cosmetic-effect.ts`), never hardcoded per item.

**Files (lane):** the per-type cosmetic render components (build/upgrade one canonical renderer per type), reward/unlock
reveal screens, inventory screen + item detail, profile + leaderboard + Agora equipped rendering, shop/paywall cosmetic
preview sheet. Do NOT touch `_layout.tsx`, auth, challenges, onboarding.
**Done:** every one of the 11 types renders its real look across all four moments; one canonical renderer per type reused
unlock→inventory→profile→shop; SFX/AUDIO have working previews; rarity/effect from `catalog.ts`; typecheck +
`check:cosmetic-rarity` green.

---

## AGENT 2 — ONBOARDING, CINDY TUTORIAL, EMBERFALL, SAFE-AREA  *(owns `_layout.tsx`)*
1. **Kill the create-campfire softlock (P0).** `_layout.tsx:266–279` force-redirects new users to
   `/group/create?onboarding=true` and the completion flag never gets set → infinite loop after "light the campfire."
   Stop forcing it: land new users on Today/home after onboarding; make "create a campfire" an option, not a gate. If
   any forced step remains, it MUST persist the onboarding-complete flag. Verify a fresh account reaches home without a
   campfire.
2. **Make the scoped Cindy tutorial land.** It didn't appear at all. Wire it into the onboarding flow, gated on consent,
   and verify it fires for a new account. (CINDY_SPEC / the tutorial mocks 226/227.)
3. **Emberfall in the tutorial/onboarding** — the season has to be introduced in the flow (it wasn't). Fold the Emberfall
   intro in where the tutorial ends.
4. **Onboarding clarity copy** — the verification step must say "check your junk/spam folder," and each step should say
   what the app does for the user. This is the core "tell people where things are" fix.
5. **Safe-area top crop (P0)** — content starts ~10% down, top strip exposed. `_layout.tsx` uses
   `initialMetrics={initialWindowMetrics}`, which can be null on TestFlight first launch. Make the provider fall back to
   live insets; verify `(tabs)/_layout.tsx:51` `paddingTop: topInset` isn't double-applied.
**Files (lane):** `_layout.tsx`, onboarding/`setup-handle.tsx`, tutorial components, Cindy tutorial wiring. Do NOT touch
cosmetics, auth, challenges.
**Done:** fresh account → home (no loop); Cindy tutorial + Emberfall intro fire; junk-folder + step copy present; no top
crop on a notch device.

---

## AGENT 3 — AUTH & BROKEN SCREENS  *(P0 stability)*
1. **Google sign-in nonce (P0).** `src/lib/auth/providers.ts`: Apple path passes `nonce: hashedNonce`, Google path calls
   `signInWithIdToken` WITHOUT a nonce while the Google token carries one → "nonce should either both exist or not."
   Make the two agree: pass the matching nonce on the Google path, or configure `GoogleSignin` with no nonce and pass
   none. Verify Google sign-in completes into the app.
2. **Friends screen + Campfire Valley render white (P0).** The screen's data hook throws with no error boundary (other
   screens render fine). Root-cause each (null-deref / query error), fix it, AND add an error boundary so a screen bug
   degrades to a message instead of a blank app. Get the console error first.
**Files (lane):** `src/lib/auth/providers.ts`, the friends screen, the campfire-valley screen, a shared error boundary.
Do NOT touch `_layout.tsx`, cosmetics, challenges.
**Done:** Google sign-in works; Friends + Valley render real content; error boundary catches screen-level throws.

---

## AGENT 4 — CHALLENGES, CINDY CREATION, SHOP CLEANUP
1. **Cindy challenge creation is too many steps — make it near-instant.** Collapse the create flow so a challenge can be
   thrown in as few taps as possible (ideally Cindy proposes → one confirm). Cut intermediate screens.
2. **No back arrow on Challenges** — add the back affordance.
3. **Remove the legacy "Emberfall/Flame Pass" mock tile from the shop** — the pre-funnel tile still shows next to the
   real paywall; delete it so there's one entry.
4. **IAP code side:** ensure the shop renders `product.priceString` (not a hardcoded number) and the `forge_pass` product
   is wired to the RC offering so it's purchasable. (The $6.99→$8.99 fix itself is Noah's ASC price-tier change; the
   "can't buy the pass" is the product not being Approved/mapped — flag anything code can't fix.)
**Files (lane):** `challenge/create.tsx`, challenges screen(s), shop screen, IAP render. Do NOT touch cosmetics render,
auth, `_layout.tsx`.
**Done:** challenge creation is minimal-tap; back arrow present; legacy shop tile gone; shop shows real priceString.

---

## NATIVE (needs the binary — hand to the build agent or a native lane)
- **Focus Nudge missing on iOS** — Live Activity works, Focus Nudge didn't ship. Confirm its native config in
  `app.config.ts` for iOS and include it in build 10 (or confirm it's Android-only, task #155).
- **Lock-in pill redesign (Live Activity)** — redesign how the pill reads on the iPhone home/lock screen. This is the
  Swift Live Activity widget — a native change, so it must be in build 10, not OTA. If the redesign is heavy, ship the
  current pill in build 10 and treat the redesign as a fast follow so it doesn't hold launch.

## CONFIG (Noah, dashboards — no code)
- **IAP price:** ASC → `forge_pass` product → change price tier from the US $6.99 tier to the **CAD $8.99** tier;
  confirm the product is **Approved** and attached to the RevenueCat offering so it's purchasable.
- **Vault won't load:** get the console error on that screen; if it's the ×10 vault crash (task #74) or a box-odds RPC,
  route to Agent 1 or 4 depending on where it lands.

---

## BUILD AGENT (runs LAST, after 1–4 merge)
1. Merge order into `integration-wave1`: **Agent 3 (stability) → Agent 2 (onboarding/_layout) → Agent 4 (challenges/shop)
   → Agent 1 (cosmetics)**, running typecheck + lint between merges; resolve any overlap (should be minimal — lanes are
   disjoint).
2. `npx expo-doctor` + `npm ls expo-image expo-modules-core` to confirm the version alignment still holds (don't
   regress the crash fix).
3. `eas build --platform ios --profile production --clear-cache` → build 10.
4. `eas submit --platform ios --profile production --latest`.
5. Report build 10's TestFlight status. Do NOT git push or submit for App Review — those are Noah's calls.

## Validation gate before submit (build 10 on device)
Fresh account → home (no campfire loop) · Google sign-in works · Friends + Valley render · IAP buys the pass at **$8.99
CAD** · cosmetic unlock → inventory → profile → shop preview all render the real look · no top crop · Cindy tutorial +
Emberfall intro fire · Focus Nudge present.
