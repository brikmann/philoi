# Flares = the lock-in aura (premium cosmetic)

**Decision (UPDATED — supersedes the old app-wide framing):** a flare is a **lock-in cosmetic**. It renders a
**faint glowing border ONLY on the lock-in screen while a session is active** — not app-wide. The earlier
"paint it on every page" version was too intense and showed even when idle; scoped to the session it reads as
a calm, premium "deep focus" frame. Free users keep the flame icon + everything else; the flare is the flex
you unlock.

**The flex still travels — via the session's out-of-app surfaces.** During a lock-in, the equipped flare's
colour tints the **iOS Live Activity card + Dynamic Island** (a faint flare-coloured border/accent) and the
**Android notification accent**. So anyone glancing at your locked-in phone still sees your flare — it's just
tied to the session, not plastered on every in-app page. (See `CODE_PROMPT_lockin_pill.md`.)

## Model
- A flare = `{ colour, effect }`. One reusable **`FlarePerimeter`** overlay, parameterized.
- **Mounted on the lock-in screen only**, during an active session — **NOT** at the app root.
  `pointer-events: none`, low opacity, over content so the screen stays usable.
- **Faint border** — a quiet coloured rim + a whisper of the effect hugging the edges; never a full-screen
  wash. Tuning: `PEAK_OPACITY ~0.14`, `EDGE ~40`, effects pulled to the edges (see PUNCHLIST_15).
- **No session-length gate** — on for the whole session the moment it starts (no 30-60-90 ramp).

## Per-flare colour + effect (this IS the flare's identity)
Rarity is by **pizzazz**: a glow is Epic, particles are Legendary, and the brand-signature auras
(lightning, inferno, the season capstone) are Mythic.

| Flare | id | Perimeter colour | Signature effect | Rarity |
|---|---|---|---|---|
| **Zeus' Wrath** | `flare-zeus-wrath` | cream-gold `#FFE87A` | electric zaps / arcs | Mythic |
| **Inferno Flare** | `flare-inferno` | `#FF3D1F` | flames licking the edge | Mythic |
| **Emberfall Ascendant** (Forge Pass S1) | `flare-emberfall-ascendant` | `#FF5A2E` | `emberfall` — lava pooling low + embers raining from the top | Mythic |
| **Void Smoke** (Void Purple Aura) | `flare-void-purple-aura` | `#7B3FBF` | drifting smoke | Legendary |
| **Void Plasma** | `flare-void-plasma` | `#A200FF` | plasma crackle | Legendary |
| **Asgardian Valor** | `flare-asgardian-valor` | electric blue `#2E7BFF` | electric zaps | Legendary |
| **Acid Rain Flare** | `flare-acid-rain` | green `#6FE22A` | falling spark droplets | Legendary |
| **White Incandescence** | `flare-white-incandescence` | `#F4EEFF` | glow (the breath alone) | Epic |
| **Solar Flare** | `flare-solar` | bright gold `#FFC02E` | glow (the breath alone) | Epic |

Every other flare follows the same rule: one perimeter colour + one signature particle/motion effect.
Define both fields per flare in the catalog.

**Zeus' Wrath is cream-gold, not white** — a white zap on a dark screen reads as a rendering glitch;
the same strike in gold reads as lightning.

**Two ids were renamed** (punchlist 15.3) because they collided with FLAME cosmetic names:
`flare-stormforge` → `flare-asgardian-valor`, `flare-toxic` → `flare-acid-rain`. Owned items are rows
holding the old id STRING, so `getItem` in `src/lib/economy/catalog.ts` carries a `RENAMED_IDS`
redirect — without it, anyone who already pulled one would simply lose it. Add to that map, never
edit an id in place without it.

## Build
- **`FlarePerimeter({ colour, effect })`** overlay: absolute inset, a faint inset glow in `colour` +
  an effect layer selected by `effect` ∈
  `{ smoke · zaps · falling · flames · plasma · glow · emberfall }`.
- Effect layers = lightweight particle / motion (Skia or Reanimated + a small SVG/particle set). Keep
  particle counts LOW — it's ambient, not a showpiece; must not cost battery or jank the UI.
- Read the equipped flare from the loadout via `EquippedFlarePerimeter`; mount it in
  **`src/app/lock-in/index.tsx`** — in BOTH the base and the gym branch, so every goal type gets it —
  so it is up for exactly as long as the session is. **Not the root layout** (that was #86's app-wide
  version, reversed in punchlist 15.2). Nothing when no flare is equipped.
- **Coordination:** the Live-Activity pill (#87) can tint to the equipped flare's colour and carry a
  hint of its effect, so the identity extends outside the app — but the perimeter itself is **in-app
  only** (a 3rd-party app can't paint the OS lock/home-screen edge).

Visual: `design-mocks/88-flare-auras.html`.
