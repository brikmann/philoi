# philoi.app — marketing site

The public one-pager for Philoi, plus the privacy policy referenced by the Garmin
developer application.

Plain HTML + CSS with a few lines of optional vanilla JS. **No framework, no build
step, no dependencies** — the files in this folder are exactly what gets served.

```
site/
├── index.html            landing page (CSS inlined)
├── privacy.html          privacy policy (CSS inlined)
├── terms.html            terms of service (CSS inlined)
├── child-safety.html     child safety standards — required by Google Play (CSS inlined)
├── favicon.svg           logo mark, used by modern browsers
├── favicon.png           32×32 fallback
├── apple-touch-icon.png  180×180 home-screen icon
├── og.png                1200×630 social share card
├── robots.txt
├── sitemap.xml
├── vercel.json           www → apex redirect
├── .vercelignore         keeps _assets/, README and .env* out of the upload
└── _assets/              sources for the PNGs above — NOT served content
```

## Run it locally

Any static server works. From the repo root:

```bash
npx serve site          # → http://localhost:3000
# or
python -m http.server 8080 --directory site
```

Then open `/` and `/privacy.html`. Opening `index.html` straight off the filesystem
mostly works too, but the root-relative links (`/privacy.html`, `/favicon.svg`)
will 404 — use a server.

## Brand tokens

`index.html` uses the app's space palette, mirrored from `src/constants/theme.ts`
(`space*`, `legend`, `emberForward`). If the app's theme changes, update the
`:root` custom properties at the top of `index.html`. The legal pages still carry
the older twilight tokens in their own `<style>` blocks.

| token | value | |
|---|---|---|
| `--bg` | `#0E0A1C` | page background |
| `--panel` / `--panel2` | `#1A1230` / `#241A3A` | cards, surfaces |
| `--line` | `#2E2348` | borders |
| `--ink` / `--muted` | `#f4f0ff` / `#c9bfe6` | text |
| `--emgrad` | `#ff7a2f → #ffb05a → #ffd166` | the ember signature; near-black text on it |
| accents | legend `#b98bff`, gold `#ffd166`, green `#39d98a`, cyan `#4fd6e0` | |

System fonts only: the page loads nothing from another origin.

## Layout — the vision landing (2026-11-10)

`index.html` is the pitch landing (`philoi_landing_vision.html` in the repo root is its
source mock). It's self-contained: inline CSS and JS, and the five "living campus" phone
screenshots are inline `data:` images. In order:

1. Hero: "Your people are scattered everywhere." Eleven app and campus-chat nodes start
   scattered and merge into the flame. It plays on load and replays when the hero comes
   back into view. On phones the offsets shrink (`--mx`/`--my` override a node's phone
   position).
2. One place: Rooms, Campfire, Lock In and Matching, each as what it replaces.
3. Why it matters: three cited stats (Gallup 2023, U.S. Surgeon General's youth social
   media advisory 2023, Cigna U.S. Loneliness Index 2020 via CNBC). The markup holds the
   final numbers, so no-JS and reduced motion show them. **Never add a number without a
   source link under it**, and keep each label exactly as narrow as its source: the
   Cigna 73% is Gen Z *workers*, and the 2× is ages 12–15.
4. How it works: three cards badged "live".
5. Verified students: campus email verification is *optional* in the app, so never write
   "verified students only", "gated" or "no randos".
6. The living campus: roadmap. Every screenshot and card stays badged "Coming soon"
   or "coming" until it ships.
7. Algorithm ("built to bring people together", never "no algorithm"), then competition
   (opt-in, off by default), then cosmetics. Cosmetic names must be real catalog names.
8. The name: φίλοι. The "we do good things for each other" line is framed as what the
   title meant, not a quote.
9. CTA (App Store, plus an Android beta invite by email) and a footer that links every
   legal page.

Live vs roadmap: no `philoi.app/{username}` claim (it 404s on the web), and no film art
claim (TMDB isn't configured in prod, so film tags return nothing).

The previous page (the manifesto, with app-rendered cosmetic art) is `c659a32`.
`_assets/cosmetic-art/export.mjs` only fills `<!--art:KEY-->` markers, and this page has
none.

## Availability

The app is live on iOS. Every App Store CTA goes to
`https://apps.apple.com/app/id6790697786`. Android has no store listing yet, so its
CTA is a `mailto:support@philoi.app` "follow for launch". Do not point it at the
`waitlist` edge function: that function's confirmation email still promises
"Season 1 opens October 1, 2026".

## Regenerating the images

`og.png`, `favicon.png` and `apple-touch-icon.png` are committed, so you only need
this after changing the logo or the share-card copy:

```bash
node site/_assets/build-assets.mjs
```

It screenshots `_assets/og.html` and `_assets/icon.html` with a headless
Chrome/Edge already installed on the machine — no npm install required.

## Deploy

**Live at https://philoi.app**, on Vercel project `brikmanns-projects/philoi-site`
— separate from the `philoi` project that serves `www.getphiloi.com`.

The site is fully static; `site/` is the publish directory. No framework is
detected, so the output directory is `.` and the files here are served as-is.

**Two ways it deploys, and neither is "any push":**

- **Git:** the project is connected to the `philoi` repo with Root Directory
  `site`, and its production branch is **`add-marketing-site`**. Pushes to any
  other branch (e.g. `integration-wave1`) only build previews.
- **CLI:** because Root Directory is `site`, `npx vercel --cwd site --prod` now
  fails ("The specified Root Directory "site" does not exist" — it looks for
  `site/site`). Deploy from a folder whose `site/` subfolder is the site, with
  `.vercel/project.json` beside it, e.g. a clean copy of just the served files.
  Running it from the repo root instead would upload the whole repo.

Heads-up: a CLI deploy of the working tree puts production ahead of
`add-marketing-site`, and the next push to that branch rebuilds production from
it. Keep that branch in step with whatever was deployed.

`.vercelignore` keeps `_assets/`, this README and any `.env*` out of the upload —
without it `_assets/og.html` would be publicly reachable, and `vercel link`
writes a `site/.env.local` holding a `VERCEL_OIDC_TOKEN`.

### Domain

`philoi.app` and `www.philoi.app` are both attached to the project. DNS lives at
whois.com, not Vercel:

| Type | Name | Value |
|---|---|---|
| `A` | `@` | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

Both are rank-2 values in `vercel domains verify` output — supported, but Vercel's
current rank-1 picks are `216.150.1.1` / `216.150.16.1` for the apex. Certificates
took ~12 minutes to issue after the records went in.

`www` redirects to the apex via `vercel.json`, matching the canonical tag and the
sitemap. Note it needs **two** rules: `/:path*` does not match the bare root, so a
separate `"source": "/"` entry is required or `www.philoi.app/` serves a duplicate
homepage instead of redirecting.

### After deploying, check

- [ ] `https://philoi.app/privacy.html` loads — the Garmin application links to it
- [ ] `https://www.philoi.app/` 308s to the apex, root included
- [ ] `https://philoi.app/_assets/og.html` 404s
- [ ] The share card looks right in a Slack/iMessage/WhatsApp paste, or via
      [opengraph.xyz](https://www.opengraph.xyz)
