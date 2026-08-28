# Code Prompt — Merge, deploy, verify legal pages + finish the getphiloi.com migration

Executes tasks #135 and #136, plus the one remaining legal cross-link. Order matters: link → merge → deploy → verify → migrate leftovers → commit. **Stop and report** at any conflict or ambiguity rather than guessing.

## 0 · Preserve uncommitted work
The tree has unrelated in-progress changes (Cindy flame, icon assets, `ITEM_CATALOG.md`) that must stay **untouched and uncommitted**. Before any branch operation, `git stash push -u` those (or otherwise protect them) and restore them at the end. Never commit them, and never commit CRLF-only churn.

## 1 · Wire the last cross-link (Terms §4)
In `site/terms.html` §4, the "Child Safety Standards" mention is plain text. Now that `site/child-safety.html` exists, make it a real link to **`/child-safety.html`** (or the clean URL if you set up rewrites). This is the only place the three legal pages don't yet cross-reference. Commit on `add-marketing-site` with the rest.

## 2 · Merge `add-marketing-site` → `master`
- Confirm `add-marketing-site` is the branch holding the committed legal work (terms.html, child-safety.html, the src link repoints, sitemap, cross-links).
- Merge it into **`master`** (fast-forward if possible; otherwise a clean merge commit). **If there are conflicts, stop and report** — do not force-resolve.
- Do **not** sweep in the stashed unrelated work.
- Push `master`.

## 3 · Deploy to production
Vercel is **not** git-connected here, so a push does **not** publish — you must deploy manually:
```
vercel --prod --cwd site
```
**Recommended:** set up auto-deploy so future pushes publish, then confirm the Production Branch is `master`:
```
vercel git connect --cwd site
```
(Flag if the production-branch setting is anything other than `master` — we don't want a stray branch auto-publishing.)

## 4 · Verify LIVE (this is the real finish line — #135)
After the deploy propagates, confirm all three return **200 live**, not just in the repo:
```
https://philoi.app/privacy.html        → 200
https://philoi.app/terms.html          → 200  (currently 404)
https://philoi.app/child-safety.html   → 200  (currently 404)
```
Also confirm the in-app links now resolve (they point at these exact URLs). Report the three status codes back.

## 5 · getphiloi.com leftovers (#136) — with guardrails
These are the last old-domain references. **Two are risky — do not change blindly:**
- **`send_uni_code` FROM = `noreply@getphiloi.com`** → change to `noreply@philoi.app` **only if `philoi.app` is a verified sender domain in Resend.** If it isn't verified, changing this **breaks university-verification emails** — so leave it and flag instead. Verify before touching.
- **Support email `support@getphiloi.com`** (`account-disabled.tsx:10`, `settings.tsx:214`) → change to `support@philoi.app` **only if that inbox exists / forwards.** If unsure, use the known-good `nb@philoi.app` or leave + flag. Don't point users at a dead inbox.
- **`app.config.ts` applink `getphiloi.com`** → **leave as-is.** It's deliberate (its comment: old invite links must keep resolving). Changing it breaks previously shared invite codes. Only note it.

## 6 · Finish
- Restore the stashed unrelated work (Cindy/icons/catalog) — still uncommitted, untouched.
- Commit only: the Terms §4 link (step 1) and any #136 changes you were able to make safely.
- Report: the three live status codes, whether git-connect was set up (+ production branch), and which #136 items you changed vs. flagged.

**Downstream unblocked once step 4 is green:** the Laurier IT email (Terms link resolves) and the Google Play submission (Child Safety page serving).
