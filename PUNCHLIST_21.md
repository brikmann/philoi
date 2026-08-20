# Punchlist 21 — home streak overlap + lock-in flame/flare

Big wins this pass: leaderboard **Greek pillars**, the campfire **clan page** (mock 94), and the **challenges
redesign** all landed. Remaining fixes below — home first (Noah's ask), then the lock-in flame + flare.

## HOME — `src/app/(tabs)/index.tsx` + `src/components/home-xp-bar.tsx`
🔴 **The streak text overlaps the XP bar (reads "blurred").** `streakRow` (`styles.streakRow`, ~L736) and
`HomeXpBar` (rendered ~L198) are colliding — a negative `marginTop: -Spacing.two` (~L659) pulls them into each
other, so "🔥 4-day streak" renders **on top of** the XP bar's "78% to Silver I · 1,174/1,500 XP" labels, and
"184 XP to today's fire" piles in too. On device it's an unreadable stack.
- **Fix:** kill the negative margin and give three cleanly-spaced rows under the flame:
  1. **Streak line** ("🔥 4-day streak" + share icon) — its own row, clear gap below the flame.
  2. **Hexagon badge + XP bar** — the "% to \<tier\>" and "N / M XP" labels sit **above** the fill, not on the streak.
  3. **"184 XP to today's fire"** — its own line **under** the bar.
  No element should overlap another. Match mock 92's spacing (flame → streak → rank/XP bar → CTA).

## LOCK-IN — `src/app/lock-in/index.tsx`
🟠 **1. Flame ≠ the vector.** The lock-in flame is `SessionFlame` (~L856, `session-flame.tsx`) and draws a
rounder, different shape than the home `FlameLogo`. Make `SessionFlame` render the **same `FlameLogo` silhouette**
(recoloured by the equipped flame ramp) so home and lock-in are the identical mark. No bespoke rounded flame.

🔴 **2. Flare renders as a weird dark oval aura.** `EquippedFlarePerimeter` still isn't the mock-88 treatment —
on device it's a black/olive **oval vignette**, not a flare. Rebuild to the mock-88 look: a **soft radial glow in
the flare colour + soft glowing particles**, visible but soft, full-bleed — NOT a dark oval darkening the centre.
Also it's **mounted twice** (~L816 and ~L938) — dedupe to a single mount.

🟠 **3. Make the flare truly full-bleed — it must cover the top too.** It now reaches the footer edge (good, the
hard rectangle is gone) but stops at the header: the **status bar / notch area stays dark** (there's even a comment
~L578 "the safe-area insets stay dark too"). Render the flare layer `position:absolute; inset:0` **ignoring the
safe-area insets** so it bleeds under the status bar — edge-to-edge top *and* bottom.

## Order
Home overlap first (most visible, it's the launch screen), then the lock-in flame swap, then the flare rebuild +
full-bleed. The flare is the one that's been missed most — build it to mock 88 (soft glow + soft particles), not
a vignette.
