# Philoi — per-screen build prompts for Code

Paste **one block at a time** into Claude Code. After each: run it, open the matching `design-mocks/*.html` in your browser, compare, fix, *then* do the next. Order below is the recommended **build order** (not file order) — do **Step 0 first**.

Rules baked into every prompt: the HTML is the exact *visual* reference (hex, px, radii, `@keyframes`) to **translate into React Native + Reanimated** — never a webview; use shared theme tokens; replace only *this* screen's conflicting code; never rip out shared logic (nav/data/API/state) silently — flag it.

---

### Step 0 — Design system (do this before any screen)
```
Set up the Philoi design system from PHILOI_UI_SPEC.md §1–4. Put the twilight-purple color tokens, spacing, radii, and the Inter font into src/constants/theme.ts, REPLACING Fredoka/Nunito. Add the campfire flame logo (SVG vector in §3) as a reusable component, and regenerate the app icons + web favicon from it (plum/twilight background, no transparency). Every screen after this must reference these tokens — no hardcoded hex where a token exists. Build the shared components in §7 (avatar, chip, rank hexagon, progress bar, CTA button). Run a typecheck when done.
```

### Step 0b — Reward feedback: sound + haptics (cross-cutting — wire in as you build the loop)
```
Add soundification + haptics so the app feels rewarding, per PHILOI_UI_SPEC.md §22. The app ALREADY has a sound system — RewardBurst (Spark/Bloom/Surge tiers), plus preloadRewardSounds() and reward preferences — so EXTEND that, don't rebuild it. Make one reward-feedback helper and fire it on the key moments; match intensity to significance (quiet navigation, loud rewards):
- Lock in (tap Start): a satisfying "ignite" cue + a firm haptic — the session begins. [PRIORITY]
- Done / Post (Stop → recap, and again on Post): a warm "settle/complete" cue + haptic, plus a subtle rising tick/whoosh AS THE XP BAR FILLS on the done screen (§13). [PRIORITY]
- Rank-up (§11): the loudest cue — reuse the RewardBurst Surge tier + a strong haptic; Infernal is the biggest.
- Streak kept / milestone, challenge win, reactions: small tiered cues (crackle / triumph / light taps).
Use expo-audio for sounds + expo-haptics for haptics; PRELOAD at startup (already done for RewardBurst). Respect the device mute switch, reduced-motion, and a global sound toggle in Settings. Nail Lock in and Done first — those two taps must feel great.
```

**Sound-file task (for Step 0b):** existing sounds are in `assets/sounds/` — `spark.wav`, `bloom.wav`, `surge.wav` — loaded via `src/lib/sound.ts` (prefs in `src/lib/reward-settings.ts`). Add three new short cues: `ignite.wav` (Lock in), `settle.wav` (Done/Post), `whoosh.wav` (XP-bar fill). Source them from **Pixabay Sound Effects** (`pixabay.com/sound-effects` — CC0 / no-attribution, commercial-safe); each **< 1s, normalized, .wav or .mp3**. Drop into `assets/sounds/`, register in `sound.ts`, and wire: `ignite`→Lock-in Start · `settle`→Stop/Post · `whoosh`→XP fill on the done screen · reuse `surge.wav` for rank-up. **Until the real files are added, map the moments to the existing spark/bloom/surge as placeholders so nothing is silent.** Only CC0 / royalty-free-for-commercial — note each source; never rip from YouTube or other apps.

### 1 — Splash / sign-in  (file: `01-splash.html` · spec §20)
```
Build the Splash / sign-in screen. Read design-mocks/01-splash.html and PHILOI_UI_SPEC.md §20. Translate its inline CSS (exact hex, px, radii, @keyframes) into React Native + Reanimated — it's a visual reference to match, not a webview. Use the shared theme tokens. Notes: gently flickering campfire logo with embers rising; the Greek etymology subtext (φίλοι · fee-loy · Ancient Greek + definition); single action "Continue with Google"; the OAuth consent screen must read "Philoi" (not Aspire OS / supabase). Replace this screen's current UI; don't touch auth logic beyond wiring the button. Run it and stop so I can compare to the mock.
```

### 2 — Onboarding  (file: `17-onboarding.html` · spec §21)
```
Build Onboarding. Read design-mocks/17-onboarding.html and PHILOI_UI_SPEC.md §21. Translate the mock's inline CSS into React Native — visual reference, not a webview. Use theme tokens. Three steps with a progress bar: (1) pick a username (unique @handle + display name), (2) choose school via a REAL searchable university picker backed by a canonical universities list — NOT free text, (3) consent (Terms + Privacy). IMPORTANT: no goals step. Do not collect or pre-create any goals. Replace the current onboarding UI; keep the routing gate logic but remove any goal-selection step. Run it and stop for comparison.
```

### 3 — Solo campfire (home)  (file: `08-solo-campfire.html` · spec §12)
```
Build the Solo campfire screen (card 1 of the home swipe). Read design-mocks/08-solo-campfire.html and PHILOI_UI_SPEC.md §12 (solo campfire section). Translate inline CSS to React Native — reference, not webview. Use tokens. Notes: NO chat or feed; greeting, your steady personal flame, plain streak, a single "Lock in" CTA (no subtitle), your rank hexagon + XP bar, and a short private journal of recent lock-ins; pager dots at the bottom. Replace this screen's UI; don't touch shared data logic. Run it and stop for comparison.
```

### 4 — Lock-in goal picker  (file: `07-lockin-goal-picker.html` · spec §12)
```
Build the Lock-in goal picker sheet (opens when Lock in is tapped). Read design-mocks/07-lockin-goal-picker.html and PHILOI_UI_SPEC.md §12 (goal picker). Translate inline CSS to React Native — reference only. Use tokens. Notes: bottom sheet "What are you locking in for?"; goal-type grid each with its flaming icon; optional detail field; solo vs. with-the-campfire toggle; Start button. Goals are chosen HERE each time — not from a saved user list. Run it and stop for comparison.
```

### 5 — Running lock-in session  (file: `09-running-session.html` · spec §13)
```
Build the Running lock-in session. Read design-mocks/09-running-session.html and PHILOI_UI_SPEC.md §13. Translate inline CSS + animations to React Native + Reanimated — reference, not webview. Use tokens. Notes: the goal's tool burns IN the flame (bright cream tool, swap per goal type); a COUNT-UP timer on a background-safe clock (persist start time, compute elapsed on resume); "Locked in with you" body-doubles each with a live timer; an in-session camera (the ONLY camera in the app) → lock-in photos; a quiet Stop button that posts the session to the campfire chain with duration + XP + photos. Run it and stop for comparison.
```

