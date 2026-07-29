# Philoi — design mocks (pixel-exact reference)

These are the **approved screen designs** as standalone HTML. Open any file in a browser to see the exact colors, sizes, layout, and animations. **Build each screen to match its mock** — the `PHILOI_UI_SPEC.md` section gives the rules and rationale; the mock gives the exact pixels.

> Built in a preview sandbox. A few `var(--…)` tokens are host chrome (the outer backing card + caption line) and can be ignored — **every app value (hex colors, px sizes, `@keyframes`) is inline** in each file's `<style>`. The phone frame + its contents are the design.

| # | File | Spec § | Screen |
|---|------|--------|--------|
| 01 | `01-splash.html` | 20 | Splash / sign-in (logo, Greek etymology, Continue with Google) |
| 02 | `02-campfire-home-swipe.html` | 5 | Home — 2 pages only: Your fire (lock in) ↔ the valley (discover) |
| 03 | `03-campfire-lockin-screen.html` | 6 | A campfire: roaring flame, feed photos, campfire level |
| 04 | `04-campfire-field.html` | 10 | The valley — spaced-out fires, filters, tap → preview (members/level/photos), join states, enter code |
| 05 | `05-rankup-legend.html` | 11 | Rank-up forge — Diamond I → Infernal (final) |
| 06 | `06-campfire-interior-chat.html` | 12 | Campfire interior — merged chat + lock-in events + composer |
| 07 | `07-lockin-goal-picker.html` | 12 | Lock-in goal picker sheet |
| 08 | `08-solo-campfire.html` | 12 | Solo campfire — Lock in CTA + journal + pager |
| 09 | `09-running-session.html` | 13 | Running lock-in session (goal-as-fuel, timer, body-doubles) |
| 10 | `10-create-campfire-class.html` | 14 | Create a campfire (with class designation) |
| 11 | `11-leaderboard.html` | 15 | Leaderboard — campfires / uni / vs-unis · XP / streaks |
| 12 | `12-challenges-tab.html` | 16 | Challenges tab (invite, H2H race, group) |
| 13 | `13-start-challenge.html` | 16 | Start a challenge (campfire-first, type-adaptive) |
| 14 | `14-fitness-sync-prompt.html` | 17 | Fitness sync prompt (Apple Health / Health Connect / Strava) |
| 15 | `15-profile.html` | 18 | Profile — rank, stats, goals, lock-in photo grid |
| 16 | `16-settings.html` | 19 | Settings |
| 17 | `17-onboarding.html` | 21 | Onboarding — username, searchable university picker, consent (no goals) |
| 18 | `18-lockin-done.html` | 13 | Lock-in "done" — session recap (duration, XP, streak, photos) → post to campfire |
| 19 | `19-campfire-options.html` | 12 | Campfire options — branded bottom action sheet (edit / invite / mute / report / leave / delete) |
| 20 | `20-invite-campfire.html` | 12 | Invite to a campfire — high-contrast code + copy + share link |
| 21 | `21-friend-ping.html` | 16 | Friend ping — person-first: nudge to lock in / challenge H2H (sword) / challenge group (users) |
| 22 | `22-join-requests.html` | 14 | Join requests (owner) — approve/deny for gated campfires, with context + Approve all |
| 23 | `23-gym-routine-picker.html` | 23 | Gym toggled in goal picker → "Today's routine" (saved routines from memory / Freestyle) |
| 24 | `24-gym-session-logger.html` | 23 | Gym running session — live workout log (sets/reps, auto-PR), timer + body-doubles |
| 25 | `25-home-active-session.html` | 5 | Home with live session mini-map — persistent top-center bar (activity + timer) while locked in |
| 26 | `26-flame-meter.html` | 5 | Daily flame meter — XP-goal bar below the Lock-in hero; ⅓ embers → ⅔ particles → full ignites |
| 27 | `27-flame-meter-complete.html` | 13 | Meter-complete done screen — dual XP (+lock-in, +fire bonus), embers fly to a top-right balance, Share |
| 28 | `28-story-share-ios.html` | 13 | Story share card (iOS) — pre-composed "on fire" image handed to the iOS share sheet |
| 29 | `29-story-share-android.html` | 13 | Story share card (Android) — same image in the Android (Material) share sheet |
| 30 | `30-fire-rank-layouts.html` | 5 | A/B: fire + rank bars horizontal (stacked, matched) vs vertical (fire left / rank right) |
| 31 | `31-rankup-tier-flash.html` | 11 | Tier-crossing flash effects — Silver sweep / Gold sparkle / Diamond prism / Infernal on fire + rotating headline (+ division-bump toggle) |
| 32 | `32-rankup-full-sequence.html` | 11 | Full rank-up flow — forge (rise from campfire, 05) → flare → splash with tier flash + Share (31) |
| 33 | `33-tab-bar-icons.html` | 4b | Bottom tab bar — line icons (flame/trophy/target/user), active coral; + line-flame vs brand-flame for Campfires |
| 34 | `34-friend-requests.html` | 16 | Friend requests — accept/decline incoming, sent/pending (a friend = mutual add, NOT a campfire member) |
| 35 | `35-add-friend.html` | 16 | Add a friend — search @username, Add → Requested / Accept / Friends states, suggested from campfires |
| 36 | `36-challenge-hero.html` | 16 | Challenges hero — flaming-arrow target, "Start a challenge" + friend/campfire pills, challenge log (W/L colored) |
| 37 | `37-active-challenge-marker.html` | 16 | Active-challenge marker — live chip on your fire, in campfires (Watch), and on friend rows |

Interactive files (02, 04, 05, 09, 11, 13, 17) have working animations / tap behavior — click the pills, fires, replay buttons, and the university search.
