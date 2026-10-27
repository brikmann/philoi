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

## Layout — mock 322, connection-first

The design source is `design-mocks/322-website-connection-redesign.html`. The page
leads with connection; competition is an arena you opt into. In order:

1. Sticky nav: lowercase **philoi** wordmark + "FEE-loy · friends", section links, "Get philoi"
2. Hero: "Find your people. / Lock in. / Climb your campus.", the "Live on iOS" pill, and a
   3-phone fan (Lock In · Home · Social reel) with floating cheer / ⚔ challenge / rank-up chips
3. App gallery: Lock In, Social reel, Leaderboard
4. Thesis: "Social media runs on comparison. philoi runs on connection."
5. How it works (3 steps), then Features (6 cards) — each with a mini app-snippet on top
6. Flex: equipped profile, the Shop, earned-vs-collected lanes, the Flame Pass band, and
   the flare showing on a leaderboard row and a post
7. Season pass: "We threw in a season pass, because everyone loves rewards." over Season 1's
   real reward track (every fifth level, from `forge-pass.ts`), Free + Flame Pass lanes
8. CTA band, then the footer with Privacy / Terms / Child safety / Delete account / Support

The phones are illustrative HTML, not screenshots. Keep them truthful to the app:
comment-only social (no likes or follower counts), and shop items use real names
and rarities from `catalog.ts`. Items come from crates and drops, so tiles are
tagged with their source, not given a price. Medals are earned, so none sit in the
Shop. The Flame Pass counts in **levels**. IAP copy must not say "limited time" or
show a price, and "free" only as "Free track for everyone" (the always-free lane, not
a trial).

Desktop-first, with breakpoints at 880px (single column, centred hero) and 520px
(side phones dim, chips move to the empty lower half of the centre phone, grids
collapse). Motion is CSS plus one small inline script: one-shot scroll reveals, bobbing
hero phones, drifting chips, a breathing glow, flame flicker, button sheen, shop shimmer,
gallery tilt, the pass bar filling and levels popping in, and a nav that condenses on
scroll. The script adds the hidden state itself, so without JS nothing is hidden, and
`prefers-reduced-motion` switches all of it off.

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
