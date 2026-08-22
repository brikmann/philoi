# Notifications spec — full event catalog

Every event worth a nudge, across the app. **Channels:** `push` (OS notification), `bell` (in-app header activity
list), `badge` (count on a tab/bell). Visual template = **mock 106** (push cards, bell + badge). Challenge events are
detailed in `CHALLENGE_REDESIGN_SPEC.md §D`; this is the superset.

## Global rules
- **OS permission gate** + **per-category toggles** in Settings → Notifications (categories below).
- **Every push deep-links** to the right screen; **every event also lands in the in-app bell** activity feed.
- **Rate-limit + batch** — never fire 8 "friend ranked up" pushes; batch social ("3 friends ranked up today").
- **Quiet hours** — no push during the user's local night (except things they explicitly time, e.g. a streak reminder).
- **Default ON** for high-value (friend request, challenged, won, streak-at-risk); **OFF / bell-only** for low-value
  (friend locked in, rank drop, chat) so we don't train people to mute us.

## Categories (Settings toggles)
Friends & social · Challenges · Campfires · Streak & reminders · Season & rank.

---

## Friends & social
| Event | Channel | Copy (example) | Tap → | Default |
|---|---|---|---|---|
| Friend request received | push · bell · badge | "👋 {name} added you on Philoi." | accept sheet | on |
| Friend request accepted | push · bell | "{name} accepted your request." | their profile | on |
| Friend ranked up | bell (push batched) | "🎉 {name} hit {rank}." | their profile | on |
| Friend passed you on a board | push | "😤 {name} passed you on {board}." | leaderboard | on |
| Friend joined from your invite | push · bell | "{name} joined Philoi — say hi." | their profile | on |
| Friend cheered your milestone | push · bell | "🎉 {name} cheered your milestone." | your milestone / journal | on |
| Someone cheered you in a challenge | push · bell | "🔥 {name} cheered you on{: note}" | the challenge / watch | on |
| Friend posted a milestone | bell (push opt.) | "{name} hit a milestone: {headline}." | their milestone | on |
| Friend just locked in (close friends) | bell only | "{name} just locked in." | their profile | **off** (spammy) |

## Challenges  *(full table in `CHALLENGE_REDESIGN_SPEC.md §D`)*
Challenged · invite accepted · passed/lost lead · ending-soon · won/lost · daily-goal-at-risk. Won/lost → **reward
arc (mock 47)**. Default on (except goal-at-risk = user-tunable).

## Campfires
| Event | Channel | Copy | Tap → | Default |
|---|---|---|---|---|
| Someone joined your campfire | bell · badge | "{name} joined {campfire}." | campfire | on |
| Join request (private — you're owner/admin) | push · bell · badge | "{name} wants to join {campfire}." | join requests | on |
| Campfire challenge started | push · bell | "🔥 {campfire} started a challenge — jump in." | campfire challenge | on |
| Campfire going cold | push (rate-limited) | "{campfire} is going cold — nobody's locked in today." | campfire | on |
| You were added to a campfire | push · bell | "You were added to {campfire}." | campfire | on |
| Campfire challenge settled | push · bell | placement result | **reward arc (mock 47)** | on |
| New campfire message | bell (push opt.) | "{name}: {msg}" | campfire chat | **off** by default |

## Streak & reminders
| Event | Channel | Copy | Tap → | Default |
|---|---|---|---|---|
| Streak at risk (evening, not done) | push | "🔥 Your {N}-day streak ends at midnight — lock in." | lock-in | on |
| Daily-fire reminder (user-set time) | push | "You haven't fed the fire today, {name}." | home | on |
| Streak milestone hit | push · bell | "🔥 {N}-day streak! +{reward}." | **goal/streak reward (mock 103)** | on |

## Season & rank
| Event | Channel | Copy | Tap → | Default |
|---|---|---|---|---|
| Season ending soon | push | "Season 1 ends in {N} days — climb while you can." | leaderboard | on |
| Season settled / your placement | push · bell | "You finished {placement} — collect your rewards." | **season card / reward arc** | on |
| You ranked up | in-app celebration (push if backgrounded) | "You reached {rank}." | rank-up screen | on |
| You dropped a division | bell | "You slipped to {rank}." | leaderboard | **off** (don't demoralize) |
| Reward ready to collect | push · bell · badge | "🎁 You have a box to open." | inventory | on |

---

## Leading art — pull the image that matches the event
Every notification (in-app feed row AND rich push) leads with the image of its **subject**, not the generic flame:
| Event group | Leading art | Shape |
|---|---|---|
| Rank up | the **tier icon** (e.g. Silver I hexagon in its `RANK_TIER_METAL` colour) — "You ranked up to Silver I" | hexagon |
| Friend request / accepted / ranked up / passed you / joined | the **friend's profile pic** | circle |
| Campfire joined / challenge started / going cold / added / message | the **campfire's icon / banner** | rounded square |
| Duel challenge (challenged / accepted / passed / ending) | the **opponent's avatar** | circle |
| Challenge / campfire challenge **won-lost** | the **reward art** (box / ember, rarity-coloured) or opponent avatar | square / circle |
| Streak at risk / milestone | the **flame** (heat state) with the streak count | flame |
| Season ending / settled | the **season badge / placement art** | hexagon / square |
| Reward ready to collect | the **box art** (rarity-coloured) | rounded square |

Fallback → the philoi flame when no subject image exists.

## Rich notifications
- **Push:** use image attachments so the avatar / tier / campfire / box shows in the notification — iOS
  `UNNotificationAttachment` (needs a Notification Service Extension) · Android `BigPictureStyle` / large-icon. The
  push payload must carry an `image` URL.
- **In-app bell feed:** each row leads with the same image, masked to the right shape (circle = avatars, hexagon =
  ranks, rounded-square = campfire/box, flame = streak).
- Resolve the asset from the subject: profile pic, `RANK_TIER_METAL` hexagon, campfire icon, catalog box art.

## Impl notes
- **One `notifications` event pipeline** — server emits an event `{type, actor, target, payload, image, imageShape}`;
  a fan-out (image resolved from the subject) decides
  channels by the user's category toggles + defaults + quiet hours + rate-limits, writes the in-app feed row, and
  (if push-eligible) sends via Expo push.
- **Deep links**: each `type` maps to a route (accept sheet, watch, reward arc, campfire, leaderboard, inventory…).
- **Settings location:** the notification settings menu lives **inside the global Settings page, under a
  "Notifications" row** — NOT as a settings screen hanging off the notifications/activity tab. The Activity
  (in-app feed) screen is just the feed; it must not host the category toggles or a settings gear of its own.
  (At most a small "Notification settings" link that deep-links into Settings → Notifications.) It exposes the
  5 category toggles + daily-reminder + quiet hours + lock-screen previews; OFF categories still populate the
  in-app bell (just no push).
- **Read-state:** viewing a notification in-app **marks it read** and **clears the bell badge / activity unread
  count**. Unread persists until seen.
- **Push fires independently of in-app view:** on the event, send the Expo push immediately (subject to master
  switch + category toggle + quiet hours) AND write the feed row. Do NOT gate/suppress the push on whether the
  user has opened the in-app feed. (Requires a registered Expo push token per device + FCM configured for
  Android.)
- Reuse **mock 106**'s push-card + bell + badge visuals for all of the above.
