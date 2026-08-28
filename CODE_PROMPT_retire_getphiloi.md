# Code Prompt — Retire getphiloi.com → philoi.app, then make the app branch the mainline

**Context (established, don't re-derive):** This one repo holds **two unrelated git histories**:
- The **Philoi app + static `site/`** — the Expo RN app and the static marketing site. `philoi.app` is served by Vercel deploying `site/` from this branch via `vercel --prod --cwd site` (manual, not git-connected). This is the live, active project.
- **`master`** — a *separate* Next.js landing site (root commit `66f2a5c`, ~4 commits) that serves **getphiloi.com**. Different root, no merge base with the app.

**Decision:** getphiloi.com is being **retired** in favor of philoi.app. Do it in three stages, in order, with **STOP-and-report gates**. Nothing is broken today and nothing is time-critical — correctness beats speed. **The crux is Stage 1: old invite deep-links and app-link association files on getphiloi.com must keep working, or previously-shared invites break.** Solve that before any redirect.

Some steps are **dashboard/DNS actions only Noah can do** (Vercel domain assignment, DNS records). Do the code/config/repo work; for anything requiring the Vercel or DNS dashboard, write the exact steps and **hand them to Noah — don't attempt to guess credentials or fake it.**

---

## Stage 1 — Audit what getphiloi.com MUST keep serving (do NOT skip)
1. **App-link association files.** `app.config.ts` intentionally keeps `getphiloi.com` as an applinks domain (its own comment: old invite links must keep resolving). Find what getphiloi.com serves for this:
   - iOS: `https://getphiloi.com/.well-known/apple-app-site-association`
   - Android: `https://getphiloi.com/.well-known/assetlinks.json`
   - Fetch both live and record their exact contents. These **must survive** the retirement, byte-for-byte, or iOS/Android universal links from old invites stop opening the app.
2. **Invite / deep-link paths.** Identify the URL shape of shared invite links (e.g. `getphiloi.com/invite/...`, `/join/...`, `/c/...`). Grep the app + the Next.js `master` tree for the route that handles them. Record every path prefix that a real user might have a live link to.
3. **Anything else live-facing:** email links, QR codes on any printed/marketing material, SEO pages worth 301-preserving. List them.
4. **Confirm the live deploy source** for both domains: which Vercel project + branch serves philoi.app, and which serves getphiloi.com. Confirm philoi.app deploys `site/` from this app branch.

**STOP and report** the association-file contents, the invite path shapes, and the two Vercel project/branch mappings before touching anything. This determines whether the redirect can be a blanket 301 or must be selective.

---

## Stage 2 — Redirect getphiloi.com → philoi.app, preserving deep-links
Design the redirect from the Stage 1 findings. Default recommended shape (adjust to what you found):
- **Preserve** `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` on getphiloi.com — serve the *same* association content philoi.app uses (so a single app handles both domains), or keep the existing files. Do **not** 301 these.
- **Preserve** the invite/deep-link path prefixes so old universal links still resolve and open the app (the association file is what makes the OS intercept them; make sure the web fallback for those paths doesn't 301 in a way that breaks the OS hand-off).
- **301 everything else** (`/`, marketing pages) → the equivalent philoi.app URL, falling back to the philoi.app homepage.

Implementation options — pick the one that fits how the domains are hosted (confirm in Stage 1):
- **(a) Retire the Next.js project, redirect at the domain.** Move getphiloi.com off the Next.js project and onto the philoi.app Vercel project as an additional domain, with a redirect config in `site/vercel.json` that handles the preserve-vs-301 rules above. Cleanest if philoi.app's `site/` can also serve the `.well-known` files.
- **(b) Keep a stripped Next.js project** that serves only the association files + invite fallback and 301s the rest via `next.config` redirects. More moving parts; only if the deep-link handling is coupled to that app.

Whichever you choose: **do not delete the Next.js source yet** (Stage 3 preserves it in git). Land the redirect config in code; the actual **domain reassignment in Vercel and any DNS change are Noah's dashboard steps** — write them out precisely (which domain, which project, which DNS record → which value).

**STOP and report** the chosen approach + the exact dashboard/DNS steps for Noah, before Stage 3.

---

## Stage 3 — Repo: preserve the old history, make the app branch the mainline
Only after the redirect is designed and the app is confirmed safe:
1. **Preserve the Next.js history — never lose it.** Tag current `master` before moving it: `git tag legacy/getphiloi-nextjs master` and push the tag. (Optionally also keep a `legacy/getphiloi-site` branch.) This keeps all 4 commits recoverable.
2. **Identify the app's canonical mainline branch** — the branch active dev happens on and philoi.app deploys from (likely the long-lived app trunk, not a short-lived feature branch). Confirm with Noah if it's ambiguous; **do not assume.**
3. **Repoint `master` to the app mainline.** Since histories are unrelated, this is a history replacement, not a merge — `git branch -f master <app-mainline>` (or equivalent), then `git push --force-with-lease origin master`. **STOP and report before force-pushing** — this rewrites what `origin/master` means.
4. **Do not disturb uncommitted work.** There are in-progress local changes (Cindy flame, icons, `ITEM_CATALOG.md`) and an actively-writing process in the tree. Verify the working tree is untouched before and after; don't stash, commit, or force-checkout over them. If any branch op would clobber them, **stop.**

---

## Stage 4 — Verify
- `https://getphiloi.com/` **301s → philoi.app** (or the mapped page).
- `https://getphiloi.com/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` still return **200 with correct content** (not redirected).
- An old-shape invite link still resolves / opens the app (test one).
- `https://philoi.app/*` unaffected — the three legal pages still 200.
- `git tag` shows `legacy/getphiloi-nextjs`; the Next.js commits are reachable from it.
- `origin/master` now points at the app mainline; working tree changes intact.

**Report:** the redirect approach shipped, the exact Vercel/DNS steps left for Noah, the tag preserving the old site, and confirmation the deep-link association files still serve. Flag anything you couldn't verify (especially real-device universal-link behaviour — that may need a manual phone test).

> Guardrail recap: don't lose the Next.js history, don't break old invite deep-links, don't force-push master or reassign the domain without a stop-gate, don't touch the uncommitted app work.
