# Code prompt — Cindy, the AI Flame (big build)

Turn the app's flame into **Cindy** — an AI coach (Sonnet) you see everywhere and can talk to. Own worktree.

**⚠ Coordination**
- Clear `.git/index.lock` + commit first. Own worktree.
- **Shared "AI coach service"** — Cindy, the **Focus Nudge** (being built now), and re-engagement all use one
  server-side coach: **context assembly + Sonnet call + the safety system-prompt**. If Focus Nudge stood it
  up, **build on it**; if not, you own it. Agree the interface with that agent. **GCal** (separate build) plugs
  a calendar-context function into the same service — consume it if present, work without it.
- Don't edit specs/mocks; flag disagreements.

**Source of truth:** `CINDY_SPEC.md` · mocks **115** (Cindy: home / chat / rest / voice / data-mastermind),
**116** (the protective pushback — that voice is the Focus-Nudge intercept, not home). Data model:
`ITEM_CATALOG.md` (cosmetics + unlock conditions), `REWARD_ECONOMY.md` / rank ladder (XP math),
`PROFILE_SPEC.md §G` (milestones), `NOTIFICATIONS_SPEC.md`.

## Scope
1. **Cindy = the flame, everywhere.** The existing flame (app icon / lock-in / done / home / campfire / share)
   **is** Cindy — styled by the **equipped flame cosmetic** (customizing a flame = customizing her). On **home,
   make the flame tappable → open Cindy chat**, and surface her proactive **home message bubble** (warm
   motivation / re-engagement from the coach). 🔴 **Never the heavy pushback on home** — that's the intercept.
2. **Chat (mock 115).** Text conversation; her persona = supportive friend. **Message routing:** warm +
   conversational on home; protective/safety only at the social intercept (Focus Nudge).
3. **Data mastermind — context.** Server-side, assemble a clean context from the **full model**: ranks + the
   **XP-ladder math**, sessions/history, streaks, challenges + standings, **cosmetics catalog + unlock
   conditions**, inventory/equipped, milestones, notifications, campfires, + GCal/fitness if connected. So she
   answers **precisely**: *"how much to reach Hero?"* → XP-to-Hero → **lock-in hours** at the user's rate;
   *"what unlocks Hercules' Might?"* → the real condition.
4. **Actions / tools (confirm on side-effects).** Start/stop a session (titled + typed + **auto-tied to
   relevant challenges**), **add a milestone** ("add my 85% BU111 grade" → PROFILE_SPEC §G, effort receipts
   auto-attached, 🔒 **no XP — firewalled**), join/create a challenge, goal→challenge, mark notifications read,
   equip a cosmetic. 🔴 **Honor every economy rule + firewall** — she can NEVER grant XP/embers/rank.
5. **🎙 Voice (ElevenLabs) — new dependency.** Tap Cindy → talk: ElevenLabs STT in + her **TTS voice** out,
   Sonnet as the brain (mock 115 Frame 4). **Text-first**; voice is the hands-free layer. Rate-limit (voice
   minutes cost). Voice *may* be a premium **convenience** (not pay-to-win — text stays free/full) — *confirm*.
6. **Safety-first (inherit `APP_BLOCKER_SPEC §C-safety`).** Never shame; on distress lean to connection + real
   support; safety over productivity. Applies to Cindy everywhere.

## Economics / privacy
- Coach brain = **free** (never paywall the coach). Rate-limited, cached. Reads a lot of personal data →
  server-side, consented, reads **only the user's own** data (never another user's private data).

## Acceptance (from `CINDY_SPEC.md`)
- [ ] Flame = Cindy app-wide, styled by equipped cosmetic; home flame tappable → chat; proactive home bubble.
- [ ] Warm/motivation + chat on home; pushback/safety only at the intercept — never the heavy voice on home.
- [ ] Reads full model → precise answers (rank→hours, cosmetic unlock conditions).
- [ ] Acts (add milestone firewalled, start session auto-tied, …) with confirms; honors economy firewalls.
- [ ] Voice tap-to-talk via ElevenLabs; text-first; rate-limited.
- [ ] Safety-first everywhere; free; server-side; own-data only.