### 5b — Live session mini-map (global, cross-tab)  (file: `25-home-active-session.html` · spec §5/§13)
```
Build the persistent live-session bar ("mini-map"). Read design-mocks/25-home-active-session.html. Translate inline CSS to React Native — reference only, use tokens.

It's a GLOBAL element rendered in the root layout above the tab content, visible on EVERY tab/screen whenever a lock-in is active, hidden when none. A rounded pill pinned top-center under the safe-area inset: pulsing coral dot (`#E0612C`) + activity icon + activity label (the goal/routine name, e.g. "Push day") + a live running timer + a maximize glyph. Tapping it navigates back to the running session (Step 5, or the gym logger for gym lock-ins).

CRITICAL — the timer must be driven by the session's START TIMESTAMP from the active-session store, not a local `setInterval` counter, so it stays correct across navigation, remounts, and backgrounding. Keep active-session state (id, goal/routine, startedAt, campfire, mode) in ONE context/store; the mini-map, the home, and the running screen all read from it.

Only ONE lock-in at a time: while a session is active, the home reflects it (roaring flame, "You're locked in", body-doubles line, and the primary CTA becomes "Return to your lock-in" instead of "Lock in"), and "Lock in" affordances elsewhere are disabled/hidden. Respect reduced-motion (dot stops pulsing). Run it and stop for comparison.
```

### 6 — Campfire home swipe  (file: `02-campfire-home-swipe.html` · spec §5)
```
Build the Campfire home. Read design-mocks/02-campfire-home-swipe.html and PHILOI_UI_SPEC.md §5 (+ §9 motion, §10 field). Translate inline CSS + animations to React Native + Reanimated — reference only. Use tokens.
IMPORTANT — this is now just TWO pages in a horizontal pager, nothing more:
- Page 1 = "Your fire": the solo lock-in home (greeting, big living flame, streak, "Lock in" CTA, your rank hex + XP bar, recent lock-ins). This is the default page.
- Page 2 = the valley (discovery). Swiping right from Your fire reveals it — it IS the field/valley from Step 10 (mock 04), same component.
Two pager dots only. There is NO scroll-wheel of per-campfire cards anymore, and NO separate "Find a campfire" list page — DELETE that flat list screen entirely. There is NO Saturn/globe button to reach discovery; the valley is simply page 2. The campfires you're a member of appear in the valley under the "My fires" filter (tap one → its interior, Step 9). Only fully animate the centered flame on page 1 (perf).
Run it and stop for comparison.
```

### 6b — Daily flame meter (home page 1)  (file: `26-flame-meter.html` · spec §5)
```
Build the daily flame meter on home page 1 ("Your fire"). Read design-mocks/26-flame-meter.html. Translate inline CSS + animations to React Native + Reanimated — reference only, use tokens.

WHAT: a daily XP-goal progress bar ("Today's fire") that sits BELOW the "Lock in" hero and ABOVE the rank hex. Two tracks: the flame meter = TODAY, the rank hex below = forever.

DAILY GOAL (adaptive by default + static override):
- Default `daily_goal_mode = auto`: today's target is computed from the user's rolling ~14-day average lock-ins/day, with guardrails — FLOOR of 1, a CAP so it can't run away, a small stretch only when they've hit goal several days running, ADAPTS DOWN as well as up (eases if they slow), and is SMOOTHED off the average so one big/zero day doesn't whipsaw it. New users get a gentle fixed default (~1) for the first week until there's history.
- `daily_goal_mode = manual`: user sets a fixed target in Settings.
- Persist `daily_goal_mode`, the computed/target value, today's progress, and a per-day `completed` flag.

COMPLETION (once per day): when the meter fills → award bonus XP (and reserve the hook for +ember currency, monetization) + show the completion card. Lock-ins BEYOND completion still earn normal rank XP but do NOT re-trigger the reward — it's a daily "I showed up" milestone, not farmable.

SOUND: fire a dedicated "meter fill / complete" cue as it ignites (soundification §22 — reuse the rising whoosh building into a short flourish). Haptic on complete.

ANIMATION TIERS (match the mock): ⅓ = slow rising embers · ⅔ = more/faster particles · full = small, faint flames ringing the WHOLE perimeter (pointing outward) + steady rising embers + a soft steady glow (no pulsing). Reduced-motion → static per tier.

