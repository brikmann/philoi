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

## Layout — the vision manifesto (2026-11)

The page is a scroll-told manifesto. Social media is broken, your campus is scattered
across a dozen apps, and Philoi brings it into one place. In order:

1. Nav: the wordmark and one "Get Philoi" button, nothing else.
2. Hero: "University has a social media problem." The signature animation sits in the
   stage beside it. Fourteen generic-glyph nodes (big apps plus campus chats, clubs,
   Strava, Forest and Liftoff) start scattered, then pull onto an ellipse around the
   flame. It plays once on load and replays when you scroll back up. Phones show ten
   nodes; `.n.w` nodes are wide-screen only. Each node carries `--i` (desktop slot),
   `--m` (phone slot), `--o`/`--om` (orbit ratio) and `--sx`/`--sy` (scattered position).
   Positions use CSS `cos()`/`sin()`.
3. What each app becomes: group chats to Rooms, Strava to Lock In, Forest/Liftoff to
   Lock In together, feeds to Campfire, finding people to matching, playlists to music.
4. The problem: four cited stats that count up (Gallup 2023, U.S. Surgeon General 2023,
   Statistics Canada 2021, Primack et al. 2017). **Never add a number without a source
   link under it.**
5. How it works: three beats with illustrative HTML phones (matching, campfire, Lock In).
6. Built for your campus: verified students, campus and program scoping, one app for
   your whole degree, rolling out from Laurier. Campus email verification is
   *optional* in the app, so don't write "sign-up is gated".
7. The algorithm that connects: "built to bring people together", never "no algorithm".
8. Competition is a feature: Standings are opt-in and off by default; personal progress
   leads.
9. Cosmetics: flames, flares, halos and cards as self-expression. No grind, earn or
   unlock language.
10. The name: φίλοι inside a hand-drawn laurel. Philoi means "friends", and in the
    Hellenistic courts it was the honorary title for a ruler's trusted inner circle. Not
    followers, allies. This is the promise beat that ties together patrons, the verified
    campus circle and the ethos that you're not competing with your people. The
    "we do good things for each other" line is framed as what the title meant, not a quote.
11. CTA (iOS, plus an Android beta invite by email) and a footer that links every legal page.

The phones are illustrative HTML, not screenshots. Keep them truthful to the app. No
real-person imagery: avatars are gradient circles, and third-party apps appear as text
labels with generic glyphs, never their logos. Live vs roadmap: music is "connect your
music", never "we pull your Spotify feed", and there's no claim of importing from other
networks.

Motion: one inline script. The hero merge, one-shot reveals, the stat count-up, and
looping animations that only run while their `[data-live]` section is on screen. The
script adds the hidden and scattered states itself, so without JS, or with
`prefers-reduced-motion`, the page shows its finished state: the integrated ring, every
section visible, the final numbers.

`philoi.app/{username}` currently 404s on the web (no rewrite), so the page doesn't link
to it as a live demo.

## Cosmetic art

Every flame, flare, halo, card, medal, relic, crate, the house crest and the Lock In flame
on the page is the app's own renderer (`ItemArt`, `BoxArt`, `HaloRing`, `PatronCrest`,
`FlameLogo`) exported to inline SVG. Each sits between `<!--art:KEY-->` and `<!--/art-->`
in `index.html`, with the keys listed in `_assets/cosmetic-art/art.jsx`. After an art or
catalog change, or to add a key:

```bash
node site/_assets/cosmetic-art/export.mjs
```

It renders from `git archive HEAD src` (so it never ships a sibling session's uncommitted
item), refills every marker in place, and is idempotent. The first run installs esbuild
into a temp folder; the app's `package.json` is untouched.

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
