# Philoi — Challenge & End-of-Season reward copy (`CHALLENGE_REWARD_COPY.md`)

The rotating **headline** on the challenge-reward screen (mock `47-challenge-reward.html`) and the **End-of-Season Settlement** (mock `48-end-of-season-settlement.html`). Same system as the rank-up copy (`RANK_UP_COPY.md`).

## How it works
- The headline is **one line pulled from the pool that matches the outcome** — chosen by **placement tier × context**.
- **`{name}` is appended** (the lines already end in ", Noah."). Templated per user.
- **No immediate repeat**; rotate random or round-robin so regulars don't see the same line twice.
- The **placement tier maps to the reward economy** (`REWARD_ECONOMY.md`): absolute #1/#2/#3 for duels & small groups; **percentile** (top 10% / 25% / 50% / <50%) for whole-campfire, university, and season boards.

## Placement → pool selection
- **1v1 duel:** winner → **Rank 1 (Duel)**; loser → **Rank 2 (Duel)** (close-loss / rematch tone — never "Fraud Watch" for a 1v1).
- **Small group (≤ ~8):** use absolute **Rank 1 / 2 / 3** pools; 4th+ → the percentile pool they fall in (usually Top 50% / <50%).
- **Whole campfire / university / vs-unis / season (big boards):** **percentile** pools, checked **most-selective first: Top 1% → 5% → 10% → 25% → 50% → <50%**. If literally top 3, the **Rank 1/2/3 "Campfire & Season"** pools override the percentile (absolute podium wins). Top 1% is the apex tier — it maps to the top of the `REWARD_ECONOMY.md` ladder (mythic box + apex badge on a season board).
- **End-of-Season:** same tiers, the **"Campfire & Season"** pools, played grander (see §Settlement).

---

## 🥇 Rank 1 — The Apex / Champion
**1v1 Duel**
- "Total dominance, {name}."
- "Left them in the ash, {name}."
- "Claimed the crown, {name}."
- "No contest, {name}."

**Partial / Whole Campfire & End-of-Season**
- "The arena belongs to you, {name}."
- "Campfire King, {name}."
- "Top of the food chain, {name}."
- "You ran this semester, {name}."
- "Undisputed, {name}."
- "The whole tribe bows to the blaze, {name}."
- "Set the curve. Broke the scale, {name}."
- "History remembers this, {name}."
- "You conquered them all, {name}."
- "The throne is yours alone, {name}."
- "Nobody even came close, {name}."

