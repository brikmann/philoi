# Code Prompt — The banner set: one bespoke animated scene per banner (full-screen)

Every campfire banner gets its **own coded, animated, full-screen scene** — not the current shared "2-colour gradient + one ridge silhouette." Reference: **`design-mocks/101c-banner-art.html`** (each scene is built there; match its composition + motion). On `integration-wave1`, client/OTA (SVG + Reanimated, no rebuild). This supersedes the generic art in `src/components/economy/campfire-banner-art.tsx`.

## §0 · Delete two banners first
Remove **Emberfall Banner** (`banner-emberfall`) and **Emberfall Elite** (`banner-emberfall-elite`) from the catalog (`src/lib/economy/catalog.ts`) — Noah cut them (too specific).
- **Forge Pass S1** granted `banner-emberfall` at a tier — reassign that reward slot to another banner (e.g. **Emberfall Standard** or **Ashfall**); don't leave the pass granting a deleted item.
- **`banner-emberfall-elite`** is `earned` + `seasonStamped` — if any account already owns it, **don't hard-delete their item** (grandfather it, or swap it to Ashfall on their loadout). Flag the owned-item handling for Noah rather than orphaning an equipped banner; report who (if anyone) has it.
- After removal the set is **7 banners** (below). Nothing should reference the two deleted ids.

## §1 · Full-screen + animated, backing the whole campfire
Each banner renders **top-to-bottom, edge-to-edge** as the campfire's background (per the campfire chat redesign, mock 101 / R2–R3): behind the header, the feed/chat, and the message composer, with a legibility scrim so text stays readable. All scenes are **animated** (like the flares) and must be **cheap** — they run continuously behind a live chat, so cap particle counts, use Reanimated worklets / a small looped SVG, no per-frame React re-renders. **Reduce-motion:** fall back to the static first frame (gradient + silhouettes, no particles).

## §2 · The seven scenes (match mock 101c)
Each keeps its catalog `from`/`to` colours as the base palette; the scene is the identity.

1. **Hearthlight** (`banner-base-hearth`, common, **DEFAULT**) — quiet: mountain **ridge** silhouettes + **embers drifting up**. (This is essentially today's art — keep it.)
2. **Emberfall Night** (`banner-emberfall-night`, epic) — deep night sky, a **starfield** with a few **constellations drawn** (star nodes joined by faint lines), a few embers adrift.
3. **Ashfall Ridge** (`banner-ashfall-ridge`, epic) — a **distant city skyline** on the horizon with **ash falling** over it; muted grey-lavender.
4. **Obsidian Colosseum** (`banner-obsidian-colosseum`, legendary) — the **Roman colosseum in 2.5D** (nested elliptical wall tiers so you read the full curved bowl) **grounded in a night sky** (stars behind), arched **windows flickering** with gold light + torch glow.
5. **The Great Forge** (`banner-the-great-forge`, legendary) — **pure black**; a **distant, intensely-lit anvil** with a **smith figure striking** it (hammer swings on a ~2.4s cycle); the **whole anvil flares** and **sparks burst** synced to each strike.
6. **Ashfall** (`banner-ashfall`, legendary) — a **cloaked/Greek-statue man standing on a mountain**, **torch raised** (flame flickering); a **city burns** behind and below him (foreground + horizon buildings on fire, lit windows, rooftop flames); **ash rains** over the whole scene; he's back-facing, turned slightly right so **only one eye** shows, **flickering with flame**. Cryptic — "he's turned the city to ash."
7. **Emberfall Standard** (`banner-emberfall-mythic`, mythic, season-stamped) — **ONE giant pulsing Cindy flame** centred, and the **screen borders flicker with an aura** like a flare (inset perimeter glow pulsing with the flame). The apex.

## §3 · Where the art plugs in
`campfire-banner-art.tsx` currently resolves `bannerColors(key)` → `{from,to}` and paints a `sky` gradient + one ridge + `EmberDrift`. Refactor so each banner id maps to **its own scene component** (a switch on the cosmetic key/id), each drawing its bespoke SVG layers + Reanimated particle/flame system, all sized to the full screen via the existing `variant="screen"` path. Keep `bannerColors` for the base palette and the legibility scrim helper. The banner still comes from `groups.banner_item_id`; only the *rendering* per id changes.

## Done
- `banner-emberfall` + `banner-emberfall-elite` removed from catalog; Forge-Pass slot reassigned; owned-Elite handling flagged (not orphaned).
- The 7 remaining banners each render their **own full-screen animated scene** per mock 101c, backing the campfire chat/feed/composer, with a legibility scrim and a reduce-motion static fallback, and cheap enough to sit behind a live chat.
- Reference: `design-mocks/101c-banner-art.html`.
