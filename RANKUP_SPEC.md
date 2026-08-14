# Rank-up moment spec — the Primordial ladder (build spec for Code)

Extends the **existing** `src/components/rank-up-celebration.tsx` (708 lines: badge-morph from the flames, `TierFlashOverlay` keyed to `TIER_FLASH_KIND`, bespoke particle systems for Gold/Diamond/Infernal, full-screen tier wash, `onShare` hook) and `src/lib/rank-up-copy.ts` + `RANK_UP_COPY.md`. **Do NOT rebuild it** — add the four new legend tiers, rename the apex, and layer in the escalation model below. Companion to `RANK_REWORK_SPEC.md` (the ladder/curve) and `design-mocks/05-rankup-legend.html` / PHILOI_UI_SPEC.md §11.

**All JS. No native. Ships OTA.**

---

## 1 · Escalation model — three intensities

The component already splits `isDivisionBump` vs tier crossing. Add a **third, rarer** level: `isBandCrossing`.

| Level | When | Feel | Duration |
|---|---|---|---|
| **Division bump** | III→II→I *within* a tier | The incineration (fuse-in → hellfire burns a numeral off) + **the tier's own rank-up hit** lands as the new division locks, light haptic. **NO copy** (§5) | ~1.5s |
| **Tier crossing** | `X I → Y III` (tier *type* changes) | Full: badge morphs old→new, the new tier's bespoke motif + `TIER_FLASH_KIND` particles, heavier wash (~0.7), medium+success haptic, tier rank-up SFX, share offered | ~3s |
| **Band crossing** ✦ new | **Only two moments:** `Diamond I → Hero III` (enter the Realm of Legend) and `Immortal I → Primordial` (the apex) | Cinematic: an extra framing beat + the grand treatment, hardest wash (0.9), heavy haptic sequence, **Victory Anthem**, share surfaced prominently | ~4–5s |

Add an `isBandCrossing` prop (true iff the crossing lands on `hero` III *from* diamond, or on `primordial`). It gates the framing card, Victory Anthem, and the auto-share.

**Band-crossing framing card** (a 1.2s pre-beat before the badge morph) — uses the tier's own §5 copy:
- → Hero: "**MORTAL LIMITS BROKEN.**" then "WELCOME TO THE REALM OF LEGEND."
- → Primordial: "**YOU ARE BEYOND TIME ITSELF.**" then "YOU ARE NOW PRIMORDIAL."

---

## 2 · Per-tier motif

Reuse the existing particle primitives (Ember, Smoke, Glint [sparkle+prism], FlameBlob, HexLick, metallic sweep, tier wash). Recolor per `RANK_TIER_METAL`. New tiers get a distinct, escalating motif — don't let them fall back to a generic wash.

| Tier | Flash kind | Motif (color = `metal.inner`) |
|---|---|---|
| bronze | — | sweep + embers *(existing)* |
| silver | sweep | metallic sweep *(existing)* |
| gold | sparkle | sweep + gold sparkle glints *(existing)* |
| platinum | sweep | cool-silver sweep *(existing; recolor to new platinum)* |
| diamond | prism | sweep + cyan prism glints *(existing)* |
| **hero** ✦ | sweep | **crimson** sweep + a burst of igniting **embers** (reuse Ember, tinted crimson) — the "threshold ignites" beat. Its arrival is the band crossing. |
| **titan** ✦ | prism | **verdigris** prism shards raining + a subtle **screen-shake** (±2–3px, 400ms, respect reduce-motion) — colossal/earthquake |
| **olympian** ✦ | sparkle | **white-gold** sparkle glints + **god-rays** (2–3 soft radial light beams from top fading down) — divine radiance |
| **immortal** ✦ | prism | **violet** iridescent prism glints, slower + softer than Diamond's, over a gentle ascending violet glow — ethereal, *not* fiery. **PLUS faint ghost-wisp faces** — 4–5 translucent violet-white spectral faces (soft blurred forms with two hollow eyes) drifting slowly upward and fading (~2.5–3.5s, low opacity ~0.4): the souls of the dead rising to mock you. Pairs with the "laughter of the damned" audio layer (§3). Keep them subtle + haunting, never cartoonish. |
| **primordial** (was infernal) | flame | inherits the **full Infernal fire treatment verbatim** — FlameBlobs rising, HexLick burning, hardest wash (0.9) — the apex. Just repoint the `infernal` branch to `primordial`. |

