# Google Calendar integration — real deadlines feed the AI coach

Don't build exam scheduling natively — **read the calendar students already use.** A read-only Google Calendar
integration grounds the AI coach (APP_BLOCKER_SPEC §C/§C2) in **real commitments** — exams, assignment
deadlines, class times, free/busy windows — instead of guesses.

**Why it matters:** GCal is the **school administrative layer** many students live in. Reading it turns Philoi
from a fun focus/competition tool into a **grade-improver + social connection + fun** — the AI can say things
that are actually true: *"You've got the BU111 midterm Friday and two things due this week — you're behind,
let's pick it up,"* or, reading burnout, *"You've done a lot and nothing's due till next week — go talk to
someone, you've earned it."*

## Connect
- **OAuth, read-only** (`calendar.readonly` / `calendar.events.readonly`). Reuse the app's existing Google
  sign-in consent flow where possible.
- **Opt-in**, in **Connected Apps** alongside Strava / Health (a "Connect Google Calendar" card).
- Clear consent copy: "So Philoi can see your deadlines and free time and coach you around them. Read-only.
  Never shared with anyone."

## What it reads
- **Upcoming events** in a rolling window (e.g. next 2–4 weeks): exam/quiz/midterm titles, assignment due
  dates, class blocks, other commitments.
- **Free / busy windows** (when the user is open to lock in vs in class).
- Let **Sonnet interpret** the raw events (titles, dates) rather than brittle keyword parsing — it maps
  "BU111 Midterm Fri 9am" → a real deadline + course tie.

## Feeds
1. **AI coach (primary)** — real deadline awareness in both nudge directions:
   - In-session nudge: "the exam you have Friday isn't going to study for itself."
   - Re-engagement: "you're free till 2pm and there's a deadline tonight — good window to lock in."
   - **"You're behind" awareness** — cross-reference upcoming deadlines vs recent effort.
   - **Don't nudge during class / busy** blocks.
2. **(Optional, later)** deadline-aware challenges/goals; suggested lock-in windows before an exam.

## Privacy (important — calendar is sensitive)
- **Read-only, minimize, don't warehouse.** Prefer a **server-side fetch of just the relevant window at
  AI-call time**; don't store the full calendar. Never surface cal contents socially or to other users.
- **Revocable** in Connected Apps + Google account. Store the refresh token encrypted, server-side only.
- Fully optional — the coach works without it (just less precise); connecting makes it sharp.

## Build
- Google Calendar API + OAuth (Google Cloud project, calendar scopes added to the consent screen).
- Encrypted refresh-token storage (server). **Fetch events server-side** at the moment the AI message is
  generated (same Sonnet call in APP_BLOCKER §C/§C2), pass the relevant window into the prompt context.
- Rate-limit; cache the window briefly per session.
- This is a **separate integration build** from the Focus Nudge; the coach *consumes* it when connected.

## Positioning
GCal is what makes the AI coach credible: it's no longer "a study app guessing" — it's reasoning over your
actual academic schedule. That's the difference between a toy and a **grade improver**. (Pairs with the S2
prof play and the "Cindy" idea — all one AI-reads-your-real-data thesis.)

## Acceptance
- [ ] Connect Google Calendar (read-only OAuth) in Connected Apps; opt-in + clear consent; revocable.
- [ ] Server-side fetch of the upcoming window at AI-message time; not warehoused.
- [ ] AI coach messages reference real deadlines/exams + free/busy; "you're behind" awareness; quiet during class.
- [ ] Works-without-it fallback (coach still runs, less precise).
