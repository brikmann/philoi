# Cosmetic art-system pass — tracker + briefs

Full redraw/render pass across all cosmetic types. Split into **render/behavior fixes** (spec — I can nail
these) and **illustrative art** (needs an illustrator/image-gen for final; hand-SVG is concept only).

## A · Render / behavior fixes (spec — not art)
- **Titles — stop rendering as a pill.** On the profile a title should render as just the **styled title text**
  (a small wordmark/label under the name — its own colour/weight per rarity), not a chip/pill background. In
  the collection, preview it as the text itself. A title is a *name*, not a badge.
- **Cards — render the actual graphic.** The equipped CARD cosmetic (profile card backdrop) must render as its
  **real art/texture** behind the identity block on the profile, and as a proper **swatch/thumbnail of that art**
  in the collection — not a flat colour fill. (This is the §2 cosmetic-render bug PROFILE_SPEC already flags.)
- **Banners — render the actual graphic.** Same: the BANNER must show its **real illustrated art** on the
  profile/campfire header and as a real thumbnail in collection — not a flat colour/placeholder.

## B · Illustrative art (concept + brief; final by illustrator/image-gen)
- **Audio + SFX icons — ✅ DONE (mock 120).** Each shown as its symbol (campfire, book, anvil, rocket, EQ…),
  rarity-tinted.
- **Flares — punchier.** They're an app-wide perimeter aura (colour + effect). Make the vectors *bolder*:
  higher-contrast, more energetic motion (jagged/pulsing edges, denser particles), not a soft even glow. Each
  flare should read as a distinct energy, not a tint.
- **Halos — cooler.** More striking silhouettes/effects (orbiting shards, cracked rings, prismatic arcs, etc.)
  — a halo should feel like a crown of energy, not a plain ring.
- **Relics — the ancient set (§4a) + discipline ladders (§4a-2) + Atlas.** Ancient = mysterious locked state +
  reveal (secret achievements). Mocks 118/119 cover discipline + Atlas; ancient set still needs its own sheet
  (locked silhouette + hint, and the unlock reveal).
- **Medals — season/placement medals.** Own sheet needed.
- **Cards / Banners art** — beyond the *render* fix above, the actual art pieces per item need illustrating.

## Order — pick the next sheet
Suggested: relics + medals (achievement art) → flares + halos (aura art) → cards + banners art. The three
render/behavior fixes (§A) can ship independently of the art — they're spec.