---

## 3 · Audio (`src/lib/sound.ts`)

- **Division bump** → soft tier-up chime.
- **Tier crossing** → the standard rank-up SFX (let it ride the existing per-band escalation).
- **Band crossing** → **Victory Anthem** (the legendary rank-up SFX). Reserve it for these two moments *only* so it stays special — do not play it on ordinary tier crossings.
- Reuse the old Infernal rank-up cue for Primordial's own SFX layer under the anthem.
- **Immortal (special layer)** → its mix carries **the laughter of the damned** — a slow, reverb-drenched chorus of ghostly whispers + distant, pitched-down soul-laughter, sitting LOW beneath the heartbeat/hum. The dead mock you and pray for your downfall, but death has no claim — it plays as triumph *over* them, not a jump-scare. **The chosen clip is in-repo: `assets/sounds/rankup-immortal-souls.mp3`** (Pixabay "Demonic Spirit Voice – Sinister Laughter"; pitch down + reverb + keep it low in the mix). Syncs with the ghost-wisp visual motif (§2). Sources in `RANKUP_AUDIO_SOURCES.md` (Immortal).

## 4 · Haptics (`src/lib/reward-feedback.ts`, expo-haptics)

Bump = light impact. Tier crossing = medium impact + success notification. Band crossing = a short heavy sequence (heavy → pause → success). All gated by reduce-motion / the system haptics setting.

---

## 5 · Copy — ONE hard-hitting all-caps line per tier (no more personal/social pools)

**Model change — supersedes the old `{personal}, {name}. {social}` system entirely.** Rank-up copy is now a single fixed **all-caps two-liner shown ONLY when you reach a new tier** (a tier crossing). **Division bumps show NO copy** — just the lighter flash + haptic (§1). Rip out the personal/social pools, the no-immediate-repeat picker, the `{name}`/`{school}`/`{mascot}`/`{rival}` interpolation, and `composeRankUpHeadline`. Replace `RANK_UP_LINES` with a flat `Record<RankTierName, { head: string; sub: string }>`, and update `RANK_UP_COPY.md` (source of truth) to match.

```ts
export const RANK_UP_COPY: Record<RankTierName, { head: string; sub: string }> = {
  bronze:     { head: 'IGNITION.',                 sub: 'THE CLIMB HAS BEGUN.' },
  silver:     { head: 'FORGED IN STEEL.',          sub: 'THE EDGE IS YOURS.' },
  gold:       { head: 'THE CROWN IS YOURS.',       sub: 'EVERY LOCK-IN TURNS TO GOLD.' },
  platinum:   { head: 'INTO RARE AIR.',            sub: 'FEW EVER CLIMB THIS HIGH.' },
  diamond:    { head: 'FORGED UNDER PRESSURE.',    sub: 'THE MORTAL PEAK — ONE STEP FROM LEGEND.' },
  hero:       { head: 'MORTAL LIMITS BROKEN.',     sub: 'WELCOME TO THE REALM OF LEGEND.' },   // = ascension event
  titan:      { head: 'THE EARTH TREMBLES.',       sub: 'A TITAN WALKS AMONG THEM.' },
  olympian:   { head: 'YOU ENTER OLYMPUS.',        sub: 'THE GODS MAKE ROOM.' },
  immortal:   { head: 'DEATH HAS NO CLAIM.',       sub: 'YOU CANNOT FALL.' },
  primordial: { head: 'YOU ARE BEYOND TIME ITSELF.', sub: 'YOU ARE NOW PRIMORDIAL.' },         // = transcendent event
};
```

Render `head` big + bold, `sub` smaller/lighter beneath (same treatment as the band-crossing copy). `hero` and `primordial` lines double as the two band-crossing framing lines — one source, no duplication.

---

## 6 · Trigger — fire for EVERY XP source (PUNCHLIST_5 #6)

