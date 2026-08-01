# Philoi — Punchlist 2 (leaderboard / challenge / settings pass)

Bugs + fixes from testing the leaderboard 2.0 + challenge pass. Grouped by screen. **[MOCK]** = needs a new/updated schematic; **[DECISION]** = product call to confirm; everything else is a fix against the existing spec/mocks. Verify each against its mock before moving on.

---

## 0 · Global
- **Live personal lock-in bar clutters the headers.** The active-session bar (top inset) overlaps/crowds the Leaderboard & Challenge titles. Fix in the **shared chrome (§4b)**: the live bar gets its own row and the header inset accounts for it — it must never sit on top of or push into the screen title.
- **Google Sign-In must be native, not Supabase-rendered. [DECISION→native]** Right now the OAuth flow routes through Supabase's hosted page (`*.supabase.co`), which looks unprofessional. Switch to **native Google Sign-In** (`@react-native-google-signin/google-signin`) → get the Google **idToken** → `supabase.auth.signInWithIdToken({ provider: 'google', token })`. Keeps Supabase as the backend, but the user sees the **native Google account picker**, no Supabase redirect. Needs Google OAuth client IDs (web + iOS + Android) in config + the plugin → **native change = a rebuild.**
- **Campfire active streak doesn't load right** (shows a stale "1 day streak"; sometimes doesn't update after days away). Streak calc is buggy — recompute as *consecutive days with a qualifying lock-in*, reset when a day is missed, and don't cache a stale value. Audit the streak query + the daily-rollover boundary.

## 1 · Leaderboard
- **Podium avatars are square JPGs, not circular; no medal ring.** Clip avatars to a **circle** and add the **gold / silver / bronze ring** around the 1/2/3 finishers (per mock 42).
- **Google avatars show on a profile but not on the leaderboard.** Rows/podium aren't using `avatar_url` — wire the same avatar source the profile uses; fall back to the initial only when null.
- **Long names get cut off** (e.g. "Noah Brikman"). Truncate with ellipsis, and on the narrow podium use **first name + last initial** ("Noah B."); full name on the row list / profile.
- **Parthenon base slab misaligned.** The horizontal base under the columns doesn't line up with the pillar feet — align the `baseslab` width/position to the podium.
- **Board renders empty.** Opening the leaderboard should auto-populate your **relevant pool**: friends + friend-requests + everyone in your campfires, and — since your campfire is empty right now — **fall back to your university** so it's never blank.
- **Can't see a person's leaderboard stats on their profile.** Add their **rank hexagon + XP + board position** to the friend profile (mock 43) — it's specced, wire it.
- **Vs-uni names.** Show the **colloquial short name on the board** ("Laurier", "Waterloo", "UofT"), but keep the **full legal name** ("Wilfrid Laurier University") in a person's profile/settings. Add a `short_name` field per university.
- **[MOCK] Report/block sheet** — the ⋯ menu opens the raw Android system dialog ("Report, Block user, Cancel" with no UI). Replace with a proper on-brand bottom sheet (see mock `50-report-block.html`).
- **[MOCK] "Add friend" button states are boring + don't change color.** Add → Requested doesn't visibly change. Give it clear state styling: **Add** (coral filled) → **Requested** (muted/outline + check, disabled) → **Friends ✓** (confirmed). Small design pass — see §Friend-button states below.

## 2 · Challenges
- **[MOCK] Spartan empty-state illustration is unclear** — people can't tell what the SVG is. Redesign it for legibility (clearer helmet silhouette + campfire), or swap to a bolder, more readable composition.
- **Empty state not applied.** "Challenges" title is still at the top AND the "Start a challenge" hero isn't under the text — apply the **mock 41** empty-state layout (no title; illustration → "No challenges yet." → subtext → CTA under it).
- **Challenge creation is broken (multiple bugs):**
  - Challenging a friend just returns to their profile with **no "request sent"** state and no persisted challenge.
  - The receiver sees the **same challenge duplicated** (currently shows "challenging myself in an XP battle" **4×**) — there's a **self-challenge** bug + **duplicate inserts**. Fix: prevent self-challenge, dedup on (challenger, opponent, active), and show a real **"Request sent"** state on the profile/challenge log.
- **Can't accept or view progress on a challenge.** Build the **accept** action + the **progress/Watch view** (mocks 37/44/45) — a received challenge needs Accept/Decline, and an active one needs the live scoreboard.
- **No challenge data populates.** Finished a 221-XP session → challenge shows **0 progress**. The metric isn't being tallied into the challenge. Wire lock-in XP / device metrics into the active challenge's running total; build the **redemption/rematch** view.

## 3 · Campfires
- **Small board fallback.** When a campfire has **< 3 people**, use the **old (simple list) leaderboard** format; ≥ 3 → the Parthenon podium. (Specced — apply it.)
- **"Nobody here yet. Members show up once they start earning XP" bug** — wrong/again empty state; members exist but aren't rendering. Fix the members query / loading state.
- **"Lock in" CTA sits at the very bottom and looks weird.** Reposition the campfire lock-in CTA to a sensible, prominent spot (not pinned awkwardly at the bottom).
- **"No lock-ins yet" weird message** when a member has no active lock-in — fix that empty state (should be the soft empty state, not a jarring line).
- **"Join a Campfire" via code is still the old UI.** Apply the current create/join UI (mocks 10/04) — this keeps regressing.
- **[DECISION] Remove campfire levels** — redundant metric. Strip the campfire level badge/metric everywhere it appears.

## 4 · Settings
- **Remove "View profile" row** — pointless when the back arrow already returns to the profile.
- **Move Sound & haptics to the top**, under a **Preferences** group.
- **Rename "About" → "Legal".**
- **No native Sign-out UI** — add a proper sign-out row + confirmation.
- **Delete "Manage goal types"** — old UI, no longer used.
- **Legal links go direct.** Privacy Policy, Terms of Service, Child Safety should link **straight to the getphiloi.com page** (external), not an intermediate in-app screen.
- **[DECISION] Membership** — move out of Settings for now; it belongs with the monetization spec (Step 21). Park it until that pass.
- Notifications UI is good — leave it.

## 5 · Friends
- **"Locked in now" is good** — keep.
- **Tapping a locked-in friend** should offer: **Lock in with them** · **Challenge H2H** · **Challenge as a group**. Bug: the **H2H option still shows even when you already have an accepted challenge** with that person — hide/disable it (show "View challenge" instead) when an active challenge exists.
- **Body-doubling doesn't work.** "Lock in with them" does **not** actually **join** their live session — it should drop you into a lock-in that joins their session (the body-double / "locked in with you" presence). Fix the join wiring.

---

## Friend-button states (design note for the "boring button" fix)
The relationship button on a profile/row reflects the §16 state machine, each visually distinct:
- **`none` → "Add friend"** — coral **filled**, `person-add` icon.
- **`requested` (you sent) → "Requested"** — **outline / muted** with a small check, **disabled**.
- **`incoming` (they sent) → "Accept"** — **green filled** (accept), with a secondary decline.
- **`friends` → "Friends ✓"** — subtle confirmed pill (muted bg + green check), disabled.
Animate the tap (Add → Requested) with a quick fill→outline transition so it clearly registers.
