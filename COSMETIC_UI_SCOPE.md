# Cosmetic UI — what "finished + uploaded" actually means
_Grounded in the code on `add-marketing-site`. The big finding: the cosmetic art is **already procedural and code-complete** — it is not a pile of missing image files._

## How cosmetics render (already built)
`src/components/economy/item-art.tsx` draws **one vector family per art kind**, recolored by each item's two-stop palette (`art: { kind, from, to }`). All 11 kinds are handled: `flame · particle · flare · card · halo · title · banner · audio · sfx · relic · medal`. The design rule (from the file): *"~60 items don't need ~60 hand-drawn files — the silhouette is the constant, the palette is the item."*
- **Inward — flames / flares / particles:** done. `item-art.tsx` + `applied-art.tsx` (the applied `aura` perimeter) + `flare-perimeter.tsx`. Mocks 118/119/126 are the reference; verify the shipped shapes match them.
- **Outward — cards / banners / halos:** done. Each has a `case` in `item-art.tsx`. These are the profile / Agora-author flex layers.
- **Relics / medals:** done — relic renders as "a faceted gem on a plinth," palette per item (Hestia's Hearthstone, Prometheus' Shard, etc. in `catalog.ts`). **The 🏛️ in the mocks is HTML shorthand; the app already draws the real vector.**

## Audio / SFX (assets exist, need merging + wiring)
- Audio cosmetics have **real files** in a worktree: `assets/audio/cosmetic/` (deep-space-sub-bass, edm-pulse, heavy-bonfire-crackle, lofi-lullaby, midnight-thunder, monastery-drone) + `/preview/` clips. Rank-up SFX ladder + `ignite/whoosh/settle/spark` shipped in `assets/sounds/`.
- **Work left:** merge that worktree's audio into the branch, wire the SFX pipeline (#49), the two SFX slots start/stop (#82/#83), and audio preview play buttons (#81). SFX starter set reuses shipped `spark.wav`/`settle.wav` — no new files needed for v1.

## So "finished + uploaded" = these steps (not new art)
1. **Verify** each procedural art kind matches its approved mock (flames 118, flares 119, cards/banners/halos) — visual QA pass, tweak the `shapeFor` paths if they drifted.
2. **Land equipped cosmetics on every surface** (#127/#132): home flame, flare perimeter aura, profile card+halo+banner, and now **Agora post authors render their halo + flex card** (mock 162). Confirm `applied-art` is invoked on each.
3. **Merge + wire audio** (#49/#81/#82/#83): bring the worktree audio onto the branch, hook the pipeline, preview buttons, start/stop SFX slots.
4. **The one true new-art need:** the **discipline / activity icon set** — see GRAPHIC_PLACEHOLDER_AUDIT.md + mock 163. Everything else is code that already exists.
5. **Commit + push** so it's "uploaded."

Bottom line: the cosmetic *system* is done. The remaining cosmetic work is verification + surface wiring + the audio merge + the discipline icon set — not generating dozens of images.
