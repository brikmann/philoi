# Philoi 🔥

**Strava for all your goals — with the friends who won't let you flake.**
"Lock in — together."

Philoi is built with Expo (managed workflow) + TypeScript + expo-router, and Supabase for
auth, Postgres, and Storage. It's designed to run in **Expo Go on Android** with no native
build required.

## 1. Install

```bash
npm install
```

## 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In **Authentication → Providers**, enable **Google** and follow Supabase's Google OAuth
   setup (create an OAuth client in Google Cloud Console, add the Supabase callback URL).
3. In **Authentication → URL Configuration**, add `philoi://` to the redirect allow list
   (and `https://getphiloi.com/*` once the universal-link domain is live).
4. Open the **SQL Editor** and run the whole of [`supabase/schema.sql`](./supabase/schema.sql)
   once. It creates every table, RLS policy, the `check-in-photos` Storage bucket, its
   policies, and the leaderboard/streak/recap RPCs. Safe to re-run.
5. Copy your **Project URL** and **anon/public key** from Project Settings → API.

## 3. Configure environment variables

```bash
cp .env.example .env
```

| Variable | Where to get it | Required |
|---|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API | ✅ |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API (anon/public key — **never** the service_role key) | ✅ |
| `REVENUECAT_IOS_KEY` | RevenueCat dashboard, once billing is wired up (see [`src/lib/billing.ts`](./src/lib/billing.ts)) | — |
| `REVENUECAT_ANDROID_KEY` | RevenueCat dashboard, once billing is wired up | — |

`app.config.ts` reads these via `process.env` and exposes only the Supabase URL and anon key
to the client through `extra` → `Constants.expoConfig.extra`. The service_role key is never
referenced anywhere in this app.

## 4. Run it

```bash
npx expo start
```

Scan the QR code with **Expo Go** on Android (or press `a` with an emulator running). No
`expo prebuild` / dev client needed for v1 — every native module used (camera/picker,
notifications, secure store, haptics) is Expo Go-compatible.

## What's in here

```
app.config.ts                      — app config, scheme (philoi://), env → extra, plugins
.env.example                       — env var template
supabase/schema.sql                — tables, RLS, storage bucket + policies, RPCs, streak trigger

src/constants/theme.ts             — Philoi brand tokens (color, type, spacing, radius)
src/components/flame-icon.tsx      — the campfire flame, inline SVG
src/components/logo.tsx            — "Phil"+"oi" two-tone wordmark
src/components/ui/*                — PrimaryButton, SecondaryButton, Card, TextInput, Chip, Screen, EmptyState
src/components/group-card.tsx      — Home screen "Lock in" card
src/components/feed-item.tsx       — a check-in post in the group feed
src/components/reaction-bar.tsx    — quick-tap emoji reactions with haptics
src/components/leaderboard-row.tsx — one ranked row (achiever/Pro chips, streak)
src/components/recap-strip.tsx     — "You hit it N× this week"
src/components/reminder-settings.tsx — per-group local reminder toggle + time picker

src/lib/supabase.ts                — Supabase client (AsyncStorage-persisted session)
src/lib/auth/auth-context.tsx      — session + profile state, creates the profiles row on first sign-in
src/lib/auth/providers.ts          — Google OAuth via expo-auth-session (Apple seam included)
src/lib/api/groups.ts              — fetch/create/join groups, leaderboard, weekly recap, invite links
src/lib/api/check-ins.ts           — feed fetch + photo upload + check-in insert
src/lib/api/reactions.ts           — add/remove emoji reactions
src/lib/notifications.ts           — local per-group streak reminders (expo-notifications)
src/lib/billing.ts                 — Pro pricing constants + RevenueCat seam (stubbed, throws until wired up)

src/hooks/use-my-groups.ts         — Home screen's group list (refetches on focus)
src/hooks/use-group.ts             — single group details
src/hooks/use-feed.ts              — group feed
src/hooks/use-leaderboard.ts       — group leaderboard
src/hooks/use-entitlement.ts       — isPro = profile.is_pro || dev override (Profile screen toggle)

src/app/_layout.tsx                — root Stack with Stack.Protected auth/handle/main gates, font loading
src/app/sign-in.tsx                — branded "Continue with Google" screen
src/app/setup-handle.tsx           — one-time handle picker, shown when profile.handle is null
src/app/(tabs)/_layout.tsx         — Today / Profile tab bar
src/app/(tabs)/index.tsx           — Home/Today — group cards, Lock in buttons
src/app/(tabs)/profile.tsx         — handle, stats, Pro entry, reminders, dev Pro toggle, sign out
src/app/group/create.tsx           — name/emoji/goal type/cadence → invite link with copy button
src/app/join.tsx                   — philoi://join?code=ABC123 — also reachable via in-app "Join with a code"
src/app/group/[groupId]/index.tsx  — Feed / Leaderboard tabs + recap strip + invite button
src/app/group/[groupId]/check-in.tsx — camera/library photo, caption, post, streak celebration
src/app/paywall.tsx                — "Philoi Pro" — features, pricing, dev "force Pro" link
```

## Notes on what's stubbed vs. real

- **Auth**: real Google OAuth through Supabase. The provider call is abstracted
  (`src/lib/auth/providers.ts`) so Apple sign-in is a one-line addition later.
- **Streaks & leaderboard**: computed server-side in Postgres (a trigger recomputes streaks on
  every check-in insert; the leaderboard and recap are RPCs) — the client never reports its own
  streak.
- **Reminders**: local notifications only (`expo-notifications`), per the brief. No server
  needed for v1; the seam for Expo push notifications is the same module, just add a
  `expo-notifications` push token registration + a server trigger later.
- **Billing**: `src/lib/billing.ts` has real pricing constants and feature copy, but
  `purchasePro()`/`restorePurchases()` throw until RevenueCat is wired up (look for
  `// TODO: RevenueCat`). Use the **dev Pro toggle** in Profile (or on the Paywall, in `__DEV__`
  only) to test every Pro-gated UI path today.
- **Universal links**: `https://getphiloi.com/join/:code` is referenced in the invite link and
  in `android.intentFilters` / `ios.associatedDomains`, but actually serving/verifying that
  domain (Apple App Site Association, Android Digital Asset Links, and the "app not installed
  yet → store/landing page" fallback) is a website-side task once the domain is live — the app
  side is ready for it.
