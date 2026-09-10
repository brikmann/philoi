# `outreach-assets/gym-banner/` — Laurier AC retractable banner

The pull-up banner for the Wilfrid Laurier Athletic Complex, pending the
advertising clearance asked for in `PHILOI_GYM_BANNER_EMAIL.md`. Send
**`PHILOI_gym_banner_print.pdf`** to the printer and
**`PHILOI_gym_banner_print.png`** to anyone who just needs to look at it.

The earlier proof lives at `outreach-assets/PHILOI_gym_banner.png`. Keep it —
it is what the clearance email attached, and the copy here is the copy Kevin
and Wesley were shown.

## Final size

| | |
|---|---|
| **Trim** | **850 × 2000 mm** (33.46 × 78.74 in), portrait |
| **Artboard** | 856 × 2006 mm — 3 mm bleed on all four edges |
| **Safe zone** | 40 mm in from every edge, and nothing critical below **1850 mm** |
| **Hidden strip** | the bottom **150 mm** rolls into the stand's base cassette |
| **Colour** | authored in **sRGB** — see the note to the printer below |
| **Type** | **Inter** 400/500/600/700/900, embedded in the file |

Background and the ember footer band run to the bleed edge on purpose. No type,
QR or logo does: the lowest ink that has to be read is the `philoi.app` under
the footer QR at ~1776 mm, still 74 mm clear of the cassette line.

**Confirm the bleed and the hidden strip against the printer's own template if
they supply one.** 150 mm is typical for a roll-up cassette, not universal, and
it is the one number here that comes from the hardware rather than from us.

### Note to the printer

> Artwork is screen-designed in **sRGB**, supplied as vector PDF at final size
> with 3 mm bleed. Please convert to your press profile — do not expect the
> oranges to hit exactly, they are a screen gradient (`#E0612C → #F2A33C →
> #FFD27A`). Body text on the ember band is `#2A1400`, not black, deliberately.

## The QR code

One QR, bottom right of the ember footer band, with `philoi.app` set under it in
dark ink so the URL is readable without a phone. It resolves to
**`https://philoi.app`** — the marketing site, which routes on to the store.
Nothing points at a store listing directly, so the banner does not go stale when
Android ships.

| | |
|---|---|
| Printed code area | **124 mm** (minimum asked for: 40 mm) |
| Error correction | **H** — 30 % recoverable |
| Quiet zone | full 4 modules, drawn inside the viewBox |
| Contrast | dark `#17121F` on white, never inverted |

`verify.mjs` decodes it **out of the exported PNG** on every build — that is the
test-scan, done on the pixels a scanner would see rather than on the source.

⚠ It sits ~270–430 mm off the floor once the stand is up. That is fine to scan
but low to notice, and it is now the only one — if the banner ever reads as
having no obvious call to action from across the room, a second QR up at the
phones (~1.0–1.3 m, the comfortable range) is the fix.

## Files

| file | what it is |
|---|---|
| `banner.html` | **the editable source.** Self-contained: fonts, QR and flame mark are all inlined. Open it in a browser and it renders with no network. |
| `build.mjs` | renders the PDF + PNG with a headless Chrome/Edge already on the machine |
| `verify.mjs` | checks page size and page count, that the PDF is vector, PNG resolution, and decodes the QR |
| `inline-assets.mjs` | regenerates the base64/QR block inside `banner.html` |
| `PHILOI_gym_banner_print.pdf` | **vector**, 856 × 2006 mm — this is what gets printed |
| `PHILOI_gym_banner_print.png` | 5055 × 11847 px = **150 DPI at full size**, for proofing |

## Regenerate

```sh
node outreach-assets/gym-banner/build.mjs     # PDF + PNG
node outreach-assets/gym-banner/verify.mjs    # then always this
```

Only if you changed the URL, the fonts or the flame mark:

```sh
node outreach-assets/gym-banner/inline-assets.mjs
```

`inline-assets.mjs` reads Inter from `node_modules/@expo-google-fonts/inter`
(so run `npm install` in the repo root first) and pulls `qrcode` into a temp
dir on demand; `verify.mjs` does the same with `jsqr` + `pngjs`. Neither adds
anything to the app's `package.json`. `build.mjs` needs nothing at all.

