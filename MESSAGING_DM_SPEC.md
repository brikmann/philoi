# Direct Messages (1:1) — Scoping
_Talk to a friend directly, outside campfires and challenges. Mock 151._

## Why
Campfires cover group chat and challenges cover competition, but there's **no way to just message one friend**. Add lightweight 1:1 DMs.

## Entry points
- **Friend profile** (`src/app/friend-profile.tsx`): a primary **Message** button in the action row, alongside **Challenge** and **Ping** (the existing `friend-ping-sheet`).
- **Friends list**: a **💬 message** button on each friend row (row still opens the profile; the bubble opens the thread directly).
- Opening either lands on the 1:1 thread (`/dm/[friendId]`).

## Ping vs Message (mock 152)
Two distinct actions on a friend:
- **Ping** = a **one-tap accountability nudge**. No thread. It has **four types**, each with a default line you can **override with your own words**:
  - **Invite** — "Lock in with me"
  - **Nudge** — "Get back to it"
  - **Praise** — "Proud of you"
  - **Location** — "Where you at?"
  Tap a type to send its default, or type a custom message *under that type* (so a custom ping still carries a type). Fires as "Noah pinged you: <message>"; a ping-back is one tap. Store `type` + `body` on the ping.
- **Message** = a **real conversation** (the DM thread below).
- **Icons (custom vectors, not emoji):** Message = a chat bubble with three dots (`#msgIcon`); Ping = concentric radiating rings / a pulse (`#pingIcon`) — reads as a broadcast nudge. Both defined in the mock defs; port to a shared icon set.
- Ping reuses/replaces the existing `friend-ping-sheet`. Notification type `friend_pinged`, category `friends_social`, sender avatar as art.

## The thread
- Standard 1:1 chat: message bubbles, online/last-active in the header, text input.
- **`+` composer menu (mocks 152/153)** — each option opens the right place with the friend already in context:
  - **Photo** → the device **gallery/photo picker** (+ camera). Send selected image(s).
  - **Share a lock-in / clip** → your **recent lock-ins / set-videos / share cards** list (with a `‹ Maya · Share a lock-in` breadcrumb); tap one to attach it to the DM.
  - **Challenge** → the **challenge create menu with the friend pre-filled as opponent** (locked "from this chat"). **This is the only place Cindy appears in the DM flow** — an "or describe it to Cindy" hand-off to scope a custom duel.
  - **Lock-in invite** → your **campfires** list to invite them into one, plus a **"Just us — lock in now"** 1:1 option. **Rank-gate aware:** campfires can be rank-gated. **"[Rank]+" means that tier's base division (III) and up** — so Gold+ = Gold III or higher, Titan+ = Titan III or higher. Compare on the ordinal rank index (Bronze III … Gold … Diamond … **Hero** … **Titan** … Primordial), where a higher tier always outranks a lower one regardless of division (Hero II > Diamond I). The invite flags **"clears it ✓"** when the friend's rank index ≥ the gate, and **locks the Invite with the reason** ("Titan+ · she's Hero II — not yet") when it's below. Also marks campfires they're already in.
  - **Cheer** → a **one-tap** cheer with an optional **custom message**, sent as a cheer notification (no thread).
  - **Ping** → the ping sheet (presets + **Custom…** so you can say anything).
- **Cindy is deliberately NOT in the composer at large** — only surfaced when you tap **Challenge**. DMs stay person-to-person so a friend chat never feels like a bot is in the room.
- Overflow menu: **mute**, **block**, report.

## Data model
Generalize the existing campfire-message pipeline rather than build a parallel one:
- `dm_threads` (id, user_a, user_b unique-ordered pair, created_at, last_message_at). One row per friend pair.
- `dm_messages` (id, thread_id, sender_id, body, kind in {text, challenge, invite, cheer}, ref_id nullable → challenge/session, created_at, read_at).
- Read state per user; unread count per thread powers a Messages badge.
- RLS: only the two members can read/write their thread.

## Notifications
On `notify_event`, one type `dm_received`:
- **Bell + OS push**, leading art = **sender's avatar** (same treatment as `campfire_message`).
- Category `friends_social`; respects the master + category toggles. Route `/dm/[senderId]`.
- Tapping the push/bell opens the thread (in-app or from OS), consistent with every other event.

## Guardrails
- **Friends-only** — you can DM accepted friends. (Non-friends can't open a thread; a challenge/campfire is the path to meet first.)
- **Block / mute** per thread. Blocked users can't send.
- Same quiet-hours + do-not-disturb rules as other pushes.

## Build notes
- New route `/dm/[friendId]` + a Messages list (all threads) reachable from the Friends area.
- Reuse the campfire message send/read RPC shape for `dm_messages`; reuse the challenge-card renderer for inline challenge sends.
- Add the **Message** button to `friend-profile.tsx` and the 💬 to the friends list rows.
