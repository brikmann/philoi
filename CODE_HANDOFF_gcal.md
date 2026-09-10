# Handoff — Google Calendar integration (read-only, feeds the AI coach)

Built against `GCAL_INTEGRATION_SPEC.md`. Consumed by `APP_BLOCKER_SPEC §C/§C2` (Focus Nudge +
re-engagement) and `CINDY_SPEC.md §3` (data mastermind).

**Status:** code complete and committed. It needs the Google-side setup in §4 and the Supabase
secrets in §3 before a real calendar can connect.

> ### ⚠️ Updated 2026-09-09 — the connect flow was rebuilt. Three things in this doc changed.
>
> 1. **The OAuth flow is `expo-auth-session` PKCE in the system browser, not the native Google
>    SDK.** The old flow called `GoogleSignin.addScopes()`, which widens whichever Google account
>    the member signed into Philoi with and offers **no account chooser**. That silently assumed
>    the Philoi login and the calendar account are the same Google account. They frequently are
>    not — a personal Gmail login with classes on a school account is the common student case —
>    and an email/password member had no session to widen at all. The flow now runs
>    `prompt=select_account consent` every time and keys the grant to the Philoi `user_id`.
> 2. **The scope is `calendar.events.readonly`, not `calendar.readonly`.** Narrower, and it comes
>    with a hard constraint: see §4.2.
> 3. **The consent dialog is a Philoi component, not `Alert.alert()`.**
>
> §2, §3, §4 and §7 below reflect the current build. The §1 contract is unchanged.

---

## 1. The contract — READ THIS IF YOU OWN THE AI COACH SERVICE

One function. It never throws, and it never blocks a coach message.

```ts
import { getCalendarWindow, formatCalendarWindowForPrompt } from '../_shared/gcal.ts';

const window = await getCalendarWindow(serviceClient, userId);   // service-role client
if (window.busyNow) return;                                       // they're in class — stay quiet
context.push(formatCalendarWindowForPrompt(window));              // drop straight into the prompt
```

`supabase/functions/_shared/gcal.ts` is the whole public surface. If your coach is a Deno Edge
Function in this project, import it — no HTTP hop. If it lives anywhere else, POST to the
`gcal-window` function with the **service role key** and `{ userId }` (see §2).

### Signature

```ts
getCalendarWindow(
  admin: SupabaseClient,          // service role — the tables have no RLS policies by design
  userId: string,
  options?: {
    from?: string | Date;         // default: now
    to?: string | Date;           // default: from + 21 days
    now?: string | Date;          // instant busyNow/freeAt/freeUntil are evaluated against
    force?: boolean;              // skip the cache (still rate-limited)
  },
): Promise<CalendarWindow>        // never rejects
```

### What comes back

```ts
type CalendarWindow = {
  connected: boolean;             // false => reason a coach without calendar context
  reason: 'not_connected' | 'revoked' | 'rate_limited' | 'error' | null;
  timeZone: string | null;        // IANA, e.g. "America/Toronto"
  from: string; to: string; now: string;
  events: {
    title: string;                // RAW Google title — you interpret it, we don't
    start: string; end: string;   // ISO 8601
    allDay: boolean;              // all-day = a DEADLINE, not an occupancy
    calendar: string;             // source calendar name (primary only — see §4.2)
    busy: boolean;                // counts toward free/busy
  }[];
  busy: { start: string; end: string }[];   // merged, non-overlapping
  busyNow: boolean;               // <- "don't nudge during class"
  freeAt: string | null;          // when the current busy run ends (null if free now)
  freeUntil: string | null;       // when the next busy block starts <- "free till 2pm"
  fetchedAt: string;
  cached: boolean;
};
```

### The four things that matter to your prompt

| Spec line | Field |
|---|---|
| "the exam you have Friday isn't going to study for itself" | `events` (raw titles) |
| "you're free till 2pm and there's a deadline tonight" | `freeUntil` + `events` |
| **"you're behind"** awareness | `events` cross-referenced against your own effort data |
| **Don't nudge during class / busy** | `busyNow` (and `freeAt` for when to try again) |

### Rules of the road

- **Works-without-it is not optional.** Every failure — no grant, revoked at Google, rate-limited,
  Google down — arrives as `connected: false` with a `reason`. Handle exactly one case:
  no calendar context. Never surface `reason` to a member; it's for logs.
- **Let Sonnet read the titles.** No keyword matching on "midterm"/"due"/"exam" anywhere. The
  module deliberately hands over raw titles; `formatCalendarWindowForPrompt()` already tells the
  model to interpret them and to never invent a deadline.
