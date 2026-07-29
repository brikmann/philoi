# Philoi — v1 "Real App" Build Spec

*Beta → deployable v1. Captured from Noah's Jul 23 feature dump. Priority tags: **[P0]** launch-blocker · **[P1]** core · **[P2]** polish. Read the two "big shifts" first — they reframe the rest.*

---

## ⭐ The two things bigger than the rest

**1. "Lock-in" is a core-loop change, not a feature.** The app is moving from *photo check-ins* → *timed "lock-in" sessions*: one-tap start/stop, solo or with friends, photo optional, start+stop posted to the group chat, time locked in → proportional XP → leaderboard. This repositions Philoi from "photo habit tracker" toward **focus/deep-work + social competition** (think Forest × Focusmate × group chat). That's a sharper, more ownable wedge than habit-photos — and it lines up with the body-doubling/Focusmate demand the research already surfaced. Commit to it deliberately; everything else orbits it.

**2. Three of these changes secretly fix your #1 research finding.** Goal-type moves to the *user*, circles become *purely social*, and circles become *discoverable + searchable* (plus onboarding drops you into circles that match your goals). Together that re-architects the on-ramp so **people with no group can find one** — which is exactly the "bring-your-own-circle" mismatch the master research doc flagged as the likely cause of the beta stall. Your intuition converged on the research. Prioritize this cluster.

---

## [P0] Launch-blocking bugs

