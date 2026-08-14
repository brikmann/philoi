# Flares = the perimeter aura (premium cosmetic)

**Decision:** there is NO free/base perimeter aura. The perimeter aura **IS the flare** — that's what
flares are for. Equipping a flare paints a **faint glowing perimeter INSIDE the app, on EVERY page**
(home, lock-in, shop, profile — all of it), scoped to that flare's own colour + signature effect. Free
users still get their flame icon and everything else; the aura is the flex you unlock.

## Model
- A flare = `{ colour, effect }`. One reusable **`FlarePerimeter`** overlay, parameterized.
- **Mounted once at the app root**, above every screen, so an equipped flare shows app-wide — not just
  on the lock-in screen. `pointer-events: none`, low opacity, sits over content so the app stays fully
  usable.
- **Faint by default** — subtle and noticeable, never blinding or obscuring. (Optional: a touch stronger
  on the lock-in screen as the "deep focus" moment — keep minimal, decide later.)
- **No session-length gate.** Equip → it's on, everywhere. (The old "90m+ only" / 30-60-90 framing is
  dropped; if you ever want intensity to ramp with session depth, that's an optional layer on top —
  not required.)

## Per-flare colour + effect (this IS the flare's identity)
| Flare | Perimeter colour | Signature effect |
|---|---|---|
| **Void Smoke** (Void Purple Aura) | deep purple | drifting smoke |
| **Zeus' Wrath** | white | electric zaps / arcs |
| **Stormforge** | electric blue | pulsing glow + electric zaps |
| **Toxic** | green | falling "toxic-waste" spark droplets |
| **Inferno Flare** | orange / red | flames licking the edge |
| **Solar Flare** | bright gold | solar-flare arcs off the edge |
| **Void Plasma** | violet | plasma crackle |

Every other flare follows the same rule: one perimeter colour + one signature particle/motion effect.
Define both fields per flare in the catalog.

## Build
- **`FlarePerimeter({ colour, effect })`** overlay: absolute inset, a faint inset glow in `colour` +
  an effect layer selected by `effect` ∈ `{ smoke · zaps · falling · flames · plasma · glow }`.
- Effect layers = lightweight particle / motion (Skia or Reanimated + a small SVG/particle set). Keep
  particle counts LOW — it's ambient, not a showpiece; must not cost battery or jank the UI.
- Read the equipped flare from the loadout; mount the overlay in the **root layout** so it paints every
  page. Nothing when no flare is equipped.
- **Coordination:** the Live-Activity pill (#87) can tint to the equipped flare's colour and carry a
  hint of its effect, so the identity extends outside the app — but the perimeter itself is **in-app
  only** (a 3rd-party app can't paint the OS lock/home-screen edge).

Visual: `design-mocks/88-flare-auras.html`.
