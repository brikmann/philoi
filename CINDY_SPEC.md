# Cindy — the AI Flame you speak with

**Cindy is the flame.** The home flame becomes a persona (Sonnet) you can talk to — a warm, motivating coach
that knows your data (sessions, goals, streak, active challenges, and, if connected, your Google Calendar).
Same brain as the Focus Nudge / re-engagement / AI goals — one AI coach, now with a face and a name.

## Cindy IS the flame — everywhere (the big one)
The flame the user already sees and has been growing **is** Cindy — not a new mascot. She's the flame on the
**app icon / logo · the lock-in (SessionFlame) · the done / well-done screen · the home heat flame · the
campfire flame · share cards.** One identity, app-wide.
- 🔴 **The equipped flame cosmetic is how Cindy looks.** Every flame skin / colour / aura in the catalog
  (`ITEM_CATALOG.md`) is **customizing your companion** — buying/equipping a Mythic flame isn't just status,
  it's dressing up your friend. This retroactively deepens the *entire* cosmetic economy: cosmetics become
  *personal*, not just flex. The **heat states** read as Cindy's energy; the **live session aura** is her
  getting hyped with you.
- She's the flame you've been leveling up all along — so the persona lands as attachment, not a bolted-on
  chatbot.
- 🔴 **Two rendering rules (carry into the real build, not just mocks):**
  1. **One flame orientation, everywhere = the logo flipped horizontally (the "Cindy flame").** 🔴 UPDATED:
     the mirrored flame is now the **single canonical mark on every surface** — app icon, favicon, launch /
     splash, home / done / daily-fire hero, iOS/Android ambient (Live Activity / notification), and the
     website. This **supersedes** the earlier "app-icon keeps the original orientation" split. Flip the master
     `FLAME_PATH` (`src/components/ui/flame-logo.tsx`) once and make sure nothing applies a *second* mirror, so
     every flame renders the same way. See `AGENT_PROMPT_global_flame_icon.md`.
  2. **Never render a 🔥 emoji in Cindy's UI or dialogue.** She *is* the flame — her chat avatar / name-tag is
     the vector flame (the equipped cosmetic), never the generic emoji, and her generated message text must not
     emit 🔥 (add "no 🔥 emoji" to her system prompt).

## Cindy's data + actions — the background mastermind
Cindy silently aggregates **everything** about you (server-side) into a clean context, so her answers are
**exact and actionable — not vibes.** She's the single pane over the whole app.

**Reads the full model:** ranks + the **XP-ladder math**, sessions + history, streaks, goals / challenges /
standings, the **cosmetics catalog + unlock conditions** (relics, discipline relics, boxes, Flame Pass), your
**inventory + equipped**, milestones, the **notifications / activity feed**, campfires, and (if connected)
Google Calendar + fitness.

**Answers precisely — e.g.:**
- *"How much do I have to lock in on classes to reach Hero?"* → computes XP-to-Hero from the ladder, converts
  to **lock-in hours** at your XP/hour rate, factors recent pace → "≈ 38 more hours — about 3 weeks at your
  pace, or ~2 if you keep the BU111 challenge going."