- **Use `formatCalendarWindowForPrompt()` rather than rolling your own block**, so all three
  callers (nudge, re-engagement, Cindy) describe the calendar identically and "what did the model
  actually see?" has one answer. It writes dates out in the member's own zone on purpose — the
  model should never be doing timezone arithmetic — with the exception of all-day dates, which are
  calendar dates with no zone and render exactly as Google wrote them.
- **Never surface calendar content socially.** It goes into the member's own prompt and nowhere
  else: not the campfire, not a share card, not another member's view.
- **Don't cache it yourself.** The module already caches the window for 10 minutes per member and
  rate-limits to 20 Google fetches per member per rolling hour. Calling it once per nudge and
  again per chat turn is fine and costs Google one request.

**Disagreement / change request:** the shape is a first cut against the spec, not a treaty. If the
coach needs something that isn't here (e.g. a `pastEvents` window for "you said you'd study
yesterday"), it's a small change to `gcal.ts` — raise it rather than post-processing around it.

---

## 2. What was built

**Migration** — `supabase/migrations/0105_google_calendar_integration.sql`
- `google_calendar_connections` — one row per member. Refresh token **AES-256-GCM encrypted**,
  Google account email (display only), granted scopes, rolling rate-limit counter. No RLS
  policies, exactly like `strava_connections` / `whoop_connections`.
- `google_calendar_window_cache` — the brief normalized window, with `expires_at`. **Not a
  warehouse**: 10-minute TTL, swept on write, deleted on disconnect. There is no events table.
- `get_my_google_calendar_status()` → `connected, account_email, linked_at`. Never the token.
- `disconnect_my_google_calendar()` — local delete; the fallback path only (see below).

> ⚠️ **Migration number.** `0105` was chosen to sit clear of `0100`, since the Campfire, Challenge
> v2, Focus Nudge and Cindy builds are all running in parallel and each may add one. Renumber
> before merge if it collides — **two files sharing a leading number silently roll back**.

**Edge Functions**
| Function | What it does |
|---|---|
| `_shared/gcal.ts` | The contract above. Token refresh, Google fetch, normalize, free/busy, cache, rate limit, prompt shaping. |
| `_shared/token-crypto.ts` | AES-256-GCM with the key in an Edge Function secret, **not** in Postgres. |
| `gcal-oauth-exchange` | `code` + PKCE `codeVerifier` → refresh token. The only place the Google client secret is used. The redirect URI is derived server-side, never taken from the caller. |
| `gcal-oauth-callback` | **Public** (`verify_jwt = false`). Google's Web client will not accept a `philoi://` redirect, so Google redirects the browser here and this 302s to `philoi://gcal-auth`. Holds no secret and reads nothing. |
| `gcal-disconnect` | **Revokes at Google**, then deletes locally. Deletes either way. |
| `gcal-window` | HTTP surface of the contract, for a coach that can't import the module. |

**App**
| File | What changed |
|---|---|
| `src/lib/google-calendar.ts` | the PKCE handshake; parks `state`+`codeVerifier` in SecureStore, hands the code to the server |
| `src/app/gcal-auth.tsx` | **new** — the `philoi://gcal-auth` return route. Not optional: see the two decisions below |
| `src/components/calendar-consent-dialog.tsx` | **new** — the Philoi-branded consent modal that replaced `Alert.alert()` |
| `src/hooks/use-google-calendar-connection.ts` | same shape as `use-whoop-connection`; `connect()` doubles as "switch account" |
| `src/app/connected-apps.tsx` | "Your schedule" group, `Connected · <google account>`, Switch account, Disconnect via `<ConfirmDialog>` |
| `src/lib/auth/providers.ts` | `configureGoogleSignin()` no longer takes a scope override — nothing widens the sign-in config any more |
| `src/constants/feature-flags.ts` | `GOOGLE_CALENDAR_ENABLED` (false — see §4) |
| `src/types/database.ts` | the two new RPCs |

### Three decisions worth knowing about

**The browser, not the native sheet — because the calendar account is not the login account.**
This is the whole argument for the rewrite and it is in the header above. The native SDK's
`addScopes()` cannot offer an account chooser; `prompt=select_account` in a browser flow always
can. The cost is a rebuild (the JS changed) and one extra Edge Function; the benefit is that
connecting a *different* Google account than you log in with is a supported path rather than an
impossible one.

