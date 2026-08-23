# Google OAuth verification — submission text

Paste-ready copy for **Verification Center**. Every claim below is enforced in code; the
"where" column is so a reviewer (or you) can check rather than take it on trust.

- **Scope requested:** `https://www.googleapis.com/auth/calendar.readonly` (only this one —
  `calendar.events.readonly` is deliberately NOT requested, since calendar.readonly covers it and
  two overlapping scopes only make the consent sheet longer)
- **Google Cloud project:** 921536564136
- **Privacy policy:** https://philoi.app/privacy.html (section 4, "Calendar integration")
- **Demo video:** _<paste the unlisted YouTube URL>_

---

## Justification (scope rationale)

Philoi is a small-circle accountability app. Members set a goal, check in with photos, and an
in-app AI coach ("Cindy") helps them plan around their real life.

We request `calendar.readonly` so that the coach can see the member's own upcoming commitments —
event **start/end times and titles only** — and reason about them when the member asks things like
"when should I train this week?" or "can I fit a session in before my deadline?". Without it the
coach can only offer generic advice, because it has no idea when the member is actually free or
what they are working toward.

The data is used solely to answer that member's own questions, in their own session. It is never
shown to another user, never used for advertising, never sold, and never used to train a model.

## How the access is limited

| Property | How it is enforced |
|---|---|
| Read-only | Only `calendar.readonly` is requested, and the token exchange verifies **Google's own granted `scope`** on the response before storing anything — a member who unticks the permission is treated as not connected |
| Opt-in | Off by default. An in-app consent screen states the trade before Google's own sheet is opened |
| Minimal fields | `fields=` masks on every Google call mean descriptions, locations, attendee identities, conferencing links and event ids are **never fetched at all** — not fetched-then-discarded |
| Not warehoused | There is no events table. A 10-minute cache holds a computed busy/free window, and is swept |
| Fetched only when needed | The calendar is read at the moment the coach answers, by the coach. There is no sync job and no scheduled fetch anywhere in the system |
| Encrypted at rest | Refresh tokens are AES-256-GCM encrypted with a key held only as an Edge Function secret. The mobile app has no code path that can receive a token |
| Revocable | Disconnect **revokes at Google first**, then deletes locally — and deletes locally even if Google is unreachable |
| Honours Google-side revocation | An `invalid_grant` on refresh deletes the connection, so the app stops claiming a link the member has already cut |
| Optional | Every failure path returns `connected: false` and the coach is required to work without it |

## What the demo video shows

1. Settings → Connected apps → "Your schedule" → **Connect Google Calendar**
2. The in-app consent screen explaining what will be read
3. Google's own consent sheet, showing `calendar.readonly`
4. Granting, and the row switching to connected with the account email
5. Asking the coach a question, and it **referring to a real upcoming commitment**
6. **Disconnect** — the row returning to disconnected

---

## Pre-submission checklist

- [x] Privacy policy live and naming the calendar scope — verified at https://philoi.app/privacy.html
- [ ] **Consent screen's privacy-policy field points at that URL** — there is a second, older policy
      at `getphiloi.com/privacy` (different codebase, "Last updated July 1 2026") that does NOT
      mention Calendar. If the console points there, verification fails on the policy check
- [ ] Google Calendar API enabled in project 921536564136
- [ ] `calendar.readonly` added under Scopes
- [ ] Test account added under Audience → Test users
- [ ] Demo video recorded and uploaded **Unlisted** to YouTube
- [ ] Homepage/app ownership verified for the domain
