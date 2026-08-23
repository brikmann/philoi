# Ship Cindy + Voice + GCal — new native build

Goal: one `eas build` with **Cindy (text + voice)** and **Google Calendar enabled for test users**. Backend is
already live (ai-coach / ai-coach-voice deployed, all 5 secrets set, 0101 applied, brain key verified). This
build adds the native voice module, flips GCal on, and produces the demo video for verification in the same pass.

**Scope:** Cindy + voice + GCal ONLY. **Do NOT bundle Focus Nudge** (Screen Time extensions + entitlements are
a separate native build — keep them out of this one).

## 0. Branch prep (Windows checkout — CRLF)
- **Merge `worktree-cindy` → `add-marketing-site`** so the Cindy client is on the ship branch (last merge went
  the other way). Should be near-clean — `database.ts` already reconciled.
- **Confirm the GCal client is on the branch too** (the `connected-apps.tsx` "Your schedule" group + the OAuth
  connect flow — landed via commit `3e1cd96`). If it's not, merge it in.
- `npx tsc --noEmit` clean. (The 25 pre-existing React-Compiler lint errors are not blocking.)

## 1. Voice native dep
- Ensure **`expo-speech-recognition`** is installed (on-device STT).
  - ⚠ Latest release (56.0.1) isn't published for SDK 57 — **this build IS the verification.** If the build
    fails or STT no-ops on 57: fall back to `@react-native-voice/voice` (or `expo-av` capture → a cheap STT).
    **Don't let voice block the build** — worst case, ship text + GCal now, voice on the next build.
- **Native permissions** (config plugin / `app.json` → `infoPlist` / Android permissions):
  - iOS: `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`.
  - Android: `RECORD_AUDIO`.
- TTS = ElevenLabs (secrets set). The `voice_unavailable` guard already checks brain + TTS, so the mic hides
  if either key is missing.

## 2. Flags + test access
- Set **`GOOGLE_CALENDAR_ENABLED = true`** (only Google **test users** can actually grant until verification
  clears — that's fine for the build).
- Add your test account under **OAuth consent screen → Audience → Test users**.
- Confirm `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `GOOGLE_WEB_CLIENT_SECRET`,
  `GCAL_TOKEN_ENC_KEY` are all set (they are).

## 3. Build
New native module → runtimeVersion changes → **can't OTA, must build.**
- First an **internal build to test on-device + record the demo**:
  `eas build --profile preview -p ios` (and `-p android`).
- Once green, cut **`--profile production`** → TestFlight / Play internal for testers.

## 4. On-device test checklist
- [ ] **Cindy text chat** (signed in) → real reply (proves the full round-trip — the one thing still unverified).
- [ ] **Voice** → tap/hold-to-talk → STT transcribes → Sonnet → Cindy's **TTS reply plays**.
- [ ] **GCal connect** → Settings → Connected apps → Connect Google Calendar → Google consent (`calendar.readonly`)
      → granted → **Cindy references a real deadline**.
- [ ] **Disconnect** GCal works (token revoked, cache cleared).

## 5. Two birds — record the GCal demo video during Step 4
The connect flow + Cindy using a deadline IS the demo video Google requires. Screen-record it, upload
**Unlisted to YouTube**, then **Verification Center → paste the justification + video URL → Submit** (justification
text is ready in the earlier handoff).

## After
- Voice worked on 57? → great. Didn't? → ship text + GCal, swap the STT lib, rebuild for voice.
- Then: Focus Nudge → its own build; watch the first 0111 settlement cron tick; point Focus Nudge at
  `_shared/coach/`.
