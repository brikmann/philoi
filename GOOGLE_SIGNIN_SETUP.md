# Philoi — Native Google Sign-In setup

Native Google Sign-In (`@react-native-google-signin/google-signin`) → idToken → `supabase.auth.signInWithIdToken()`. Replaces the Supabase-hosted OAuth page with the native account picker; Supabase stays the backend. (Punchlist 2 §0.)

> **Project ownership:** the Google Cloud project is owned by the **personal gmail** (Workspace account `nb@philoi.app` can't create GCP projects). This is invisible to users — the **OAuth consent screen is branded "Philoi"** (support email can be `nb@philoi.app`). No professionalism cost.

## Constants
- **Google Cloud project number:** `921536564136`
- **App package / bundle ID:** `com.philoi.app`
- **Supabase project ref:** `coaqgcquzywadrghzbfj`
- **Supabase OAuth callback URL:** `https://coaqgcquzywadrghzbfj.supabase.co/auth/v1/callback`

## The three OAuth clients (all under the one project, `921536564136-…` prefix)
| Client | Type | Where it's used | Value |
|---|---|---|---|
| **Web** | Web application | `webClientId` in code · Supabase Client ID + secret · Supabase Authorized Client IDs | `921536564136-______.apps.googleusercontent.com` **[FILL]** (+ secret) |
| **iOS** | iOS | `iosClientId` in code · reversed-ID URL scheme · Supabase Authorized Client IDs | `921536564136-______.apps.googleusercontent.com` **[FILL]** |
| **Android** | Android | **NOT referenced in code** — Google matches by package + SHA-1 | `921536564136-5bma1u1ch760hp8jqhiadbho5h8fdnsf.apps.googleusercontent.com` |

**Key gotcha:** the **Web** client ID is the one passed to `GoogleSignin.configure({ webClientId })` — even on Android. Using the Android client ID there → `DEVELOPER_ERROR`.

## Android signing (SHA fingerprints)
From the EAS **development** keystore (`eas credentials` → Android → development):
- **SHA-1:** `B4:B7:A9:04:8A:4F:41:9F:24:D1:AE:4D:5D:F2:B1:82:DE:CC:0F:12` ← registered on the Android OAuth client
- **SHA-256:** `62:82:20:3E:62:F4:A7:CB:0B:9B:80:A4:2D:F4:AB:C2:4E:77:24:0E:2A:E0:6C:2F:BF:8A:5B:27:50:D8:EA:EB`
- ⚠️ **TODO when shipping to Play Store:** Google Play App Signing re-signs with a *different* key → grab the **Play App Signing SHA-1** (Play Console → App integrity) and add it as a second fingerprint / second Android OAuth client, or production sign-in breaks with `DEVELOPER_ERROR`.

## Code wiring (`app.config.ts` + sign-in call)
- Plugin: `@react-native-google-signin/google-signin` in `plugins` (done), with `iosUrlScheme` = the iOS client's **reversed** client ID (`com.googleusercontent.apps.921536564136-…`).
- `GoogleSignin.configure({ webClientId: <WEB>, iosClientId: <IOS> })`.
- Flow: native sign-in → get `idToken` → `supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })`.
- Native module → requires a fresh dev build (not Metro/OTA).

## Supabase wiring (Dashboard → Authentication → Providers → Google)
1. Enable **Sign in with Google**.
2. **Client ID (for OAuth):** the **Web** client ID.
3. **Client Secret (for OAuth):** the **Web** client secret.
4. **Authorized Client IDs:** comma-separated `<WEB_CLIENT_ID>,<IOS_CLIENT_ID>` (Android's token audience = the Web ID, so it's covered). This is what lets `signInWithIdToken` accept the token's audience.
5. Leave **Skip nonce check** OFF for Google.
6. Copy the callback URL (above) → add to the **Web** OAuth client's **Authorized redirect URIs** in Google Cloud.

## Troubleshooting
- **`DEVELOPER_ERROR` (Android):** SHA-1 / package mismatch, or the Android client ID was used as `webClientId`. Confirm SHA-1 matches the build's keystore + `webClientId` is the **Web** ID.
- **Audience rejected by Supabase:** the Web/iOS client IDs aren't in Supabase's **Authorized Client IDs** list.
- **Nothing native happens:** the app wasn't rebuilt with the native module — Metro/OTA can't add it.

## Pre-rebuild checklist
- [ ] Web + iOS OAuth clients created; IDs filled into this doc + code + Supabase
- [ ] Supabase Google provider enabled, secret + Authorized Client IDs saved, callback URL added to Google Cloud
- [ ] `webClientId`/`iosClientId` in `GoogleSignin.configure`; `iosUrlScheme` set
- [ ] Everything committed (EAS builds from git)
- [ ] `eas build --profile development --platform android` → test native picker + Health Connect
