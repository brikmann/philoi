# Garmin Connect Developer Program — Application copy (paste-ready)

Form: **https://www.garmin.com/en-US/forms/GarminConnectDeveloperAccess/**
Everything below is written to paste straight into the request form / integration call. Fill the **`[BRACKETED]`** bits (only you have them); the rest is ready to go.

> Framing reminder: this program is **enterprise/business use**. Apply as **Philoi** (your venture), not as a personal hobby project. Be honest and specific — Garmin reviews use cases and can decline vague/experimental ones.

---

## 0 · Fields only you can fill
- **Legal / business name:** `[Philoi — or your registered entity name, e.g. "Philoi Technologies"; if not incorporated yet, use "Philoi (sole proprietor / pre-incorporation)"]`
- **Contact name:** `[Noah Brikman]`
- **Contact email:** nb@philoi.app
- **Website:** https://philoi.app  *(landing page — build in progress)*
- **Country:** `[Canada]`
- **Expected users / devices supported (first year):** `[your honest estimate, e.g. "100–500 in an initial university pilot, scaling with campus rollout"]`

---

## 1 · Which APIs to request
- **Health API** — all-day metrics: **steps, distance, intensity/active minutes** (for step & distance challenges).
- **Activity API** — **activities (runs, rides): type, distance, duration** (for workout/run challenges).

*(You can use both in one app. Request both if your challenges span daily steps and logged workouts.)*

## 2 · Data types (keep it minimal — request only these)
Daily steps · distance · intensity/active minutes · activity summaries (type, distance, duration). **No** need for HR streams, pulse-ox, body composition, or beat-to-beat interval (that last one carries a commercial license fee — avoid it).

## 3 · Integration model
**Push (webhook) preferred**, OAuth 2.0 for account linking. Garmin pushes new wellness/activity summaries to our backend endpoint; we store only the challenge-relevant totals. Pull/Ping acceptable as fallback.

---

## 4 · Company / product description  (paste into "describe your company/app")
Philoi is a mobile social-accountability app for students. Small friend groups ("campfires") set goals — studying, workouts, running, job applications — and "lock in" together, earning XP, ranks, and streaks for consistently showing up. It's built on React Native / Expo with a Supabase backend and is aimed at university students (initial rollout around `[Wilfrid Laurier / Waterloo]`). The core value is accountability: seeing friends show up makes you show up.

## 5 · Use case for Garmin data  (paste into "how will you use Garmin data / describe your integration")
Philoi runs fitness challenges between friends and within groups — e.g. "most steps this week," "who runs the farthest," "hit 10k steps daily." Today these depend on in-app timers or self-reported numbers, which are easy to game and undermine the competition. Connecting Garmin lets a user **auto-verify their own activity** so challenge results are trustworthy.

