# Punchlist 6 — UI tweaks batch

All JS, all OTA-shippable — no migration, no native change. Grounded against the current tree.

**Reference mocks (build to these):**
- §1 verified panel → `design-mocks/82-verified.html`
- §3 done screen → `design-mocks/81-done-screen.html`

---

## 1 · Stale "You're verified at {university}" panel (Android) — mock `82-verified.html`
A stale `CampusVerifiedPanel` ("You're verified at Laurier") shows when the live state says
otherwise. Root cause: the verified UI isn't single-sourced from a freshly-read profile, and
profile state isn't cleared on sign-out, so a value can linger across sessions/accounts.

- **`src/lib/auth/auth-context.tsx`** — on `signOut`, clear local state immediately
  (`setProfile(null)`, `setSession(null)`) alongside `supabase.auth.signOut()`, so a previous
  account's `university_email_verified` can't carry into the next view.
- **`src/app/campus.tsx`** (Settings → Campus) — refetch on focus so `verified =
  profile?.university_email_verified` always reflects the server:
  `useFocusEffect(useCallback(() => { refreshProfile(); }, []))`.
- **`campus-verification.tsx` / `setup-handle.tsx`** — the verified panel must render strictly
  off the live profile flag. No optimistic/local `justVerified` value should keep it mounted
  after navigation; reset any such flag on unmount.
- **While you're in the verified panel, rebuild it to match `design-mocks/82-verified.html`** —
  one shared component for both onboarding + Settings (only the CTA label differs): green verified
  badge with the school crest, "You're verified at {Laurier}", two ✓ UNLOCKED chips (My Uni / Vs
  Unis), the trust note, and the "🎓 Laurier ✓" profile-badge preview. School name interpolated
  from the profile's short school name.
- **Verify (Android):** verify → sign out → sign back in (same *and* different account) → Campus
  shows the true server state, no stale "verified" panel.

## 2 · Remove the sign-out confirmation — go straight to the main page
The sign-out flow has an extra confirmation step; kill it so tapping "Sign out" signs out
directly and lands on the sign-in/main page, no intermediate dialog/button.

- **`src/app/settings.tsx`, `handleSignOut()`** — drop the `Alert.alert('Sign out of Philoi?', …)`
  confirmation entirely; call `signOut()` directly:
  ```ts
  function handleSignOut() { signOut(); }
  ```
- `signOut()` already clears the session (and the native Google session, per the Google-signout
  fix), which routes to the entry page via the auth gate. **Confirm on Android** it goes straight
  there with no leftover "sign out now" screen/button in between.

## 3 · Done screen — rebuild around the flame (mock 81)
`src/components/lockin-done-screen.tsx` is overloaded. Rebuild it around the **same large living
flame as the work session** (mock 69 / `CampfireFlameStage`), stripped to the essentials. Layout
+ kept/cut list: **`design-mocks/81-done-screen.html`**.

**Keep, in this order:** big flame (hero, glowing/settled) → `LOCKED IN` + big duration → the goal
line → one compact rank row (hex badge · tier · `+XP` · bar filling toward next, with the existing
fill + count-up animation) → one streak line → a single **post card** (pre-seeded to the campfire
the session started in — one tap; optional note folded in; "change" to multi-select others) →
primary `Post & finish` → secondary `Just finish`.

**Cut / collapse:**
- The routine-naming block ("Routines build from memory") — remove from the done flow; offer it
  once from the gym screen instead.
- The standalone caption field — fold into the post card as the optional note.
- The streak before→after animation — just the result line.
- The upfront multi-select campfire grid — collapse behind "change" (still multi-post).
- Gym recap sprawl + clip grid — for a gym session collapse to ONE summary line
  ("5 exercises · 18 sets · 12,400 lb") with a "View" that opens the full recap.
- Photo gallery — if photos exist, a single small thumbnail row above the post card, not a gallery.

**Unchanged behavior:** a real rank-up (crossing OR division bump) still hands off to the
full-screen `RankUpCelebration` instead of this screen (see `lock-in/index.tsx`) — this screen only
renders for a stop that didn't move the rank.

---

## Ship
All JS → next OTA. #1 and #2 want a quick on-device Android check (stale panel gone; sign-out lands
on the main page directly). #3 is a component rebuild against mock 81 — verify the non-gym, gym, and
with-photos variants all stay clean.
