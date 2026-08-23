# Handoff — Cindy, the AI coach

Built on branch `worktree-cindy`. Source of truth: `CINDY_SPEC.md`, mocks 115 + 116,
`APP_BLOCKER_SPEC.md` §C/§C2/§C-safety, `GCAL_INTEGRATION_SPEC.md`.

---

## For the Focus Nudge build — read this first

**The shared coach service exists. Do not stand up a second one.**

`supabase/functions/_shared/coach/` is the "context assembly + Sonnet call + safety system-prompt"
service the coordination note asked for. The intercept is already a first-class surface in it.

```ts
import { runCoach, stripIntent } from '../_shared/coach/index.ts';

const result = await runCoach({
  surface: 'intercept',          // 'chat' | 'home' | 'intercept' | 'reengagement'
  userId, userClient, admin,
  situation: { opened_app: 'social', retreats_today: 3 },  // anything the DB can't know
});
// result.intent → 'reinforce' | 'wellbeing' | 'support'
// stripIntent(result.text) → the message to render
```

Or over HTTP, no import needed:

```
POST /functions/v1/ai-coach   { "op": "intercept", "situation": {...} }
POST /functions/v1/ai-coach   { "op": "reengagement" }
```

Notes for your build:

- **Latency.** `ShieldConfiguration` renders synchronously and cannot await this. Call it at
  **lock-in start**, cache `message` to the shared app-group container, and have the extension read
  the cached string. There is a static fallback path on your side to write.
- **Re-engagement can decline to fire.** `{ "op": "reengagement" }` returns `{ skip: true }` when the
  model judges the user is overworked or it's a bad moment (§C2). Honour it — don't fire anyway.
- **The safety prompt is already shared.** §C-safety is in the coach's system-prompt core, above the
  routing split, so it applies to your surface without you re-encoding it.
- **The support surface exists**: `/support` (mock 116 frame 3). Link the wellbeing/safety nudge to it.
- **Usage metering** is shared. Your intercept calls count against the same `coach_usage.text_calls`
  daily cap. That's deliberate — one user, one budget.

## For the GCal build

`supabase/functions/_shared/coach/gcal.ts` already fetches and injects the calendar window at
message time. You own the other half:

- A `google_calendar_connections` table with `user_id, access_token, refresh_token, expires_at`
  (that's the exact shape `accessTokenFor()` reads).
- The read-only OAuth flow + the Connected Apps card + revoke.
- Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` as project secrets for the refresh path.

Until then the coach is calendar-blind and fully functional — the module returns `null` on a missing
table, missing row, dead token, or a Google outage, and the prompt omits the calendar block. **No
change to the coach is needed when you land**; it starts working the moment rows exist.

---

## Deploy

```bash
supabase secrets set ANTHROPIC_API_KEY=...
supabase db push                       # migration 0101
supabase functions deploy ai-coach
supabase functions deploy ai-coach-voice
```

Voice is **dark** until these are also set — the mic does not render without them:

```bash
supabase secrets set ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=...
```

🔴 **`expo-speech-recognition` is a new native dependency** → voice needs an `eas build`, it will not
appear in an existing dev client. **Cindy's text chat has no native dependency and runs on the
current build.** Android only for testing (Noah has no iPhone).

⚠️ The package's latest release is `56.0.1` (tracks SDK 56); this project is on SDK 57. It declares
`expo: "*"` so it installs, but it has not been published for 57 — **verify it builds before relying
on voice.** Text is unaffected either way.

---

## The two firewalls (please don't undo these)

**1. Cindy never executes an action.** The model *proposes*; `src/lib/api/coach.ts`
`performCoachAction()` performs, on the device, through the same functions the UI calls, under the
user's own JWT. So every RLS policy and economy rule applies to her identically to a tap, and a
milestone she posts pays zero XP because it is the same `createMilestone`.

There is deliberately **no** security-definer "coach acts" RPC. Adding a server-side executor would
hand an LLM write access to the economy in one commit. `coach_bump_usage` is the only service-role
function and it only counts.

**2. Own data only.** `get_coach_context()` takes no user parameter and is `auth.uid()`-scoped, so it
cannot be asked for anyone else's rows — even called with a wrong id, it returns the JWT owner's.

**Tone routing is structural too.** Each surface gets its own routing block appended to a shared
core, and the *home* block contains no pushback instructions at all. The warden voice isn't
discouraged on home — it's absent from the prompt home runs with.

---

## What's built

| Area | Where |
|---|---|
| Migration (tables, `get_coach_context`, metering) | `supabase/migrations/0101_ai_coach.sql` |
| Shared coach service | `supabase/functions/_shared/coach/{index,prompt,tools,gcal}.ts` |
| HTTP entry (chat, bubble, consent, intercept, re-engagement) | `supabase/functions/ai-coach/index.ts` |
| Voice (TTS-only) | `supabase/functions/ai-coach-voice/index.ts` |
| Client API + action execution | `src/lib/api/coach.ts` |
| Chat screen | `src/app/cindy.tsx` |
| Voice screen | `src/app/cindy-voice.tsx` |
| Support surface | `src/app/support.tsx` |
| Home bubble + tappable flame | `src/components/cindy/`, `src/app/(tabs)/index.tsx` |
| Settings | `src/app/settings.tsx` |

**Voice pipeline** is the cheap one the spec mandates: on-device STT (free, platform recognizer, no
audio leaves the phone) → Sonnet → ElevenLabs TTS for her reply only. `continuous: false` means the
recognizer ends on a natural pause — that's the auto-send. Metered in **TTS characters**, because
synthesis is the only paid step. Over budget, she still answers — just silently.

---

## Deliberate deviations from the mocks

- **Milestones confirm before posting.** Mock 115 frame 5 shows it posting immediately. A milestone
  lands in other people's feeds, and the mock was drawn for a typed request, not a possibly-misheard
  voice turn. The confirm is an **inline chip**, not a modal, so it keeps the mock's feel.
- **No buy/spend tool.** "Spending embers → confirm" is listed in the spec as a category, but a
  purchase decision belongs in the shop. Cindy can't spend; she points.

## Open / not built

- **Discipline relics** (`Hercules' Might = 100k lb lifted`, the spec's own example) don't exist yet —
  that's `CODE_PROMPT_discipline_relics.md`. The unlock-conditions block in `prompt.ts` is
  transcribed from `economy_evaluate_relics()` (the SQL that actually grants), so it covers the five
  relics that ship today. Add the discipline relics to that block when they land.
- **Premium "Call Cindy"** real-time mode — spec says confirm if/when. Not built; the free STT path is
  what ships.
- The proactive home bubble is fetched on app use. It is **not** a push — that's the re-engagement
  surface, which the Focus Nudge build schedules.
