# University verification — build spec (onboarding)

Verify a student actually attends the school they picked, to gate the **My Uni** and **Vs Unis** leaderboards.
Flow mock: `design-mocks/75-uni-verification.html`. Plugs into the existing `setup-handle.tsx` onboarding
(which already collects `university` as free text) as an optional step after uni-select.

---

## ⚠️ Correction to the proposed auth flow (read first)
The suggested `supabase.auth.signInWithOtp` / `verifyOtp({ type: 'email' })` **will not work here.** Those are a
full **sign-in** — `verifyOtp` returns a *session for the uni-email identity*, i.e. it signs the user in AS
`noah@uwaterloo.ca`, creating/switching to a different auth user. That directly conflicts with the intended
design ("Google/Apple OAuth stays the login method; university email is verification-only"). It would replace
the Google session and orphan the user's real profile/data.

**Use a custom 6-digit code flow that never touches Supabase Auth** — the email is a verified *attribute* on the
existing OAuth user, not a login. This needs a transactional email sender (Supabase's built-in email only fires
for auth events). **Resend** is the minimal option: an API key + ~10 lines in an Edge Function — not real
"infrastructure."

---

## 1 · University → domain (Hipolabs)
- On uni select, hit `GET https://universities.hipolabs.com/search?name=<q>&country=Canada` → `{ name, domains[] }`.
  (Use **https**, not http.) Store `university` (name) + `university_domain` (domains[0]) on the profile.
- **Cache a local JSON of the top ~20 Canadian universities** (name + domain) shipped in the app, so search +
  the domain suffix work offline / instantly; fall back to the API for anything not in the cache.
- Keep the existing "not listed" free-text fallback — but a school with **no known domain can't be verified**
  (it just doesn't get the badge / uni tabs; never blocks onboarding).

### 1b · Email PREFIX (local-part) hints — no API, curated, non-enforcing
There is **no API** for a school's email local-part format. Domain APIs (Hipolabs) and academic-email verifiers
exist, but the prefix convention (Laurier `brik8334@` = first-4-of-surname + last-4-of-student-#, Newcastle
`initials.surname#@`, ANU `u1234567@`) is internal IT policy, unpublished in any queryable form, and it **varies
within a school** (students vs faculty vs alumni vs legacy accounts).
- **Do NOT regex-enforce the prefix** — it would falsely reject legit students (short surnames, collision
  suffixes, grad/staff accounts). **Enforce the DOMAIN only.** The OTP is the real proof of ownership: whatever
  the local part, if the code arrives, they own an `@mylaurier.ca` address → verified.
- **DO** ship a small **curated per-school format HINT** — a hand-maintained string shown as helper/placeholder
  text (guidance only). Add a `format_hint` field to the local top-20 cache, e.g.:
  `Laurier → "first 4 of last name + last 4 of student # · e.g. smit4521"`. Unknown schools show no hint (fine —
  the user just types the email they use). Optionally prefill the local-part placeholder from the hint.

## 2 · Schema (new migration)
```
alter table profiles
  add column if not exists university_email text,
  add column if not exists university_email_verified boolean not null default false,
  add column if not exists university_domain text;

-- custom OTP store (not auth) — one active code per user
create table uni_verification_codes (
  user_id uuid primary key references profiles(id) on delete cascade,
  email text not null,
  code_hash text not null,          -- hash the 6-digit code, never store plaintext
  expires_at timestamptz not null,  -- now() + 10 min
  attempts int not null default 0,  -- cap at ~5 then force resend
  last_sent_at timestamptz not null default now()  -- resend cooldown (~45s)
);
alter table uni_verification_codes enable row level security;  -- no client policy; Edge Functions (service role) only
```

## 3 · Edge Functions (service role, act on auth.uid())
- **`send_uni_code({ email })`**
  1. Load caller's profile → `university_domain`. **Reject if `email`'s domain ≠ `university_domain`** ("use your
     @uwaterloo.ca email"). 2. Enforce resend cooldown (`last_sent_at`). 3. Generate a 6-digit code, upsert
     `{user_id, email, code_hash=hash(code), expires_at=now()+10min, attempts=0, last_sent_at=now()}`.
  4. Email the code via **Resend** (`RESEND_API_KEY` secret) from a Philoi sender.
- **`verify_uni_code({ email, code })`**
  Load the row; check not expired, attempts < cap, `hash(code)==code_hash`, email matches. On success:
  `update profiles set university_email=email, university_email_verified=true where id=auth.uid()` and delete the
  code row. On failure: increment `attempts`. Return a clear reason (expired / wrong / too many tries).

Secrets: `supabase secrets set RESEND_API_KEY=…` (+ a verified sender domain in Resend). No native change.

## 4 · Gating — the whole point
- **My Uni** and **Vs Unis** leaderboard tabs require `university_email_verified = true`. Unverified → the tab
  renders a 🔒 "Verify to unlock" state with a CTA into this flow (mock 75D shows the unlocked pair).
- Enforce server-side too: the uni/vs-uni leaderboard RPCs only include verified users, so an unverified account
  can't appear on a campus board even via a crafted call. (Keeps the campus rankings *real* — the selling point.)

## 5 · Onboarding placement (mock 75, `setup-handle.tsx`)
- After the uni-select step, add an **optional** "Verify your campus" step: email entry (domain-locked suffix,
  mock 75B) → code entry (75C) → verified (75D). **Skippable** ("verify later") — skipping finishes onboarding
  with `university_email_verified=false` and the uni tabs locked.
- Domain suffix in the email field comes from `university_domain` (only the local part is typed).

## 6 · Account management (Settings)
- "Campus" row in Settings shows verified state. Changing school or email = re-run §3 (send → verify), which
  updates `university`, `university_domain`, `university_email`, and re-sets `university_email_verified`.
- Changing to an unverified school flips `university_email_verified=false` and re-locks the tabs until re-verified.

## Ship
JS (screens) + one migration (§2) + two Edge Functions (§3) + the `RESEND_API_KEY` secret. No native rebuild;
migrations via `supabase db push`, functions via `supabase functions deploy`.
