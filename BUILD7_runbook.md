# RUNBOOK — Build 7 (the production iOS build → App Store). Cut from integration-wave1.

Build 7 is the real submission build. It carries everything committed since build 6: the dyld-crash fix (via
`--clear-cache`), the Apple gate (SIWA, token revocation, report/block, account-deletion FK, health purpose string),
the Integrations rework, AND the whole Emberfall / Flame Pass funnel + burning name. Native (new font + native
modules), so **no OTA** — it must be a fresh binary.

Project ref `coaqgcquzywadrghzbfj` · branch `integration-wave1` · distribution cert `9SMMWAJKTQ` (reuse for all 6 targets).

## A · Pre-build gates — ALL true before you cut
1. **0220 applied + branch pushed** (`APPLY_0220_and_push.md`). Build from the pushed HEAD so the burning names resolve for everyone.
2. **HEAD is integration-wave1** with all six funnel commits + the Apple-gate commits (`git log --oneline -12` to eyeball).
3. **Server-side deployed:** `apple-revoke` edge function is deployed with the real Apple key (you re-set it after the
   empty-key run). `0220` live. The `0220` winner_id set-null / bucket-purge cleanup (S1/S2) can follow.
4. **Apple dashboards done (B1):** Sign in with Apple **capability on the App ID** + the **Apple provider in Supabase
   Auth** (Client IDs `com.philoi.app`, enabled). Without both, the Apple button errors in review.
5. `npm run typecheck` green (includes `check:cosmetic-rarity`). Lint's 3 pre-existing errors on unchanged lines are non-blocking.

## B · Cut the build (`--clear-cache` is mandatory — it's the dyld-crash fix)
```powershell
eas build --platform ios --profile production --clear-cache
```
- `--clear-cache` forces a fresh Pods/prebuild — the fix for build 6's `dyld: symbol not found` launch crash.
- At the credential prompts, **reuse `9SMMWAJKTQ`** for the app + all 5 extensions. Do NOT generate new certs (you're at
  Apple's 2-cert cap).

## C · Validate on device BEFORE submitting (build 6 dyld-crashed — prove this one launches)
`eas submit --platform ios --latest` → TestFlight → Internal Testing → install. Then, in order:
1. **It launches.** The whole point of `--clear-cache`. If it *still* dyld-crashes, don't submit — pull the crash
   `.ips` (3uTools/iMazing) and send me the `Termination Reason: DYLD … Referenced from:` line; that names the culprit.
2. **Crashes:** #42 gym → purple freeze, #74 ×10 vault crash. Fix if they repro.
3. **IAP:** buy the Flame Pass + Restore (TestFlight = free sandbox). Confirm the **purchase-success** reveal plays and
   the "LANDING…" stamp clears when the entitlement lands.
4. **Sign in with Apple:** fresh Apple signup → setup-handle (consent) → **delete account** → confirms success AND
   Philoi drops out of Settings → Apple ID → Sign in with Apple (revocation working).
5. **Report/block** on an Agora post.
6. **Emberfall funnel:** paywall gallery renders from live data; shop banner → paywall; tutorial Flame Pass card;
   **burning name** shows on the leaderboard/Agora/campfire/profile (your own name at minimum).
7. **OTA proof:** push a no-op `eas update --branch production`, confirm it lands.

## D · Submit to App Store review
- Add the build for review with **"Manually release this version"** — approved-and-held, so you press go on Oct 1.
- Console (each can reject): product type = Non-Consumable/Non-Renewing (NOT auto-renew); App Privacy labels; Privacy +
  Support URLs live; honest age rating; UGC review note (report+block present, `moderation_reports`, consent gate at
  `setup-handle`); turn **off Mac (Apple silicon) availability** to silence the harmless ITMS-90863 warning.

## E · After upload (server-only, no rush)
- S1/S2 deletion cleanup (winner_id set-null already in 0220? confirm; `avatars`/`campfire-photos`/R2 purge).
- SealBadge (`CODE_PROMPT_seal_badge.md`) as an OTA fast-follow once the font's in the shipped binary.

## Ship order
A (gates) → B (`eas build … --clear-cache`) → C (validate it LAUNCHES, then the matrix) → D (submit, manual release) → E (later).
