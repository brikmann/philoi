# Punchlist 14 — loot-box open UX, reveal SFX, flare session-tiering

Three things off the on-device box-open pass (screenshots).

---

## 1 · Simplify the open animation — stop telegraphing rarity
Right now the ×10 open floods the screen with big rarity-colored auras and rarity-tinted card borders
*before* anything is revealed (the overlapping circles, the colored star cells). It reads as a rarity
light-show, not "you opened boxes." Make it dead simple: **N boxes open → here are your items.** Nothing
about rarity until the item itself is shown.

Strip the rarity telegraph from the OPENING phase:
- `multi-deal.tsx:108` — drop `borderColor: RARITY_COLOR[rarity]` on the dealt cells; use the neutral
  card border. The cell shows plain **box art**, not a rarity-tinted shape.
- `box-crack.tsx:132` — the crack pulse is `RARITY_COLOR[rarity]`; make it a neutral/gold crack, same
  for every box. The crack shouldn't leak the tier.
- Remove the full-bleed rarity **aura circles** behind the grid (the `rarityGlow` overlay in the deal
  phase). Opening is just the boxes cracking.
- Keep the phase caption honest: "Opening 10…" (count), not a rarity readout.

Reveal rarity only at the RESULTS grid (where it belongs), and simplify that too:
- Lead with a plain count — "You opened 10" — not the giant red **BEST PULL** hero that currently
  collides with everything. Then the grid of items: art + name + rarity label, dupes dimmed with their
  salvage payout. That's it.
- 1× keeps its single hero reveal (one item, its own rarity flourish on reveal is fine).

Net: the animation says "boxes opening," the grid says "here's what you got." No rarity spoiler in
between.

## 2 · Reveal SFX — the common→mythic ladder (was scoped, never built)
`MultiDeal` plays no sound, and there are no per-rarity reveal cues. Build the audio moment:
- **Open cue** — a crack/whoosh as each box pops (one-shot; on ×5/×10 it fires per box in the cascade,
  lightly staggered so it reads as a run, not a wall).
- **Per-rarity reveal sting**, escalating with the best pull:
  | Rarity | Reveal |
  |---|---|
  | Common / Uncommon | short, dry tick — barely there |
  | Rare | brighter chime |
  | Epic | chime + a short rising swell |
  | Legendary | swell + a choir "haaa" enters |
  | Mythic | full choir "HAAAA" + low sub — the "holy shit" moment |
- On ×10, the reveal sting plays once for the **best pull** (not ten times); the per-box open cue
  covers the rest.
- New (non-dupe) high-tier pulls get the choir; dupes get a muted version so a salvaged dupe doesn't
  fake a jackpot.

**Audio is cut** — built to the 6-tier framework, 7 files in `assets/sounds/reveal/` (no clipping):

| Cue | File | Layers | Decay |
|---|---|---|---|
| `box-open` | `reveal/box-open.mp3` | crack/whoosh per box (subtle — fires ×N) | 0.3s |
| `reveal-common` | `reveal/reveal-common.mp3` | cardboard flip + dull felt drop, dead dry | none (0.2s) |
| `reveal-uncommon` | `reveal/reveal-uncommon.mp3` | leather slide + metal snap + warm G4 wood chime | 0.5s room |
| `reveal-rare` | `reveal/reveal-rare.mp3` | wind swoosh + hum, brass unlock, C5 crystal chord | 1.2s shimmer |
| `reveal-epic` | `reveal/reveal-epic.mp3` | air-suction + arc crackle, resonant synth-gong hum (no choir) | 2.5s swell |
| `reveal-legendary` | `reveal/reveal-legendary.mp3` | 0.2s duck → horn riser, vault slam + brass fanfare + sparkle | 3.5s cathedral |
| `reveal-mythic` | `reveal/reveal-mythic.mp3` | sub vacuum → implosion/plasma shockwave + war-horn + growl | 5s+ aura tail |

*Made from synth + your own assets (choir/sparkle/riser/foghorn from the rank-up set), nothing
externally sourced. The brass fanfare, synth-gong and war-horn are synth approximations — if you want
true orchestral brass/horns later, that needs licensed samples I can't pull here.*

**Haptics** (the framework's per-tier pattern → expo-haptics, Code wires these with the cue):
common = light tap · uncommon = crisp double-tap · rare = sharp tap + fading buzz · epic = heavy
rumble + high ripple · legendary = max double-thud + ~1s decay pulse · mythic = prolonged heartbeat
shockwave wave.

Wiring:
- Add the 7 cues to the `RewardCue` union + `SOURCES` in `sound.ts`.
- **box-open** fires per box in the deal/crack cascade (`multi-deal.tsx` / `box-crack.tsx`), lightly
  staggered.
- **reveal-<rarity>** fires once for the **best pull's** rarity when the results land (`open.tsx`). On
  1× it's that item's rarity.
- If the best pull is a **dupe**, play the reveal cue at reduced volume (~0.4) so a salvaged dupe
  doesn't fake a jackpot. New (non-dupe) high-tier keeps the full choir.
- `git add assets/sounds/reveal/` (new, untracked).

## 3 · Flare / aura session-tiering — resolve the spec conflict + build it
**Spec conflict:** ITEM_CATALOG §1c says God-Mode Flares are "active only during 90m+ sessions," but
§2b (session-tiered aura) says any equipped aura escalates at **30 / 60 / 90 min**. Resolve to the
30/60/90 model (the user's intent) and delete the "90m+ only" line in §1c.

**And it's unbuilt:** there's no elapsed-time gate on the equipped flare/aura anywhere — no 1800/3600/
5400s thresholds, no equipped-flare render tied to `elapsedSeconds`. So an equipped flare shows nothing
at 30 min. Wire it:
- Drive off the existing `useElapsedSeconds` on the lock-in screen.
- Tier from elapsed: **≥30 min → Kindled** (soft glow), **≥60 → Burning** (brighter, motion),
  **≥90 → Locked In** (full intensity), nothing before 30.
- Render the equipped FLARE (recolored per the item) at the tier's intensity on the live-session flame;
  resets when the session ends. No XP coupling — pure visual.
- Applies to any equipped aura/flare; the same ramp can intensify a flame skin per §2b.

---

## Minor (same screenshot) — session pill overlaps the results
The live-session pill ("Study · 27:31") floats over the box-open results and collides with the BEST
PULL title. Once #1 drops the giant hero that mostly resolves, but the floating pill should sit under
the modal/results layer (z-index) or hide while a box-open reveal is on screen.

## Ship
All JS → OTA, except the reveal SFX assets (#2) which I'll cut. #1 and #3 are the priorities.
