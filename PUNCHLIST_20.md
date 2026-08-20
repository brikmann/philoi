# Punchlist 20 — device review (home · lock-in · done)

Second on-device pass of the P0–P6 build. Three screens, root causes below.

## 1. HOME — `src/app/(tabs)/index.tsx`
- ✓ Centered greeting applied.
- **Home hero = CLEAN PERSONAL FLAME (decision).** Replace `<HeatFlame heat={personalHeat} size={132} />` on Home
  with the person's **equipped flame** — the `FlameLogo` silhouette recoloured by their flame ramp
  (`EquippedFlameSvg`), roaring/breathing (mock 92). **The coal-bed `HeatFlame` gauge is reserved for CAMPFIRES**
  (group heat) — Home no longer uses it. (Rationale: Home = you; campfires = the group's fire. Home no longer
  needs to "go cold.")
- 🔴 **Fix `HeatFlame`'s render — it draws as bars, not tongues.** `components/heat-flame.tsx` builds each tongue as
  an `Animated.View` + `borderRadius` (a rounded rectangle) → yellow lozenges on a brown ellipse (Noah: "rendered
  horribly"). Rebuild the tongues as **`react-native-svg` `<Path>`s using mock 93's pointed bezier geometry**,
  animated via Reanimated (scaleY per path); keep the coal-bed ellipse + glow + sparks/smoke. Then **use this
  corrected `HeatFlame` on the campfire cards/screen** for roaring/steady/cold — campfires currently render a plain
  static `FlameSvg` for "steady" (see `(tabs)/index.tsx` ValleyFlame), which is inconsistent. Unify on `HeatFlame`.
- 🔴 **Background reads near-black in the body.** `ScreenBackground` formula is correct, but on a tall device the
  radial (`at 50% 6%`, `ry 62%`) pools the purple in the top ~15% and the lower ⅔ falls to `#161320` (near-black).
  Fix: (a) verify `(tabs)/index.tsx` and the tab navigator scene backgrounds are **transparent** (not an opaque
  dark fill painted over the gradient); (b) **extend the radial** so the deep-purple carries down — raise `ry`
  toward ~95–100% and/or add a mid stop (`~#231830` around 40%). Goal: a deep-purple screen, not black.

## 2. LOCK-IN — `src/app/lock-in/index.tsx` + `src/components/economy/flare-perimeter.tsx`
- 🔴 **Flare still renders the OLD aggressive mock-88 red vignette — P2b was never applied.** `flare-perimeter.tsx`
  is still painting four hard `<Rect>` edge bands at `PEAK_OPACITY 0.82` → the red box. **Rebuild to the mock-88
  treatment:** a **soft radial-glow rim + soft glowing particles** (radial-gradient fills + glow, NO hard rects),
  full-bleed behind header/nav, **mounted once** (remove the duplicate mount), and **dim the flame ~50%** when a
  flare is equipped. Visible but soft — not a hard-edged box. (This is the single biggest miss of the pass.)
- ✓ Rank bar removed from the lock-in screen.

## 3. DONE — `src/components/lockin-done-screen.tsx` / `flame-completion-card.tsx`
- ✓ Logo flame applied.
- 🟠 **Layout isn't the mock-92 polish.** Rebuild to mock 92: flame ~118 + `SESSION COMPLETE` kick + `+XP` +
  rank-progress line, deep-purple, no fire-bonus. Fix any leftover "Post to nowhere — pick one" placeholder.

## Carryover / expected (not regressions)
- Leaderboard still parchment podium — mock 95 lives in `CODE_HANDOFF_share_cards.md`, not built yet. Fine.
- Challenges empty-state mascot art looks off-brand — low priority, note for later.

Order: fix the **lock-in flare** (P2b) and the **home flame swap + HeatFlame render** first (most visible), then the
background, then the done-screen layout.
