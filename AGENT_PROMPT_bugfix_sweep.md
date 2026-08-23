# Agent task — full app bugfix sweep

**Goal:** systematically find and fix bugs across the whole app. Don't add features — stabilize what's there.
Work on the current ship branch. Keep each fix small and self-contained; commit per fix with a clear message.

## Scope boundary
🔴 **Do NOT touch the campfire / challenge / watch surface** — a separate agent owns it
(`AGENT_PROMPT_bugfix_campfire.md`). That means: skip `src/app/campfires.tsx`, `src/app/(tabs)/challenges.tsx`,
`src/app/challenge*/**`, `src/app/watch/**`, `src/components/campfire-*`, `src/components/challenge*`,
`src/components/social-challenge-card.tsx`, `challenges-tab.tsx`, and the challenge hooks/api. If a bug you find
lives there, **log it and leave it for the campfire agent** — don't edit it, or the two branches collide.

## Ground rules
- **Reproduce → fix → verify.** For every bug: state the repro, the root cause, the fix, and how you confirmed
  it. No speculative changes.
- **Don't regress specs.** Behavior is defined in the `*_SPEC.md` files and `design-mocks/`. If a "bug" is
  actually spec'd behavior, flag it instead of changing it.
- **Firewalls stay intact:** grades/milestones earn **zero XP**; Cindy never grants embers/XP/rank; the AI
  custom goal is **free**. Never weaken `auth.uid()`/RLS scoping.
- Migrations are numbered and forward-only — new fixes get a **new** migration; never edit an applied one. Do
  **not** run `db push` / `functions deploy` yourself — leave deploy-gated steps for Noah and list them.

## 🔴 GLOBAL FIX — keyboard avoidance (build the shared solution here)
App-wide bug: **opening the keyboard doesn't push the UI up** — the input stays hidden behind the keyboard in
Cindy chat, the lock-in "Custom" activity input, sending a note to a friend, the milestone composer, and
anywhere else a text field sits low on the screen. Looks cheap; fix it **systemically**, not per-screen.
- Build **one shared keyboard-aware wrapper** (e.g. `src/components/ui/keyboard-avoiding.tsx` — a
  `KeyboardAvoidingView` with `behavior="padding"` on iOS / height on Android, correct `keyboardVerticalOffset`
  for the header + tab bar + safe-area insets) OR adopt `react-native-keyboard-controller` if already a dep.
  Bottom-docked inputs should ride the keyboard; scrollable forms should keep the focused field visible.
- Check the Android side too: `app.config.ts` → `android.softwareKeyboardLayoutMode` and the edge-to-edge /
  `windowSoftInputMode` config — edge-to-edge often breaks the default resize.
- **Adopt the wrapper on every input surface this agent owns:** Cindy chat, lock-in Custom input, friend
  note/DM, milestone composer, settings forms, onboarding, search fields. Campfire chat inputs are owned by the
  campfire agent — it will adopt the **same** wrapper (don't build a second one).
- Verify on both iOS and Android, with and without a hardware keyboard, on a notch + a home-indicator device.

## Pass 1 — static + boot
- `npx tsc --noEmit` → fix all type errors (the ~25 pre-existing React-Compiler lint warnings are known/OK —
  note them, don't chase them).
- Run the lint step; fix real errors.
- Boot the app; fix anything that throws on startup or on first render of each tab.

## Pass 2 — known open bugs (from Noah's tracker — verify each still repros, then fix)
- 🔴 **Gym lock-in → purple splash freeze** (hard blocker) — starting a gym lock-in hangs on the purple splash.
- 🔴 **×10 loot-box vault crash at the results screen.**
- 🔴 **Box opens throw "expected JSON array"** (needs migration 0069-era fix deployed — write/verify the SQL,
  flag the deploy).
- **Daily step aggregation** — weekly totals right, daily wrong (multi-source dedup).
- **Challenges not resetting properly** / completed challenges not clickable + no history.
- **Custom "time locked in" goal credit** not landing via the `check_ins` trigger.
- **Buy Direct** weekly rotation + missing countdown.
- **Purchase toast + inventory refetch** after a buy (no confirmation / stale inventory).
- **Equipped-audio silence** + flare intensity/scope.
- For each: confirm it's still broken on HEAD (some may already be fixed) before touching code.

## Pass 3 — click-through every screen
Walk each tab + modal and fix crashes, dead buttons, console errors, broken images, and obvious layout breaks:
home, lock-in (all types), done, daily fire, profile/trophy hall, leaderboards, campfires + interiors,
challenges, watch, shop/inventory/box-open, settings/connected-apps, onboarding, Cindy chat. Screenshot before
+ after for anything visual.

## Deliver (DIAGNOSE + PROPOSE — Noah reviews before anything ships)
- Work on branch `fix/app-sweep` — **do not merge to the ship branch.**
- Write the **bug ledger to `APP_BUG_LEDGER.md`**, one numbered entry each:
  `[ ] approve` · repro · root cause · the fix you made (files + diff summary) · verification (or "could not
  repro on HEAD"). Leave the `[ ]` for Noah to tick. Log any campfire-surface bugs in a separate "for the
  campfire agent" list — don't fix them.
- List new migrations (forward-only) + a separate **deploy-gated** list (db push / functions deploy / native
  rebuild) for Noah.
- `npx tsc --noEmit` clean on the branch.
- Noah reviews the ledger + diffs, ticks the right ones, and hands it to `AGENT_PROMPT_apply_sweep_fixes.md`.
