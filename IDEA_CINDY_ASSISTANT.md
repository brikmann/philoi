# Idea — "Cindy", the Philoi AI assistant (backlog)

An in-app **AI assistant (Sonnet-powered) named "Cindy"** that uses everything Philoi already knows about you
— sessions, goals, active challenges, campfires, streaks, milestones, synced fitness data — to **do things for
you** by voice or text.

## The hook (example)
> "Cindy, start a project work session for BU111"

→ Cindy **starts a Work lock-in titled "BU111"** and **auto-adapts to any active BU111 challenges** — e.g. if
there's a running "BU111 desired-grade" challenge or a class placement race, she tags the session to it, picks
the right metric (lock-in time), and it starts counting toward that challenge automatically. No manual setup.

## Why it fits Philoi
- It sits on the **same Sonnet backend** as the AI custom-goal parsing (mock 113) — one AI layer, two uses.
- It removes friction from the core loop: the hardest part is *starting*; Cindy makes starting a sentence.
- It's a natural **premium** surface (Flame Pass perk or paid tier — TBD).

## Capabilities to brainstorm
- **Sessions:** start/stop/resume a lock-in, titled + typed, auto-linked to relevant challenges.
- **Challenges:** "what am I in / how am I doing?", start or join one, check standings, nudge/cheer friends.
- **Planning:** "what should I lock in on today?" — reasons over deadlines, active challenges, streak risk.
- **Recaps:** "how was my week?" — summarize hours, wins, placements; draft a milestone.
- **Goals:** turn a spoken goal into a tracked challenge (the AI-custom-goal flow).

## Open questions (for when we scope it)
- Name — "Cindy" (confirm) vs something on-brand (ember/fire themed?).
- Voice + text, or text first.
- **Side-effectful actions need confirmation** (starting a session is safe; joining/creating challenges,
  messaging friends, spending embers → confirm first).
- Premium gating (Flame Pass vs add-on).
- Privacy — it reads a lot of personal data; on-device vs server; consent.

## Status
**Backlog / future.** Not a current build. Pairs well with the AI custom-goal feature and the S2 prof play
(Cindy could run class-session flows). Revisit after the current campfire/challenge work ships.