PUBLISH (opt-in): completing the meter can publish an "I completed my fire today" card to the user's campfires (like a lock-in). Consent-gated, with a toggle in Settings; default off until they opt in. Run it and stop for comparison.
```

### 7 — A campfire (lock-in screen)  (file: `03-campfire-lockin-screen.html` · spec §6)
```
Build a group Campfire screen (the roaring-fire view). Read design-mocks/03-campfire-lockin-screen.html and PHILOI_UI_SPEC.md §6. Translate inline CSS + animations to React Native + Reanimated — reference only. Use tokens. Notes: roaring flame with sparks; opted-in feed photos scattered around it (fresh ones outlined); "X & others locked in now" + lit avatars; the campfire's shared level (hex badge + XP bar) and group streak at the bottom; your personal rank badge in the header (tap → profile). Run it and stop for comparison.
```

### 8 — Lock-in done (session summary)  (file: `18-lockin-done.html` · spec §13)
```
Build the Lock-in "done" screen — shown right after Stop on the running session (§13). Read design-mocks/18-lockin-done.html and PHILOI_UI_SPEC.md §13. Translate inline CSS to React Native — reference only. Use tokens. Notes: a SATISFYING recap, not a loud celebration. Order top→bottom: (1) activity chip + session time; (2) IMMEDIATELY below, an ANIMATED XP bar that fills from the pre-session XP to the new total on open (the "+XP" fades in and the number counts up), with the rank hexagon badge beside it — if the fill crosses a tier, chain into the rank-up moment (§11); (3) the streak widget directly under it, ONLY if applicable; (4) the session photos ("From this session"); (5) a "Posting to [campfire]" line + a primary "Post to the campfire" button (writes the lock-in event to that campfire's chain with duration + XP + photos) and a secondary "Keep this one private". Run it and stop for comparison.
```

### 9 — Campfire interior (chat + lock-ins)  (file: `06-campfire-interior-chat.html` · spec §12)
```
Build the Campfire interior (tapping into a campfire). Read design-mocks/06-campfire-interior-chat.html and PHILOI_UI_SPEC.md §12. Translate inline CSS to React Native — reference only. Use tokens. Notes: ONE merged chat+feed timeline — text messages and lock-in event cards interleaved; a live "locked in now" strip; system lines for streaks; composer where "Lock in" is a hero bar ABOVE a text-only input (NO composer camera — photos come only from lock-in sessions). Run it and stop for comparison.
```

### 10 — Campfire field + discovery  (file: `04-campfire-field.html` · spec §10)
```
Build the valley (= page 2 of home, and the discovery surface). Read design-mocks/04-campfire-field.html and PHILOI_UI_SPEC.md §10 (+ §9 motion). Translate inline CSS + animations to React Native + Reanimated — reference only. Use tokens.

Layout: campfires as fires scattered across a dark twilight valley, sized/brightened by activity (roaring = big + foreground). SPACING IS CRITICAL — fires and their labels must NOT overlap; use a spread layout with clear gaps and single-line (ellipsized) labels. Top-left is a plain BACK ARROW (returns to Your fire) — NOT a pill labelled "field". Bottom control bar: SEARCH (campfires / courses / schools) + filter toggles (My fires / My school / Classes / Popular) that repopulate the valley + a dashed "Have a code? Join a private campfire" row + "Start a campfire of your own". Only fully animate the roaring fires (perf).

TAP A FIRE → PREVIEW SHEET (not an instant join): a bottom sheet showing the campfire's flame + name, campfire level, member avatars + count, "N locked in now", and a few recent lock-in photos (if any). The sheet's CTA depends on the campfire's privacy state:
- OPEN → "Join <name>" — joins instantly, anyone can (no approval).
- GATED → "Request to join" — pings the owner to approve; note "The owner approves new members." A small lock badge also shows on gated fires in the valley.
- MINE (already a member) → "Open <name>" → its interior.
The valley lists OPEN + GATED campfires. PRIVATE campfires are hidden — reachable only via the "Have a code?" flow (enter code → join directly). The user's own solo fire is NOT a node in the valley — that's home page 1 (Your fire); the valley only shows group campfires. Run it and stop for comparison.
```

### 11 — Create a campfire (+ class)  (file: `10-create-campfire-class.html` · spec §14)
```
Build the Create-a-campfire screen. Read design-mocks/10-create-campfire-class.html and PHILOI_UI_SPEC.md §14. Translate inline CSS to React Native — reference only. Use tokens. Notes: name + emoji; a "For a class?" toggle that reveals a Course field + School (from profile); an "I can help with this class" helper toggle. Store course_code + school + a per-membership is_helper flag; make class campfires searchable by course.

PRIVACY — a "Who can join" 3-way selector (replaces the old Discoverable toggle): Open (in valley, instant join) · Gated (in valley, owner approves) · Private (hidden, code only). Persist as a `privacy` enum. This SAME selector must also appear in campfire settings / Edit campfire, editable any time (transitions per §14: →Open auto-approves pending, →Private leaves the valley, →Gated starts collecting). The valley (Step 10) shows Open + Gated only.

JOIN REQUESTS (gated only) — build the owner approve/deny flow: an owner-only "Join requests" row + count badge in the options sheet (mock 19), and the requests screen (design-mocks/22-join-requests.html · spec §14) — rows with avatar, name, @username, context line, Approve (adds member) / Deny (dismiss), an "Approve all" action, and an empty state. Gate the screen + actions on an owner/admin role check (role-based, enforced in RLS). On approval, notify the requester ("You're in 🔥 <campfire>") deep-linking to the interior. Run it and stop for comparison.
```

### 12 — Profile  (file: `15-profile.html` · spec §18)
```
Build the Profile screen. Read design-mocks/15-profile.html and PHILOI_UI_SPEC.md §18. Translate inline CSS to React Native — reference only. Use tokens. Notes: avatar + name + @handle + university; rank hexagon + XP bar; stats (streak / lock-ins / hours); goal chips; a grid of the user's lock-in photos. On someone else's profile, respect their photo-privacy setting (§19). Settings gear top-right → §19. Run it and stop for comparison.
```

### 13 — Settings  (file: `16-settings.html` · spec §19)
```
Build the Settings screen + its sub-actions. Read design-mocks/16-settings.html and PHILOI_UI_SPEC.md §19. Translate inline CSS to React Native — reference only. Use tokens. Notes: profile summary row (→ profile); Notifications (grouped toggles), Who can see my photos (My campfires / Everyone / Just me), Manage goal types; then Sign out (→ splash) and Delete account (red danger — requires an explicit confirm, then a real server-side hard-delete that purges the user's photos from storage; no soft-disable). Run it and stop for comparison.
```

### 14 — Leaderboard  (file: `11-leaderboard.html` · spec §15)
```
Build the Leaderboard. Read design-mocks/11-leaderboard.html and PHILOI_UI_SPEC.md §15. Translate inline CSS to React Native — reference only. Use tokens. Notes: scope pills (Campfires = all people across your campfires deduped / My uni / Vs. unis); metric toggle XP vs Streaks (hidden on Vs. unis). ALWAYS sort by raw XP (tier hexagon is a badge only, never the sort key). Your row highlighted; My uni = top 10 + your pinned row; Vs. unis = schools ranked per-capita. Also add the per-campfire (intra-campfire) local board inside each campfire. Run it and stop for comparison.
```

### 15 — Rank-up moment  (file: `05-rankup-legend.html` · spec §11)
```
Build the Rank-up moment. Read design-mocks/05-rankup-legend.html, design-mocks/31-rankup-tier-flash.html, design-mocks/32-rankup-full-sequence.html (the full forge→flare→splash-with-share flow), RANK_UP_COPY.md (headline copy), and PHILOI_UI_SPEC.md §11. Translate the animation timeline into Reanimated precisely — it's the exact reference. Use tokens. Notes: ~5s campfire forge — the hexagon emerges tiny from the smoke, slowly rises + materializes + rotates, flares as it solidifies, then HOVERS and pulses (does not auto-dismiss). Metal tiers Bronze→Diamond; Infernal (renamed from "Legend") = molten hexagon with a FAINT soft-glow aura (a blurred radial glow, NOT literal flame shapes) + a FLAME VECTOR in its center (brand flame, molten #B0431E/#E0612C — not a numeral, not a crown), and the loudest/amplified forge. EVERY rank-up plays the full-screen forge + riser (§11) — division bumps AND tier crossings; only the flare PAYOFF scales (bump = lighter flash + soft cue, crossing = full tier flash + full tier sound). Add a "Share" that generates a polished card.

RANK-UP LOGIC (spec §11, mock 31):
1. MULTI-RANK SKIP — if the XP earned clears several ranks at once, compute the FINAL resulting rank and display ONLY that (e.g. 500 XP clearing Bronze III + II shows a rank-up to Bronze I, not each step). If multiple tier TYPES are crossed at once, use the final/highest tier for the flash + sound.
2. HEADLINE — composed "{personal}, {name}. {social}" from RANK_UP_COPY.md (the source of truth). Load the copy into RANK_UP_LINES = { bronze:{personal:{3:[…],2:[…],1:[…]}, social:[…]}, silver:{personal:[…],social:[…]}, gold, diamond, infernal }. On a rank-up to (tier, division): personal pool = bronze uses personal[division], other tiers use personal[]; pick one personal stem + one social sentence, EACH with its own no-immediate-repeat history; compose `p + ", " + firstName + ". " + s`. Personal stems carry no name; social sentences carry no name. Interpolate {school}/{mascot}/{rival} in social from profile (fallbacks; beta = Laurier / Golden Hawks / Waterloo). Applies to every rank-up — only the flash/sound intensity differs by tier-type change.
3. FLASH ON EVERY RANK-UP, TWO INTENSITIES — a within-tier DIVISION bump (e.g. Bronze III→II) gets a LIGHTER flash (quick tier-colored shimmer: fainter tint + short sweep + a small spark pop near the badge, ~0.5s, no full-screen takeover) so no promotion goes unmarked. Crossing a new TIER TYPE gets the full-screen dramatic effect (+ the forge): Silver = metallic light sweep (#C4CBD6) · Gold = golden sparkle burst (#F5C542) · Diamond = a shower of prismatic glints (#7FE0E8) · Infernal = the whole screen catches fire (flames rise + coral edge vignette) and the hex BURNS. Infernal is singular (always major). RECONCILE: the fiery Infernal effect is the TRANSITION only — the settled/resting Infernal badge stays the faint molten aura (no literal flames), per §11.
4. RISER (EVERY rank-up): the forge + riser plays on every rank-up now (division bump AND tier crossing) — see §11; what scales is the flare payoff, not whether there's a build. On the ~3.7s forge, play rankup-riser.wav from t=0 — it swells and climaxes exactly on the flare (FLARE_DELAY_MS ≈ 3700) and cuts as the per-tier cue lands, so they don't compete. Primary = cinematic; alts rankup-riser-wildfire.wav / rankup-riser-drone.wav.
   PER-TIER SOUND — real files in assets/sounds/, selected by the NEW tier type on a tier-TYPE crossing: Bronze = rankup-bronze.wav (hammer) · Silver = rankup-silver.wav (ka-ching) · Gold = rankup-gold.wav (ching) · Diamond = rankup-diamond.wav (choir; alt rankup-diamond-sparkle.wav) · Infernal = rankup-infernal.wav (victory rock guitar; alt rankup.wav flame). Preload with the other cues. A division bump gets a small SOFT cue (lighter version) paired with its lighter flash.

RENAME (code + DB): the apex tier "Legend" is renamed to "Infernal". Update all user-facing strings to "Infernal", swap the badge emblem from the crown to the brand FLAME VECTOR centered in the hexagon, and rename the stored tier value 'legend' → 'infernal' in rank_thresholds via a migration (then NOTIFY pgrst, 'reload schema') plus every code reference (rank-tiers.ts, types/database.ts, hexagon-badge.tsx, rank-up-celebration.tsx, leaderboard rows, reward-feedback.ts). Pre-launch, a clean value rename is fine; if you'd rather not migrate the stored value, keep the internal key and map it to the "Infernal" display label — but everything the user sees must read Infernal.

Run it and stop for comparison.
```

### 16 — Challenges tab  (file: `12-challenges-tab.html` · spec §16)
```
Build the Challenges tab. Read design-mocks/12-challenges-tab.html and PHILOI_UI_SPEC.md §16. Translate inline CSS to React Native — reference only. Use tokens. Notes: sections for pending invites (Accept/Decline card), active head-to-head races (two competitors + a live split bar + payout), and group all-or-nothing (member progress dots + payout). Metric = real lock-in XP; payouts capped/scaled with anti-collusion. Run it and stop for comparison.
```

### 16b — Friend ping ("Your people")  (file: `21-friend-ping.html` · spec §16)
```
Build the Friend ping screen. Read design-mocks/21-friend-ping.html and PHILOI_UI_SPEC.md §16. Translate the inline CSS to React Native — reference only, use design tokens.

Structure: a "Your people" screen titled with an add-friend (ti-user-plus) action and a search field. Friends are grouped: a "Locked in now" section (friends with an active lock-in session) pinned to the top, then "All friends". Each row = avatar + name + status line + a trailing quick-action button.

STATE-AWARE ACTIONS — this is the key rule:
- A friend who is LOCKED IN RIGHT NOW: avatar shows a coral live ring; the trailing quick button is a coral LOCK icon = "Lock in with them" (joins/starts your own session alongside theirs). Do NOT show a "nudge to lock in" for these people — nudging someone already locked in is nonsense.
- A friend who is NOT locked in: the trailing quick button is the amber 🔥 flame = one-tap "Nudge to lock in" (fires a push notification "<You> pinged you to lock in 🔥", no setup). Show a brief check-mark confirmation on tap.

Tapping a row (anywhere but the quick button) opens a branded bottom sheet (same sheet pattern as mock 19) with the friend's header and up to three actions:
  1. PRIMARY, state-dependent: "Lock in with them" (if they're locked in) OR "Nudge to lock in" (if not).
  2. "Challenge — head to head" (ti-swords) — deep-links into Start-a-challenge (Step 17) with type=H2H and THIS friend pre-selected as opponent, skipping the campfire/who steps.
  3. "Challenge — as a group" (ti-users) — deep-links into Start-a-challenge with type=group.

"Locked in now" status comes from live session state (same source the campfire live-presence strip uses). Nudges send a push + an in-app notification; tapping the nudge notification opens the lock-in goal picker (Step 4). Wire the two challenge actions to pass a prefilled param into the challenge creator. Run it and stop for comparison.
```

### 17 — Start a challenge  (file: `13-start-challenge.html` · spec §16)
```
Build the Start-a-challenge screen. Read design-mocks/13-start-challenge.html and PHILOI_UI_SPEC.md §16. Translate inline CSS to React Native — reference only. Use tokens.

The setup is TYPE-ADAPTIVE, and the ordering differs by type:
- HEAD-TO-HEAD is FRIEND-TO-FRIEND (opponent-first). Pick an opponent from ALL your friends (not campfire-bound — an H2H does NOT require a shared campfire). Then the race metric (Most XP / Most lock-in time), and an OPTIONAL "Let a campfire watch" toggle that, when on, reveals a campfire selector so a group can cheer you both on. No campfire is required to challenge a friend.
- GROUP is campfire-first: pick the campfire, set the shared goal (stepper), confirm "who's in" (all members), done.
- SOLO: pick a campfire to announce to, then describe the challenge.

Shared below config: duration pills (24h / 3 days / 1 week), a capped payout preview, and a send button that relabels to the exact action ("Challenge Aidan" / "Start group challenge" / "Announce challenge").

PREFILL FROM PING (Step 16b): the screen must accept route params { type, opponentId } (and optionally campfireId). When arriving from a friend ping, default to that type with the opponent pre-selected and show a small "From your ping to <name>" tag — the user lands ready to send. When opened fresh from the Challenges tab (+), no prefill. Run it and stop for comparison.
```

### 18 — Effort & anti-cheese principles  (foundational — read BEFORE Steps 19–21 and apply to challenges / leaderboards / flame meter / Forge Pass)
```
NOT a screen. The design rules every reward-bearing feature must obey. Reality: a lock-in is NOT technically verifiable — someone can tap "Lock in" and scroll reels and it still counts. We do NOT chase perfect verification (it's impossible and ruins UX). We make cheating pointless, visible, and rare.

CORE RULE — rewards stay INTRINSIC. XP / rank / cosmetics / embers only. NEVER attach real money or high extrinsic value to unverified effort. A cheater only cheats themselves out of the actual benefit; there's no external payoff to farm. (This is why "never sell effort" and the loot-box caution exist.)

MATCH REWARD SIZE TO VERIFIABILITY — do not treat all metrics equally:
- Device-verified metrics (steps / distance / active-minutes / workouts via HealthKit / Health Connect / Strava / Garmin / Whoop, §17) are hard to fake → the BIG rewards + placement multipliers ride on THESE.
- Gym: the workout log (logged sets/reps, §23) is the proof-of-effort — a gym lock-in that counts needs logged work (+ optional photo; phase-2 form video), not just a running clock.
- Study/focus: offer an OPTIONAL app-blocking / Focus mode during a lock-in (Forest/Opal/Brick model) — engage it and you can't scroll reels; leaving the app ends the session. Strongest verification for focus work, and it reads as a commitment device, not surveillance.
- Honor-system metrics (untracked study/reading) stay LOW-STAKES — small XP, social bragging, no jackpots worth cheating for.

ANTI-FARMING ON THE LOCK-IN:
- MINIMUM DURATION = 30s. A lock-in under 30s earns ZERO XP (no flame-meter progress, no rank XP, no ember reward) but STILL RECORDS as a lock-in programmatically (it's in history / count — we don't silently drop it, and we don't punish a genuine misfire). On finishing a sub-30s session, the done screen (§13) is REPLACED by a "too short" state instead of the normal reward flow:
    • Heading: "That was a quick one" (or "Too short to count")
    • Body: "Lock-ins under 30 seconds don't earn XP — it's logged, but give it a real go to earn fire." (never scolding; it's a nudge, not a punishment)
    • Single CTA: "Back to home" → returns to Home page 1. No share, no reward card, no confetti.
    • Keep it calm/neutral in tone + color (muted, not the danger red) — a genuine short session shouldn't feel like a failure.
  Rotate 2–3 heading variants so repeat testers don't see the same line. This is the visible face of the min-duration rule.
- Cooldown / no rapid-repeat stacking.
- Diminishing XP per session (the flame meter already caps the day — extra sessions earn little).
- Quality floor for a challenge unit: e.g. a gym lock-in counts only if ≥ ~20 min AND has a photo or logged sets.
- Keep the random "still here?" confirmation on long sessions (presence check).

PLACEMENT MULTIPLIER (group challenges) — do it right:
- Rank by the VERIFIED metric TOTAL at challenge end — NEVER "fastest to goal" (farmable).
- Placement multiplier is PERCENTILE-based (scales to any board): top 50% 1.1× / 25% 1.3× / 10% 1.5×, plus absolute elite caps top 10 2× / top 3 2.3× / top 2 2.5× / #1 3×. Take the best tier you qualify for. Guard: absolute-rank caps only apply where that rank is more selective than the 10% line (big boards only), so small campfires use the percentile tiers. Gate the big multipliers to verifiable-metric challenges; rank by verified total, never speed.
- END-OF-SEASON leaderboard reward (phase 2): the same percentile ladder applied to ALL of a person's season lock-in XP by their final placement (scope: campfire / uni / vs-unis) — e.g. uni #1 → 3× the whole season's XP. MUST ride on these floors (only already-counted XP can be multiplied — no retro-multiplying farmed junk).

SOCIAL + RESIDUAL:
- Surface quality signals (duration, photos, consistency) so farming is visible + embarrassing among people who know you. Allow reporting.
- Accept the residual: a small % will always game it — fine, it only hurts the cheater; the honest majority is unharmed. Do NOT add invasive verification to chase them.
```

### 19 — Fitness sync prompt  (file: `14-fitness-sync-prompt.html` · spec §17)  [Phase 2]
```
Build the Fitness sync prompt (Phase 2 — only after the core loop works). Read design-mocks/14-fitness-sync-prompt.html and PHILOI_UI_SPEC.md §17. Translate inline CSS to React Native — reference only. Use tokens. Notes: a bottom sheet that appears ONLY when a fitness challenge/goal uses a device metric (steps/distance/workouts) — offering the sources that can actually measure THAT metric (steps → Apple Health / Health Connect / Strava / Garmin; workout-minutes·strain·sleep → + Whoop, which has NO step count), plus an always-present "I'll log it manually" fallback and a privacy line. Sequence the actual integrations HealthKit + Health Connect first, then Strava, then Whoop, then Garmin. Run it and stop for comparison.

ALSO ADD a persistent, DISCOVERABLE entry — the contextual sheet is not enough (you can't find it unless you happen to create a device-metric challenge). Add **Settings → "Connected apps"** (per §19) listing Apple Health / Health Connect / Strava / Whoop / Garmin, each with a Connect / Connected state, so a user can connect sources any time. This is the home for the current "we're still building this" placeholder until 19a–19e land.
```

### 19a — Apple HealthKit integration  (spec §17 · iOS)  [Phase 2 · no partner approval, entitlements only]
```
Wire Apple HealthKit as a fitness source for device-verified challenge metrics. Read PHILOI_UI_SPEC.md §17 and Step 18 (device metrics carry the big rewards; minimal scopes; manual fallback ALWAYS available — never gate participation).

SETUP: HealthKit needs a custom dev build (NOT Expo Go). Add the Expo config plugin (react-native-health / expo community HealthKit plugin), the `com.apple.developer.healthkit` entitlement, and Info.plist `NSHealthShareUsageDescription` copy ("Philoi reads only the activity your challenge needs — e.g. steps — to verify it automatically. Your health data stays on your device."). READ-ONLY — request NO write scopes.

SCOPES (minimal, per-challenge): request only what the active challenge needs — StepCount, DistanceWalkingRunning, ActiveEnergyBurned, Workouts. Do not request everything up front; request the metric when the user connects for a challenge that uses it.

DATA FLOW: on connect, tally the challenge metric locally (e.g. steps between challenge start/end) and push ONLY the challenge-relevant number to the leaderboard/campfire ("8,200 / 10,000 steps") — never a health export. Keep raw data on-device. Optional: HealthKit background delivery to keep an active challenge's total fresh.

STATE: reflect Connected/Disconnected in Settings → Connected apps. On iOS make Apple Health the platform-aware default (§17). Build behind the fitness feature flag. Run on a device build and stop for review.
```

### 19b — Google Health Connect integration  (spec §17 · Android)  [Phase 2 · no partner approval]
```
Wire Google Health Connect as the Android fitness source. Read PHILOI_UI_SPEC.md §17 and Step 18. Same rules as 19a: read-only, minimal scopes, manual fallback always available, only the challenge-relevant number leaves the device.

SETUP: use react-native-health-connect in a custom dev build. Health Connect is native on Android 14+; on older versions it's the installable APK — detect availability and, if absent, fall back to manual entry (don't hard-crash). Declare the health permissions in the manifest AND provide the required privacy-policy rationale screen (Health Connect rejects apps without a stated data-use rationale).

SCOPES (minimal, per-challenge): Steps, Distance, ActiveCaloriesBurned, ExerciseSession — request the specific one the challenge needs, read permission only.

DATA FLOW: tally the metric over the challenge window; publish only the challenge number. Raw stays on-device. STATE in Settings → Connected apps; Health Connect is the Android platform-aware default (§17). Behind the fitness flag. Run on an Android device build and stop for review.
```

### 19c — Strava integration  (spec §17 · cross-platform)  [Phase 2 · OAuth + Strava review gate — do AFTER 19a/19b]
```
Wire Strava for runs + rides (cross-platform). Read PHILOI_UI_SPEC.md §17 and Step 18. Strava is later than HealthKit/Health Connect because it needs OAuth + Strava's app-review gate.

OAUTH (secret stays server-side — NEVER ship the client secret in the app): authorization-code flow via expo-auth-session / expo-web-browser to Strava's authorize endpoint with the redirect URI; exchange the code for tokens in a Supabase Edge Function (or backend) that holds the client secret; store + refresh tokens server-side. Request the minimal scope `activity:read` only.

API TERMS (hard constraints): a member may only ever see their OWN Strava-derived numbers — Strava's terms forbid displaying other users' data, so no cross-user Strava leaderboards from raw Strava data (map it into Philoi's own metric total instead). Respect rate limits. Review gate: the app starts limited (1 athlete), self-upgrade to 10, formal review beyond — so keep Strava behind the flag and test with the dev athlete first.

DATA FLOW: pull the athlete's activities in the challenge window (distance/time for run/ride challenges), reduce to the challenge-relevant number, publish that only. Optional: a Strava webhook subscription to ingest new activities without polling. STATE in Settings → Connected apps (offered on both iOS + Android). Behind the fitness flag. Build, and stop for review before requesting Strava's rate-limit upgrade.
```

### 19d — Whoop integration  (spec §17 · cross-platform)  [Phase 2 · OAuth + production review — do AFTER Strava]
> ⏸️ **PENDING / BLOCKED (as of 2026-07-29):** the Whoop developer dashboard (developer.whoop.com) requires signing in with a **WHOOP account**, and Noah doesn't own a Whoop. Blocked on getting a friend's WHOOP credentials (or having them create the app / team and share the Client ID + Secret). Do not start 19d until unblocked — Strava (19c) proceeds independently.
```
Wire Whoop for strain / workouts / sleep / recovery. Read PHILOI_UI_SPEC.md §17 and Step 18. Same rules: read-only, minimal scopes, manual fallback always available, only the challenge-relevant number leaves the device, own-data only.

METRIC FIT (important): Whoop has NO step count — it measures strain, heart rate, workouts, sleep, recovery. So offer Whoop for WORKOUT-MINUTES / STRAIN / SLEEP challenges, NOT step races. Don't show Whoop as an option on a steps challenge (§17 metric-fit rule).

OAUTH (secret stays server-side): register the app in the Whoop developer dashboard for client ID/secret + redirect URI. Authorization-code flow via expo-auth-session / expo-web-browser; exchange + refresh tokens in a Supabase Edge Function (backend holds the secret). Request minimal scopes only — e.g. read:workout, read:sleep, read:cycles (strain), read:profile — pick the one the challenge needs. Whoop requires app review for production beyond dev; test with the dev account first.

DATA FLOW: pull the relevant Whoop records in the challenge window (workout minutes / strain score / sleep hours), reduce to the challenge number, publish that only; raw stays off the campfire. STATE in Settings → Connected apps (iOS + Android). Behind the fitness flag. Build and stop for review.
```

### 19e — Garmin integration  (spec §17 · cross-platform)  [Phase 2 · PARTNER APPROVAL required — do LAST, heaviest gate]
```
Wire Garmin for steps / distance / activities. Read PHILOI_UI_SPEC.md §17 and Step 18. Same rules: read-only, minimal scopes, manual fallback always available, only the challenge-relevant number leaves the device, own-data only.

GATE FIRST (do this before any code): Garmin needs Garmin developer-program PARTNER APPROVAL — a B2B application to the Garmin Health / Activity API + review, not just entitlements. Apply and get approved before building; without it there's no API access. Flag this to Noah as the long-lead item.

INTEGRATION: Garmin uses OAuth for user linkage and PUSH/WEBHOOK delivery — Garmin pushes activity/wellness data to YOUR backend endpoint (a Supabase Edge Function / webhook receiver) rather than you polling. Stand up the webhook receiver, verify Garmin's signatures, store the user linkage + tokens server-side (secret never on the client). Request minimal data types — steps, distance, activities — only.

DATA FLOW: on Garmin's push, tally the challenge metric over the challenge window server-side, then expose ONLY the challenge-relevant number to the leaderboard/campfire; never a full export. Own-data only. STATE in Settings → Connected apps (iOS + Android). Behind the fitness flag. Build against the approved dev credentials and stop for review.
```

### 20 — Gym tracker (lean V1)  (files: `23-gym-routine-picker.html`, `24-gym-session-logger.html` · spec §23)  [big feature — its own pass · obeys Step 18]
```
Build the lean gym tracker. Read design-mocks/23-gym-routine-picker.html, design-mocks/24-gym-session-logger.html, and PHILOI_UI_SPEC.md §23. Translate inline CSS + animations to React Native + Reanimated — reference only, use tokens.

SCOPE (locked): lean in-session workout log. NO per-set video in V1 (deferred to phase 2 — §23 has the video tiers/cost/architecture for later). One optional session clip via the existing lock-in photo path is fine.

FLOW:
- Picking the GYM goal in the lock-in goal picker (§12) reveals "Today's routine" (mock 23): saved routines from memory + "Freestyle", picking one preloads its lifts. Plus a one-tap ENERGY state — Light / Same / Dialed.
- The gym running session (mock 24) is a live WORKOUT LOG instead of a bare timer: exercise cards → set rows (weight × reps), add-set, and per exercise a ⋯ menu with REPLACE exercise (swap if a machine's taken) / reorder / remove. Timer shrinks to a header pill; body-doubles collapse to a strip. AUTO-PR: on saving a set, flag a PR if it beats the stored best for that lift (personal_records). The energy chip shows in the header.
- On Finish, the workout summary (exercises, top sets, PRs) becomes part of the lock-in data on the done screen (§13) → keep PRIVATE or POST to the campfire; the posted chat card shows lifts + PRs.
- Routines build from memory: any logged workout can be saved as a routine. Add lightweight routine management (create/edit/save).

ENERGY STATE — two rules (§23): (1) GENTLE — Light/Same/Dialed applies only a small ~±5% nudge to SUGGESTED target numbers, never a hard override; every set stays editable. (2) HONEST BRAG — the chat "…was feeling dialed today" line / elevated-numbers flex surfaces ONLY when the user actually hit the higher numbers, not just for the mood they picked.

DATA (Code): `exercises` library, `workouts` (→ lock_in), `workout_sets` (weight/reps/is_pr), `routines`, `personal_records`. Keep the tracker deliberately lean — the moat is the social/accountability layer, not out-featuring Hevy/Strong. Build, run, stop for comparison.
```

### 20b — Per-set video clips  (spec §23 phase-2 video block)  [Phase 2 — AFTER gym V1 + retention · ships in a BUILD, not OTA]
```
Add per-set workout video clips to the gym tracker. Read PHILOI_UI_SPEC.md §23 (the phase-2 video block: tiers, cost, architecture, AND the per-set capture mechanic + data model). This is a phase-2 add-on to Step 20 — do NOT build it into gym V1.

CORE UX RULE — never auto-film every set (kills flow, burns quota). A clip is OPT-IN per set: each set row in workout-set-logger.tsx gets a small camera affordance that films THAT set. Two triggers: (1) manual tap; (2) auto-prompt "Film this PR?" when a saved set beats the stored best (personal_records). One clip per set, always skippable. Hard-cap record length to the tier (10s free / 15–20s paid).

PIPELINE (reuse the §23 architecture — R2, on-device compress, signed URLs, campfire-scoped):
1. Record — expo-camera video mode, capped to tier length.
2. Compress ON-DEVICE — react-native-compressor to the tier target (720p/1080p) before upload (keeps transcode ~$0, uploads survive gym cellular).
3. Poster frame ON-DEVICE — expo-video-thumbnails at record time (no server thumbnailing).
4. Upload — get a SIGNED UPLOAD URL from a Supabase Edge Function, PUT the compressed clip + thumbnail DIRECTLY to Cloudflare R2 (never through the app server). Client secret / R2 keys stay server-side.
5. Playback — expo-video with a SIGNED, EXPIRING GET URL from an Edge Function; poster thumbnail while loading.

DATA: extend `workout_sets` with nullable `video_key`, `thumb_key`, `duration_s`, `resolution`, `uploaded_at`. Postgres holds references only; bytes live in R2. Add a `video_clips` count check per user/month.

QUOTA: before capture, check the user's monthly clip count vs tier (FREE 10 · 720p/30fps/10s · PAID UNLIMITED · 1080p/60fps/15–20s). Paid is effectively uncapped — only a soft fair-use guard against automated abuse, NOT a cost gate. Show the "N left this month" counter ONLY to free users; paid has no countdown. 1080p is the CEILING — no 4K (see §23 reasoning).

SURFACES: clip shows on the done-screen recap, PR history, and the posted campfire chat card (PR clip = the flex, form clip = feedback). Tap-to-play. Scope clips to campfires/friends ONLY — never a public feed (avoids UGC-video moderation cost).

PRIVACY/SECURITY: server-side-at-rest encryption (R2 SSE) + signed expiring URLs + campfire/friend access control (NOT E2E). Rolling ~90-day retention TTL.

NATIVE: react-native-compressor, expo-video, expo-video-thumbnails are native modules → this needs a new build (not OTA). Build behind a feature flag, run, stop for review.
```

### 21 — Monetization: Free · Ignite · Blaze  (ref: MONETIZATION.md · REWARD_ECONOMY.md · spec §4, §19, §23, §24)  [later — after retention is proven · obeys Step 18]

**Do this FIRST (spec before code):** extract MONETIZATION.md's "Reward economy" section into a dedicated **`REWARD_ECONOMY.md`** and a new **spec §24 (Inventory)**. That spec is the single source of truth for: the Inventory data model, the reward-scaling engine (significance → rarity), and the grant tables (challenge-win / end-of-season). Build 21a–21e against it. Keep MONETIZATION.md as the *why*, REWARD_ECONOMY.md as the *how*.

```
Build the Philoi Fire monetization layer. Read MONETIZATION.md, REWARD_ECONOMY.md, and PHILOI_UI_SPEC.md §4 (flame skins), §19 (settings), §23 (video tiers), §24 (Inventory).

THE ONE RULE (non-negotiable): never sell anything that fakes effort — no buying XP, rank, streaks, PRs, or leaderboard position. Everything paid is COSMETIC or CONVENIENCE. Core lock-ins, campfires, joining, chat stay free. Do NOT gate the flame meter or its rewards.

TIER: one "Philoi Fire" subscription (student-friendly ~$3–5/mo). Always brand it fully "Philoi Fire" (never bare "Fire"; keep lowercase "your fire" for the solo campfire).

COSMETICS: flame skins (recolor the living flame — HARD constraint from §4: skin changes the color ramp ONLY, never the size/intensity/animation that signals activity; implement as a swappable palette token under the same state logic); profile banners; avatar frames + rank-hex glow; campfire skins (owner); alt app icons; premium share-card templates; a subtle persistent ember-glow on subscribers' flames (must not read as the "roaring" activity state).

BADGES — HARD LINE: earned badges (streaks/PRs/challenges) stay FREE and are the real status; paid badges are clearly cosmetic/"supporter" flair + custom titles, NEVER styled to look earned.

CONVENIENCE: more saved routines / more campfires / bigger caps; deeper history + analytics; the 1080p·60fps video tier (§23); streak insurance (give a little free too, don't paywall the streak).

PAYWALL UX (Nitro-inspired, MONETIZATION.md): branded hero, tier card(s) with per-month price + perk rows + CTA, a "Pick your plan" comparison table, and a swipeable "Favorite Fire perks" carousel. Energetic on-brand copy ("Get Fire", "light it up").

EMBERS (phase it): the soft currency earned by locking in (and the flame-meter reward, §13). Paid users get a monthly stipend; free users grind toward cosmetics. A cosmetics shop spends embers. Also ship a one-time "Founding member" badge ("Prometheus' Disciple") for early supporters. Wire Settings entries per §19. Build behind a feature flag; ship after retention is proven.

REWARD ECONOMY (REWARD_ECONOMY.md / §24) — the bridge from the effort economy to the shop. All of this is COSMETIC/CURRENCY only (Rule stands) and rides on the Step 18 verified-effort floors — a grant can only fire off already-counted, verified progress; never off self-reported or farmed junk.

21a — INVENTORY (verifiable, server-authoritative). A tables-backed inventory owned by the server (client only reads it): `embers` balance; `owned_badges` (each row carries `source: 'earned'|'paid'`, a `provenance` string like "Won from vs Aidan · S2", and `earned_at`); `loot_boxes` (rarity + unopened count + how obtained); `cosmetics` (flame skins / banners / frames / hex glow, with equipped flag). Build the Inventory SCREEN: ember balance up top, then Badges (earned vs paid clearly separated, provenance shown on tap — earned badges can NEVER be bought), unopened Boxes (tap to open → reveal animation), Cosmetics (equip/unequip). Earned-vs-bought must be visually unambiguous.

21b — REWARD-SCALING ENGINE. One server function `grantReward(context)` that maps an achievement to a payout by significance = difficulty × competition-scope × duration × placement. Output = { embers, box rarity | none, badge | none }. Rarity ladder = Kindling → Ignition → Furnace → Vessel of Hestia → Hephaestus' Chest → Prometheus' Vault. This is the ONE place rewards are computed; challenge-end and season-end both call it. Effort-verify inputs before granting (Step 18).

21c — CHALLENGE-WIN GRANTS (call grantReward at challenge close; ref PUNCHLIST §5, mocks 36/37).
  • Friend H2H: scale by goal difficulty × duration. Casual 24h win → small embers. A ridiculous long goal (e.g. most lock-in time all semester) → EPIC/LEGENDARY box (Vessel of Hestia / Hephaestus' Chest) + an exclusive earned badge + embers. Redemption rematch win → small box on top.
  • Campfire (group): scale by placement PERCENTILE × campfire size × goal difficulty. Everyone who finishes → completion embers. Then best tier: top 50% → embers + common/uncommon box; TOP 10% in a large campfire → RARE/EPIC box (Furnace / Hestia); top 3 big fire → epic/legendary + badge. Reuse the exact percentile guard from Step 18 (absolute-rank caps only when more selective than the 10% line).

21d — END-OF-SEASON REWARDS (call grantReward at season close, per leaderboard scope: campfire / uni / vs-unis). Same percentile ladder applied to reward RARITY: participated → season completion badge + embers; top 10% (uni) → Epic box + a dated seasonal badge; top 10 → Legendary box + rarer seasonal badge; UNI #1 → Mythic box (Prometheus' Vault) + the apex seasonal badge + big embers (this is ON TOP of the 3× season-XP multiplier from PUNCHLIST §5 — the XP multiplier lives in the effort economy, the box/badge in the reward economy). Seasonal badges are dated and kept forever across resets. One season clock shared with the Forge Pass reset.

21e — BALANCE GUARDRAILS (protect the paid economy). Earned rewards skew to PRESTIGE (exclusive earned badges, un-buyable) + modest embers/boxes — NOT floods of embers, which would undercut paid packs. Biggest earned payouts (mythic box for uni #1) are rare by nature (one per season) so they don't flood. Keep grant amounts tunable via server config (no client-side reward math) so the economy can be balanced post-launch without a release.
```

---

**Reminder:** verify each screen against its mock before moving on, and keep the shared theme tokens the single source of color/type so nothing drifts.
