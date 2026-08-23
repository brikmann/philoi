# Runbook — get Cindy live

Ordered top-to-bottom. **Keys + schema BEFORE the endpoints** — deploying functions first just shelves a
broken mic. Project ref: `coaqgcquzywadrghzbfj`. Do the git steps on the **Windows checkout** (CRLF-safe).

---

## Step 1 — Anthropic API key (the #1 blocker)
Without this, every coach/voice call 500s at the brain step (and the mic still shows).
1. **console.anthropic.com → Settings → API Keys → Create Key** ("Philoi coach"). Make sure the org has
   **billing / credits** enabled.
2. Set it as a Supabase secret:
   ```sh
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx --project-ref coaqgcquzywadrghzbfj
   ```
   (or Dashboard → Project Settings → **Edge Functions → Secrets** → add it)
3. Confirm: `npx supabase secrets list --project-ref coaqgcquzywadrghzbfj` shows `ANTHROPIC_API_KEY`.

## Step 2 — GCal secrets (set now while you're here; GCal stays flagged-off)
1. **`GCAL_TOKEN_ENC_KEY`** — a 32-byte AES-256-GCM key. Generate:
   ```sh
   openssl rand -base64 32
   ```
   (check `supabase/functions/_shared/token-crypto.ts` for base64 vs hex; use what it decodes.)
2. **`GOOGLE_WEB_CLIENT_SECRET`** — Google Cloud Console → **APIs & Services → Credentials →** your **Web**
   OAuth client → copy the client secret.
3. Set both:
   ```sh
   npx supabase secrets set GCAL_TOKEN_ENC_KEY=xxxx GOOGLE_WEB_CLIENT_SECRET=yyyy --project-ref coaqgcquzywadrghzbfj
   ```
   (`GOOGLE_CALENDAR_ENABLED` stays `false` until Google verification — see Step 7.)

## Step 3 — bring `worktree-cindy` current (so 0101 can push)
`worktree-cindy` branched at `c7612c5`, missing `0096`–`0099` + `0105` (already applied remotely). **Do NOT run
`migration repair --status reverted`** — it'd corrupt history. Merge the current branch in instead:
```sh
cd <the cindy worktree>
git fetch
git checkout worktree-cindy
git merge add-marketing-site       # pulls in 0096–0099, 0105, coach-adjacent changes
# resolve any conflicts (database.ts likely — additive union, keep both sides)
npx tsc --noEmit && <lint>          # must be clean before continuing
```

## Step 4 — push migration `0101`
```sh
npx supabase db push               # → Yes.  Applies 0101_ai_coach.sql
```
(Now that 0096–0099/0105 are present locally, `db push` won't refuse with LegacyDbPushMissingLocalError.)

## Step 5 — deploy the functions
```sh
npx supabase functions deploy ai-coach ai-coach-voice --project-ref coaqgcquzywadrghzbfj
```
(Run from the cindy worktree. This is the permission-gated command — approve it.)

## Step 6 — verify
- **Text chat** (no native dep — works on the current client): send Cindy a message, confirm a real reply
  (proves `ANTHROPIC_API_KEY` resolves — no 500 at the brain step).
- **Voice**: needs an **`eas build`** (expo-speech-recognition isn't published for SDK 57), so it verifies on
  the next dev-client build, not from Step 5. Text is the immediate green light.
- Quick endpoint check: hit `ai-coach` with a test payload; expect a 200, not a 500.

---

## Step 7 — follow-ups (not blocking the deploy)
- **Guard fix (Cindy agent):** add `ANTHROPIC_API_KEY` to the `voice_unavailable` check so a missing brain key
  *hides* the mic instead of showing a broken one.
- **Watch the first settlement cron tick** (B's 0111 settlement — hand-audited, not runtime-verified): confirm
  XP awards land and group challenges settle against the **invited subset**, not the whole campfire.
- **Google OAuth verification:** submit for the `calendar.readonly` sensitive scope now (long pole). Flip
  `GOOGLE_CALENDAR_ENABLED = true` (one line, no rebuild) once verified.
- **Focus Nudge** should consume `_shared/coach/` — not build a second brain (signature in `CODE_HANDOFF_cindy.md`).
- **Next challenge-v2 slices** (server side ready): member ticker · custom time + calendar · AI custom goal ·
  results/reward screen · watch share cards.
- Eventually merge `worktree-cindy` → `add-marketing-site` once stable.
