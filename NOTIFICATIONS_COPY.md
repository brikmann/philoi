# Philoi Notification Copy — every scenario (approved)

Noah's approved title + body per notification. `{var}` = filled at send time. A couple of rows also call for a **quick action** (a Cheer button on the push). Hand to an agent to update the `notify_push` copy + wire the new events/actions.

> Voice: second-person, fire/streak motif, competitive edge; reminders/losses stay warm. Bodies with `·`/`-` append conditionally.

---

## Streak & reminders
| Scenario | Title | Body | Action |
|---|---|---|---|
| Daily fire reminder | `Got time tonight?` | `You haven't locked in today. Got a few minutes to feed the fire?` | |
| Streak at risk | `Streak at risk` | `Your {N}-day streak breaks at midnight — lock in 🔥` | |
| Still locked in? | `Still locked in?` | `Your session's been going a while — tap to keep it going.` | |

## Session
| Scenario | Title | Body | Action |
|---|---|---|---|
| Session complete | `Nice one.` | `{minutes} min {label} - +{xp} XP - {toNext} XP to {nextRank} - {N} day streak. Nice work.` | |

*`{label}` = "in the gym" / "studying" / "on a run" / "reading" / "on applications" / "locked in". The XP / streak parts append only when they apply.*

## Friends & social
| Scenario | Title | Body | Action |
|---|---|---|---|
| Friend checked in | `{name} just locked in on {label}` | `{goal detail / goal label}` | **Cheer** button |
| Friend hit their challenge | `{name} just hit their {type} challenge` | `Send a cheer?` | **Cheer** button |
| Friend nudge to lock in | `{friend} wants you to lock in` | `Join them?` | |
| Friend request | `New friend request` | `{name} wants you to add them as a friend on Philoi` | |
| Friend accepted | `{name} added` | `{name} added you back. Let's see who locks in more.` | |
| Friend ranked up | `{name} ranked up to {rank}` | `You gonna let that slide?` | |
| Friend passed you | `{name} passed you and is {xp} ahead` | `Take it back ⚔️` | |

## Challenges
| Scenario | Title | Body | Action |
|---|---|---|---|
| Invited to a campfire challenge | `{campfire} invited you to a challenge` | `{challenge} is waiting on your answer` | |
| Change request | `Change request on {challenge}` | `{name} wants to change the terms — tap to review` | |
| Challenge forfeited | `Duel challenge forfeited` | `{name} bowed out — no rewards for either side` | |
| Challenge won | `GG. You beat {loser} in {challenge}` | `Claim {rewards} for a hard battle.` | |
| Challenge lost | *(keep warm — draft)* `So close` | `{winner} edged it this time. Run it back? ⚔️` | |
| Challenge ending soon | *(draft)* `Challenge ending soon ⏳` | `{challenge} closes in {time} — lock in before the clock hits zero.` | |

## Campfires
| Scenario | Title | Body | Action |
|---|---|---|---|
| You're in | `You're in {campfire}.` | `Say hi to someone.` | |
| Promoted to admin | `You're promoted to {role} in {campfire}` | `You can now manage it.` | |
| Join request (to owner) | `{name} wants to join your campfire` | `Tap to approve or decline.` | |
| Campfire going cold | *(draft)* `{campfire} is going cold` | `Nobody's locked in lately — light it back up. 🔥` | |
| Campfire challenge settled | `Campfire challenge settled` | `You placed {place} of {field} — tap to see your reward.` | |
| Ping (silent nudge) | `{sender} nudged you` | `{sender message, if any}` | |
| @mention (you) | `{sender} mentioned you` | *(message preview, ≤140)* | |
| @all mention | `{sender} mentioned everyone` | *(message preview)* | |

## Season & rank
| Scenario | Title | Body | Action |
|---|---|---|---|
| Ranked up | `You ranked up to {rank label}!` | `Claim your rewards and let everyone know about it.` | |
| Reached the apex | *(rank-up title)* | `You reached Primordial. The king himself bows toward your greatness.` | |
| Relic earned | `Relic earned` | `{relic name}` | |
| Season finish / placement | `Season {id} - {band} finish` | `That's {x%}! Good work.` — **if bottom 50%:** `You're in the bottom 50%. Nice effort.` | |
| Rank dropped | *(draft)* `You slipped to {rank}` | `You dropped a division — lock in to climb back. 🔥` | |
| Season ending soon | *(draft)* `Season ends soon ⏳` | `{days} left in Season {id} — lock in your placement before it closes.` | |
| Reward ready | *(draft)* `Reward ready 🎁` | `You've got a reward waiting — tap to claim it.` | |

---

### Handoff
*"Update the notify_push copy in the Supabase migrations to match NOTIFICATIONS_COPY.md — one additive migration redefining the affected notify functions/triggers; keep `{var}` interpolations and category/gating intact. Wire the events that aren't emitting a push yet (friend request/accepted/ranked-up/passed-you, campfire cold, rank dropped, season ending, reward ready) into their triggers. Add a **Cheer quick-action** to the 'friend checked in' and 'friend hit their challenge' pushes (a notification action button that sends a cheer). Season-finish body branches on placement (top vs bottom 50%)."* Rows marked *(draft)* are Claude's proposals Noah hasn't finalized.