*(#1 is the single throne — it outranks Top 1% in both copy grandeur AND visual intensity. See the intensity ladder below.)*

## 🥈 Rank 2 — The Silver Crown / High Execution
**1v1 Duel**
- "Narrow margin, {name}."
- "Pushed to the limit, {name}."
- "Razor thin, {name}."

**Partial / Whole Campfire & End-of-Season**
- "One step from the throne, {name}."
- "Silver-forged performance, {name}."
- "Chasing the apex, {name}."
- "Stole the spotlight, {name}."
- "Striking distance, {name}."
- "Heavy metal finish, {name}."

## 🥉 Rank 3 — The Podium / High Heat
**1v1 Duel / Small Groups**
- "Locked on the board, {name}."
- "In the fight till the end, {name}."

**Partial / Whole Campfire & End-of-Season**
- "Podium locked, {name}."
- "Top tier energy, {name}."
- "Standing with the elite, {name}."
- "Heat rising, {name}."
- "Earned your place, {name}."

## 🔱 Top 1% — The Immortals / Olympian
*(Apex percentile tier — big boards & season only. The rarest banner; pairs with the top of the reward ladder.)*
- "Immortal, {name}."
- "Etched into the marble, {name}."
- "One in a hundred, {name}."
- "Walking with the gods, {name}."
- "Legend of the season, {name}."
- "The peak has your name on it, {name}."
- "Untouchable, {name}."

## ⚡ Top 5% — The Ascendants / Titans
- "Titan tier, {name}."
- "Top 5% of the whole board, {name}."
- "Ascendant, {name}."
- "Breathing rare air, {name}."
- "Elite of the elite, {name}."
- "Carving your name in, {name}."

## 🔝 Top 10% — The Academic Weapons / Vanguard
- "Vanguard status, {name}."
- "Top 10% on campus, {name}."
- "Pacesetter for the tribe, {name}."
- "Dragging the average up, {name}."
- "Pure high-frequency execution, {name}."
- "They're watching your shadow, {name}."

## 📈 Top 25% — The Contenders / Dialed In
- "Solid ground, {name}."
- "In the upper echelon, {name}."
- "Fanning the flame, {name}."
- "Main character momentum, {name}."
- "In striking range for next season, {name}."
- "Overperforming the pack, {name}."

## ⚖️ Top 50% — The Mid-Pack / In the Mix
- "Holding the line, {name}."
- "In the arena, {name}."
- "Fueling the fire, {name}."
- "Alive in the fight, {name}."
- "Baseline established, {name}."
- "Time to turn up the heat, {name}."

## ⚠️ Bottom <50% — Fraud Watch / Needs Ignition
*(Motivational, not cruel — the tone is "the fire's not out, get back in," never mocking. Never used for a 1v1 loss.)*
- "On Fraud Watch, {name}."
- "Stoke the embers, {name}."
- "Cold execution, {name}."
- "Don't let the fire die out, {name}."
- "Your Campfire needs you locked in, {name}."
- "Next season starts right now, {name}."

---

## Reward-screen intensity ladder (bolder + brighter toward the top)
The reward screen (mocks 47/48) **escalates in visual energy by tier** — the higher the finish, the more explosive. The **absolute podium (#1/2/3) always outranks the percentile tiers** in both copy grandeur and visual intensity: being THE champion beats being *among* the top 1%. Colors climb the ramp (ember → amber → coral → **molten Infernal**); glow radius, flame count, badge size, particle burst, and animation speed all scale up together. Reduced-motion → a static frame per tier.

| Tier | Reward-screen treatment |
|---|---|
| **#1 · Champion** | **MAX** — full-screen molten flame wash, brightest gold+fire glow, largest animated badge, spark-burst + haptic. The mock-48 settlement energy, even for a mid-season win. |
| **#2 / #3 · Podium** | Very high — big burst, silver/bronze + fire, strong pulsing glow, animated badge. |
| **🔱 Top 1% · Immortal** | High-epic — radiant aura, bright + animated; a clear notch *below* the literal podium. |
| **⚡ Top 5% · Titan** | High — energetic glow + flame accents. |
| **🔝 Top 10% · Vanguard** | Elevated — warm burst, confident. |
| **📈 Top 25% · Contender** | Positive — gentle glow, upbeat. |
| **⚖️ Top 50% · Mid-pack** | Neutral-positive — modest, "in the mix." |
| **⚠️ <50% · Needs ignition** | Calm / muted — **embers, not blaze**; motivational, never a hollow over-celebration. |

## End-of-Season Settlement — screen layout
When a semester closes, the challenge-reward screen becomes the **End-of-Season Settlement**:
- **FINAL SEASON STANDINGS** header.
- The **placement + headline** (e.g. 👑 RANK 1 → "Undisputed, {name}.") from the pools above.
- An **animated flaming badge** with the tier line (e.g. **TOP 1% · INFERNAL DIVISION**).
- **SEASON REWARDS UNLOCKED:** the loot box (e.g. 📦 **Prometheus' Vault**) + a flame cosmetic (e.g. 🔥 electric-blue plasma flame).
- CTAs: **SHARE TO CAMPFIRE** · **CLAIM REWARDS**.
- **On-open reveal (mock 48):** the Settlement plays a one-time cinematic entrance the first time the app opens after a season closes — the **flaming badge pulses into existence** (scale-in + glow bloom), **then the copy rises in beneath it** (eyebrow → RANK → headline → tier → rewards → CTAs, staggered). Plays once per season end; `prefers-reduced-motion` → static.

### Micro-copy callouts
- Loot box unlock: **"CLAIM YOUR PROMETHEUS' VAULT"**
- Forge Pass bonus: **"FORGE PASS MULTIPLIER APPLIED (+50% BONUS EMBERS)"**
- Share CTA: **"Flex on your Campfire"** / **"Post to Instagram Story"**

*(Season rewards + multipliers ride on the Step 18 verified-effort floors and the `REWARD_ECONOMY.md` percentile ladder; the Forge Pass bonus applies only if the user holds the pass.)*

---

## Sound effects — MOCK now, real per-tier later
- **Now:** mocks 48/49 use a **synthesized placeholder chime** (Web Audio) that fires on the reveal (48) or on tap (49), brighter/fuller for higher tiers. Placeholder only.
- **Real SFX to source — one cue per tier**, matched to the intensity ladder, brightest/biggest at the top:
  **#1 · #2 · #3 · Top 1% · Top 5% · Top 10% · Top 25% · Top 50% · <50%.**
  Higher tiers = layered, triumphant (orchestral hit / choir swell / whoosh + spark); lower tiers = softer; **<50% = a single warm ember tick** (motivational, never sad/mocking). Plays at the reveal moment (season settlement on-open; challenge-reward on the results screen), respecting the **Sound & haptics** setting (§22) and reduced-motion/sound-off.

---

## Second pass — copy to FILL (scaffold for Noah)
*The pools above are the placement **headline**. This second pass adds depth. Each block below is a slot to populate — same rules ({name} appended, no immediate repeat).*

1. **Subtext line (per tier)** — a shorter supporting line under the headline. *Seed:* #1 → "Nobody else was close." · Top 10% → "You set the pace." · <50% → "The fire's still lit." **[fill all tiers]**
2. **1v1 loss / rematch pool** — its own set (loss currently borrows Rank 2). Non-defeatist, redemption-forward. *Seed:* "Run it back." · "Redemption's one lock-in away." **[fill]**
3. **Goal-type flavor (optional)** — variants keyed to the challenge activity. *Seed:* run win → "Left them in the dust." · study win → "Out-locked and out-thought." · gym win → "Out-lifted the whole fire." **[fill per goal type]**
4. **Rival / school templating** — `{school}` / `{mascot}` / `{rival}` like `RANK_UP_COPY.md`. *Seed:* Vs-unis #1 → "{school} runs the province." **[fill]**
5. **Personal-best / self lines** — beat your own last season. *Seed:* "New you. Old record's ash." **[fill]**
6. **Box-reveal micro-copy (per rarity)** — the line as a loot box opens. *Seed:* Mythic → "The Vault answers." **[fill per rarity]**
7. **Cheer copy** — what a spectator's cheer says/pops (Watch screen, mocks 44/45). *Seed:* "🔥 Go off!" · "Cook them." **[fill]**
8. **Milestone / streak-season lines** — first season, comeback after a bad season, perfect week. *Seed:* comeback → "From the ashes, {name}." **[fill]**