**`philoi://gcal-auth` is a REAL expo-router route, and that is load-bearing.** Google's **Web**
OAuth client rejects custom-scheme redirect URIs outright, so the browser goes to the
`gcal-oauth-callback` relay first and that 302s into the app. Then the same trap Strava hit: on
Android, `WebBrowser`'s redirect detection races expo-router's Linking listener for the incoming
URL, and if the router wins with no route defined, a successful consent lands on **"Unmatched
Route"** and the grant is lost. So both paths are wired, they share one `completeGoogleCalendarAuth()`,
and because a Google authorization code is **single-use** (unlike Strava's repeatable upsert) the
loser of the race finds the code already consumed and no-ops instead of triggering `invalid_grant`.
The PKCE verifier lives in SecureStore rather than a closure so it survives the OS killing the app
while the browser is foregrounded.

**The refresh token is encrypted; the fitness tokens aren't.** A calendar grant reads every
commitment in someone's life, so a database dump alone must not yield a usable token. The key
lives in `GCAL_TOKEN_ENC_KEY` (an Edge Function secret) — Postgres never sees it, which is the
whole point and is why this isn't pgcrypto. Access tokens are minted per fetch and never stored.

## 3. Supabase secrets

```bash
supabase secrets set \
  GOOGLE_WEB_CLIENT_ID="921536564136-….apps.googleusercontent.com" \
  GOOGLE_WEB_CLIENT_SECRET="…" \
  GCAL_TOKEN_ENC_KEY="$(openssl rand -base64 32)"
```

- `GOOGLE_WEB_CLIENT_ID` / `GOOGLE_WEB_CLIENT_SECRET` are the **Web** OAuth client's — the same
  pair already in Supabase Auth → Providers → Google (`GOOGLE_SIGNIN_SETUP.md`). Not the Android
  or iOS client: the browser flow authorizes against the Web client, which is also the only
  client type whose redirect URI can be the https relay.
- `GCAL_OAUTH_REDIRECT_URI` is **optional**. Unset, the exchange derives
  `${SUPABASE_URL}/functions/v1/gcal-oauth-callback`, which is what the app uses too. Set it only
  if the relay ever moves.
- `GCAL_TOKEN_ENC_KEY` must be 32 bytes of base64. **Losing or rotating it invalidates every
  stored refresh token** — members would have to reconnect. Back it up wherever the other project
  secrets live.

Then (the migration is already applied — see §2):

```bash
supabase functions deploy gcal-oauth-exchange gcal-oauth-callback gcal-disconnect gcal-window
supabase functions deploy ai-coach ai-coach-voice   # they consume the window; deploy in lockstep
```

`gcal-oauth-callback` is declared `verify_jwt = false` in `supabase/config.toml`; the rest keep
the default. **Deploying the callback with the JWT gate on turns every successful consent into an
opaque 401** — a browser following Google's redirect carries no Authorization header.

---

## 4. Google-side setup — THE ACTUAL BLOCKER

Everything happens in Google Cloud project **921536564136** (`GOOGLE_SIGNIN_SETUP.md`), the one
sign-in already uses. No new project, no new OAuth client.

1. **APIs & Services → Library → enable the Google Calendar API.**

2. **OAuth consent screen → Scopes → add `https://www.googleapis.com/auth/calendar.events.readonly`.**

   > ### ⚠️ 4.2 — what this narrower scope costs, and why it is not free
   >
   > `calendar.events.readonly` **cannot list the member's calendars.** `calendarList.list`
   > accepts only `calendar.readonly` / `calendar` / `calendar.calendarlist*`; under an
   > events-only grant it **403s**. So `gcal.ts` reads the **`primary` calendar by id and never
   > enumerates** — the calendar's name and IANA zone come off the `events.list` response itself
   > (`fields=summary,timeZone,items(...)`), which is what makes the narrow scope workable at all.
   >
   > **The cost:** a subscribed or secondary calendar is invisible. A student whose "BU111" course
   > calendar is a separate subscription gets nothing from it, and `CalendarEvent.calendar`
   > collapses to the one primary name — so the course tie now has to come from the event *title*,
   > which is the model's job anyway. `gcal.test.ts` pins this so the trade stays visible.
   >
   > **What it does NOT buy:** any relief from verification. `calendar.events.readonly` is a
   > **sensitive** scope exactly like `calendar.readonly`. Widening back is a one-line change to
   > `GOOGLE_CALENDAR_SCOPE` plus restoring an enumeration step; `grantCoversCalendar()` already
   > accepts the wider scopes, so existing grants would keep working across the change.

3. **Credentials → the Web OAuth client → Authorized redirect URIs → add**
   `https://<project-ref>.supabase.co/functions/v1/gcal-oauth-callback`.
   This is new, and the flow cannot complete without it — Google fails the authorize step with
   `redirect_uri_mismatch`. It must match byte-for-byte what the app sends and what
   `gcal-oauth-exchange` derives.

4. **Pick a verification path, and say which one out loud.** A sensitive scope means that until
   Google verifies the app, **only accounts on the consent screen's test-user list can grant it**;
   everyone else meets the unverified-app warning.
   - **Pilot (current):** keep the app in **Testing** and add pilot users under
     *OAuth consent screen → Audience → Test users*. Works immediately, no review.
   - **Public launch:** submit for verification **before** the store clock matters. Google asks
     for a justification and usually a demo video, and review is measured in **days to weeks** —
     recording the demo needs the flow working on a real device, which is why the flag is on.
     The honest justification is the spec's: *read-only, so an AI study coach can reason about the
     student's own deadlines and free time, shown only to them, never stored or shared.*

5. `GOOGLE_CALENDAR_ENABLED` in `src/constants/feature-flags.ts` is already `true`. Note this is
   **not** an OTA-able change any more — the connect flow is new JS **and** a new route, and
   `PHILOI_NO_OTA` policy applies regardless: it ships in a build.

## 5. Privacy properties, so a reviewer can check them fast

| Spec requirement | How it's enforced |
|---|---|
| Read-only | Only `calendar.events.readonly` (+ non-sensitive `openid email`, for the display address) is ever requested; the exchange **verifies Google's own granted `scope`** via `grantCoversCalendar()` before storing anything and refuses otherwise |
| Opt-in | Feature flag + a Philoi-branded consent modal spelling out the trade **before** Google opens |
| The member knows WHICH account | The chooser runs every time, and the row reads `Connected · <google account>` — the Google account is independent of the Philoi login, so "Connected" alone would not say what is attached |
| Encrypted, server-side only | AES-256-GCM, key in an Edge Function secret; the app has no code path that could receive a token |
| Don't warehouse | No events table. `fields=` masks on the Google calls mean descriptions, locations, attendee identities, conferencing links and event ids are never even fetched. 10-minute cache, swept |
| No token ever reaches the app | The client holds only a one-time `code` and its PKCE verifier; redeeming needs the client secret, which exists only in the Edge Function |
| Fetch at AI-call time | `getCalendarWindow()` is called by the coach, not by a sync job. There is no scheduled fetch anywhere |
| Revocable | Disconnect **revokes at Google** first, then deletes. Local delete happens even if Google is unreachable |
| Respects Google-side revocation | `invalid_grant` on refresh deletes the connection and returns `reason: 'revoked'`, so Connected Apps stops claiming a link that no longer exists |
| Never shared socially | Nothing reads these tables except the coach's own prompt assembly for that same member |
| Optional | Every failure is `connected: false`; the coach is contractually required to run without it |

---

## 6. Tests

`supabase/functions/_shared/gcal.test.ts` — no network, no database, Google and the Supabase
client both stubbed:

```bash
deno test --allow-env supabase/functions/_shared/gcal.test.ts
```

It covers the crypto round-trip, event normalization (declined and cancelled dropped, unticked
calendars never fetched), back-to-back busy-block merging, `busyNow`/`freeAt`/`freeUntil`
recomputed per call rather than replayed from the cache, cache hits, Google-side revocation,
rate-limit fallback to a stale window, and a Google outage degrading to `connected: false`.

It exists because it caught two real bugs during the build, both of the silent kind:

1. **The cache never hit.** `from`/`to` default to *now*, so every call asked for a window shifted
   a few minutes further out, and `readCache` only reuses a window that fully contains the request.
   The cache was stale-by-shift the instant it was written — every coach message would have hit
   Google. Fixed by fetching an overhang exactly the length of the TTL.
2. **All-day events rendered a day early.** Google sends `date: "2026-08-28"`, which parses as UTC
   midnight; formatted in `America/Toronto` that renders "Thu 27 Aug". The coach would have named
   the wrong day for a Friday midterm — the single most credibility-destroying thing this feature
   could do. All-day dates now format in UTC, which is the calendar date Google actually wrote.

## 7. Testing it end to end

Once §3 and §4 are done and the flag is on:

1. Settings → Connected apps → **Your schedule** → Connect → the Philoi consent modal →
   **CONTINUE** → Google's **account chooser** → consent.
2. Row shows **Connected · <the account you picked>**, with **Switch account** and **Disconnect**
   underneath.
2b. **The independence check — this is the one worth doing deliberately.** Pick a Google account
   that is NOT your Philoi login. The row must show that address, and the coach must read that
   calendar. If the chooser doesn't appear at all, the flow has regressed to the old
   `addScopes()` behaviour.
3. `select user_id, google_email, scopes, length(refresh_token_encrypted) from
   google_calendar_connections;` — the token column must be unreadable ciphertext starting `v1.`.
4. Call the window (as yourself, from the app's session, or with the service role key):
   ```bash
   curl -s -X POST "$SUPABASE_URL/functions/v1/gcal-window" \
     -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
     -d '{"userId":"<uuid>","includePrompt":true}' | jq
   ```
   Check `events` carries your real titles, `timeZone` is yours, and `prompt` reads sensibly.
5. **Busy check:** put an event on your calendar covering now, re-run with `"force":true`,
   confirm `busyNow: true` and `freeAt` is that event's end.
6. **Cache check:** run it twice — the second returns `cached: true` and doesn't hit Google.
7. **Revocation check:** remove Philoi at myaccount.google.com → third-party access, then run with
   `"force":true` → `connected: false, reason: "revoked"`, and the row is gone.
8. Disconnect in-app → the Philoi confirm → row gone, cache gone, and Philoi no longer listed
   under myaccount.google.com → third-party access. **Check Google's side, not just the row** —
   "revokes at Google" is a promise printed on the consent modal.
9. **Cancel paths, which must be silent:** back out of the account chooser; and press Cancel on
   Google's consent screen. Both return to Connected apps with no error dialog.
10. **Android specifically:** confirm the redirect does not land on "Unmatched Route". That is
   the expo-router race described in §2 — it is the failure mode this flow is shaped around, and
   it does not reproduce on iOS.

---

## 8. Not built (deliberately out of scope)

- **Deadline-aware challenges / suggested lock-in windows** — the spec marks these
  "(Optional, later)". The data is all in `CalendarWindow` when someone wants them.
- **Past-events window.** Only forward-looking. If "you're behind" wants *"you had three free
  hours yesterday and did nothing"*, that needs a `from` in the past — supported by the signature
  already (`from` is a free parameter), just never exercised.
- **Non-Google calendars** (Apple, Outlook). Different integrations entirely.

---

## 9. Verification state

**Committed** on `integration-wave1`. Migration `0105` was already applied to prod and the ledger
reads `local == remote`; **this build added no migration** — the 0105 schema already covers the
grant, the cache and the two owner-scoped RPCs, so inventing a second table would have been
duplication. Prod held **zero** rows in `google_calendar_connections` at the time of the scope
change, so nothing needed migrating off `calendar.readonly`.

### What was and wasn't verified

- ✅ **App half** — `npx tsc --noEmit` clean; `npx expo lint` reports nothing in any touched file.
  (`tsconfig.json` excludes `supabase/functions`, so the Deno code never enters that run.)
- ✅ **`deno check`** on `gcal-oauth-exchange`, `gcal-oauth-callback`, `gcal-disconnect`,
  `gcal-window` and `_shared/coach/gcal.ts` — all clean. These were **never compiled** before this
  pass; the previous handoff listed them as reviewed-but-unrun.
- ✅ **`deno test --allow-env supabase/functions/_shared/gcal.test.ts`** — 9 steps, all passing,
  rewritten for the primary-only fetch path. The `calendarList` stub now returns Google's real
  **403** and a counter asserts it is called **zero** times, so a reintroduced enumeration fails
  loudly in the suite instead of silently costing members their window in prod.
- ❌ **`ai-coach` / `ai-coach-voice` full `deno check`** — blocked offline: `npm:@anthropic-ai/sdk`
  is not in `node_modules` and could not be cached. The changed seam (5 lines in
  `_shared/coach/index.ts`) is typed by `_shared/coach/gcal.ts`, which does check clean.
- ❌ **Anything touching real Google** — no OAuth round trip, no real event fetch, no real
  revocation, no account-chooser run. Blocked on §4, and §7 is the script for it.

### The bug this pass found

`_shared/coach/gcal.ts` was a **second, rival implementation** of the integration, and it was
broken. It selected `access_token, refresh_token, expires_at` from `google_calendar_connections`
— columns that have never existed; 0105 stores `refresh_token_encrypted` and deliberately stores
no access token. Every call errored, the `catch` turned that into `null`, and the coach was
**permanently calendar-blind while logging nothing and failing nothing**. A member could connect,
see "Connected", and never once be coached on a real deadline. It now delegates to `../gcal.ts`,
and there is one implementation.
