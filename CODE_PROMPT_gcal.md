# Code prompt — Google Calendar integration (feeds the AI coach)

Read-only Google Calendar integration so the AI coach reasons over **real** deadlines/exams/free-busy. Own
worktree. Independent build — plugs a calendar-context function into the shared AI coach service.

**⚠ Coordination**
- Clear `.git/index.lock` + commit first. Own worktree.
- **Deliver a server-side function** the coach service calls at message/context time (e.g.
  `getCalendarWindow(userId, from, to)` → normalized events + free/busy). Agree the shape with whoever owns the
  **AI coach service** (Focus Nudge / Cindy agents). The coach must **work without** this (degrade gracefully).
- Don't edit specs/mocks; flag disagreements.

**Source of truth:** `GCAL_INTEGRATION_SPEC.md` (+ `APP_BLOCKER_SPEC §C/§C2` and `CINDY_SPEC.md` for how it's
consumed).

## Scope
1. **Connect (read-only OAuth).** Scopes `calendar.readonly` / `calendar.events.readonly`. Reuse the app's
   existing Google sign-in consent where possible. **Opt-in** card in **Connected Apps** (next to Strava /
   Health). Clear consent copy: "so Philoi can see your deadlines + free time and coach you around them.
   Read-only. Never shared."
2. **Token storage.** Encrypted **refresh token, server-side only**. **Revocable** in Connected Apps + it
   respects Google-side revocation.
3. **Fetch, don't warehouse.** A **server-side fetch of just the relevant upcoming window** (e.g. next 2–4
   weeks) **at AI-call time** — normalize to `{title, start, end, allDay}` + free/busy. Do **not** store the
   full calendar. Cache the window briefly per session. Rate-limit.
4. **Expose to the coach.** Hand the normalized window to the coach's context (server-side) so Sonnet gets real
   exams/deadlines/free-busy — true "midterm's Friday" lines, "you're behind" awareness, nudge into free
   windows, stay quiet during class. Let Sonnet interpret raw event titles (no brittle keyword parsing).
5. **Privacy.** Never surface calendar contents socially or to other users; read-only; minimize; fully optional.

## Setup (Google side)
- Google Cloud project + OAuth consent screen with the calendar scopes; verify the app for those scopes if
  required for production.

## Acceptance (from `GCAL_INTEGRATION_SPEC.md`)
- [ ] Connect Google Calendar (read-only OAuth) in Connected Apps; opt-in + clear consent; revocable.
- [ ] Encrypted server-side token; server-side fetch of the upcoming window at AI-call time; not warehoused.
- [ ] Coach gets real deadlines/exams + free/busy; "you're behind" + quiet-during-class behavior; interprets
      titles via the model.
- [ ] Works-without-it fallback (coach still runs, less precise).
