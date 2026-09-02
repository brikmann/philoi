# Code Prompt — flares ramp with lock-in time (faint → max), replacing the flat intensity cut

New mechanic (Noah's, revived from an original idea a user re-surfaced unprompted): **a flare's intensity scales with how long the current lock-in has run.** It starts near-invisible and steps up at **15 / 30 / 60 minutes**, so the flare reflects how deep you are in *this* session — the longer you hold, the more your flame roars.

This **replaces** the earlier "flatly reduce every flare by ~half" plan. Same three intensity axes (coverage/opacity, density/count, brightness/glow) and the same toned-down ceiling — but instead of pinning them low always, they **ramp with elapsed time**. This is a better fix for "too intense": the flare is barely-there for most of a session and only reaches full after a sustained hold, and even that full is the toned-down version.

Client-only, OTA-able. Renderer: `src/components/economy/flare-perimeter.tsx`; the lock-in screen (`src/app/lock-in/index.tsx`) already tracks `elapsedSeconds` and the active session lives in `ActiveSessionProvider`.

## 1 · The intensity curve — 4 stepped tiers
Flare intensity is a function of the **current session's elapsed minutes**, stepped (not a smooth creep — discrete bumps are the point):

| Tier | Elapsed | Feel |
|---|---|---|
| 0 | 0–15 min | **Faint** — barely visible. A faint, thin perimeter hint; for Asgard, extremely thin + sparse bolts; every flare minimal. |
| 1 | 15–30 min | Slightly up from faint. |
| 2 | 30–60 min | Noticeably present. |
| 3 | 60+ min | **Max** — the toned-down full (perimeter aura not full-screen engulf, ~half the element density of the literal mock, softer glow). This is the ceiling; it never exceeds it. |

- All three axes scale **together** across the tiers (coverage/opacity, density/count, glow/brightness). The faint tier is *fainter* than the old flat-reduction target; the max tier is the old toned-down "full."
- Motion/cadence unchanged across tiers — only presence scales, not speed.
- Each flare keeps its identity at every tier (Zeus gold-from-clouds, Asgard blue top-down hammer, Inferno, Void, Toxic, Emberfall Ascendant) — a faint Asgard is still unmistakably Asgard, just whisper-quiet.

## 2 · The threshold surge — a sudden moment at 15 / 30 / 60
Crossing a threshold is a **reward beat**, not a quiet interpolation: on each crossing, a brief **surge** — the flare pulses/blooms up to the new tier over a short beat, then settles at it. A subtle haptic tick on the crossing is welcome (respect reduce-motion / the haptics pref). This is the "your flame just grew" moment the mechanic exists for.

## 3 · Copy under the timer
A tiny caption beneath the lock-in timer announces each step:
- 15 min → **"15m elapsed — flare up"**
- 30 min → **"30m elapsed — flare up"**
- 60+ min → **"60+m — flare max"**
Show it as the surge fires and let it linger briefly, then settle to a quiet current-tier indicator (or fade) — keep it small and out of the way of the timer/flame hero. Wording exactly as above.

## 4 · Per-session, resets each lock-in
Driven by the **active session's** elapsed time — a fresh lock-in starts at Tier 0 (faint) again; it reflects the *current* hold, not lifetime minutes. When no session is running, there's no ramp.

## 5 · Previews show MAX
Anywhere a flare is shown to *preview/flex* it rather than during a live session — inventory, shop item detail, collection — render it at **Tier 3 (max)** so the user sees what the item actually looks like. Only the in-session perimeter aura ramps.

## 6 · Asgard's Valor (and Zeus) — thin, not line-y
The bolts currently read as thick **lines**, worst at the faint end. Make them **thin yet impactful** at every tier: a thin bright near-white core over a dimmer, slightly wider glow; a jagged/forked path (a straight thin stroke still reads as a rule — the zigzag sells it as lightning); impact carried by the bottom shrapnel/flash, not by stroke width. At Tier 0 this is a single thin sparse strike; by Tier 3 it's more frequent but still thin. Apply the same thin-core treatment to Zeus so the two lightning flares stay consistent.

## 6b · Emberfall Ascendant — risers must be FLAMES, not dots
The Ascendant risers currently render as **dots / circles**. The spread and size are right (it reads as smoke), so **keep those** — the only change is the **glyph**: each riser is a small **flame** shape, not a circle. The name is literally "rising flame," so they should read as tiny flames rising.
- Swap the particle glyph from a dot to a small flame silhouette (reuse the canonical Cindy flame path scaled down, or a simple flame shape — not a filled circle). Keep the current count, spread, and per-riser size.
- **Direction:** "Emberfall *Ascendant*" and "rising flame" both mean upward — the risers should **rise (bottom → top)**. They currently read top-to-bottom; flip them to rise unless Noah says keep them falling. (Flag this — it's the one thing he didn't explicitly call out, but the name implies up.)
- Applies at every intensity tier (faint tiny flames → fuller at max).
- **Recolour:** EA is currently `#FF5A2E`, which reads as a dirty sienna orange — unattractive. Make it a hotter **orangey-red, "hellfire"** (pull the green channel down toward red). Recommended **`#F5401C`** (tune to taste). Update **both** hardcodes so it stays consistent: `src/lib/economy/catalog.ts:569` (the flare `colour`) and `src/components/economy/season-standing-share-card.tsx:27` (`const EMBERFALL`). Keep it **distinct from Inferno** (`#FF3D1F`) — EA slightly deeper/redder, not identical. The flame-glyph risers inherit this colour.

## 7 · Gym sessions — flare rendered, but fainter than a study lock-in
Flares **do** render in a gym session today (the lock-in screen mounts `EquippedFlarePerimeter` in both its branches, ~`index.tsx:943` and `:1111`), but at the **same** intensity as a study lock-in — only the flame is dimmed in gym, not the flare. That's wrong: in a gym session the user is **actively looking at the screen** between sets, so a full-strength perimeter is in their face.

- **Keep the flare in gym**, but apply an **additional dampening multiplier** on top of the time-ramp — a gym flare is meaningfully fainter than a study flare at the same tier (start ~0.5–0.6× of the study intensity; tune to taste). So even a 60-min gym max sits below a 60-min study max.
- The **ramp still happens inside gym** (faint → less-faint at 15/30/60, with the surge + caption) — it's the whole curve scaled down, not a flat clamp.
- **Mechanism:** `ActiveSession.mode` (`'gym' | 'lockin'`, already in `active-session-context.tsx`) is the signal. The screen renders the two branches separately, so pass a `gym`/`dampen` prop to `EquippedFlarePerimeter` in the gym branch and thread it into the intensity calc as a mode multiplier. Don't infer it inside the renderer if the branch can just declare it.
- Behind a named constant (`GYM_FLARE_DAMPEN`) alongside the tier table.

## Tunable
Put the per-tier values behind named constants (a `FLARE_INTENSITY` table keyed by tier 0–3, per axis), the thresholds behind named minute constants, and the gym multiplier as `GYM_FLARE_DAMPEN` — so "make Tier 1 a touch stronger," "move the 60 to 45," or "gym a bit fainter still" are each one-line edits.

## Verify on device
Start a lock-in with a flare equipped (test account had **Emberfall Ascendant** + **Lightning Tendrils**): it's barely visible at first; at 15/30/60 it visibly surges and the caption fires; at 60+ it sits at the toned-down max with the flame + timer clearly legible throughout; Asgard reads as thin lightning, not lines; a fresh session resets to faint; inventory/shop previews show the flare at full.

## Done =
Equipped flares start near-invisible and step up at 15/30/60 min of the current lock-in, each crossing a visible surge with the "…flare up / flare max" caption under the timer; max intensity is the toned-down ceiling (never the literal-mock engulf); Asgard/Zeus bolts are thin bright filaments not lines; previews show max; per-session reset; all levers behind named constants.