- **OAuth consent screen shows the wrong brand.** Android: *"continue to Aspire OS"* (leftover from the pivot — Google Cloud OAuth consent screen app name is still the old project). iOS: *"continue to supabase"* (Supabase's default auth domain showing through). Fix: rename the Google OAuth consent-screen app to **Philoi**, and set a **custom domain for Supabase Auth** so it doesn't say "supabase." Trust-critical — "continue to supabase" reads as sketchy/unfinished to a new user.
- **App needs multiple refreshes to get past loading screens.** Reliability bug in startup/auth-restore (the `appReady`/stuck path in `_layout.tsx`). Diagnose the hang before launch — first-run users won't refresh, they'll bounce.
- **Keyboard handling is broken on both platforms.** UI doesn't move with the keyboard; it covers inputs. Add `KeyboardAvoidingView` / keyboard-aware scrolling across every form (auth, create-circle, goal, chat, bio).

## [P1] Onboarding

- **Pick a username** (unique `@handle` + display name).
- **Choose your school** via a **real searchable university picker** (NOT free text) — backed by a canonical universities list so campus/class grouping stays clean.
- **Consent** screen — Terms + Privacy.
- **No goals at onboarding** (design change): goals are chosen **per lock-in** from a global menu, and users lock in however / whenever / as often as they want — no once-a-day cap. (See `PHILOI_UI_SPEC.md` §21 + §12.)
- Auto-surface **discoverable campfires** (incl. class campfires for the user's school) so a new user lands in community, not an empty app.
- **First-run tutorial / coach-marks:** guided walkthrough of the main sections — dark scrim, tooltip textboxes, arrows to features, Back/Continue. *Keep it short, skippable, and re-openable, and route it to end on the user's first real Lock-In.* Learn-by-doing beats a passive slideshow — a tour that just narrates screens gets tapped through and forgotten. Guard against onboarding (goal pick + bio + campfires + tutorial) becoming a slog before the first aha.

## [P1] Goals & Circles (data-model change)

- **Decouple goal type from circles.** Circles become purely social: **name + emoji only.**
- **Goals live on the user** (chosen in onboarding, editable later).
- **Discoverable circles:** public circles, found via a **native search** function. This is the cold-start/discovery solution.
- ⚠️ *Eng note:* this is a schema migration (groups drop `goal_type`; goals re-associate to users). *Product note:* discoverable circles only feel alive if there are enough of them and they're moderated — seed a starter set and add basic reporting/moderation before opening search publicly.

## [P1] Within circles

- **Ping-all:** "I'm at the gym — come join" fires a direct push to every circle member. Rate-limit it (e.g., 1–2/day per user) so it doesn't become spam.
- **Merge Feed + Chat** into one unified messaging chain (lock-ins/check-ins and messages in a single timeline).

## [P1] The Lock-in mechanic (core loop — make this feel great)

- One-tap **Lock in** session: press to start, press to stop. Solo or with friends. Photo optional.
- Start + stop post to the group chat; duration = time locked in.
- **Proportional XP** to the leaderboard by time; compare who locked in more.
- **Camera during a lock-in:** optional camera button to snap photos while locked in; they display alongside the live session and save to the profile gallery / feed. Brings the old photo-proof back as an *optional* layer on top of the timer — and opens a new ICP (**nostalgia seekers** who want to capture the journey/progress with friends). Low cost — image capture already exists (`expo-image-picker`); ties into the friend-profile photo gallery + merged feed.
- *Cheesing:* accepted as a fun-vs-purity tradeoff — agreed, don't over-engineer it. One light guardrail worth considering (not removing the fun): a **per-session or daily cap** on counted time, so the board doesn't quietly become "who left the timer running overnight," which is both game-breaking and boring. Your call.

## [P1] Ranks / XP

- Add a **quantitative XP number** underneath the ranks (currently qualitative tiers only). XP is driven by lock-in time + challenge wins; tiers sit on top of the XP total.

## [P1] Challenge tab (3 types)

- **Individual:** self-set (e.g., "10k steps every day for a week").
- **Head-to-head:** nominate a friend (e.g., "who can study longer"). Winner gets bonus leaderboard points + an **"I'm better than you"** badge/flag on the leaderboard.
- **Group:** all-or-nothing — everyone completes → everyone gets XP; anyone fails → no one does. (Strong collective-pressure mechanic; à la Habitica parties.)

## [P2 → likely post-v1] Fitness integrations

Purpose: auto-track + publicly display fitness challenges to friends (e.g. 10k steps/day) from real device data instead of self-report.

- **Wearables:** Apple Watch, Samsung / Wear OS, Garmin, WHOOP.
- **Apps:** Strava.

⚠️ **Scope reality — this is the single heaviest item in the spec; hold most of it past v1:**

- Each is a real integration with its own OAuth + (Garmin / WHOOP / Strava) **developer-program approval you don't control the timeline on.** Weeks of work + external dependencies, not a sprint.
- It re-introduces **wearable dependence** — the exact friction that dogged Aspire OS ("I don't own a watch" — Nabil; ~half the student population has none). Gating fitness challenges on a wearable shrinks your reachable users right when you're trying to prove the loop.
- You don't need it to prove the loop — manual/photo lock-ins already cover fitness challenges for v1.

**If/when you do it, recommended order:**

1. **Apple HealthKit + Google Health Connect** — highest coverage, no partner approval (just entitlements); covers Apple Watch + most Android/Samsung via the phone.
2. **Strava** — popular with runners, accessible OAuth API (mind brand + rate-limit rules).
3. **Garmin / WHOOP** — gated partner APIs, lower coverage; only once there's real demand.

Treat as **Phase 2 (after the loop retains)**, not v1 launch scope.

## [P2] Profile

- Remove the **"Free during early access"** widget.
- **Friend profile view:** short bio, what they're working on, and — if they enable it in settings — a gallery of the photos they've posted. Reads like a "look how locked-in this person is" journal (social-proof / light-voyeurism loop that drives engagement).
- Users **advertise their goals + a description** (set during onboarding).

## [P2] UI refresh

- Current design is clean but "reads like AI slop" — needs a distinctive identity, not a generic template. (Consider a dedicated design pass / theme direction rather than incremental tweaks.)
- Home screen copy: **"Hey {Name}, let's lock in today."**
- ⚠️ Don't let the visual refresh block shipping the lock-in loop — the loop feeling good matters more than the skin.

---

## Suggested build sequence

1. **[P0] bugs** — OAuth branding, loading refresh, keyboard. (Non-negotiable before anyone new touches it.)
2. **Lock-in loop + XP** — the core thing that has to feel good. Nail this first; it's the product.
3. **Goals→user + purely-social circles + discoverable/searchable circles** — the on-ramp fix (your research finding). This is what lets it grow past your friends.
4. **Challenges + ping-all + merged feed/chat** — the engagement/competition layer.
5. **Profile + UI refresh** — polish and identity, last.

*Fitness integrations are explicitly **Phase 2**, after the loop is proven — keep them out of v1 launch scope.*

*Guiding principle from the strategy convo: the goal isn't "market to everyone," it's making one dense cluster (Laurier gym scene) visibly, undeniably alive. Every feature above should be judged by: does it make a small circle feel more alive and more worth pulling friends into?*
