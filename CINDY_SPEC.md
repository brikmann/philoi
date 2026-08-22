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

## Persona
- A supportive friend embodied as the flame — encouraging, a little playful, never a taskmaster.
- 🔴 **Safety-first (inherits `APP_BLOCKER_SPEC §C-safety`):** never shames; on distress signals leans to
  connection + real support; safety over productivity. Applies to Cindy everywhere, home + intercept.

## Voice — tap to talk (🎙 ElevenLabs)
- **Tap Cindy → talk to her out loud.** A real voice conversation: **ElevenLabs** does speech-to-text in +
  Cindy's **TTS voice** out (their Conversational AI / voice-agent), with the **Sonnet coach as the brain** in
  between. Pick a warm voice that matches her persona.
- Genuinely useful **hands-free** — mid-study, walking to class, at the gym. **Text-first**; voice is the
  richer mode on top.
- **Cost:** voice minutes have real cost → **rate-limit**. Voice could be a **premium *convenience*** (NOT
  pay-to-win — text stays free + fully featured, so gating the *modality* doesn't gate power). *Confirm gating.*
- **Dependency:** ElevenLabs account/API (new integration).

## Backend / economics
- Same **Sonnet coach** as Focus Nudge + AI goals + re-engagement — one service. **Free** (core coaching
  utility — pay-to-flex: never paywall the coach's brain). Rate-limited; cache.
- **Text first**; voice via ElevenLabs (above). Reads a lot of personal data → server-side, consented,
  privacy-minded.

## Build sequencing
After the Focus Nudge (shares the brain + the safety prompt). The home-flame-as-Cindy + chat is the new
surface; the message-routing split is the key behavior.

## Mocks
- **Mock 115** — Cindy: home speech bubble + the chat (start-a-session hook).
- **Mock 116** — the pushback channel: reinforce · wellbeing/safety · the "talk to someone" support surface.

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
