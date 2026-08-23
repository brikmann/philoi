# Privacy policy — drop-in edits for Google Calendar + AI coach

Paste into `philoi.app/privacy.html`. Three edits, written in the existing policy's voice.

---

## EDIT 1 — New section (insert right after §3 "Fitness & health integrations")

### Calendar integration (Google Calendar)

**The short version:** connecting your Google Calendar is optional and read-only. Philoi reads only your
upcoming event times and titles — never their contents — so your in-app coach can steer you around real
deadlines and your free time. It is never shown to other users, never sold, and deleted when you disconnect.

If — and only if — you choose to connect Google Calendar, Philoi requests **read-only** access so your coach
can be useful about your actual schedule. The rules we hold ourselves to:

- **Opt-in.** Google Calendar is never connected by default. You connect it explicitly and grant permission
  through Google's own authorisation screen. The scope we request is `calendar.readonly`.
- **Read-only.** We only ever read. Philoi never creates, edits, moves or deletes anything in your calendar.
- **Only what the coach needs — titles and times, for a short window ahead.** We read the start/end times and
  titles of your **upcoming** events, and your free/busy blocks, for a rolling window of the next few weeks.
  We deliberately do **not** fetch event descriptions, locations, attendees, or event IDs — the request is
  masked to exclude them.
- **Used only to personalise your coaching.** Those titles and times are passed to our AI coach (see section 6)
  so it can nudge you around a real exam or deadline, suggest a free window to lock in, and stay quiet while
  you're in class. That is the only use.
- **Not stored beyond a short cache.** We don't keep a copy of your calendar. The forward window is held in an
  encrypted, short-lived cache (minutes) only to avoid re-requesting it on every coaching message, and your
  Google refresh token is stored encrypted.
- **Never shared, never sold, never used for ads.** Calendar data is never shown to other users, never
  disclosed to third parties except the AI provider in section 6 that generates your coaching, and never used
  for advertising or profiling.
- **Disconnect any time.** You can disconnect from within Philoi (Settings → Connected apps) or revoke access
  from your Google account. When you disconnect, we revoke the token with Google and delete what we cached.

Philoi's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

---

## EDIT 2 — Add two providers to §6 "Sharing & service providers" (the bullet list)

- **Anthropic (Claude)** — powers the in-app AI coach. When you use the coach, the relevant context (your
  recent activity, goals, streak, and — if you've connected it — your upcoming calendar titles/times and
  free/busy) is sent to Anthropic's API to generate a coaching message. It is processed to answer you and is
  **not used to train Anthropic's models**.
- **ElevenLabs** — text-to-speech. If you use voice, the **text of the coach's reply** is sent to ElevenLabs to
  synthesise the spoken audio. ElevenLabs receives only that reply text, not your account data.

---

## EDIT 3 — One line in §2 "Optional connected sources"

Add after the fitness sentence:

> If you connect **Google Calendar**, we receive read-only event **times and titles** (not their contents) —
> covered in the *Calendar integration* section below.

---

## Also
- Add **"Calendar integration"** to the Contents list (and let the numbering shift).
- Bump the "Last updated / Effective" date at the top.
