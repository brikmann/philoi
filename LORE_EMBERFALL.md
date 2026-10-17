# Emberfall — Season 1 lore bible

**Status:** copy/data only (catalog `lore` fields + a shop banner) → JS/OTA-able, NOT a build-7 blocker. Fold into build 7
if ready; otherwise ship as an OTA update after launch. This file is the single source of truth for season lore copy.

## Why this framing (merges Noah's two options)
The economy is already Greek-fire myth (Prometheus, Hestia, Hephaestus, the Promethean Vault). So:
- **Option A (Hades escapes)** gives the *villain + quest* — external stakes that fit the pantheon.
- **Option B (embers create or destroy — rise, or burn yourself down)** gives the *theme + choice* — and it's the one
  that actually means something for a study app: **it's about not burning out.**
The season fuses them: Hades is why the embers fell; the duality is what each ember does to *you*.

---

## The canonical tale (long form — season intro / "read the tale" expander)
> Long before the campus, Prometheus stole a coal of the Titans' primordial fire and gave it to mortals. That fire was
> never only warmth — it was the raw stuff of making *and* unmaking, creation and ruin in the same light. For an age it
> was kept: banked in **Hestia's** hearth, worked in **Hephaestus'** forge, hoarded in the **Promethean Vault**.
>
> Then **Hades** tore the underworld open. The seal that held the dead below broke, the ground ran like a furnace, and
> the primordial fire fell out of the cracked sky in a rain of embers — the **Emberfall**. Every ember is a shard of
> that first fire. It can raise you, or reduce you to ash.
>
> Gather enough and you forge a seal to shut the dark back out. Squander them — or let them consume you — and you burn:
> yourself, and everyone warming their hands at your fire.
>
> Season 1 is the choice, made one lock-in at a time. **Rise on the embers, or be ash before Emberfall ends.**

## Hooks (short — for shop banner + paywall lead)
- **One-liner (shop banner, paywall hero):** "Hades cracked the underworld and the sky rained fire. Every ember can
  raise you or ruin you — gather them, forge the seal, and rise before Emberfall ends."
- **Tagline (buttons / tight spaces):** *"Rise on the embers, or burn."*
- **The stakes, in one breath:** every lock-in gathers embers; the season ends when the seal holds — or doesn't.

---

## Marquee cosmetics — each is a captured shard of Hades' power (put in catalog.ts `lore` field)
Framing (Noah): the **Emberfall Seal** is the thing you *forge* — the L100 capstone that seals Hades back out and burns
beside your name eternally. **Every other cosmetic is a function of Hades' wrath/power that you caught mid-fall and bent
to your advantage** — his flame becomes your flare, his crown your halo, his ruin your banner. Lead each with what it
*means*, not the slot.

