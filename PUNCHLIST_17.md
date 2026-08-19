# Punchlist 17 — main-loop render fixes (home · lock-in · done · daily-fire)

Second on-device pass. The reskin plumbing landed (gradient, tokens, Flame Pass) but the **hero flame
draws wrong on every screen**, the **home layout drifts from mock 92**, and the **flare is the old
aggressive app-wide deco, not mock 88**. Fix the main loop to match the mocks *exactly* first
(home · lock-in · done · daily-fire); then we go screen-by-screen. Priorities are ordered.

---

## P0 — Flame vector is still the tri-colour campfire (spans EVERY screen) 🔴
**Symptom (Noah, on device):** the flame renders as *"the tri-colour campfire as before, except in the
shape of the vector — not the smooth outline we scoped."* Wrong on home, campfire, done, daily-fire.
**The one place it's RIGHT is the Home tab-bar icon** — because that uses a *different* component.

**Root cause — two flame systems, only one is correct:**
- ✅ **`components/ui/flame-logo.tsx` → `FlameLogo`** is the scoped mark: **one** path (`FLAME_PATH`,
  viewBox 24×24) filled with a **single smooth vertical gradient** (deep ember base → pale gold tip).
  This is exactly mock 92's `#flameMark` + `#flameGrad`. The tab bar uses it → renders correctly.
- ❌ **`components/flame-icon.tsx` → `FlameSvg`** is what every hero/done/daily-fire/campfire uses.
  Code re-pathed the geometry but **kept three stacked opaque `<Path>` layers** filled with
  `ramp.outer / ramp.mid / ramp.core`. Three opaque layers = the tri-colour campfire look. That's the bug.
- ❌ **`components/campfire-flame.tsx` → `CampfireFlame`** literally still renders the **🔥 emoji**
  (`<Text>🔥</Text>`, line 46). Anywhere this mounts is an OS emoji, not our mark.

**Fix:**
1. In `FlameSvg`, render **one** path — the outer silhouette — filled with a **vertical `LinearGradient`
   driven by the ramp** (base `ramp.outer` → mid `ramp.mid` → tip `ramp.core`, low→high). **Delete the
   mid + core stacked `<Path>` layers.** One smooth-gradient silhouette = FlameLogo's look, and flame
   **cosmetics still recolour** (the ramp feeds the gradient stops — geometry unchanged, every size/
   aspect call site unaffected). *Simplest correct version: reuse `FLAME_PATH` from flame-logo.*
2. Replace `CampfireFlame`'s 🔥 emoji with the same flame (`FlameSvg`/`FlameLogo`), keeping its
   heat-driven breathe/scale/glow. No emoji anywhere.
3. This single change corrects home, done, daily-fire, campfire, hexagon badge and share cards together
   (they all route through `FlameSvg`).

**Mock 92 flame sizes (viewBox 24×24):** home hero **132**, done **118**, daily-fire roar **150**.

---

## P1 — Home screen doesn't match mock 92
Ref: `design-mocks/92-home-done-dailyfire.html` (first phone).
- **Greeting isn't centered.** Mock `.greet{text-align:center}` — center it. (`.g1` 13px muted line,
  `.g2` 22px/800 name line — keep the greeting to that scale, centered.)
- **Flame too small.** Bump the hero to **~132**; the hero column is `flex:1` centered so the flame
  actually breathes with space above/below — don't let it collapse.
- **Rank badge + Lock-in CTA are squished.** Mock structure top→bottom: header pill + hamburger → centered
  greeting → **`flex:1` hero (flame + streak)** → **`.rankrow`** (hexagon badge 42×47 + combined XP bar,
  width 238, `margin-top:14`) → **`.cta`** as its **own padded block** (`padding:0 18px 18px`), the
  `.lockbtn` = `linear-gradient(135deg,#F2A33C,#E0612C)`, black text `#3a1608`, radius 15, padding 16.
  Give the rankrow and the CTA the mock's spacing — they are **not** adjacent/cramped.

---

## P2 — Lock-in screen (`src/app/lock-in/index.tsx`)
**(a) Kill the rank bar on lock-in.** Lines ~847–854 render `RankProjectionBar` inside a `rankBar` view
→ that's the on-device *"38% to Silver I · ~3½h."* **We moved the projection to Home + the Lock-Screen
Live Activity; the in-app lock-in screen has NO rank bar** (FLARES_SPEC / mock 91). Remove that block.

**(b) The flare is the OLD aggressive app-wide deco — rebuild to mock 88.** Two problems in
`src/components/economy/flare-perimeter.tsx`:
  - It paints **four hard-edged `<Rect>` gradient bands** at each edge (`EDGE=92`, `PEAK_OPACITY=0.82`).
    Hard rectangular bands at 0.82 = the **red box vignette** Noah saw. (The file's own comment still
    says "0.14 at the edge" while the constant is 0.82 — stale.)
  - `EquippedFlarePerimeter` is mounted **twice** in lock-in (~794 and ~921) and is the app-wide variant.
  - **Fix:** render the **mock-88 treatment — full-bleed, soft**: a **soft radial glow rim** (not hard
    rect bands) + the effect's **soft glowing particles** (radial-gradient fills + glow, per mock 88),
    **visible but soft**, edge-to-edge behind header/nav. Mount **once**, only while a session is active.
    Match mock 88's particle look/opacities (visible — NOT the retired `~0.14`; but soft-glow, not a
    hard-edged box).