To check the safe zone visually, add `class="show-guides"` to the `<body>` tag
— **the last one in the file**, the header comment contains a literal `<body>`
that a naive find-and-replace will hit first. That draws the 40 mm margin and
the hidden cassette strip over the art. No export path ever sets it.

## Where the design comes from

Nothing here is invented:

| thing | source of truth |
|---|---|
| twilight palette, ember gradient, ink/muted | `src/constants/theme.ts` |
| Inter, and which weights mean what | `src/constants/theme.ts` § `Fonts` |
| flame mark | `philoi-flame-mark.svg` at the repo root, referenced not copied |
| gym set logger screen | `src/components/workout-log.tsx` + `design-mocks/24-gym-session-logger.html` |
| campfire chat screen | `design-mocks/101-campfire-chat.html` |
| the lock-in card in that chat | `src/components/lock-in-event-card.tsx` |
| The Agora screen | `design-mocks/162-agora-screen.html` |
| headline, 3 steps, footer claim | the approved proof, `outreach-assets/PHILOI_gym_banner.png` |

The three phones are the whole pitch in one glance, and **left to right is the
story**: you log a set, it lands in your gym's chat, it goes out to the campus
feed.

| | screen | caption |
|---|---|---|
| 1 | the set logger mid-session — squat 225/245/265 with a PR, a half-entered bench set | "Log your gym sets" |
| 2 | the Laurier Gym campfire, lock-ins and a group challenge inline | "Your gym's group chat" |
| 3 | The Agora, filtered to University | "The Agora — campus feed" |

The set logger is the 4-column `SET / LB / REPS / ✓` grid that actually shipped
in `workout-log.tsx`, down to its fractional type sizes and the values it
hardcodes instead of taking from `theme.ts` — the card at `rgba(36,28,56,0.82)`
so the session flame glows through, the banked-cell border at coral 40 %, the
Finish button at radius 13. `design-mocks/52` draws a set as an inline row with
a green tick; that variant never shipped, so it is not what is on the banner.

The phone screens are **rendered from the mocks and the real component**, not
photographed. When there is a clean build on a device, replacing them with
actual screenshots is a drop-in: the frames are `.phone > .screen`, a real
390 × 844 logical viewport scaled bodily, so a 390 × 844 screenshot swaps
straight in at the same size. Phone width is set in one place — `--pscale` on
`.phone`, currently 2.26772 for a 240 mm device.

**Two constraints hold that 240 mm, and they meet exactly.** Across:
3 × 240 + 2 × 25 mm of gap = 770 mm, which is the content width, so the row
starts on the left margin and ends on the right one. Down: a 240 mm phone is
512 mm tall, and at `top: 708mm` the row bottoms out at 1220 mm with the
captions at 1238 and the HOW TO JOIN eyebrow at 1290. Widen the phones and they
run into the eyebrow; change the gap and the row stops meeting the margins.

## Two things that are deliberate, and one to watch

**No Laurier crest, purple or gold.** The university's marks need their own
brand approval, separate from advertising clearance. The nod is text only:
"Built by a Golden Hawk · free for students".

**No store badges at all.** An earlier cut carried Apple's official
"Download on the App Store" lockup; it came off with the left-hand scan block.
Nothing on the banner now names a store, which sidesteps the problem that
`PHILOI_IOS_DATES.md` ships v1 iOS-only with Android at reading week — a Play
badge would have pointed at a listing that does not exist yet. Step 1 of HOW TO
JOIN still carries the honest version in words: "free — iOS now, Android next".
If the badge is ever wanted back, it is Apple's supplied artwork, never redrawn,
from `https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg`,
and it needs clear space of at least a tenth of its own height on all sides.

⚠ **The in-app numbers are illustrative, and one of them used to be a claim.**
The proof's campfire header read "312 members · 41-day streak" for a campfire
that does not have 312 members yet. That is gone — the header now reads
"campfire · roaring" with no count. The XP, reaction and rank numbers inside the
phone screens are ordinary UI sample data and read as such, but **do not put a
membership or user count back on this banner** unless it is true on the day it
prints.
