# V1 — Feedback & Contact + Domain cleanup

## 1 · Feedback & Contact (in-app)
- **Feedback form in Settings**, categories: **Bug report / Feature request / General feedback**.
- Submissions go to **info@philoi.app**.
- **Contact email shown in Settings → About/Help** so users can reach you directly.
- **Mailto fallback** so it works with no backend.

Implementation:
- **v1 (simplest, zero backend):** the form composes a `mailto:info@philoi.app` link — subject
  `[Bug report] …` (category prefix) + body = their message → opens the mail client.
- **Nicer (still light, if time):** POST to a Supabase edge function that emails via **Resend**
  (already wired for the uni codes) to info@philoi.app, so the user never leaves the app. Fall back to
  mailto if the network call fails. Do this only if it doesn't threaten the Aug 20 date; otherwise
  ship mailto for v1.

## 2 · Domain cleanup — AUDIT RESULT (done, I have repo access)
The app source is basically clean — this is much smaller than "audit the whole codebase" implies.

- ✅ **No `getfeelloy.com` anywhere in the code.** ⚠️ Heads-up: the old secondary domain that IS in the
  code is **`getphiloi.com`**, not getfeelloy.com — so confirm which domains you actually registered /
  need to cancel. (feelloy was a brand *name*, not the domain in the code.)
- ✅ **No `feelloy` and no Aspire OS references in shipped app source (`src/`).** The only Aspire /
  Realmly / aspireos.co mentions are in OLD planning/handoff `.md` docs in the repo root
  (`aspire_os_brand_kit…`, `realmly_*`, `tribal_setup…`, `cadence_*`) — **not shipped**, safe to ignore
  or archive.
- ⚠️ **The ONE hardcoded old-domain reference in shipped code:**
  `supabase/functions/send_uni_code/index.ts:27` — the FROM fallback defaults to
  `'Philoi <noreply@getphiloi.com>'`. The live value already comes from the `UNI_CODE_FROM` secret;
  this fallback is the only leftover.

### To-do (mostly infra, not code)
1. **Edge-function FROM fallback → `noreply@philoi.app`** (one-line change in `send_uni_code/index.ts`)
   and set the `UNI_CODE_FROM` secret to the philoi.app sender. Confirm philoi.app is verified in Resend.
2. **Host privacy + terms** at `philoi.app/privacy` and `philoi.app/terms` (App Store requires a
   privacy policy URL — needed for the v1 submission anyway).
3. **Redirect** `getphiloi.com → philoi.app` (and `getfeelloy.com → philoi.app` *if* that domain
   actually exists) **before** cancelling, to catch any old links.
4. **Cancel** the old domain registrations once the redirects are confirmed live.
5. Optional: archive/delete the old Aspire/Realmly `.md` planning docs from the repo root so they stop
   showing up in searches (cosmetic).
