# Code Prompt — Fix legal-link domains, age inconsistency, and Child Safety page

Follow-up to the terms.html work. Three things: resolve the age contradiction, publish Child Safety on the new domain, and repoint every in-app legal link from the old domain (`getphiloi.com`) to `philoi.app`. Do all of it, re-verify, then commit the full set together.

## A · Site (`site/`)
1. **Age inconsistency (decided: standardize on 18+).** Edit **`privacy.html` §12** so the minimum age matches Terms §1 — change "at least 13 years old (or 16 where…)" to **"18 or older."** (Terms §1 already says 18+; leave it.) This is the one legal-wording change, approved.
2. **Scrub old domain in `terms.html`.** Replace any remaining **`getphiloi.com`** references in the Terms body with **`philoi.app`** (URLs and the domain in text). Contact email stays `nb@philoi.app`.
3. **Publish Child Safety Standards on philoi.app.** Create **`site/child-safety.html`** (clone `privacy.html`'s head/header/footer/CSS exactly), publishing the Child Safety Standards content that lives at `getphiloi.com/child-safety`. Title "Child Safety Standards — Philoi", canonical `https://philoi.app/child-safety.html`, updated OG/Twitter meta, contact `nb@philoi.app`. Add it to `sitemap.xml` and cross-link it in the footer next to Privacy/Terms. (Google Play requires this page live for social apps.)
   - If the child-safety source content isn't available, stop and flag — do **not** invent legal wording.

## B · In-app links → point to the live philoi.app pages
Use the **exact live URLs** (the pages use `.html`): `https://philoi.app/privacy.html`, `https://philoi.app/terms.html`, `https://philoi.app/child-safety.html`. (If you'd rather clean URLs like `/privacy`, add the rewrites in `site/vercel.json` and use those — either is fine **as long as each returns 200**.)

1. **`src/app/legal.tsx`**
   - line 9 `privacy.url` → `https://philoi.app/privacy.html`
   - line 10 `terms.url` → `https://philoi.app/terms.html`
   - line 11 `child-safety.url` → `https://philoi.app/child-safety.html`
   - line 23 body text "This policy is hosted at getphiloi.com" → "…hosted at philoi.app."
2. **`src/app/settings.tsx`** (Settings → Legal rows)
   - line 353 Privacy Policy `Linking.openURL` → `https://philoi.app/privacy.html`
   - line 354 Terms of Service → `https://philoi.app/terms.html`
   - line 358 Child Safety Standards → `https://philoi.app/child-safety.html`
3. **`src/app/setup-handle.tsx`** (onboarding consent)
   - line 25 `PRIVACY_URL` → `https://philoi.app/privacy.html`
   - line 26 `TERMS_URL` → `https://philoi.app/terms.html`

## C · Verify
- Every in-app legal URL and every web cross-link **resolves to a real, live page** (privacy, terms, child-safety all 200 on philoi.app). No `getphiloi.com` left in `legal.tsx`, `settings.tsx`, `setup-handle.tsx`, or `terms.html`.
- Privacy §12 and Terms §1 now **agree on 18+**.
- Onboarding (`setup-handle`) and Settings both open the correct new-domain pages.

## Out of scope (note, don't change unless asked)
- The **support** email `support@getphiloi.com` (`account-disabled.tsx`, `settings.tsx`) is a separate migration — leave it, or flag it, but don't fold it into this change.
- No redesign; no new legal wording beyond the approved §12 age edit and the Child Safety page (verbatim from its existing source).

## Commit
Once verified, commit the whole set together (site pages + the three `src/` files) so nothing ships a half-migrated state.