The moment must fire from the **global rank-watcher**, not just the lock-in done screen — otherwise Strava/Whoop/challenge-payout rank-ups show nothing. On fresh rank data (home mount, app foreground, post-sync refetch), compare current vs persisted last-seen rank; if it **increased**, fire the celebration and update last-seen; de-dupe so it plays once per real change. Compute the escalation level from the delta:
- same tier, higher division → division bump
- new tier → tier crossing
- lands on Hero III (from Diamond I) or on Primordial → **band crossing**

On a band crossing, auto-surface the share CTA. (Down-map from the curve change never fires — it's an increase-only check; see RANK_REWORK_SPEC.md §5.)

## 7 · Reduce-motion

Skip particles + screen-shake; keep the badge reveal, copy, one haptic. Band-crossing framing card still shows (static).

## 7b · Dev-tool wiring (on-device testing)

Visual source of truth for every moment: **`design-mocks/78-rankup-tester.html`** (open it — click any tier to see its motif + copy; the two ascension buttons play the band crossings). Wire the real celebration into the existing rank picker in `src/components/dev-tools.tsx` so each can be fired on demand:

- Add a **"Rank-up tester"** panel with **one button per tier** (all 10: bronze→primordial) plus a **"Division bump"** toggle and **two dedicated buttons** for the ascension events (`Diamond → Hero`, `Immortal → Primordial`).
- Each button calls the **same imperative entry point the global rank-watcher uses** to present the celebration — don't fork a second code path. Pass the full shape so the escalation logic (§1) runs for real:

```ts
// tier button (respects the Division-bump toggle):
showRankUp({ tier, division: bumpOn ? 2 : 3, isDivisionBump: bumpOn, isBandCrossing: false });

// ascension buttons (force the band crossing):
showRankUp({ tier: 'hero',       division: 3, isDivisionBump: false, isBandCrossing: true });
showRankUp({ tier: 'primordial', division: 1, isDivisionBump: false, isBandCrossing: true });
```

- If the celebration is currently only mounted inside the lock-in done flow, lift it to a **global overlay** (a provider/portal at the root, or the existing rank-watcher's host) so dev-tool triggers — and real server-side XP rank-ups (§6) — can present it from anywhere.
- The dev triggers should also fire the matching **audio + haptics** so those can be auditioned on-device, not just the visuals.

## 8 · Ship & verify

- JS only → OTA. No migration, no native.
- Force via **dev-tools** each of the 10 tiers AND each escalation level: a division bump, a tier crossing, and both band crossings (Diamond I→Hero III, Immortal I→Primordial). Confirm: correct motif/color, Primordial = full fire + no numeral, Victory Anthem *only* on the two band crossings, share auto-surfaces on band crossings, reduce-motion path is clean.

---

## 9 · Canonical moment reference — `design-mocks/85-rankup-moment.html`

**Build to mock 85.** It runs the full moment end-to-end WITH the real repo audio synced to each beat,
then settles into the share card — so animation, audio, and card are one coherent thing. Companions:
mock 83 (signatures + incineration in isolation), mock 84 (all share cards).

**The arc (every tier crossing):** the badge enters with the tier's **signature move**, and the tier
**HIT lands on the flare and RINGS OUT** (don't cut it short — let it ring into the moment) → at ~2.2s the
frame **settles into the share card** (Philoi brand, tag, tier name, all-caps line, `@handle · rank`,
drifting embers, Share CTA), the hit still ringing under it. **No generic riser** — the tier hit *is* the
punch (the cinematic riser had a different sound profile and clashed with the hits).
**Band crossings** don't use the generic riser — their **ascension/transcension track *is* the build**:
it starts in the pre-beat (Hero after the shatter+0.3s silence; Primordial as the void collapses) and
**builds across the whole sequence, climaxing at the crest** (war-horn on Hero's crest slam; the plasma
drop on Primordial's emblem).

| Tier | Signature move | Audio (file · timing) | Card tag |
|---|---|---|---|
| Silver | blade-slash streak reveal | `rankup-silver` (sword unsheathe) · hit on flare | RANK UP |
| Gold | crown descent + coin rain | `rankup-gold` · hit on flare | RANK UP |
| Platinum | crystallize + frost shimmer | `rankup-platinum` · hit, rings out | RANK UP |
| Diamond | pressure-forge + prism glints | `rankup-diamond` · hit on flare | RANK UP |
| **Hero** (band) | diamond shatter → whiteout **crimson pillar breaks through** → crest **slam + shockwave** | `ascension-hero.mp3` — **diamond-shatter break-through → the FULL Champions Anthem (~83s), plays entirely ONCE** (like Primordial — Hero is the *first* transcension moment, so it gets the full anthem, uncut, not looped). NOTE: this reuses the Champions Anthem that's also the `sfx-victory-anthem` cosmetic — swap in a dedicated Hero track if one gets sourced. | ⚔ ASCENDED |
| Titan | colossal slam + screen-shake + falling debris | `rankup-titan` — needs an **audible boom** (pure rumble is inaudible on phone) | RANK UP |
| Olympian | slow bloom + god-rays | `rankup-olympian-v2.mp3` — RAW anthemic mix, choir + deep foghorn **notes HELD out** (sustained/legato) + sub-bass; the gods welcoming you, NOT fairy/fanfare | RANK UP |
| Immortal | ethereal rise + ghost-wisps + lingering aura | `rankup-immortal` (rings out) + `rankup-immortal-souls-v2.mp3` **layered under, PROMINENT** (~0.85 vol) with a **slow fade-out that ends on the same beat as the chime** (no abrupt cut) | RANK UP |

> **Asset cleanup — DONE.** The `-v2` mixes have been promoted to `rankup-olympian.mp3` and
> `rankup-immortal-souls.mp3` (the read-only originals were deleted), and the stale
> `ascension-primordial.mp3` Atum stand-in is gone. `sound.ts` points at the canonical names.
| **Primordial** (band) | void collapse (converging dark-matter particles) → cosmic tear **rips open then SEALS shut** (never leaves a persistent beam on screen/card) → **emblem COALESCES in** (blur+scale, forms *out of* the particles — must NOT bouncy-pop, that reads choppy) → aura + fire | `transcension-primordial.mp3` — the **FULL Atum "primordial waters" track, UNCUT (~3.5 min), plays entirely ONCE** (never looped, never trimmed). The apex is a once-ever monumental moment (~500 hrs to reach) — the whole anthem sings for you while the emblem + aura hold; the celebration can be dismissed (which stops the audio), but let it play if they stay. | 🔥 PRIMORDIAL |

> **Audio wiring — DONE.** `ASCENSION_SOURCES` in `sound.ts` is live: `ascension-hero` →
> `ascension-hero.mp3`, `ascension-primordial` → **`transcension-primordial.mp3`**. Both players are
> explicitly `loop = false`. The celebration starts the anthem in the pre-beat
> (`startAscensionAnthem`) and `fireRankUp` holds its tier hit back whenever an anthem is carrying
> the crest, so the two never fight; dismissing the celebration calls `stopRankUpAudio()`, which is
> the only thing that ever cuts one short.
>
> **Superseded by §9 in the build:** (a) there is no riser anywhere in the moment — the cue, the
> asset wiring and `start/stopRankUpRiser` are gone; the tier hit is the punch. (b) The §1
> band-crossing *framing card* was replaced by the mock's cinematic pre-beat (shatter → pillar;
> void → tear) — the same `hero`/`primordial` copy now lands on the composed share card under the
> ⚔ ASCENDED / 🔥 PRIMORDIAL tag, so it's still one source with no duplication. Under reduce-motion
> the moment cross-fades straight to that composed card, which is where the static copy shows.

**Intra-division bump (supersedes the old "no moment" note):** white-ray **fuse-in** (loot-box style,
`whoosh`) → badge forges in → **godly hellfire incinerates the top numeral stroke** (`ignite`) → the
burned stroke's **width collapses so the remaining marks recenter** (center-anchored) → **the tier's own
rank-up hit lands** as the new division locks (e.g. Gold II→I plays the Gold hit, ~0.9 vol) → settles into
a lighter **🔥 DIVISION UP** share card (badge shows the new division e.g. *Gold II*, a light two-line, no
big epic copy — that stays reserved for tier crossings).

**Playback note:** do **NOT** clip the tier hits — let each ring out fully (they fire on the flare, so a
long tail rings *under* the settling card, which is the point). Titan's audio still needs an audible
transient (a pure rumble is inaudible on a phone). Silver = sword unsheathe (done).