| Cosmetic (key) | Display name | Tier | Lore line |
|---|---|---|---|
| `medal-emberfall-crown` (L100) | **The Emberfall Seal** (RENAME from "Emberfall Crown") | Mythic | "The seal itself. Forge it at level 100 and it burns beside your name forever — proof you gathered enough to shut the dark back out." → **renders eternally next to the name on the profile.** |
| `halo-emberfall-mythic` | Crown Halo | Mythic | "The first ember that chose to warm rather than consume — it burns above the heads of those who rose." |
| `title-forged-in-ember` | "Forged in Ember" | Legendary | "You walked into the Emberfall and came out shaped — not ashed." |
| `banner-emberfall-mythic` | Emberfall Standard | Legendary | "Raised over a fire others gather around. You turned the fall into a forge." |
| `flare-emberfall-ascendant` | Emberfall Ascendant | Legendary | "The one fire that defies the fall — where every ember drops, this aura climbs. It rings your whole profile, always rising." (Its flames animate UPWARD, against the season's falling embers — the visual signature of the item.) |
| `particle-void-smoke` | Void Smoke | Legendary | "What's left when an ember consumes instead of creates. Worn as a warning — or a boast." |
| `sfx-emberfall-strike` | Emberfall Strike | Legendary | "The crack of an ember striking the seal, and holding — plays when you end a lock-in." |
| `card-emberfall-mythic` | Emberfall Sovereign | Legendary | "The face you show the campus: one who commands the fall." |

> **Rename note:** `medal-emberfall-crown`'s *display name* → "The Emberfall Seal". The **key stays the same**, so
> `check:cosmetic-rarity` and the SQL grants are untouched — only the `name` string changes. The Seal is the one item
> that pins to the profile nameplate permanently (build it as the nameplate sigil, mock 223).

## Unlock scatter (instant on purchase vs earned by climbing — surface on the paywall)
Pull the real levels from the pass track (`forge-pass.ts`); the paywall marks each cosmetic accordingly.
- **⚡ Instant (L0 receipt on purchase):** Emberfall Ascendant flare (+ Forge flame + 1,000 embers).
- **Earned by climbing:** Emberfall Standard **L25** · Void Smoke **L40** · Crown Halo **L50** · Emberfall Strike **L50**
  · Emberfall Sovereign **L75** · The Emberfall Seal **L100** · "Forged in Ember" **L100**.
Framing: one look is yours on purchase, the rest you forge by locking in through the season — the Seal is the apex earn.

Lower-tier set items get one short line in the same voice (Molten Copper flame = "an ember caught mid-choice"; Kindled
title = "you caught your first ember and it didn't burn you"). Keep every line to the create/destroy + seal spine.

## Mini-art cosmetics (make the marquees more enticing — new small pieces)
Small companion art so marquees feel alive, and to seed a collection pull:
- **Ember motes** — a shared micro-effect: a few live embers drift around any equipped Emberfall mythic on the profile.
- **Seal fragments** — one small glowing rune-shard per marquee; collecting more of the set visually snaps them toward a
  completed "seal" ring on the profile (collection incentive → drives pass + box purchases).
- **Hades' crack** — a faint fissure-glow behind mythics only, so the top tier reads as "touched by the break."
- Each is SVG-cheap (motes = animated dots, fragments = rune paths, crack = a masked gradient), so they're buildable
  without new art assets and ship as JS.

## Flame Pass ownership = THE BURNING NAME (new)
A Flame Pass holder's **display name renders on fire** everywhere the campus sees it — leaderboards, campfires, the
Agora, their profile. This is the always-on ownership flex (distinct from equippable cosmetics): fire-gradient text +
a flicker glow + small flame licks off the top (all CSS, no assets — see `design-mocks/225` / `226` for the effect).
Gate it on the `forge_pass` entitlement. It's the single strongest reason to buy — your name literally burns in front
of everyone.

## New screens (all JS, OTA-safe — fold into build 7 or ship after)
- **Shop entry banner** (`design-mocks/224-shop-emberfall-banner.html`) — the Emberfall banner at the top of the Shop:
  constellation + falling embers + flashing "Own Emberfall" + one-line hook + `$8.99/sem`; tapping it opens the paywall.
- **Paywall** (`223`) — copy now: "This semester, every ember can *raise you or ruin you*." → break → "Harness the fire
  with your fellow students to burn bright and earn *exclusive rewards* — all for less than a cup of coffee." → `$8.99/semester`.
- **Purchase success** (`design-mocks/225-flamepass-success.html`) — seal reveal, "The fire is yours," the **burning
  name reveal** ("Your name, from now on: 🔥Noah"), the instant Ascendant unlock, "Start climbing" CTA.
- **Tutorial slide** (`design-mocks/226-tutorial-flamepass.html`) — teaches the burning name as social proof: a mini
  leaderboard with one name on fire, "See a name on fire? That's a Flame Pass holder," → "See the Flame Pass" CTA.

## Where it surfaces
1. **Shop page** — a lore banner at the very top (season art + the one-liner + "Read the tale ⌄"), leading into the
   Flame Pass and boxes. See `design-mocks/222-shop-lore-banner.html`.
2. **Paywall** — the hero leads with the one-liner (see updated `design-mocks/221-…`).
3. **Cosmetic detail** — the `lore` field renders under each item's name.

## Wiring (all JS/data — OTA-safe)
- Put every line above into the matching `catalog.ts` item's `lore` field.
- Shop banner = a new header component on the shop screen; paywall hero = one line in `paywall.tsx`.
- Mini-art = small components gated to equipped Emberfall mythics. Narrow, additive; no migration.
