# Punchlist 4 — bug batch (home/profile/challenges/goal-setup/steps)

Two items already fixed directly in the repo; the rest are specced for Code to implement + lint + build.
All JS-only (OTA-shippable) unless noted.

---

## ✅ DONE (already in repo)

**A. Daily step aggregation** — `src/lib/api/fitness-challenge-sync.ts`.
Root cause: `syncStepsFromDevice` compared the device's step `total` for `[period_start, now]` against
`alreadySynced` = the sum of **all** prior logs with its note (all-time, unscoped). Weekly goals have one
fixed period so it matched; a **daily** goal that resets accumulates prior-day logs whose all-time sum
exceeds today's device total → negative delta → daily progress silently stops. Fixed by scoping the
already-synced query to the current period: `.gte('created_at', challenge.period_start)`. VERIFY: a daily
steps goal advances day-over-day, matching the device's step count for *today*.

*(Also note: the multi-source over-count some users see is HealthKit/Health Connect summing every
contributing device in a window. If daily still looks inflated after this fix, gate the read to a single
preferred source per platform rather than the OS's merged total — flagged, not yet done.)*

---

## TO DO

**B. Remove the home "Your recent lock-ins" journal** — `src/app/(tabs)/index.tsx`.
Delete the `<View style={styles.journal}>…</View>` block (recent list + empty state). Then PRUNE the now-dead
code so lint passes: the `recentLockIns` state + its `fetchMyRecentLockIns` effect, and the imports/consts
only it used (`RNImage`, `STRAVA_BADGE`, `STRAVA_ORANGE`, `GOAL_TYPE_ICON`, `GOAL_TYPE_META`,
`formatSessionDuration`) + the `journal*` styles. Replace the block with a `flex:1` spacer so the fire is the
hero with open room below. **Enlarge the flame** (`CampfireFlameStage size={80}` → ~`120`) and center the
hero in the freed space. This is the space the season graphic (mock 69) will fill — lock-in data now lives
ONLY on Profile. (Full mock-69 home adoption — centered greeting + season pill — is a follow-up.)

**C. Full lock-in history on Profile** — `src/app/(tabs)/profile.tsx` + new screen.
Add a "See all" affordance on the profile "Lock-ins" header → a new route (e.g. `app/lock-in-history.tsx`)
that lists ALL of the user's lock-ins, paginated, reusing the compact row style. Add a paginated fetch
(extend `fetchMyRecentLockIns` with an offset, or a `fetchMyLockInsPage(userId, {limit, offset})`). Profile is
now the single home for lock-in data (per B).

**D. Trim excess top space during a lock-in** — `src/components/live-session-bar.tsx` + `_layout.tsx` /
`(tabs)/_layout.tsx`. The white bar is fixed (dark now), but there's still a large gap between the floating
pill and the screen title during a lock-in. The reserved inset (`LIVE_SESSION_BAR_HEIGHT = 48`) plus each
screen's own top safe-area/header padding double up. Lower the reserved height (~36–40) and/or ensure the
tab `sceneStyle` paddingTop isn't stacking on top of a screen SafeAreaView top inset. Tune in the simulator
so the content sits ~8px under the pill, not a half-screen gap.

**E. Completed challenges → clickable + history folder** — `src/app/(tabs)/challenges.tsx` +
`social-challenge-card.tsx`.
(1) Make **completed** challenges tappable (today only `status === 'active'` is wrapped in the watch
Pressable) — a finished challenge should open a result/recap (the Watch screen already renders final
standings; route completed → `watch/[challengeId]` in a read-only "final" state, or a dedicated result view).
(2) Move completed challenges (both personal `completed` and social non-active) out of the active list into a
collapsed **"History"** section below Personal goals, so the tab isn't cluttered by finished ones.

**F. Rework the goal/challenge-setup sheet** — `src/components/fitness-sync-prompt.tsx`.
The "Track this automatically?" sheet renders its context header ("Group challenge / 10000 steps today /
🔥 Goat") flush against the status bar (no safe-area/top padding) and cramped. Rework: wrap in a top
SafeAreaView / add the inset, give it a clean header (challenge title + subtitle + goal chip) per the
fitness-sync mock (mock 14), tidy the Connect rows + spacing, and make it read as a deliberate sheet, not
overflow text under the clock.

---

## Ship
B–F are JS-only → ride the next OTA/build. A is JS-only too (already committed). Nothing here needs a native
rebuild. (The separate Strava/Health-Connect items from Punchlist-prior still stand: SQL push + one HC rebuild.)
