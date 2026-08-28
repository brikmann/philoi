# Cindy dev build — did the pass run correctly? (on-device checklist)

Build: `eas build --profile development -p android` off `add-marketing-site`, then `npx expo start --dev-client`.
**Delete the old app first** (icon cache + it predated the Cindy merge).

## 0. Build gate (the risk that could fail the whole thing)
- [ ] Build went **green**. If it failed, check whether it was **`expo-speech-recognition`** on SDK 57 — that's
      the known voice risk. If so: ship text + everything else now, swap the STT lib next build. Don't let voice
      block the pass.
- [ ] App installs and `--dev-client` connects; app boots to home with no crash.

## 1. Native assets (baked at build time — this is the only build that proves them)
- [ ] **App icon** = the new mirrored flame (not the old one).
- [ ] **Splash** = the flame.
- [ ] **Hearth Hum** — equip/preview the base ambient audio → it **plays** (was silent before).
- [ ] **Emberfall Strike** — preview the Forge Pass tier-50 SFX → plays (implosion → boom → crackle).

## 2. Cindy entry points (quick — do these first)
- [ ] **Home flame → tap → chat** → send a message → **real reply**. (This is the #1 check — proves the live
      backend / `ANTHROPIC_API_KEY` round-trip.)
- [ ] **Home flame → hold → voice** → talk → it transcribes → Cindy replies **out loud** (TTS). If it no-ops,
      note it; text still passing = acceptable.
- [ ] **Header flame** (top-right) on Boards / Challenges / Profile → tap → Cindy opens.
- [ ] **Home proactive bubble** shows a data-aware line **above** the flame, **no** red dot.

## 3. Cindy mid-session (the new wiring)
- [ ] Start a lock-in → **tap the session flame** → quick-sheet slides up over the camera/Stop row.
- [ ] Each row lands in chat with the right prefill: *How am I doing?* / *Add a note* / *Open full chat*.
- [ ] **Gym**: the small header flame opens the sheet; line renders under the gym header.
- [ ] Cindy **consent OFF** → no bubble, no sheet fetch (flame still taps to chat per the home rule).
- [ ] Milestone line (30/60/90 min): hard to wait for live — either sit a session to 30 min, **or** temporarily
      lower the threshold in `use-cindy-lockin-line.ts` for one smoke test, confirm the bubble fires once above
      the flame + auto-dismisses, then revert.

## 4. Scenario checks (need a setup or a wait — do if time)
- [ ] **GCal** (only if `GOOGLE_CALENDAR_ENABLED` is on + you're a Google test user): Settings → Connected apps
      → Connect Google Calendar → consent → Cindy references a real deadline.
- [ ] **Reward reveal**: settle a challenge (or one that's already settled) → the reveal fires **once**, then
      standings on re-open. (Needs `0118` live — it is.)
- [ ] **Gym lock-in** starts without the old purple-splash freeze.

## Fast-refresh note
JS (Cindy UI, quick-sheet routing, milestone logic) hot-reloads over Metro — iterate freely. **Icons, audio, and
the voice module do NOT** — any change there needs a fresh dev build.

## If something's off
- Text chat fails → backend/key issue, not the build. Hit `ai-coach` with a test payload; expect 200.
- Flame taps do nothing → you're on an old install; delete + reinstall.
- Voice silent but text works → STT lib on SDK 57; ship text, swap lib next build.
