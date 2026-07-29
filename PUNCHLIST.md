# Philoi — UI fix punchlist (build ↔ mocks)

`design-mocks/*.html` + `PHILOI_UI_SPEC.md` are the source of truth. Fix each below and verify against its mock. (Ignore the floating gear in screenshots — that's the Expo dev menu.)

---

## 0 · Global chrome — fix ONCE in a shared shell (§4b)
*These keep regressing because each screen re-implements them. Centralize.*

- **One background everywhere = `Colors.cream` / `#1B1726`.** No screen sets its own. Only exceptions: the bottom tab bar (lighter), and the two immersive routes (running session + rank-up forge, `#17131f`). **The campfire interior/selection screen is STILL darker — this is the repeat offender; kill its hardcoded bg.**
- **One shared header component** → identical top inset / height / type size across all four tabs, so titles ("Leaderboard" / "Challenges" / "Profile") don't jump when switching. Right side = at most one action, different per screen. **Home has NO title** — drop "Your fire" + its flame icon (clutter); the centered greeting is the top anchor. Home header corners: **friends icon top-LEFT, settings gear top-RIGHT** (both key menus one tap from home).
- **Tab bar = line icons, not emoji** (mock 33): flame / trophy / target / user, **active coral `#E0612C`**, inactive muted, labels kept. Use bundled vector icons, never a runtime-fetched webfont.
- **Keyboard avoidance app-wide** — inputs (composer, valley search, challenge fields) must lift above the keyboard (iOS `KeyboardAvoidingView` + tab-bar offset; Android `adjustResize`). Currently nothing moves.

## 0b · Navigation — one home for everything (§4b)
- Primary nav = **bottom tab bar only.**
- **Friends ("Your people", mock 21)** → **Home header, top-LEFT** icon (single entry). Remove it from Profile.
- **Settings** → **Home header, top-RIGHT** gear (primary; may also stay on Profile — same destination).
- **Remove the redundant profile avatar from Home** (Profile tab covers it).
- **Add-friend + friend requests (mock 34)** → inside Friends. **Join a campfire** → valley/discover only (not Friends).

---

## 1 · Home (page 1, "Your fire" — mock 30 opt B / §5)
- **Kill the bottom whitespace** — recents ("Your recent lock-ins") fill the bottom third; no dead gap.
- **Daily fire goal `258/20` is broken** — cap the bar at 100%, floor the goal (never below ~one real lock-in); purge the 0-duration phantom lock-ins dragging the avg down.
- **Matchstick bars** — remove the brown log/prong nubs; both bars = clean identical tracks, badge floating above (mock 30 opt B).
- **Header: drop the "Your fire" title + flame icon** (clutter). Header = **friends icon top-left, settings gear top-right**, nothing in the middle.
- **Center the dynamic greeting** ("Five and blazing, Noah") — it's now the screen's top anchor, horizontally centered.

## 2 · Campfire interior / valley
- **Background still darker** → `#1B1726` (see §0). Recurring — fix at the shared shell.
- **Empty campfire = a black void** → add the empty state (soft flame + "No lock-ins yet — tap Lock in to start the fire"), mock 06.
- **Remove the "Your fire · swipe back" hint** on home page 2 (mock 02 updated).
- **Valley "My fires" shows nothing** though you're in a campfire → render joined campfires as fire nodes (mock 04).

## 3 · Leaderboard (mock 11 / §15)
- **Rank shows as TEXT, not the hexagon** → use `HexagonBadge` (small) per row. Keep raw XP as the sort key.

## 4 · Profile (mock 15)
- **Pluralization:** "1 session" not "1 sessions", "1 lock-in" not "1 lock-ins".
- **Blank lock-in tile** (no photo) → show the goal icon, not an empty tile.
- **Remove the Friends icon from here** (moves to Home, §0b); keep the Settings gear.

## 5 · Challenges (§16, mock 13)
- **"Personal goal" tab still uses the OLD UI (Fredoka font)** → restyle to match "Challenge a friend" (twilight tokens, Inter). The two tabs must look like one screen.
- **Goal-type row not horizontally scrollable** — can't reach "Custom" → make it a horizontal `ScrollView`.
- **"Challenge …" button dangles** with no opponent → disable + label "Pick someone to challenge".
- **"Share with a Campfire" toggle** is ON while text says "join a campfire first" → off + disabled when no campfire.
- **Flow reconciliation (do with the challenge-tab pass):** H2H = **friend-to-friend / opponent-first** (no shared campfire required, optional "let a campfire watch"); Group/Solo stay campfire-scoped.

**Challenge tab rebuild — hero page + mechanics (mocks 36 / 37):**
- **Hero page (mock 36):** the Challenges tab becomes a hero like home — header "Challenges" → a crisp **grey vector arrow-in-target** icon → "Start a challenge" → two pills: **Challenge a friend** (→ friend H2H creation) / **Challenge a campfire** (→ group creation). A **Challenge log** fills the bottom (like recent lock-ins).
- **Log colours:** friend WIN = **green**, friend LOSS = **red** with a **"Rematch?"** button; group results = **neutral/amber** (not defeatist — it's collective), showing the placement reward.
- **Rematch → redemption:** a loss offers "Rematch?"; a rematch is worth MORE — a won rematch pays **+300 vs the original +200**, labelled **"Redemption +300"** (green) when the *previous loser* wins it. **Cap the escalation** (rematch bonus doesn't keep climbing rematch after rematch); if the original victor wins the rematch it's "Won +300", not "Redemption".
- **Marker = type icon + user emoji (mocks 36/37):** type icon is fixed — **⚡ lightning = H2H**, **👥 people = group** — and the creator **picks an activity emoji** (dumbbell / pen / book / runner…) shown on the card + marker.
- **Active-challenge marker (mock 37):** a live pulsing chip on **your fire** (opponent/goal + time + who's ahead), **in campfires** (members see it + a **Watch** button to spectate), and **on friend rows/profiles**. Needs an `active_challenge` a member/friend can read.
- **XP algorithm — scale by difficulty × duration × consistency** (NOT a flat +200): a harder/longer/more-consistent challenge pays more (e.g. a 50k-daily-steps H2H → ~1000 XP). **Cap it, effort-verify it** (real lock-ins / device metrics via §17 sync, never self-reported), keep the anti-collusion cap.
- **Group (campfire) challenge = completion reward + placement multiplier — PERCENTILE-based** (scales to any size: a 6-person campfire → the general/university leaderboard). Everyone who finishes gets the **completion base**; on top, take the **best tier you qualify for**:
  - **Top 50% → 1.1× · Top 25% → 1.3× · Top 10% → 1.5×** (percentile — applies at any board size)
  - **Top 10 → 2× · Top 3 → 2.3× · Top 2 → 2.5× · #1 → 3×** (absolute elite caps)
  - *Guard:* an absolute-rank cap only grants its multiplier when that rank is **more selective than the 10% line** — so top-10/3/2/1 effectively apply only on **big boards** (general/uni, large campfires); a small campfire uses the percentile tiers (never "everyone's top 10"). Rank by the **verified metric total** (Step 18), never speed.
- **End-of-season leaderboard reward (eventually / phase 2).** At season end, a person's **placement on a leaderboard scope** (campfire / their uni / vs-unis) pays the **same percentile ladder applied to ALL of their lock-in XP earned that season** — a retroactive bonus for sustained effort (e.g. #1 on the university board → **3× the whole season's XP**; top 10% → 1.5×). Percentile-based → works cleanly on the huge general/uni boards. **Rides on the Step 18 floors:** only already-counted XP can be multiplied — no retro-multiplying farmed junk. Seasons reset the board; past-season placements/badges kept. **Reward payout (boxes/badges/embers) lives in the reward economy — `REWARD_ECONOMY.md` / spec §24, built in CODE_BUILD_PROMPTS Step 21d** (this XP multiplier stays in the effort economy; the box+badge is granted on top).

## 6 · Friends — the friend graph (NEW, §4b / §16)
- A **friend = a mutual add** (send → accept/decline), **NOT** anyone in your campfire. Build the friend graph as its own relation.
- **Add-friend flow (mock 35):** search by `@username`/name → results + a "Suggested · from your campfires" section (shared campfires / mutuals). Each row shows the correct action for its state (below).
- **Friend requests screen (mock 34):** accept/decline incoming, "Sent" = pending outgoing.
- **State machine (the load-bearing logic):** for any two users the relationship is one of `none` · `requested` (you sent) · `incoming` (they sent) · `friends`. Transitions: `none → Add → requested`; `incoming → Accept → friends`; `requested`/`incoming → decline/cancel → none`. The button on every row reflects that state: **Add** (none) · **Requested** disabled (requested) · **Accept** (incoming) · **Friends ✓** disabled (friends).
- The **friend ping (mock 21)** and **friend-to-friend H2H** (§16, mock 13) operate on **friends**, not campfire members.
- *Data (Code):* a `friendships`/`friend_requests` table keyed on the pair, with status; friendship is mutual (one row per pair). Separate from `group_members`.

## 7 · Rank-up moment (already prompted — apply if not yet in)
- Remove the orange circle (the `ring` renders at 0.7 opacity before it fires — fix the interpolation); hex rises **from the campfire**, not the circle.
- Audio must fire **once** (guard + no-loop riser + StrictMode).
- **Infernal fills the whole screen** on the first play (full-fill, not edge vignette); **every tier gets a full-screen colour wash** (division bumps too).
- Hex does **three turns (1080°)**; **riser on every rank-up**, cut at the flare.
- Background settles to `#17131f` (not lavender).

## 8 · Data hygiene
- **Purge the 0-duration phantom lock-ins** (from the Stop→auto-restart bug) — they corrupt the flame-meter goal, streak, the "0m" recents, and the greeting. Confirm the auto-restart fix shipped first.

---

**Process:** run each screen, screenshot, compare to its mock — colors, sizes, spacing, states, copy. Report any genuinely ambiguous mock rather than guessing.