- *"What do I need to unlock {cosmetic / relic}?"* → reads the condition ("Hercules' Might = 100k lb lifted —
  you're at 62k").
- *"What should I focus on?"* / *"how am I doing?"* → cross-references deadlines, standings, streak risk, unlocks.

**Acts (confirm on side-effects):**
- *"Cindy, add my 85% grade in BU111 as a milestone"* → creates it via the real path (PROFILE_SPEC §G),
  auto-attaches the effort receipts, 🔒 **firewalled — the grade earns no XP.**
- Start/stop a session (titled + typed + auto-tied), join/create a challenge, turn a goal into a challenge,
  mark notifications read, equip a cosmetic, etc.

**Guardrails:** side-effectful actions **confirm first**; she **honors every economy rule + firewall** — she
can't grant embers/XP/rank, and a grade milestone earns nothing; she reads only **your** data, never another
user's private data. "Learning in the background" = aggregating *your own* data for context, **not
surveillance.**

## The core split — message routing (what Noah asked for)
Two channels, tuned to context. **Where a message lands changes its tone.**

### Channel 1 — HOME / Cindy: motivation + conversation (the warm voice)
- Cindy surfaces **proactive, encouraging** messages on the **home screen** (a speech bubble from the flame):
  celebration ("2h on Orgo already 🔥"), re-engagement ("you've rested — exam's Friday, one more block before
  dinner?"), gentle check-ins. **Forward-looking, positive.**
- **Tap the flame → chat with Cindy.** Conversational; she can **take actions**: start/stop a session (titled +
  typed, auto-tied to relevant challenges — *"Cindy, start a work session for BU111"*), check standings, recap
  your week, draft a milestone, turn a goal into a challenge (the AI-goal flow). **Side-effectful actions
  confirm first** (starting a session is safe; joining challenges / messaging / spending embers → confirm).
- This is where **all the positive coaching lives** — home should feel like an encouraging friend, not a nag.

### Channel 2 — INTERCEPT / pushback (the protective voice)
- The **harder, protective** messages fire **only at the social-media intercept** (Focus Nudge,
  `APP_BLOCKER_SPEC`): *reinforce* ("come on — you said you'd lock in, exam's Friday") or, on **repeated
  retreat**, the **wellbeing/safety** voice ("you've been pulling away a lot — that's okay, but not the feed.
  Go outside, or text someone you trust"). Contextual, earned at the moment of drift.
- 🔴 **Never put the heavy pushback on home.** "Get back to work" / "go talk to someone" every time you open
  the app would be exhausting and would make Cindy feel like a warden. Home = encouragement; the intercept =
  the protective nudge. **Same persona, different surface + tone.**

## Entry points & surfacing (mock 117 — FINAL)
How Cindy is reached, decided screen-by-screen. Every entry point is **the flame itself** — never a separate
chatbot button.

**Home**
- The flame **is** Cindy. **Tap = text chat · hold = voice** (one hit-target, the flame; a ring appears while
  held). No separate icon.
- **Proactive bubble sits ABOVE the flame** (under the greeting) — data-aware, encouraging, auto-dismiss.
- 🔴 **No attention / notification dot on the flame.** It read as surveillance ("she's watching") — removed
  everywhere. If Cindy has something, she *says* it in the bubble; she doesn't wear a red badge.

**Tap animation — ring pulse** (mock: `cindy_tap_ring_pulse`)
- On `onPressIn`: the flame does a quick **squash → spring** (scale .9 → 1.06 → 1), and **3 ember rings ripple
  outward**, staggered ~140 ms, each ~0.9 s expand + fade. Then navigate to chat. Reads as Cindy "waking up."
- **Hold (voice):** the rings **pulse continuously** while held instead of firing once.
- RN build: Reanimated `withSequence` for the bounce; `withTiming` scale+opacity on the rings. Wire into the
  shared `PersonalFlame`/`SessionFlame` press state so it's identical wherever the flame appears.

**Global — reachable from anywhere**
- A **small header flame, top-right on every non-home screen** (Boards, Challenges, Profile, …) → opens Cindy.
  Unobtrusive, always there.
- ❌ **Skip the floating FAB** — it hovers over content and fights the ember minimalism.

**Lock-in** (mock 117 §C — full chrome: LOCKED IN + timer, "locked in with you" strip, camera + Stop, optional flare)
- 🔴 **Proactive line placement = ABOVE the flame, under the "Study · BU111 / Laurier Grind" header** (Option A,
  chosen). Mirrors home; the flame + LOCKED IN label + timer stay the uninterrupted centerpiece below.
- **Tap the flame → quick-sheet** (not full chat): *How am I doing? · Add a note to this session · Open full
  chat*. Slides up over the camera/Stop row; screen behind dims — so a check-in never derails the session.
- Proactive line fires **at milestones only** (30 / 60 / 90 min or a PR), auto-dismiss. Coexists with the
  optional **flare** aura and the **"locked in with you"** body-doubles strip.
- 🔴 **BUILD DEPENDENCY (server):** the proactive lock-in line needs a **new `lockin` `CoachSurface`.** Today
  `CoachSurface = chat | home | intercept | reengagement` and the server hardcodes `surface='home'` — the line
  can't route as specced without a new server-side routing block. The client tap quick-sheet is built and only
  needs `cindy.tsx` committed. Do the surface addition before wiring the proactive line.
- 🔴 **"Add a note to this session" = CONVERSATIONAL via Cindy** (decided). She takes the note in chat; do
  **not** restore the in-session caption field that the §13 redesign deliberately moved to the done screen.

## Persona
- A supportive friend embodied as the flame — encouraging, a little playful, never a taskmaster.
- 🔴 **Safety-first (inherits `APP_BLOCKER_SPEC §C-safety`):** never shames; on distress signals leans to
  connection + real support; safety over productivity. Applies to Cindy everywhere, home + intercept.

## Voice — tap to talk (🎙 STT-only architecture — build it the cheap way)
- 🔴 **Default = turn-based, NOT the real-time agent.** Pipeline: **on-device STT** (free — iOS Speech / Android
  SpeechRecognizer) → **Sonnet** (the brain we already pay for) → **ElevenLabs TTS** for Cindy's spoken reply
  only. UX: **hold-to-talk / tap-to-talk**, **auto-send on a pause** (silence detection) so it feels
  conversational without a literal Send button. She **replies in her voice** (TTS), so it *sounds* like a real
  convo — walkie-talkie, one turn at a time.
- 🔴 **Do NOT use ElevenLabs' Conversational-AI agent by default.** It's the always-listening real-time loop —
  ~**$0.08–0.10/min (10–15× the cost)**, and they currently absorb the LLM cost but "may pass it on." The
  STT-only path is **~1–2¢/exchange** (STT free · Sonnet ~1¢ · TTS ~0.75¢/reply) and keeps **Sonnet** as the
  persona instead of their LLM.
- **Future premium "Call Cindy" mode** — the real-time agent can be offered later as an opt-in premium mode
  (only power-users choose it, so the higher per-minute cost is self-selecting). NOT pay-to-win: text + STT
  voice stay free/full; you'd be gating the *seamless modality*, not power. *Confirm if/when.*
- **Cost control:** STT-voice is cheap enough to be **free + lightly rate-limited**. Cap TTS characters/day if
  needed.
- **Dependency:** ElevenLabs account/API (**TTS only** for v1).

## Backend / economics
- Same **Sonnet coach** as Focus Nudge + AI goals + re-engagement — one service. **Free** (core coaching
  utility — pay-to-flex: never paywall the coach's brain). Rate-limited; cache.
- **Text first**; voice via ElevenLabs (above). Reads a lot of personal data → server-side, consented,
  privacy-minded.

## Build sequencing
After the Focus Nudge (shares the brain + the safety prompt). The home-flame-as-Cindy + chat is the new
surface; the message-routing split is the key behavior.

## Mocks
- **Mock 115** — Cindy: home speech bubble + the chat (start-a-session hook). (mirrored flame, no 🔥 in dialogue)
- **Mock 116** — the pushback channel: reinforce · wellbeing/safety · the "talk to someone" support surface.
- **Mock 117** — entry points & surfacing (home tap/hold · header flame · lock-in Option A · tap quick-sheet);
  `cindy_tap_ring_pulse` — the tap ring-pulse animation.

## Acceptance
- [ ] Home flame = Cindy; proactive **encouraging** message bubble; tap → chat.
- [ ] Chat takes actions (start session titled+typed+auto-tied; recap; standings) with confirms on
      side-effectful ones.
- [ ] **Motivation on home; pushback/safety only at the social intercept** — never the heavy voice on home.
- [ ] Safety-first everywhere (never shame; support on distress); free; server-side.
- [ ] Cindy = the app flame **everywhere** (icon / lock-in / done / home / campfire / share), **styled by the
      equipped flame cosmetic** — customizing a flame = customizing Cindy.
- [ ] 🎙 Voice tap-to-talk via **ElevenLabs** (STT in + Cindy TTS out, Sonnet brain); text-first; rate-limited.
- [ ] Cindy reads the full data model (ranks/XP math, cosmetics + unlock conditions, milestones, notifications,
      challenges, GCal) → precise answers ("38h to Hero"); acts (add milestone, start session) with confirms +
      firewalls honored.
- [ ] **Entry points (mock 117):** home flame tap = chat / hold = voice, proactive bubble **above** the flame,
      **no notification dot**; **header flame** on every non-home screen (no FAB); lock-in proactive line
      **above the flame under the header** (Option A) + tap → quick-sheet.
- [ ] **Tap ring-pulse** animation on the shared flame press state (squash→spring + 3 staggered ember rings;
      hold = continuous pulse).
