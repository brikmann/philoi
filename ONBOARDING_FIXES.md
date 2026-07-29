# Onboarding activation bugs — fix tickets (Jul 21)

> ✅ **STATUS: BOTH FIXES APPLIED to `src/app/_layout.tsx` on Jul 21.** Not yet typechecked in-sandbox (shell was unavailable) — the next `eas build`/`tsc` run will confirm. Kept below for the record + test steps. No further code change needed unless the tests below fail.

Two bugs reported by beta testers on Jul 21, both blocking first-run activation. Both trace to the "force onboarding" redirect in `src/app/_layout.tsx` (lines ~76 and ~109). P0 — these are the #1 thing killing pulled-in friends.

---

## BUG 1 — "App forces you to create a goal before you can join a circle"

**What the user hits:** a friend taps an invite link → should land on `/join` and just join → instead gets dragged into the "create a circle + pick goal + cadence" screen (`/group/create?onboarding=true`), which forces a goal.

**Root cause:** the onboarding redirect gate in `_layout.tsx` only exempts the create screen:

```ts
// _layout.tsx ~line 109
if (
  appReady && session && !needsHandle && !needsConsent && !needsAccountDisabled &&
  hasCircle === false &&
  onboardingDone === false &&
  pathname !== '/group/create'          // <-- only exempts create, NOT /join
) {
  router.replace('/group/create?onboarding=true');
}
```

A newly-invited user has `hasCircle === false` and `onboardingDone === false`, so the instant they land on `/join?code=...`, this effect fires and replaces the route with `/group/create` before the auto-join can run. The invite is hijacked into circle+goal creation.

**Fix:** exempt the join/invite route(s) from the redirect. Whitelist instead of single-compare:

```ts
const ONBOARDING_EXEMPT = ['/group/create', '/join'];
...
  !ONBOARDING_EXEMPT.includes(pathname)
```

After the fix, an invited user completes the join → `router.replace('/group/${id}')` → `refetchHasCircle()` flips `hasCircle` true → the `hasCircle` effect (~line 81) marks onboarding done. No forced goal.

**Also verify:** the sign-in-through-invite path — a brand-new user who must Google-sign-in from `/join` should return to `/join?code=...` (code preserved) and auto-join, not get bounced to create. Check the auth callback preserves the pending invite code.

---

## BUG 2 — "'Skip for now' button doesn't work"

**What the user hits:** on the onboarding create-circle screen, tapping "Skip for now" appears to do nothing — it bounces straight back to the same screen.

**Root cause:** the skip handler (`group/create.tsx` ~line 224) writes the persisted flag but the layout's in-memory state never updates:

```ts
// group/create.tsx — Skip for now
await markOnboardingDone();      // writes AsyncStorage only
router.replace('/');
```

`markOnboardingDone()` only sets AsyncStorage. The layout's `onboardingDone` state is read from storage **once on mount** (`_layout.tsx` ~line 63: `isOnboardingDone().then(setOnboardingDone)`) and otherwise only set true when `hasCircle` becomes true (~line 81). `router.replace('/')` does not remount the root layout, so `onboardingDone` stays `false` in memory → the redirect gate immediately fires again → back to `/group/create`. Skip looks dead.

**Fix (mirror the existing `hasCircle` pattern):** re-read the onboarding flag on every navigation, alongside the circle refetch:

```ts
// _layout.tsx ~line 76 — currently:
useEffect(() => {
  refetchHasCircle();
}, [pathname, refetchHasCircle]);

// change to:
useEffect(() => {
  refetchHasCircle();
  isOnboardingDone().then(setOnboardingDone);   // <-- add
}, [pathname, refetchHasCircle]);
```

Now "Skip for now" → writes storage → navigates to `/` → pathname change re-reads the flag → `onboardingDone` true → gate no longer redirects. (Same fix also hardens any other place that calls `markOnboardingDone` without touching layout state.)

---

## Test after fixing (the actual activation path)

1. **Invite-join:** fresh account taps an invite link → lands on join → joins → goes straight to the circle, never sees a goal screen.
2. **Skip:** new user on create-circle → "Skip for now" → lands on Today/home and **stays** there.
3. **Create still works:** new user creates a circle → gets goal + invite + first-check-in path as before.
4. Regression: an existing user who left all circles isn't re-forced into onboarding (the persisted flag should protect them).
