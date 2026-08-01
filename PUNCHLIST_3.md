# Philoi — Punchlist 3 (post-build sanity pass 2)

Fixes from testing the lock-in redesign + challenge/leaderboard build. **[MOCK]** = new schematic (see below).

## Lock-in session (redesign follow-ups)
- **Non-gym lock-in — remove the top-right bar.** The redesigned base screen (mock 51) is full-immersive: ONLY the minimize control top-right, nothing else. Remove any leftover header/top bar.
- **Non-gym lock-in — a white bar pushes everything down.** A stray white header / live-session bar is inserting at the top and shoving the flame + timer down. The lock-in route is edge-to-edge immersive — no white bar. Likely the live-session bar or a SafeArea/header regression leaking onto the lock-in screen; suppress it on this route. (Same root as the "top-right bar" above — a leftover header.)

## Gym tracker
- **Every logged set auto-spawns another set.** Each time you complete a set, an extra empty set row appears on its own. Confirm intent — if unintended, stop auto-chaining: new rows come only from the manual **"+ Add set"** (auto-populating at most ONE ready row is fine, but it shouldn't keep adding after every log). Otherwise the gym logger tested well.

## Challenges (data bugs — top priority; these block XP too)
- **Phantom H2H challenges can't be deleted.** The old self-challenge/duplicate bug left ~4 "XP battle vs yourself" entries that persist on screen. (a) **Purge** the bad rows (self-challenges + duplicates) via migration/cleanup; (b) add a **cancel/delete** action (creator can cancel a pending challenge, either party can leave); (c) enforce the **no-self-challenge + dedup** guard so they can't come back.
- **H2H XP doesn't populate.** Active H2H shows 0 progress even after a 221-XP lock-in. Wire lock-in XP (and device metrics) into the challenge's running total + standings. The phantom rows are likely masking this — clean the data first, then verify a real H2H tallies live.

## Home / flame meter
- **Fire-complete bar vs rank bar discrepancy.** The two vertical flanking bars (today's fire / rank) are slightly misaligned — normalize per §5: same track height + baseline, badge + label sizes matched, both fill from the same bottom line.

## New screens — see mocks
- **[MOCK] Lock-in detail + share (mock 54).** Recent lock-ins on the home screen must be **tappable** → a detail view with its stats (goal, duration, XP, date, photos, PRs), and those stats **shareable** (reuses the story share card, §28/29).
- **[MOCK] Request sent / landed (mock 55).** Sending a challenge/invite needs a clear **"sent" confirmation** + how the request **lands on the receiver's end** (Accept / Decline).
