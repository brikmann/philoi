# Rank-up copy — one fixed two-liner per tier

**Source of truth for the exact strings.** Mirrored verbatim in `src/lib/rank-up-copy.ts`
(`RANK_UP_COPY`) — keep this doc authoritative and the code in sync with it, not the reverse.

## Model

One fixed **all-caps two-liner per tier**, shown **only when you reach a new tier** (a tier
crossing). Rendered `head` big + bold with `sub` smaller and lighter beneath.

- **Division bumps show NO copy** (RANKUP_SPEC.md §1) — they get the lighter wash + a light haptic
  and nothing else. That silence is what keeps the crossing distinct from the two bumps before it.
- **`hero` and `primordial` double as the band-crossing framing lines** (§1). One source, so the
  ascension takeover card and the badge screen can never drift apart.

| Tier | Head | Sub |
|---|---|---|
| bronze | `IGNITION.` | `THE CLIMB HAS BEGUN.` |
| silver | `FORGED IN STEEL.` | `THE EDGE IS YOURS.` |
| gold | `THE CROWN IS YOURS.` | `EVERY LOCK-IN TURNS TO GOLD.` |
| platinum | `INTO RARE AIR.` | `FEW EVER CLIMB THIS HIGH.` |
| diamond | `FORGED UNDER PRESSURE.` | `THE MORTAL PEAK — ONE STEP FROM LEGEND.` |
| **hero** ✦ | `MORTAL LIMITS BROKEN.` | `WELCOME TO THE REALM OF LEGEND.` |
| titan | `THE EARTH TREMBLES.` | `A TITAN WALKS AMONG THEM.` |
| olympian | `YOU ENTER OLYMPUS.` | `THE GODS MAKE ROOM.` |
| immortal | `DEATH HAS NO CLAIM.` | `YOU CANNOT FALL.` |
| **primordial** ✦ | `YOU ARE BEYOND TIME ITSELF.` | `YOU ARE NOW PRIMORDIAL.` |

✦ = also the framing copy for that band crossing (Diamond I → Hero III, Immortal I → Primordial).

## Superseded (0063 ladder rework)

This **replaces** the old `{personal}, {name}. {social}` system outright. Removed: the per-tier
line pools, the Bronze-by-division split, the no-immediate-repeat picker, the
`{name}`/`{school}`/`{mascot}`/`{rival}` interpolation, and `composeRankUpHeadline()`. The old
Infernal section is gone with the tier — Primordial replaces it.

Why: a rank-up is rare and the line is the payoff. A rotating pool made every crossing feel
randomly generated, and name/school interpolation read as mail-merge on the one screen that should
feel authored. Ten lines, each earned once.