Flow: a user opts in and links **their own** Garmin account via OAuth 2.0. For an active challenge, we read only the metric that challenge needs (e.g. daily steps, or a run's distance) over the challenge window, reduce it to the challenge-relevant number, and use that to score the user's standing. A user only ever sees **their own** Garmin-derived numbers; we do not expose one user's raw Garmin data to another. Manual entry always remains available, so users without a Garmin device can still participate — the integration adds verification, it never gates access.

## 6 · Data handling & privacy practices  (paste into "data handling / privacy")
- **Opt-in, per user, per source.** Linking is explicit via OAuth 2.0; users can disconnect at any time, which immediately stops our access.
- **Minimal scope.** We request only the data types a challenge requires — steps, distance, active minutes, activity summaries. No broader health export.
- **Data minimization in the product.** The app surfaces only the challenge-relevant figure (e.g. "8,200 / 10,000 steps"); we do not display or store full raw health records beyond what's needed to compute a challenge total.
- **Own-data display.** Consistent with Garmin's terms, a user is only shown their own Garmin-derived data; comparative challenge standings are derived scores, and we'll confirm display specifics with Garmin on the integration call.
- **Secure handling.** OAuth tokens and client secret are held server-side (Supabase Edge Functions); nothing sensitive ships in the mobile client. Webhook payloads are signature-verified.
- **Consumer-facing app**, not research or clinical use.

## 7 · Technical summary  (for the integration call)
- Client: React Native / Expo (iOS + Android). Backend: Supabase (Postgres + Edge Functions).
- Auth: OAuth 2.0 user linking; tokens + secret stored server-side.
- Delivery: Push/webhook receiver (Supabase Edge Function), signature-verified; Pull as fallback.
- Data reduced on ingest to per-challenge totals; raw not exposed cross-user.
- Testing: we'll validate in Garmin's evaluation environment + auto-verification before requesting production.

---

## 8 · Before you hit submit — quick checklist
- [ ] Website/landing page live (even a one-pager) at the URL you enter.
- [ ] Business-looking contact email.
- [ ] Use-case (§5) and privacy (§6) pasted in full — these are what the reviewer weighs.
- [ ] Requested **only** the minimal data types (§2); avoided fee-gated metrics.
- [ ] Realistic device/user estimate (§0).
- [ ] Apply early — approval + integration call is the long-lead step; build the other integrations meanwhile.

---

## 9 · Fallback email to connect-support@developer.garmin.com
Use this if the online form won't load. Send from your business address (see §10), with the website live.

> **To:** connect-support@developer.garmin.com
> **Subject:** Developer Program access request — Philoi (Health + Activity APIs)
>
> Hi Garmin Developer team,
>
> I'd like to apply to the Garmin Connect Developer Program. The online access request form won't render in my browser (the "enable JavaScript" form doesn't load), so I'm reaching out directly — happy to complete the form if you can point me to a working link.
>
> **Company:** Philoi `[— or your entity name]`
> **Contact:** Noah Brikman, nb@philoi.app, `[Canada]`
> **Website:** https://philoi.app
> **APIs requested:** Health API (steps, distance, active minutes) and Activity API (runs/rides — type, distance, duration).
>
> **Use case:** Philoi is a mobile social-accountability app for students. Friend groups set fitness challenges — e.g. "most steps this week," "who runs farther" — and today these rely on self-reported numbers that are easy to game. Connecting Garmin lets a user auto-verify their **own** activity so challenge results are trustworthy. Users opt in via OAuth 2.0; we read only the metric a given challenge needs, show each user only their own Garmin-derived numbers, and always keep manual entry as a fallback so non-device users can still participate.
>
> **Integration:** OAuth 2.0 with a server-side backend (Supabase), Push/webhook preferred, minimal scopes, tokens and secrets held server-side.
>
> We expect roughly `[100–500]` users in an initial university pilot. Could you let me know the next steps to get set up in the evaluation environment?
>
> Thanks,
> Noah Brikman
> `[phone / title, optional]`

---

## 10 · Getting a professional email (do this before applying)
A `you@philoi.app` address makes the application read as a real business (a gmail weakens it). Two-part setup:

**A. Register the domain** (~$10–15/yr) at a registrar — Cloudflare Registrar (at-cost), Porkbun, or Namecheap. Check `philoi.app` first; fallbacks: `philoiapp.com`, `getphiloi.com`, `philoi.io`. Whatever you pick becomes your website URL too.

**B. Add email on that domain** — pick one:
- **Zoho Mail — Free plan** (fastest $0 route): free custom-domain mailbox for a small team; good enough for `noah@philoi.app`. Sign up, verify the domain via DNS records, done.
- **Google Workspace** (~$7/user/mo): if you want Gmail's interface + Drive/Docs under your domain.
- **iCloud+ Custom Email Domain**: if you already pay for iCloud+, you can attach a custom domain at no extra cost.

Order of ops: register domain → set up mailbox (Zoho free is the quickest) → point a basic landing page at the domain → then send the application / email from `noah@philoi.app`. You do the signups/purchase yourself; I can't create accounts or buy the domain, but I can build the landing page.
