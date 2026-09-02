# Code Prompt — Build the campfire as a full-screen chat (mock 101)

Restructure the campfire from the tabbed **Leaderboard / Feed / Challenges** chrome into a **full-screen chat**, Discord-style, over the banner backdrop. Reference: **`design-mocks/101-campfire-chat.html`** (5 frames: chat, + menu, leaderboard view, ⋯ options, @mention). The animated full-screen banner is already wired (`group/[groupId]/index.tsx` renders `<CampfireBannerArt variant="screen" animated>`); this replaces the chrome ON TOP of it. On `integration-wave1`; client/OTA except the ping/mention notification paths (§4/§6) which touch the notify path.

**Where:** `src/app/group/[groupId]/index.tsx` owns the campfire chrome today (header + Leaderboard/Feed/Challenges tab bar + which tab mounts). The feed is `CircleTimeline`; challenges are `ChallengesTab`; there's a "Message the campfire…" composer. Reuse all of these — this is a re-composition, not a rewrite of the feed/challenge/leaderboard internals.

## §1 · Layout — the chat IS the campfire
- **Drop the Leaderboard/Feed/Challenges tab bar.** The **feed (chat) is the one main surface**, full-screen over the banner. Header shrinks to a top bar: campfire **emoji + name + member/heat line** (left), and two round buttons (right) — **🏆 leaderboard** and **⋯ options**. Message composer pinned at the bottom.
- Banner backdrop stays full-bleed behind everything (already built); keep the legibility scrim so chat is readable (mock 101 frame 1). Feed scrolls over it; composer sits on a bottom gradient.
- Remove the swipe-up-for-full-screen-feed mechanic — the feed is already the screen.

## §2 · Feed = chat + inline embeds (Discord style)
Render `CircleTimeline`'s items as a **chat stream**: plain **text messages** (own = coral bubble right-aligned, others = card bubble with the sender's name + avatar), interleaved with **rich embeds dropped inline** — a **lock-in card**, a **Strava activity**, a **challenge card** (with Accept/Decline), a **photo**. Day dividers ("Today"). Reuse the existing card components for lock-ins / Strava / challenges as the embed bodies (mock 101 frame 1). Newest at the bottom, autoscroll on send.

## §3 · The + FAB — post anything (custom Philoi icons)
Bottom-right **+** button fans out a menu (mock 101 frame 2), each row a custom **Philoi line icon** (ported from the mock — camera / **crossed swords** / **share box-arrow** / bell):
- **Post a photo** → attach + post a photo to the feed.
- **Start a challenge** → the challenge-create flow **scoped to this campfire** (prefilled campfire field; see `challenge/create.tsx` + `CODE_PROMPT_campfires.md` §6/R5 for the whole-campfire "set a race").
- **Share a lock-in** → post one of your lock-ins as a feed card.
- **Ping a member · silent nudge** → pick a member, send a **silent direct notification** (NOT a chat message) — see §6.

Add the four glyphs to the icon set (`PhiloiIcon` or a local set), matching the 1.8-stroke round style; the crossed-swords is the same one now on the Challenges nav icon, the share is the box-with-up-arrow.

## §4 · @mention in the composer (distinct from Ping)
Typing **`@`** in the message box opens a **member autocomplete** — **`@all`** (notify everyone) + each member (mock 101 frame 5). Selecting inserts a highlighted **`@name`** token; sending the message **directs it to them and notifies them in-thread** (`@all` notifies the whole fire). This is a **chat mention** — standard, visible in the message. Keep it **separate from the FAB "Ping,"** which is a silent direct nudge with no chat message. Render mentions highlighted in delivered messages.

## §5 · Leaderboard as an inner view (not a tab/route)
**🏆** opens the leaderboard as a **panel/sheet over the same campfire** (mock 101 frame 3) — **This week / All time** toggle, members ranked by XP with rank/avatar/XP. Reuse the existing leaderboard query/rows (the old Leaderboard tab's data). Swipe-down / close returns to chat. It's a view *inside* the campfire, not a separate screen.

## §6 · Options (⋯) + notifications
- **⋯** opens the existing **campfire options sheet** (Invite people, Members, Mute notifications, Campfire settings [owner], Report, Leave) — mock 101 frame 4 — with the **custom Philoi icons** (ported from the mock).
- **Ping** (§3) and **@mention** (§4) both need the **notify/push path** (the one rank-up/session-complete use): a ping = a silent direct push to one member; an @mention = a notification to the mentioned member(s)/@all. Wire both through `notify_event`/`notify_push`. (This also depends on `CODE_PROMPT_campfires.md` **R6** — campfire notifications firing at all — do that first / together.)

## §7 · Challenges in the chat model
Challenges no longer have their own tab. Instead: **starting one (via the FAB) posts a challenge card into the feed**; that inline card carries Accept/Decline and links to the challenge info/watch screens. Keep `ChallengesTab`'s underlying logic (lifecycle, accept, settle) — just surface challenges **as feed embeds + the challenge-info screen** rather than a tab list. Apply the **R5 accept-flow fixes** (`CODE_PROMPT_campfires.md`: on-brand Accept/Decline, creator auto-enrolled, accepted state, correct counts) here.

## Guardrails + Done
- One branch (`integration-wave1`); client/OTA except §4/§6 notify wiring (additive on the one push path). Reuse `CircleTimeline`, the challenge/lock-in/Strava cards, the leaderboard query, and the options sheet — re-compose, don't rewrite.
- Keep the full-screen animated banner (already wired) and its scrim; keep the silent ErrorBoundary around it.
- **Done:** opening a campfire shows a full-screen chat over the banner — messages + inline lock-in/Strava/challenge/photo embeds; a bottom composer with `@`-mention autocomplete (`@name`/`@all`, distinct from the FAB's silent Ping); a bottom-right **+** that posts photo / starts a campfire challenge / shares a lock-in / pings a member, all with custom Philoi icons; **🏆** opens the leaderboard as an inner panel; **⋯** opens the options sheet; challenges live as feed cards with the fixed accept flow; mentions + pings fire notifications. Reference `design-mocks/101-campfire-chat.html`.
