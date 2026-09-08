# Code Prompt — Focus Nudge shield: full-screen Cindy-flame (Android) + max-polish (iOS)

Redesign the Focus Nudge shield toward **`design-mocks/182-focus-nudge-shield.html`** — immersive, Cindy's
flame owning the top with a living glow + rays, copy centered, actions anchored bottom. **Read the platform
reality first — the two platforms have very different ceilings.** On `integration-wave1`. Native (rides the
next native build per platform, not OTA).

## 🔴 Platform reality (do not fight the OS)
- **iOS = Apple's ShieldConfiguration (Family Controls). CONSTRAINED.** The shield over a blocked app is
  *system-rendered*; you can ONLY set: `backgroundColor` / `backgroundBlurStyle`, one `icon` (UIImage),
  `title` + `subtitle` (label + colour), `primaryButtonLabel` (+ `primaryButtonBackgroundColor`), and
  `secondaryButtonLabel`. **No custom layout, no rays, no animation, no full-bleed.** The card is the
  ceiling. Do not try to render a custom full-screen view on iOS — the OS forbids drawing over another app.
- **Android = our own overlay (`SYSTEM_ALERT_WINDOW`, `FocusNudgeOverlay.kt`). FULL CUSTOM.** Mock 182 is
  fully achievable here — flame, rays, ember gradient, animation, the works.

## §1 · iOS — polish the shield to its max (buildable + testable now)
In the ShieldConfiguration extension (`FocusNudgeShared.swift` / the shield target), within Apple's limits:
- **Background:** dark twilight `#150F24`-ish with a blur; warm, not the flat grey.
- **Icon:** the **Philoi flame** (a rendered flame image asset, ember-lit) as the shield `icon` — this is
  the one visual that carries Cindy's presence within the constraint.
- **Title:** the headline ("You're still locked in.") in ink; **subtitle** = the Cindy body line in muted.
- **Primary button:** "Back to my session" with **ember `primaryButtonBackgroundColor`** (`#E0612C`→ember)
  and near-black label; **secondary:** "Continue anyway" (or the escalated/wellbeing pair on the caring
  tones — keep the existing intent→buttons map).
- That's the whole iOS surface. It'll read as a warm, on-brand card, not the flat system default. Ship this
  for the iOS launch; it's as premium as the API allows.

## §2 · Android — the full-screen Cindy-flame shield (mock 182) — reading-week native build
In `FocusNudgeOverlay.kt`, replace the card with the **full-bleed** layout from mock 182:
- Immersive dark-ember background (radial ember glow behind the flame), covering the whole screen.
- **Cindy's flame** large in the upper third with a **living glow** (pulse/flicker) and **slow rays** behind
  it (ember-tinted), the `PHILOI` eyebrow beneath.
- Headline + Cindy body copy centered; the two actions (ember primary + text secondary) anchored at the
  bottom. Same payload (`buildNudgePayload` → title/body/buttons) — this is the *render*, not the data.
- Keep it **instant** (§the whole point — no glimpse of the guarded app), reads the cached payload only, no
  network (the airplane-mode rule holds). Respect reduce-motion (drop the flicker/ray spin).

## Shared
- Both read the same `FocusNudgePayload` (base + escalated + escalateAfter/window/deferMs); the escalation
  card (caring tone after repeated retreat) uses the same treatment per platform.
- Nothing about the *data*/timing changes — this is presentation only.

## Verify / Done
- **iOS:** the shield shows the flame icon, warm ember background, ember primary button, correct copy —
  testable now on your device; confirm it's the max within ShieldConfiguration (no attempt at custom
  full-screen).
- **Android:** the overlay is full-bleed per mock 182 — flame + glow + rays + copy + buttons, instant, no
  feed glimpse, reduce-motion safe. (Needs a native Android build to test — reading week.)
- Reference: `design-mocks/182-focus-nudge-shield.html`, `modules/philoi-focus-nudge/` (`FocusNudgeOverlay.kt`,
  the iOS shield target, `FocusNudgeShared.swift/.kt`), `src/lib/focus-nudge.ts` (`buildNudgePayload`),
  APP_BLOCKER_SPEC / mocks 109 + 116, `philoi-flame-mark.png` (the flame asset).
