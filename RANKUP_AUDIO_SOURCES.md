# Rank-up audio — Pixabay sourcing sheet

Component clips for each rank's layered SFX (companion to `RANKUP_SPEC.md`). All links are
**Pixabay** — [Content License](https://pixabay.com/service/license-summary/): free for commercial
use, no attribution required, can't be resold standalone. Perfect for in-app SFX.

**Workflow:** each rank is a *layered design*, so grab the component clips below, **pre-mix each
rank into ONE file** in Audacity/a DAW (bake in the silence gaps for the band crossings), export
mono/stereo MP3 or M4A, and ship one clip per rank in `assets/audio/rank/`. Code plays a single
file per rank via `expo-audio` — no runtime layering. Target ~48kHz, keep files < ~200KB (trim tails).

---

## Mortal climb

### Bronze — anvil impact + warm brass ring + ember decay
- Anvil / forge: https://pixabay.com/sound-effects/search/anvil/ · https://pixabay.com/sound-effects/search/blacksmithing/ (look for "Realistic Anvil Hit & Forging Metal Ring", "Steel Hit Anvil Ring")
- Warm low brass ring: https://pixabay.com/sound-effects/search/brass/
- Ember crackle tail (low, subtle): https://pixabay.com/sound-effects/search/fire%20crackle/

### Silver — blade draw → crisp mid chime
- Sword/blade draw: https://pixabay.com/sound-effects/search/sword%20unsheathing/ ("Sword Unsheathing" by DRAGON-STUDIO, "Steel Draw Metal Knife")
- Crisp mid chime to end on: https://pixabay.com/sound-effects/search/metallic/ · https://pixabay.com/sound-effects/search/ding/

### Gold — coins clink + brass gong + warm reverb tail
- Gong (specific): https://pixabay.com/sound-effects/gong-106628/ · more: https://pixabay.com/sound-effects/search/gong/
- Coins clink: https://pixabay.com/sound-effects/search/coins/
- (Add a warm reverb on the gong in the mix rather than sourcing separately.)

### Platinum — clean high titanium "tink" → rising metallic hum
- High metallic tink: https://pixabay.com/sound-effects/search/metallic/ · https://pixabay.com/sound-effects/search/ting/
- Rising metallic/sci-fi hum: https://pixabay.com/sound-effects/cinematic-designed-sci-fi-riser-orbit-228309/ · https://pixabay.com/sound-effects/search/cinematic%20riser/

### Diamond — glass-crystal shatter → singing-bowl resonance
- Glass shatter: https://pixabay.com/sound-effects/search/glass/ · https://pixabay.com/sound-effects/search/shatter-glass/
- Singing-bowl resolve: https://pixabay.com/sound-effects/search/crystal-singing-bowl/ ("Serene Crystal Singing Bowls")

---

## Realm of legend

### Hero — war-horn blast + shield-bash sub-drop + squad chant (B♭ major)
- War horn (specific): https://pixabay.com/sound-effects/war-horn-blast-14760/ · more: https://pixabay.com/sound-effects/search/war%20horn/
- Shield-bash / bass impact: https://pixabay.com/sound-effects/search/bass%20impact/
- Crowd/squad chant echo: https://pixabay.com/sound-effects/search/battle/

### Titan — sub-bass shockwave (30–50Hz) + seismic tearing + distant thunderclap
- Sub-bass shockwave: https://pixabay.com/sound-effects/search/sub-bass/ · https://pixabay.com/sound-effects/search/rumble-bass/
- Seismic rock tearing: https://pixabay.com/sound-effects/search/earthquake%20rumble/ ("Earthquake Rumble & Cracking", "Low Sub Bass Cinematic Rumble" by Chrysalyn)
- Distant thunderclap: https://pixabay.com/sound-effects/search/thunder/

### Olympian — bright brass swell + wind-chime halo + booming choir (C major)
- Choir (specific): https://pixabay.com/sound-effects/angelic-choir-6793/ · epic bed: https://pixabay.com/music/choir-epic-hopeful-choir-orchestral-194875/
- Orchestral brass swell: https://pixabay.com/sound-effects/search/epic%20choir/ · https://pixabay.com/sound-effects/search/brass/
- Sweeping wind-chime halo: https://pixabay.com/sound-effects/search/magical%20chimes/ · https://pixabay.com/sound-effects/search/shimmer/

### Immortal — heartbeat sub-drop → pitch-shifting hum that never fully fades + the laughter of the damned
- Heartbeat sub: https://pixabay.com/sound-effects/search/bass-drone/ ("Dark Atmospheric Drone Slow Heartbeat Noise" by Chrysalyn, "Heartbeat and tense synth" by Tomas_Herudek)
- Persistent synth hum / pad (the 3s tail that dissolves to ambient): https://pixabay.com/sound-effects/search/low%20drone/ · https://pixabay.com/sound-effects/search/dark%20synth/ ("Dark Atmospheric Pads")
- **The souls of the dead, laughing** — a slow, haunting chorus of ghostly whispers + distant laughter, buried LOW under the hum: the damned mock you and pray for your downfall, but death has no claim ("DEATH HAS NO CLAIM / YOU CANNOT FALL"). Ghostly whispers (specific): https://pixabay.com/sound-effects/horror-ghostly-whispers-6085/ · more: https://pixabay.com/sound-effects/search/ghost%20whisper/ · https://pixabay.com/sound-effects/search/ghostly/ · distant demonic/soul laughter: https://pixabay.com/sound-effects/search/demonic/ ("Demonic Spirit Voice – Sinister Laughter") · https://pixabay.com/sound-effects/search/horror-laughter/
  - **Chosen clip is in-repo:** `assets/sounds/rankup-immortal-souls.mp3` (Pixabay "Demonic Spirit Voice – Sinister Laughter", phatphrogstudio).
  - **Mix it right:** pitch/time-stretch the laughter **down** (slow + deep), drown it in **reverb**, layer 2–3 voices so it reads as *many* souls, and keep it **quiet** — a cold undercurrent beneath the heartbeat + hum, never a foreground jump-scare. It should feel like triumph *over* the dead, not horror. Pairs with the ghost-wisp visual motif (RANKUP_SPEC §2).

### Primordial — 0.5s silence → vacuum implosion → plasma-flare riser + bass drop + lightning
- Silence: audio-duck in code (don't source).
- Vacuum pull / implosion (reverse whoosh): https://pixabay.com/sound-effects/search/whoosh%20reverse/ · https://pixabay.com/sound-effects/search/reverse/
- Plasma-flare riser + bass drop: https://pixabay.com/sound-effects/search/cinematic%20riser/ · https://pixabay.com/sound-effects/search/cinematic%20bass/ ("Cinematic Intro Whoosh with Deep Bass Drop" by Chrysalyn)
- Lightning/plasma crackle: https://pixabay.com/sound-effects/search/electric%20zap/ · https://pixabay.com/sound-effects/search/electricity/

---

## The two band-crossing events (from RANKUP_SPEC §1)

These reuse the layers above but with choreographed timing — pre-mix each as its own dedicated file:

- **Diamond → Hero:** Diamond glass-shatter → **0.3s hard silence** → war-horn blast + shield-bash sub-drop. (Copy: `MORTAL LIMITS BROKEN.` / `WELCOME TO THE REALM OF LEGEND.`)
- **Immortal → Primordial:** **0.5s full silence (duck)** → vacuum pull → plasma riser + 20Hz bass drop + lightning crackle. (Copy: `THE PANTHEON KNEELS.` / `YOU HAVE SURPASSED THE GODS.`)

Both are full-screen takeover modals that lock interaction ~3s while audio/haptics/animation play out.

---

## Deliverable
10 pre-mixed rank clips + 2 dedicated band-crossing clips (Hero/Primordial land on their band-crossing
mix; the other 8 use their single-tier mix). Drop them in `assets/audio/rank/`, wire into `src/lib/sound.ts`
per rank name. Victory Anthem = the Hero + Primordial band-crossing mixes (reserve for those two only).
