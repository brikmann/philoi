# Handoff — Google Calendar integration (read-only, feeds the AI coach)

Built against `GCAL_INTEGRATION_SPEC.md`. Consumed by `APP_BLOCKER_SPEC §C/§C2` (Focus Nudge +
re-engagement) and `CINDY_SPEC.md §3` (data mastermind).

**Status:** code complete, **not deployable yet** — it needs the Google-side setup in §4 and the
Supabase secrets in §3. The feature flag ships `false` until then. Nothing here is committed:
another Claude session held the git writer lease for the whole build (see §9).

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
    calendar: string;             // source calendar name — often the course tie
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
| `gcal-oauth-exchange` | `serverAuthCode` → refresh token. The only place the Google client secret is used. |
| `gcal-disconnect` | **Revokes at Google**, then deletes locally. Deletes either way. |
| `gcal-window` | HTTP surface of the contract, for a coach that can't import the module. |

**App**
| File | What changed |
|---|---|
| `src/lib/google-calendar.ts` | new — drives the native Google consent sheet, hands the code to the server |
| `src/hooks/use-google-calendar-connection.ts` | new — same shape as `use-whoop-connection` |
| `src/app/connected-apps.tsx` | new "Your schedule" group + consent alert before Google's sheet |
| `src/lib/auth/providers.ts` | `configureGoogleSignin()` extracted — `GoogleSignin.configure()` is process-global, so it now lives in exactly one place |
| `src/constants/feature-flags.ts` | `GOOGLE_CALENDAR_ENABLED` (false — see §4) |
| `src/types/database.ts` | the two new RPCs |

### Two decisions worth knowing about

**It reuses the native Google sign-in sheet, not a browser redirect.** Strava and Whoop ride
`expo-auth-session` through a system browser; this doesn't. The Google Sign-In SDK is already in
the binary, so the spec's "reuse the app's existing Google sign-in consent flow where possible"
is literal here: `addScopes()` widens the session a member already has (falling back to a full
`signIn()` for email/password members), Google mints a `serverAuthCode` via `offlineAccess`, and
that one-time code is all the app ever touches. **No new native module, no EAS rebuild.**

**The refresh token is encrypted; the fitness tokens aren't.** A calendar grant reads every
commitment in someone's life, so a database dump alone must not yield a usable token. The key
lives in `GCAL_TOKEN_ENC_KEY` (an Edge Function secret) — Postgres never sees it, which is the
whole point and is why this isn't pgcrypto. Access tokens are minted per fetch and never stored.

---

## 3. Supabase secrets

```bash
supabase secrets set \
  GOOGLE_WEB_CLIENT_ID="921536564136-….apps.googleusercontent.com" \
  GOOGLE_WEB_CLIENT_SECRET="…" \
  GCAL_TOKEN_ENC_KEY="$(openssl rand -base64 32)"
```

- `GOOGLE_WEB_CLIENT_ID` / `GOOGLE_WEB_CLIENT_SECRET` are the **Web** OAuth client's — the same
  pair already in Supabase Auth → Providers → Google (`GOOGLE_SIGNIN_SETUP.md`). Not the Android
  or iOS client: a `serverAuthCode` from the native SDK is minted **for the web client**.
- `GCAL_TOKEN_ENC_KEY` must be 32 bytes of base64. **Losing or rotating it invalidates every
  stored refresh token** — members would have to reconnect. Back it up wherever the other project
  secrets live.

Then:

```bash
supabase db push
supabase functions deploy gcal-oauth-exchange gcal-disconnect gcal-window
```

All three keep the default `verify_jwt = true` — no `config.toml` change.

---

## 4. Google-side setup — THE ACTUAL BLOCKER

Everything happens in Google Cloud project **921536564136** (`GOOGLE_SIGNIN_SETUP.md`), the one
sign-in already uses. No new project, no new OAuth client.

1. **APIs & Services → Library → enable the Google Calendar API.**
2. **OAuth consent screen → Scopes → add `https://www.googleapis.com/auth/calendar.readonly`.**
   Do **not** add `calendar.events.readonly` as well — `calendar.readonly` covers it, and asking
   for two overlapping scopes just makes the consent sheet longer.
3. **Submit for verification.** `calendar.readonly` is a **sensitive** scope. Until Google
   verifies it, only accounts on the consent screen's **test users** list can grant it — everyone
   else hits the unverified-app warning. Verification is measured in days. Google asks for a
   justification and usually a demo video; the honest answer is the one in the spec: *read-only,
   so an AI study coach can reason about the student's own deadlines and free time, shown only to
   them, never stored or shared.*
4. While waiting, add your own account as a test user and flip the flag locally to test end to end.
5. **Then flip `GOOGLE_CALENDAR_ENABLED` to `true`** in `src/constants/feature-flags.ts`. One line,
   no rebuild — the SDK is already in the binary.

---

## 5. Privacy properties, so a reviewer can check them fast

| Spec requirement | How it's enforced |
|---|---|
| Read-only | Only `calendar.readonly` is ever requested; the exchange **verifies Google's own granted `scope`** before storing anything and refuses otherwise |
| Opt-in | Feature flag + a consent alert spelling out the trade **before** Google's sheet opens |
| Encrypted, server-side only | AES-256-GCM, key in an Edge Function secret; the app has no code path that could receive a token |
| Don't warehouse | No events table. `fields=` masks on the Google calls mean descriptions, locations, attendee identities, conferencing links and event ids are never even fetched. 10-minute cache, swept |
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

1. Settings → Connected apps → **Your schedule** → Connect → consent alert → Google sheet.
2. Row shows **Connected** with the Google account email.
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
8. Disconnect in-app → row gone, cache gone, and Philoi no longer listed in your Google account.

---

## 8. Not built (deliberately out of scope)

- **Deadline-aware challenges / suggested lock-in windows** — the spec marks these
  "(Optional, later)". The data is all in `CalendarWindow` when someone wants them.
- **Past-events window.** Only forward-looking. If "you're behind" wants *"you had three free
  hours yesterday and did nothing"*, that needs a `from` in the past — supported by the signature
  already (`from` is a free parameter), just never exercised.
- **Non-Google calendars** (Apple, Outlook). Different integrations entirely.

---

## 9. Git state

Nothing was committed. `.git/claude-writer.lease` was held by another session (`dfe4cd94`) for the
duration, and per `AGENTS.md` the lease is not to be cleared without asking. The working tree
carries all the changes above; whoever owns the repo next should commit them — ideally on their
own branch, since this build is independent of the campfire / challenge work in flight.

### What was and wasn't verified

Neither Deno nor the Supabase CLI is installed on this machine, so:

- ✅ **App half** — `npx tsc --noEmit` clean; `npx expo lint` reports nothing in any touched file.
  (`tsconfig.json` excludes `supabase/functions`, so the Deno code never enters that run.)
- ✅ **`_shared/gcal.ts` + `_shared/token-crypto.ts`** — compiled under `tsc --strict` and the
  §6 suite run against the compiled output with Google and Supabase stubbed. All of it passes.
  That is how both bugs in §6 were found.
- ❌ **The three function `index.ts` files** (`gcal-oauth-exchange`, `gcal-disconnect`,
  `gcal-window`) — reviewed but never compiled or executed.
- ❌ **Anything touching real Google** — no OAuth round trip, no real event fetch, no real
  revocation. Blocked on §4.

Worth running wherever Deno lives:

```bash
deno check supabase/functions/**/*.ts
deno test --allow-env supabase/functions/_shared/gcal.test.ts
```
