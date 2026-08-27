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

## Motion

Each product section has a looping animation ported from the app's real
Reanimated components — the durations, easings, offsets and colours are the
same numbers, not lookalikes. Sources, if you change the app and want these to
follow:

| Section | Ported from |
|---|---|
| Hero campfire | `rank-up-celebration.tsx` — `CampfireFlame` roar (scaleY 1→1.13 / scaleX 1→0.94, 500 ms), `Ember`, `Smoke` |
| Lock in | `lock-in-flame.tsx` — breathe 1→1.08 (900 ms), stage pop + shockwave (scale 1→2.4, 700 ms), glow intensity `0.35 + stage*0.11`; fuel objects from `GOAL_TYPE_FLAME_META` |
| Campfires | `lock-in-flame.tsx` participants — `ZoomIn.springify()` arrivals over a growing flame |
| Ranks | `rank-up-celebration.tsx` — 3900 ms rise on `bezier(.25,.55,.25,1)`, 1080° `rotateY`, `FLARE_DELAY_MS` 3700 flash `#FFE9C2`, coral ring, tier wash; metals from `rank-tiers.ts`, geometry from `hexagon-badge.tsx` |
| Add a friend | `app/add-friend.tsx` — the Add / Requested / Accept / Friends pills, exact padding and colours |
| Daily fire | `flame-meter.tsx` — 700 ms `bezier(.2,.7,.3,1)` fill, coral→amber at full, tier ember counts, `PerimeterRing` licks |

Rules the implementation sticks to:

- **Only `transform` and `opacity` animate continuously**, so everything stays
  on the compositor. Two places swap colour (the lit fuel chip, the meter going
  amber at full) — both are discrete steps at a beat, not tweens.
- **Each stage's base CSS is a finished static illustration.** The JS only adds
  `.is-live` when the stage scrolls into view via IntersectionObserver, and
  removes it on exit so re-entering replays the sequence. With JS off you get
  the illustrations; nothing is invisible.
- **`prefers-reduced-motion: reduce` kills every animation** and never adds
  `.is-live`, falling back to those same illustrations.
- Background tabs drop `.is-live` so six loops aren't burning frames unseen.

One gotcha worth knowing if you edit the delay-tiled loops (the four rank tiers,
the four friend states, the six fuel objects): a CSS animation shows the
element's **base style during its `animation-delay`**, so whichever state is
statically visible must be explicitly hidden under `.stage.is-live` or it will
leak into the other states' windows.

## No waitlist

There is deliberately no email capture on this site. The page closes with a plain
contact band (`#contact`) pointing at `nb@philoi.app` — no forms, no inputs, no
third-party form service, and no JS beyond the scroll-driven stage playback.

If a signup flow is ever wanted, it needs to be added back from scratch rather
than re-enabled; the markup, the `.capture*` styles and the submit handler were
all removed.

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

```bash
npx vercel --cwd site           # preview
npx vercel --cwd site --prod    # production
```

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
