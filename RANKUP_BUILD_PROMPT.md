# Code build prompt — Rank-up celebration system (Primordial ladder)

Paste this into Code as one task. It ties together three artifacts:
- **`RANKUP_SPEC.md`** — behavior (escalation model, motifs, copy, trigger, dev-tool wiring).
- **`RANKUP_AUDIO_SOURCES.md`** — the per-rank audio (Pixabay component clips + mix plan).
- **`design-mocks/78-rankup-tester.html`** — the **visual + copy source of truth** (open it; click any tier / the two ascension buttons to see exactly what to build).

**Dependency:** do this AFTER (or in the same PR as) `RANK_REWORK_SPEC.md` — the new tier keys (`hero`/`titan`/`olympian`/`immortal`/`primordial`) and colors must already exist in `rank-tiers.ts` + `RANK_TIER_METAL`. **All JS + audio assets. No native change. Ships OTA.**

---

```
Implement the full rank-up celebration for the 10-tier Primordial ladder. Extend the
EXISTING src/components/rank-up-celebration.tsx (708 lines — badge morph, TierFlashOverlay
keyed to TIER_FLASH_KIND, bespoke Gold/Diamond/Infernal particles, tier wash, onShare).
Do NOT rebuild it. Source of truth: RANKUP_SPEC.md + design-mocks/78-rankup-tester.html.
Audio: RANKUP_AUDIO_SOURCES.md. Prereq: RANK_REWORK_SPEC.md tiers/colors already in place.

1. COPY (RANKUP_SPEC §5) — replace the whole personal/social system. Rip out RANK_UP_LINES,
   the {name}/{school}/{mascot}/{rival} interpolation, the no-repeat picker, and
   composeRankUpHeadline. Replace with a flat RANK_UP_COPY: Record<RankTierName,{head,sub}>
   (the 10 all-caps two-liners in §5). Copy shows ONLY on a tier crossing; division bumps
   show NO copy. Render head big+bold, sub smaller beneath — same look as the band-crossing
   text. Update RANK_UP_COPY.md (source of truth) to match. grep for the old infernal copy →
   gone; primordial replaces it.

2. ESCALATION (RANKUP_SPEC §1) — three levels. The component already splits isDivisionBump
   vs tier crossing; add isBandCrossing (true iff the crossing lands on hero III from diamond,
   or on primordial). Division bump = lighter wash (~0.5), sweep, light haptic, soft chime, no
   copy. Tier crossing = badge morph + tier motif + copy + medium haptic + rank-up SFX + share
   offered. Band crossing = the two cinematics below.

3. MOTIFS (RANKUP_SPEC §2) — reuse existing particle primitives, recolor per RANK_TIER_METAL.
   New tiers: hero = crimson sweep + igniting embers; titan = verdigris prism shards + subtle
   screen-shake (±2–3px, reduce-motion aware); olympian = white-gold sparkle + 2–3 god-rays;
   immortal = slow violet iridescent glints + ascending glow (not fiery); primordial = repoint
   the full Infernal fire treatment (FlameBlobs + HexLick + 0.9 wash) — the apex. Match mock 78.

4. THE TWO BAND CROSSINGS — full-screen takeover modals, lock interaction ~3s.
   • Diamond → Hero: diamond shatter → 0.3s silence → whiteout light-pillar → smoke-arena Hero
     crest slam + shockwave ring. Copy: "MORTAL LIMITS BROKEN." / "WELCOME TO THE REALM OF LEGEND."
   • Immortal → Primordial: interface darkens to black (collapse inward) → neon-violet cosmic
     tear → Primordial emblem snaps in from particles + persistent purple/cyan aura. 0.5s full
     audio duck first. Copy: "YOU ARE BEYOND TIME ITSELF." / "YOU ARE NOW PRIMORDIAL."

5. AUDIO (RANKUP_AUDIO_SOURCES.md) — one pre-mixed clip per rank in assets/audio/rank/ (Noah
   mixes them from the Pixabay layers; scaffold the wiring + expected filenames now, e.g.
   rank/bronze.m4a … rank/primordial.m4a + rank/ascension-hero.m4a, rank/ascension-primordial.m4a).
   Wire into src/lib/sound.ts keyed by tier + a band-crossing variant. Victory Anthem = the two
   ascension mixes ONLY. Play via expo-audio; if a file is missing, no-op gracefully (don't crash).

6. HAPTICS (RANKUP_SPEC §4, expo-haptics) — bump = light; tier crossing = medium + success;
   band crossing = heavy → pause → success. Gate on reduce-motion / system setting.

7. TRIGGER (RANKUP_SPEC §6) — fire from a GLOBAL rank-watcher, not just the lock-in done screen,
   so Strava/Whoop/challenge-payout rank-ups also celebrate. On fresh rank data (home mount, app
   foreground, post-sync refetch) compare current vs persisted last-seen; on an INCREASE, fire +
   update last-seen, de-duped (once per real change). Derive the level from the delta (same tier
   = bump; new tier = crossing; hero III from diamond OR primordial = band crossing). The curve
   change re-maps testers DOWN — increase-only guard means that never false-fires (RANK_REWORK §5).

8. DEV-TOOL WIRING (RANKUP_SPEC §7b) — in src/components/dev-tools.tsx add a "Rank-up tester"
   panel: one button per tier (bronze→primordial) + a Division-bump toggle + two buttons for the
   ascension events. Each calls the SAME entry point the watcher uses:
   showRankUp({ tier, division, isDivisionBump, isBandCrossing }). If the celebration only mounts
   in the lock-in done flow today, lift it to a global overlay/portal at root so dev triggers AND
   server-side rank-ups can present it anywhere. Dev triggers fire audio + haptics too.

9. REDUCE-MOTION — skip particles + screen-shake; keep badge reveal + copy + one haptic; band
   framing card still shows (static).

VERIFY — grep -rn "infernal" src → 0. Force each of the 10 tiers + a division bump + both band
crossings from dev-tools: correct motif/color/copy, Primordial = full fire + no numeral, Victory
Anthem only on the two band crossings, share auto-surfaces on band crossings, reduce-motion clean.
Commit + ship JS over OTA. Report anything ambiguous.
```
