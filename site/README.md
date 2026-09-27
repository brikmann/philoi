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

Colours and type are mirrored 1:1 from the app's `src/constants/theme.ts`
(twilight palette + Inter). If the app's theme changes, update the `:root`
custom properties at the top of each HTML file's `<style>` block.

| token | value | |
|---|---|---|
| twilight-900 | `#14111C` | darkest — header, footer |
| twilight-800 | `#1B1726` | page background |
| twilight-700 | `#241C38` | cards, surfaces |
| plum | `#3A2E5C` | logo backplate |
| coral / amber / ember | `#E0612C` / `#F2A33C` / `#FFD27A` | firelight accents |
| ink / muted | `#FFF6EC` / `#A99CBD` | text |

## Layout — mock 233 (Emberfall), mobile-first

Most visitors arrive from a QR code on a shirt or poster, so the **phone render
is the source of truth**. Base styles target 360–430px; `@media (min-width:820px)`
scales up to a centred shell with two-column scenes.

The whole page sits on one continuous Emberfall wash (black → blue → purple →
orange), with slow embers (9–16s falls) drifting across it. In order:

1. Sticky nav: flame mark + "Get the app"
2. Hero: the φίλοι name gloss, the headline, the
   launch-state CTA, and a phone showing Kai's burning name climbing 3rd → 1st
3. **Lock in**: the lock-in screen wearing the Emberfall Ascendant flare
4. **Campfires**: the group chat, with a challenge thrown inline
5. **The Agora**: the campus feed
6. **Cindy**: the coach reading the calendar
7. **The Shop · Emberfall**: Flame Pass banner, crates, inventory, equipped profile
8. Final CTA, then the footer with all five required links (incl. Support)

Two Greek-key dividers only: after the hero, and before the Shop.

## Cosmetic art is the app's own renderers, ported

Nothing cosmetic on the page is a stand-in. The inline script ports these
react-native-svg components to web SVG with the same paths, stops and numbers:

| On the page | Ported from |
|---|---|
| Inventory tiles, the profile avatar flame | `economy/item-art.tsx` (`ItemArt`, still path: rarity glow, ground shadow, per-type silhouette) |
| Crates | `economy/box-art.tsx` on `ItemPedestal` |
| The Emberfall Seal, Greek key, "Own Emberfall" flash | `pass/emberfall-art.tsx` |
| Lock-in flame | `flame-icon.tsx` `FlameSvg`, recoloured by `flame-ramp.ts` for an equipped flare |
| Flare aura + risers | `economy/flare-perimeter.tsx` (`FlarePerimeter` tier 3, `Ascendant`) |
| Profile preview | `pass/profile-flex.tsx` (`WithCard`) |
| Burning name | `burning-name.tsx` |

Item names, rarities and palettes are copied from `catalog.ts` (`EMBERFALL_SET`),
crate names and odds from `boxes.ts`. If the app's art or catalog changes,
update the `ITEMS` / `BOX` tables and the matching functions in `index.html`.

## Motion

- Continuous motion is `transform` and `opacity`, with one exception: the
  "Own Emberfall" sweep is the paywall's `background-position` animation.
- Reveals only hide content once the `<head>` script has added `html.js`.
- `prefers-reduced-motion: reduce` stops everything; the climb shows Kai at #1.

## The launch gate (pre-launch ↔ launched, no redeploy)

The page carries **both** states in the DOM. A tiny script at the top of `<head>`
compares `Date.now()` with `LAUNCH` (`2026-10-01T00:00:00-04:00`, the same
instant as `economy_config.season.starts_at`) and toggles `html.launched` before
first paint. CSS does the rest:

```css
html:not(.launched) .cta-live, html.launched .cta-pre { display:none !important }
```

- **`.cta-pre`**: "October 1 on the App Store" badge, "Launches October 1 · iOS", and the waitlist "Notify me" forms (hero and final CTA).
- **`.cta-live`**: App Store buttons → `https://apps.apple.com/app/id6790697786`, "Out now on iOS · Android next".

A timeout flips the class for anyone on the page at midnight, and a 30-second
backstop catches a laptop that slept through it. `LAUNCH` is the only copy of the date.

**Preview either state:** `?preview=launched` or `?preview=prelaunch` (`?preview=pre` also works).

The page flips itself, but the App Store link only works once the approved build
is **Released** in App Store Connect. That step is manual.

## Waitlist

The "Notify me" forms (pre-launch only) post to the `waitlist` Supabase
edge function, which records the address as a Resend contact. With JS off it
falls back to its `mailto:` action.

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