**(c) Dim the flame ~50% when a flare is equipped** (flare is the centrepiece; the coloured flame steps
back so it doesn't fight the effect). No flare → flame full strength.

**(d)** The equipped **flame colour** on lock-in (the pale-blue in the shot) is a separate cosmetic and is
fine — just ensure it uses the corrected P0 silhouette, dimmed per (c).

---

## P3 — Done + daily-fire to mock 92
Both inherit the corrected flame from P0. Then:
- **Done** (`components/lockin-done-screen.tsx` / `flame-completion-card.tsx`): flame **118** →
  `SESSION COMPLETE` kick → `+XP` → rank-progress line → deep purple. **No "fire bonus."** Also fix the
  placeholder **"Post to nowhere — pick one"** string seen on device (wire the real post-target or hide it).
- **Daily fire** (`components/flame-meter-complete.tsx`): roaring flame **150** → `DAILY FIRE COMPLETE` →
  **"You're on fire, Noah"** → **crisp ember token** (`EmberToken`, not the flame) → deep purple.

---

## P4 — App icon / favicon
The **in-app** flame and the **Android lock-in notification** icon now render correctly. But the **app
icon itself** (flame on the dark-purple gradient) doesn't render. Regenerate the iOS + Android launcher/
app-icon asset from the flame glyph on the plum gradient (`Colors.plum`), and confirm `app.config`'s icon
paths point at the regenerated asset.

---

---

## P5 — Flame reflects heat (home + campfire) 🆕
Ref: **`design-mocks/93-flame-heat-states.html`**. The flame is a **live gauge**, not a static logo. One
`heat ∈ [0,1]` drives three states, and the **same mapping serves the personal flame and the campfire flame**:
- **≥ 0.6 — roaring:** full `#fg` gradient, glow ~0.5, rising embers, fast flicker.
- **0.15–0.6 — simmering:** deep-ember `#fgSim` gradient, scaled ~0.62 to a warm ember bed, faint glow, slow.
- **< 0.15 — cold / burnt out:** desaturated `#3a3450`, **no glow**, a drifting smoke wisp — the "relight" nudge.

**Personal heat** = streak alive + today's progress toward goal (so a broken streak / no activity shows the
**gone-cold flame on Home** — Noah's ask). **Campfire heat** = the existing `get_my_campfire_heat()`
(share of members locked in today) → roaring when the group's active, embers when it's slipping, burnt-out when dead.

**The heat gauge is its OWN illustration — NOT the `FlameLogo`.** (Noah v2: the states can't be the brand
silhouette at different opacity, and they need a base.) Build a **coal-bed fire** that is distinct from the brand
mark, with a **persistent coal base** across all three states — only the fire on top changes, so each state is a
**genuinely different composition**, never one glyph faded:
- **≥ 0.6 roaring:** a **live cluster of staggered flame tongues** (Inferno-flare `flick`/`lick` licks, each its
  own timing) off a **bright coal bed** + rising sparks — flickers like a real campfire, not one static shape.
- **0.15–0.6 simmering:** tongues drop to **a few low, gentle licks** off a **glowing ember bed** (slower timing).
- **< 0.15 cold:** **dead grey coals** + ash flecks + **several rising smoke puffs** (staggered), **no glow**.

The clean `FlameLogo` stays the **brand** (tab bar, app icon, wordmark, home hero at rest); this coal-bed fire is
the **activity gauge**. Wire it into the home hero (heat state) and `campfire-flame(-stage).tsx` (replacing the
🔥 emoji, P0). Colours/geometry per **`design-mocks/93-flame-heat-states.html`** (v2).

## P6 — Campfire member view is missing the banner / clan layout 🆕
Ref: **`design-mocks/94-campfire-member-view.html`** (member view) + **`62-campfire-join-preview.html`** (the
join-preview it derives from). On device, opening a campfire you're in has **no banner** and doesn't match the
designed clan layout. `src/app/group/[groupId]/index.tsx` should land on:
- **Equipped Campfire Banner hero** with the group's **heat flame** (P5) on it + the **join gate** chip
  (min rank to join, e.g. "Gold+ to join").
- **Serious stat strip** (avg streak · locked-in/day · live challenges).
- **Leaderboard as the DEFAULT tab — visible the instant you open it** (Noah: "leaderboard visible from the sec
  you join"), with Feed & Challenges as sibling tabs, not the landing.
- Roster ranks (hexagon rank pips on avatars) + the house rule. Clash-of-Clans clan feel.

## Order
P0 first (it fixes the flame across all four screens at once), then P1 → P2 → P3 → P4. P5–P6 are the
screen-by-screen tweaks (home cold-state + campfire) — take them after the main loop matches on device. After
that, we walk the rest of `RESKIN_COVERAGE.md` one-by-one.

**Coordination:** don't edit the mocks/specs — flag disagreements in chat (see `CODE_COORDINATION.md`).
Commit before cutting any build so nothing in the tree gets wiped.
