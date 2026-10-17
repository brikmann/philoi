# Demo student loadouts — edit, then I wire them into the seed

Fill in any slot per person. Overwrite the keys below with ones from the **menu** at the bottom.
Send it back and I'll set every slot in `seed-leaderboard-demo.js` (own + equip).

## What actually shows where
- **Leaderboard ROW** (shot 1) renders only: **flame** (row colour + hex glow), **title** (line under
  the name), and the avatar **halo**. Rank badge comes from score automatically. Particle / card /
  banner / flare / sfx / audio do NOT appear on a board row — so if you're only shooting the
  leaderboard, you only need to customize **flame + title + halo**.
- **Profile screen** renders the full set (flame, particle, halo, card, banner, title…). Customize
  everything only if you'll also shoot these students' profiles.
- **flare** = app-wide perimeter aura, lock-in only (never on a board or static profile).
- **audio** is owned but not auto-worn; **sfx** has two slots (start + stop).

## Per-person loadout (pre-filled = current seed; starter defaults elsewhere)

| # | Name | score | flame | title | halo | flare | particle | card | banner | sfx_start | sfx_stop |
|---|------|-------|-------|-------|------|-------|----------|------|--------|-----------|----------|
| 1 | Maya K. | 545,000 | flame-rank-diamond | title-the-goat | halo-diamond-prism | flare-zeus-wrath | particle-base-spark | card-emberfall-sovereign | banner-base-hearth | sfx-campfire-spark | sfx-ember-settle |
| 2 | Devin R. | 288,000 | flame-cosmic-purple | title-final-boss | halo-hades | flare-void-plasma | particle-base-spark | card-golden-anvil | banner-base-hearth | sfx-campfire-spark | sfx-ember-settle |
| 3 | Priya S. | 154,000 | flame-rank-platinum | title-cracked | halo-glowing-amber | flare-white-incandescence | particle-base-spark | card-emberfall-mythic | banner-base-hearth | sfx-campfire-spark | sfx-ember-settle |
| 4 | Liam O. | 73,000 | flame-electric-cyan | title-built-different | halo-emberfall | flare-acid-rain | particle-base-spark | card-marble-of-olympus | banner-base-hearth | sfx-campfire-spark | sfx-ember-settle |
| 5 | Chloe B. | 35,000 | flame-rank-gold | title-pacesetter | halo-ember-halo | — (none) | particle-base-spark | card-cracked-magma | banner-base-hearth | sfx-campfire-spark | sfx-ember-settle |
| 6 | Noah T. | 12,500 | flame-solar-flare | title-dialed-in | halo-copper-ring | — (none) | particle-base-spark | card-plasma-grid | banner-base-hearth | sfx-campfire-spark | sfx-ember-settle |

(You can also change score, display name, or handle — just say so.)

## Menu — valid keys per slot (roughly common → mythic within each)

**flame:** flame-base-ember · flame-molten-copper · flame-lime-volt · flame-electric-cyan · flame-rank-silver · flame-rank-gold · flame-toxic-green · flame-solar-flare · flame-emberfall · flame-rank-platinum · flame-rank-diamond · flame-cosmic-purple · flame-forge · flame-neutron-starfire · flame-rank-hero · flame-rank-titan · flame-rank-divine · flame-s1-prestige · flame-stormforge · flame-rank-immortal · flame-rank-primordial

**title:** title-base-kindling · title-kindled · title-locked-in · title-ember-stoker · title-night-owl · title-early-bird · title-on-fire · title-pacesetter · title-cracked · title-main-character · title-villain-arc · title-built-different · title-the-goat · title-final-boss · title-the-relentless · title-the-undefeated · title-the-untouchable · title-unbroken · title-elite-ember · title-ashborne · title-ash-sovereign · title-campfire-champion · title-season-mvp · title-dialed-in · title-demigod · title-infernal · title-titan · title-emberfall-elite · title-forged-in-ember · title-s1-top-1 · title-s1-top-5 · title-s1-top-10 · title-ascended *(full list in catalog.ts — 50+ titles)*

**halo:** halo-base-ring · halo-copper-ring · halo-ember-halo · halo-glowing-amber · halo-sakura · halo-diamond-prism · halo-emberfall · halo-inferno-flare · halo-emberfall-mythic · halo-hades · halo-s1-prestige-crown

**particle:** particle-base-spark · particle-falling-ash · particle-floating-sparks · particle-ember-swarm · particle-emberfall-ascendant · particle-solar-flares · particle-lightning-tendrils · particle-void-smoke · particle-s1-prestige

**card:** card-base-hearth · card-brushed-steel · card-forged-bronze · card-carbon-fiber · card-obsidian-mesh · card-cracked-magma · card-emberfall · card-marble-of-olympus · card-plasma-grid · card-golden-anvil · card-emberfall-mythic · card-emberfall-sovereign

**banner:** banner-base-hearth · banner-ashfall-ridge · banner-emberfall-night · banner-ashfall · banner-emberfall-mythic · banner-obsidian-colosseum · banner-the-great-forge

**flare** (lock-in only): flare-solar · flare-white-incandescence · flare-acid-rain · flare-asgardian-valor · flare-emberfall-ascendant · flare-void-plasma · flare-void-purple-aura · flare-s1-prestige · flare-inferno · flare-zeus-wrath

**sfx:** sfx-campfire-spark · sfx-ember-settle · sfx-heavy-anvil-slam · sfx-sub-bass-drop · sfx-jet-engine-ignition · sfx-emberfall-strike · sfx-olympian-foghorn

**audio:** audio-base-hearth-hum · audio-heavy-bonfire-crackle · audio-edm-pulse · audio-midnight-thunder · audio-lofi-lullaby · audio-monastery-drone · audio-deep-space-sub-bass
