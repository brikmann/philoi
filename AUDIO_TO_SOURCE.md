# Audio still to source — Pixabay shopping list

Everything the code expects but doesn't have yet. All [Pixabay](https://pixabay.com) (free commercial
use, no attribution). **Rank hits + SFX** = short one-shots (~0.5–2s), export to `assets/sounds/*.wav`.
**Audio environments** = seamless *loops* (grab from the Music section where noted). Band-crossing mixes
go in `assets/audio/rank/*.m4a`. Each starts working the moment the file lands — seams are wired.

---

## A · Rank-up band crossings (2) — layered mixes, full layer breakdown in RANKUP_AUDIO_SOURCES.md

| Target file | Intent | Pixabay searches |
|---|---|---|
| `assets/audio/rank/ascension-hero.m4a` | Diamond→Hero: war-horn blast + shield-bash sub-drop + squad chant | [war horn](https://pixabay.com/sound-effects/war-horn-blast-14760/) · [bass impact](https://pixabay.com/sound-effects/search/bass%20impact/) · [battle crowd](https://pixabay.com/sound-effects/search/battle/) |
| `assets/audio/rank/ascension-primordial.m4a` | Immortal→Primordial: 0.5s silence → vacuum implosion → plasma riser + bass drop + lightning | [reverse whoosh](https://pixabay.com/sound-effects/search/whoosh%20reverse/) · [cinematic bass drop](https://pixabay.com/sound-effects/search/cinematic%20bass/) · [electric zap](https://pixabay.com/sound-effects/search/electric%20zap/) |

## B · Legend-tier hits (4) — short one-shots, replace the current fallbacks

| Target | Tier identity | Pixabay searches |
|---|---|---|
| `rankup-hero.wav` | crimson valor / mortal ascends — heroic brass stab or sword-shield ring | [heroic brass stab](https://pixabay.com/sound-effects/search/brass%20stab/) · [epic hit](https://pixabay.com/sound-effects/search/epic%20impact/) |
| `rankup-titan.wav` | colossal / earthquake — deep boom + short rumble | [cinematic boom](https://pixabay.com/sound-effects/search/cinematic%20boom/) · [deep impact](https://pixabay.com/sound-effects/search/deep%20impact/) |
| `rankup-olympian.wav` | divine radiance — bright celestial chime / harp glissando (its own, not the borrowed sparkle) | [celestial chime](https://pixabay.com/sound-effects/search/celestial/) · [magic sparkle harp](https://pixabay.com/sound-effects/search/magic%20sparkle/) |
| `rankup-immortal.wav` | ethereal / deathless — haunting shimmer or reversed bell (pairs *over* the souls layer) | [ethereal shimmer](https://pixabay.com/sound-effects/search/ethereal/) · [reverse bell](https://pixabay.com/sound-effects/search/reverse%20bell/) |

*(These four need a one-line add to the `RewardCue` union + `SOURCES` in sound.ts + the tier map in
reward-feedback.ts — only Olympian is stubbed in so far. Platinum stays on the generic hit by design.)*

## C · Cosmetic Audio environments (7) — seamless LOOPS (focus audio)

| Item · id | Vibe | Where to look |
|---|---|---|
| ~~Hearth Hum · `audio-base-hearth-hum`~~ **sourced** | low, steady hearth hum — the free starter loop **every account owns and can equip in one tap**, so its absence was audible silence rather than a gap in a box pool | *landed 2026-08-23; wired in `sound.ts`* |
| Heavy Bonfire Crackle · `audio-heavy-bonfire-crackle` | campfire crackling ambience | [campfire loop](https://pixabay.com/sound-effects/search/campfire/) · [fire ambience](https://pixabay.com/sound-effects/search/fire%20crackling/) |
| EDM Pulse · `audio-edm-pulse` | driving techno/electronic pulse | Music: [edm loop](https://pixabay.com/music/search/edm/) · [techno](https://pixabay.com/music/search/techno/) |
| Midnight Thunder · `audio-midnight-thunder` | distant thunderstorm + rain | [thunderstorm ambience](https://pixabay.com/sound-effects/search/thunderstorm/) · [rain loop](https://pixabay.com/sound-effects/search/rain%20ambience/) |
| Monastery Drone · `audio-monastery-drone` | held gregorian/monastic drone | [gregorian drone](https://pixabay.com/sound-effects/search/gregorian/) · [meditation drone](https://pixabay.com/sound-effects/search/meditation%20drone/) |
| Lofi Lullaby · `audio-lofi-lullaby` | lofi chillhop bed | Music: [lofi](https://pixabay.com/music/search/lofi/) · [chillhop](https://pixabay.com/music/search/chill%20lofi/) |
| Deep Space Sub-Bass · `audio-deep-space-sub-bass` | deep space ambient sub-bass drone | [space ambience](https://pixabay.com/sound-effects/search/space%20ambience/) · [sub bass drone](https://pixabay.com/sound-effects/search/sub-bass/) |

> Loops: pick tracks that loop cleanly (or trim to a seamless loop point). For EDM/Lofi use the **Music**
> section, not sound-effects.

## D · Cosmetic rank-up SFX (6) — short one-shots

| Item · id | Sound | Pixabay searches |
|---|---|---|
| Heavy Anvil Slam · `sfx-heavy-anvil-slam` | single heavy anvil/hammer strike | [anvil hit](https://pixabay.com/sound-effects/search/anvil/) · [blacksmith](https://pixabay.com/sound-effects/search/blacksmith/) |
| Sub-Bass Drop · `sfx-sub-bass-drop` | floor-dropping bass hit | [bass drop](https://pixabay.com/sound-effects/search/bass%20drop/) · [cinematic bass hit](https://pixabay.com/sound-effects/search/bass%20hit/) |
| Jet Engine Ignition · `sfx-jet-engine-ignition` | afterburner/jet ignition whoosh, "zero to gone" | [jet engine](https://pixabay.com/sound-effects/search/jet%20engine/) · [afterburner](https://pixabay.com/sound-effects/search/rocket%20ignition/) |
| Olympian Foghorn · `sfx-olympian-foghorn` | deep, godly foghorn/horn blast | [foghorn](https://pixabay.com/sound-effects/search/foghorn/) · [ship horn](https://pixabay.com/sound-effects/search/horn%20blast/) |
| ~~Emberfall Strike · `sfx-emberfall-strike`~~ **SOURCED** (synthesized, original) — hammer transient + sub thud + inharmonic anvil ring (~3.4s tail) + ember shimmer + light reverb; main + preview placed in `assets/audio/cosmetic/`. Ships on next native rebuild. | — | — |
| Victory Anthem · `sfx-victory-anthem` | short triumphant fanfare (can double as the Hero/Primordial anthem base) | [victory fanfare](https://pixabay.com/sound-effects/search/victory/) · [triumphant fanfare](https://pixabay.com/sound-effects/search/fanfare/) |

---

### Totals
**6 rank-up sounds** (2 band-crossing mixes + 4 legend tiers) and **13 cosmetic files** (7 ambient loops +
6 SFX), of which **Hearth Hum and Emberfall Strike are now sourced** (both synthesized, original). Rank-up sounds are the priority (they're part of the core rank experience); the cosmetic set is
needed once the final-pass equipped-audio wiring lands. License note: Pixabay Content License — free for
commercial use, no attribution, can't resell standalone; perfect for in-app audio.
