# Punchlist 5 — post-Strava bug batch

All JS unless noted. Grounded against the current tree.

---

## 1 · Home is bare — enlarge the hero to fill the space (mock 69)
`src/app/(tabs)/index.tsx`. The journal is gone and the flame is already 120, but the hero **bars + badge**
are still small, so the screen reads empty with a big dead gap under the CTA.
- Bump the constants: `HERO_BAR_HEIGHT 72 → ~110`, `HERO_BAR_WIDTH 14 → ~18`, `HERO_BADGE_SIZE 34 → ~46`,
  and the flame `CampfireFlameStage size 120 → ~140`.
- **Center the hero + CTA group** in the freed vertical space (a `flex:1` spacer above the hero and the existing
  one below, or `justifyContent:'center'` on the page content) so it's not top-stacked with emptiness below.
- Leave clear headroom below the CTA — that's where the **mock-69 season graphic** will live; don't fill it with
  anything else yet.

## 2 · Strava sync — ✅ working, no action.

## 3 · Challenges tab still looks bare
`src/app/(tabs)/challenges.tsx`. With few/no active challenges (History collapsed), the tab is just the button +
a large empty gap.
- When there are **no active** challenges (only History), show a light empty state under "Start a challenge"
  (e.g. the Spartan-armor illustration + "No active challenges — race a friend or set a personal goal"), instead
  of dead space.
- Keep the collapsible **History** section as-is; just make sure the populated state doesn't leave a half-screen
  gap (center or cap the list's empty area).

## 4 · Personal-goal metric chips aren't swipeable
The "What are you tracking?" chip row (Steps / Study time / Gym visits / Run / …) overflows the screen and can't
be scrolled — the cut-off chips are unreachable. In the goal/challenge create form (personal-goal branch):
- Wrap the chip row in a **horizontal `ScrollView`** (`horizontal`, `showsHorizontalScrollIndicator={false}`,
  `contentContainerStyle` with the gap) so every metric is reachable — OR make it **flex-wrap** to two rows.
  Either works; horizontal scroll matches the mock. The "More metrics — riding, Whoop…" reveal stays.

## 5 · Active-session pill overlaps HEADERS on pushed screens
Settings, New challenge, and the campfire leaderboard view have a **native header** that renders *behind* the
live-session pill (not pushed down like the tab screens).
- **Root cause:** the root Stack's `contentStyle.paddingTop = topInset` pushes CONTENT down, but a native
  **header** isn't content — it sits at the top and the floating pill (top:0) overlaps it. Tab screens are fine
  because they're header-less + use `sceneStyle.paddingTop`.
- **Fix:** when a session is active (and not on the lock-in route), set
  `headerStatusBarHeight = insets.top + LIVE_SESSION_BAR_HEIGHT` in the root Stack's `screenOptions` — this
  reserves space above the header content, pushing the title/back-button **below** the pill. IMPORTANT: don't
  *also* apply `contentStyle.paddingTop` on headered screens or you'll double-inset — gate the content padding to
  header-less screens (or drop it to 0 when the header already carries the offset). Tune on-device so the header
  sits just under the pill.

## 6 · No rank-up animation on Strava (server-side XP)
`rank-up-celebration.tsx` only fires from the lock-in **done** flow (`rankBefore`/`rankAfter` on the done screen).
A Strava (or Whoop) check-in is created server-side via webhook/backfill — there's no done screen, so a rank-up
from synced XP shows nothing.
- **Fix — a global rank watcher.** Persist the user's **last-seen rank** (tier + division) in SecureStore (or a
  `profiles.last_seen_rank`). Whenever fresh rank data loads — home mount, app foreground, and right after a
  Strava/Whoop backfill/sync refetch — compare current vs last-seen; if it **increased**, fire the existing
  `RankUpCelebration` and update last-seen. This covers every server-side XP source (Strava, Whoop, challenge
  payouts), not just manual stops, and de-dupes so it only plays once per actual rank change.

---

## Ship
All JS → next build/OTA. No migration, no native change. #5 and #6 want a quick on-device check (header offset;
rank-up fires once on a synced rank change and not on every refetch).
