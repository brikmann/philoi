# Code Prompt — diagnose why push STILL doesn't fire (token + send path)

The client gate fix (`registerPushToken` no longer gated on `hasCircle`) is already on the branch Noah's Pixel runs, so the code is on-device — yet no push arrives. So this is **not** the gate and **not** deploy lag; it's a token or send-path gap. The reward-loop pass already found **6 of 10 profiles have no `push_token` row** (declined permission, or a build that never registered). The likeliest truth: Noah's account has no token, and no code change conjures one. **Diagnose in order and STOP at the first thing that's wrong — don't fix speculatively.**

This needs a prod query and the physical device, so Noah is in the loop. Bundle nothing else; report findings before changing anything.

## Step 1 — Does Noah have a token?
`select user_id, token, created_at from push_tokens where user_id = '<Noah>';`
- **No row** → the token never registered. Go to Step 2.
- **Row present** → skip to Step 3 (send path).

## Step 1.5 — 🔴 Android FCM credentials (prime suspect now that permission is confirmed granted)
Permission is granted on the Pixel, which clears the usual cause — so check the **Android-specific** one next. **Android push delivery requires FCM credentials configured on the Expo/EAS project** (an FCM V1 service-account key uploaded via `eas credentials` → Android → push, and `google-services.json` in the build). iOS works off APNs with almost no setup; **Android does not** — without FCM, a token can register and permission can be granted and **every push still silently fails to deliver** (Expo's push service returns an FCM error ticket, nothing reaches the device). This exactly matches "token + permission fine, no banner."
- **Already confirmed from the repo:** `google-services.json` is present and wired (`app.config.ts:83 googleServicesFile`). That's the **client** half — necessary, not sufficient.
- **The thing to actually check:** the **server-side FCM V1 service-account key uploaded to the Expo/EAS project** — this is what Expo's push service uses to deliver to Android, and it lives in `eas credentials` (Android → push key / FCM V1), **not** in the repo. Run `eas credentials` (or the Expo dashboard → project → credentials → Android) and confirm an **FCM V1 key is present**. If it's missing, Android push silently fails for every user despite a valid token and granted permission — that would be the whole bug, and the fix is uploading the FCM V1 key (a config task, not code).
- Report this before digging further — it's the highest-probability cause now that permission and `google-services.json` are both confirmed.

## Step 2 — Why didn't the token register? (device + client)
`registerPushToken` runs on app-ready (post handle/consent) and: requests OS permission → `ensureNotificationChannels()` → `getExpoPushTokenAsync({ projectId })` → upsert `push_tokens`. Any of these silently returns/throws:
- **Permission:** is notifications permission actually **granted** for Philoi in Android Settings? If it was ever declined, `requestNotificationPermissions()` returns false and registration no-ops. Have Noah grant it, then relaunch.
- **Build type:** `getExpoPushTokenAsync` needs a **dev-client / real build with the push module** and a valid `projectId` (`f1031c6d-…` is set). It does **not** work in Expo Go. Confirm the Pixel is on a dev/preview build, not Expo Go.
- **Silent failure:** `registerPushToken` swallows errors in a try/catch (`console.warn` only). Add a temporary explicit log (or a dev-tools "register push" button) and watch: does it reach `getExpoPushTokenAsync`, does it return a token, does the `push_tokens` upsert succeed? Report which line it dies at.
- After a successful register, re-run Step 1 — a row should now exist.

## Step 3 — Token exists but no banner: the send path
`notify_event → notify_push_raw → net.http_post('https://exp.host/--/api/v2/push/send')`. Walk it:
- **Manually fire one:** `select notify_event(array['<Noah>']::uuid[], 'session_complete', 'Test', 'Test push', null, null, null, '{}'::jsonb, null, null, '{}'::jsonb);` and check (a) a `notification_events` row was written (in-app feed), and (b) whether `net.http_post` actually ran.
- **`pg_net` enabled?** `net.http_post` no-ops/errors if the `pg_net` extension isn't active. Confirm it is, and check `net._http_response` / the pg_net response table for the Expo reply.
- **Expo's response:** a `DeviceNotRegistered` / `InvalidCredentials` ticket means the stored token is **stale** (from a prior build/reinstall) — delete that `push_tokens` row and re-register (Step 2). This is the classic "token exists but is dead."
- **Prefs gate:** `notify_push_raw` filters on `notification_prefs` — `master`, `cat_<category>`, `type_<type>`, and quiet hours. Check Noah's `profiles.notification_prefs` isn't suppressing (a stray false, or quiet-hours covering now).
- **Android channel:** the push carries `channelId: 'accountability'`; if that channel is blocked in system settings, the OS drops the banner silently. Confirm the channel exists and is enabled.
- **Self-actor:** self-targeted events exclude `p_actor_id` — already audited that `session_complete`/`reward_ready`/`ranked_up` pass `p_actor_id => null`, so this shouldn't bite, but confirm the event Noah's triggering does too.

## Report (don't fix blind)
State exactly where it breaks: no token / permission denied / register throws at line X / token stale (DeviceNotRegistered) / pg_net off / prefs suppressing / channel blocked. The fix follows from which one — a one-line client change, a settings toggle, a stale-token cleanup, or an extension enable are very different fixes, and guessing wastes another round.

## Done =
A single clear finding for Noah's account — the exact failing step — plus the specific fix for that step (and, once applied, a real device banner from a triggered event).
