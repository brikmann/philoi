# Build prompt — finish mid-session Cindy (client-only, makes the current build)

The one Cindy entry point that never got wired. Components already exist (`cindy-quick-sheet.tsx`,
`cindy-bubble.tsx`, `cindy-flame-press.tsx`); the lock-in screen just doesn't use them. This is a **client-only**
wire-up — no server change, no migration — so it rides the same native build. Runs on `add-marketing-site`.
Source of truth: `CINDY_SPEC.md` "Entry points — Lock-in" + mock 117 §C (Option A).

## Context (verified)
- `CoachSurface = 'home' | 'chat' | 'intercept' | 'reengagement'` — **no `lockin`, and we don't need one to
  ship.** The quick-sheet routes into the existing chat; the proactive bubble uses `home` with a lock-in
  situation. (A dedicated `lockin` surface for tuned tone is a later functions-deploy refinement — optional, no
  rebuild.)
- Gate everything on Cindy consent, exactly like the home bubble (`useCindy` / `use-cindy-bubble`). Un-consented
  = no bubble, no fetch. No 🔥 emoji anywhere; the flame is the mirrored `PersonalFlame`/`SessionFlame`.

## 1. Tap the session flame → quick-sheet
- In the active lock-in screen (`src/app/lock-in/index.tsx` / wherever `SessionFlame` renders during a live
  session), wrap the flame in `CindyFlamePress` (or a press handler) that presents **`cindy-quick-sheet.tsx`**
  as a bottom sheet over the camera/Stop row (dim behind — must not derail the session).
- Wire the three rows to the existing chat (simplest, robust — reuse `/cindy` + `?ask=` prefill):
  - **How am I doing?** → `router.push('/cindy?ask=' + encodeURIComponent('how am I doing this session?'))`
  - **Add a note to this session** → `router.push('/cindy?ask=' + encodeURIComponent('add a note to my current lock-in'))` (conversational per the decided approach — do NOT restore the §13-removed caption field)
  - **Open full chat** → `router.push('/cindy')`

## 2. Proactive line ABOVE the flame, milestones only (Option A)
- Add a timer in the active session; at **30 / 60 / 90 min** (and on a PR if that signal is available), call the
  coach once — `surface: 'home'`, with a `situation` describing the live lock-in (type, title, elapsed minutes,
  streak) — and render the returned line in **`CindyBubble` above the flame, under the header** (mock 117
  Option A). Auto-dismiss; never continuous; one line.
- Reuse the home bubble machinery (`use-cindy-bubble.ts` pattern); gate on the same consent + `bubbleEnabled`.

## Guardrails
- Consent-gated (no fetch when off). Sheet slides over controls; bubble auto-dismisses — focus stays sacred.
- No new server surface required. If you *do* add `lockin` to `CoachSurface` for tuned tone, that's a separate
  `functions deploy` (no rebuild) — keep it out of this client change.

## Verify
- `npx tsc --noEmit` clean.
- Start a lock-in → tap the flame → quick-sheet appears over the controls; each row lands in chat.
- At 30/60/90 min → a single Cindy line appears above the flame, auto-dismisses.
- Cindy consent OFF → no bubble, no sheet fetch, flame still taps to chat only if that's the home rule.
