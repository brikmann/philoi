# Philoi — Item Catalog (v1 concepts)

*The named cosmetic + consumable set that drops from loot boxes (REWARD_ECONOMY §8), reveals in the reward menus (mock 59), rides the share cards (mock 60), and lives in the Inventory (next).*

**Voice.** Every item ships with one line of **Dark Arena lore** — evocative, mythic, a little unholy. Intensity scales with rarity: Commons are wry and grounded, Mythics are apocalyptic. No mechanics in the flavor text ("sits above your hex" is a spec note, not lore).

**Type tags** (shown as `RARITY · TYPE` in menus/cards): `FLAME`, `PARTICLE`, `FLARE`, `CARD`, `HALO`, `TITLE`, `BANNER`, `AUDIO`, `SFX`, `RELIC`, `MEDAL`.

**Fair-play (Rule 0).** The catalog is **cosmetics + prestige only** — nothing purchasable touches standing. (An earlier "Utility/Consumables" category with XP boosts + streak saves was cut for this reason.)

**Rarity colours** (from §8.1): Common `#8a7fa6` · Uncommon `#3DA85C` · Rare `#4FB0E5` · Epic `#a06cd5` · Legendary `#F5C542` · Mythic `#FF6B6B`.

---

## 1 · Goal-Typed Flame Styles — *focus-session cosmetics*
Overlays + particle effects on the flame that burns during a lock-in.

### 1a · Ember Colorways — `FLAME` (Rare → Mythic)
Recolours the base focus flame.

| Item | Rarity | Lore |
|---|---|---|
| **Molten Copper** | Rare | The first colour ever pulled from the forge — warm, patient, unhurried. |
| **Lime Volt** | Rare | A flame that hums. Stare too long and your teeth start to buzz. |
| **Electric Cyan** | Rare | Cold at the edges, colder at the core. It burns like deep water. |
| **Toxic Green** | Epic | Something died to make this colour. It has not finished dying. |
| **Solar Flare** | Epic | A sliver of the sun's surface, kept barely leashed inside your screen. |
| **Cosmic Purple** | Legendary | Lit once at the birth of a star and never allowed to go out. |
| **Neutron Starfire** | Legendary | Pure energy in the palm of your hand. |
| **Stormforge** | Mythic | The heat of this flame forged Stormbuster. |

### 1b · Particle Effects — `PARTICLE` (Epic → Mythic)
Trailing particles thrown off the flame.

| Item | Rarity | Lore |
|---|---|---|
| **Floating Sparks** | Epic | Embers that refuse to fall. They rise, looking for more to burn. |
| **Falling Ash** | Epic | The quiet snow of everything the fire has already eaten. |
| **Ember Swarm** | Epic | Not sparks. A swarm — and it hunts in the direction you're working. |
| **Solar Flares** | Legendary | Arcs of starfire loop off the flame and snap back, screaming. |
| **Lightning Tendrils** | Legendary | The fire grew fingers of white electricity. They reach for the edges. |
| **Void Smoke** | Mythic | A funeral veil of smoke coils upward, heavy with the silence of the tomb. |

### 1c · God-Mode Flares — `FLARE` (Mythic only)
Screen-edge ambient aura, active only during 90m+ sessions.

| Item | Rarity | Lore |
|---|---|---|
| **Zeus' Wrath** | Mythic | The heavens split and the fury of Olympus answers to you now. |
| **Void Purple Aura** | Mythic | The edges of the world go soft and violet, as if reality is deciding whether to hold. |
| **Void Plasma Flare** | Mythic | Pulsing with unholy energy, each spark burns with the power of a thousand suns. |
| **White Incandescence** | Mythic | No colour left. Only the pure, blinding fact of the burn. |

---

## 2 · Profile Cards & UI Identity — *social status*
Everything others see on your profile card, in feeds, on leaderboards, in 1v1s.

### Campus Verified — earned identity (never bought)
The one profile-card component you can't buy or roll from a box — you **earn** it by verifying your
school email (UNI_VERIFICATION_SPEC.md; panel in mock 82, on-card in mock 64). It's proof, not
flair: the mark that says the campus is really yours.

| Component | Earned by | Shows on |
|---|---|---|
| **Campus Verified badge** — `🎓 {School} ✓` | Verifying your uni email (domain-locked 6-digit code) | Profile card, feeds, leaderboard rows, 1v1 headers |

- Renders as the school short-name + a **green verified check** (see mock 64's card, mock 82's panel).
- **Gates My Uni + Vs Unis** — only verified students count on the campus boards, enforced
  server-side (`get_my_ranks`-adjacent RPCs filter `university_email_verified`), so rankings stay real.
- **Tied to the school** — changing campus clears it until you re-verify (server flips
  `university_email_verified` false, migration 0062 trigger).
- **Not a rarity item** — never in loot boxes, never purchasable. It sits *alongside* the cosmetics
  below but is authenticity, not status-for-sale (same "earned, never sold" spirit as the First
  Flame founder badge). Cosmetic backdrops/halos/titles decorate the card; the verified badge
  authenticates it.

### 2a · Card Textures & Skins — `CARD` (Uncommon → Legendary)
Backdrop for your profile card.

| Item | Rarity | Lore |
|---|---|---|
| **Forged Bronze** | Uncommon | Beaten flat by a hundred honest mornings. |
| **Brushed Steel** | Uncommon | Cold, plain, and completely unbothered by your excuses. |
| **Carbon Fiber** | Rare | Light as a promise, twice as hard to break. |
| **Obsidian Mesh** | Rare | Volcanic glass, woven by someone with far too much patience. |
| **Cracked Magma** | Epic | Cooled on the surface. Move it wrong and you'll see it's still molten underneath. |
| **Plasma Grid** | Epic | A lattice of contained lightning, humming just below the picture. |
| **Golden Anvil** | Legendary | Struck ten thousand times and never once dented. Neither were you. |

### 2b · Avatar Halos & Borders — `HALO` (Uncommon → Mythic)
Glowing ring around your avatar.

| Item | Rarity | Lore |
|---|---|---|
| **Copper Ring** | Uncommon | A thin band of warmth. The first mark that you showed up. |
| **Ember Halo** | Uncommon | A slow orbit of coals that never quite goes cold. |
| **Glowing Amber Halo** | Rare | Frozen honey-light, still holding the heat of the day it was earned. |
| **Diamond Prism Border** | Epic | Bends every colour it's given and returns none of them. |
| **Inferno Flare** | Legendary | Nothing says you did it like a ring of fire around you. |
| **Hades Halo** | Mythic | Pure, chaotic energy pulses through his aura. The souls he collected are still screaming for mercy. |

**Live intensity — session-tiered aura (dynamic).** An aura isn't static — it **escalates with how deep
you are in the CURRENT lock-in**, a live "you're getting more and more locked in — good for you" signal
(extends the roar/steady flame states). Three tiers ramp up within a single session:

| Tier | At | Look |
|---|---|---|
| **1 · Kindled** | 30 min | The aura catches — a soft, steady glow. |
| **2 · Burning** | 60 min | It intensifies — brighter, tighter, with motion. |
| **3 · Locked In** | 90 min | Full intensity — the deepest, most radiant state; the "seriously in it" flex. |

Resets when the session ends. Renders on your **live-session flame** (and, opt-in, to your campfire while
you're locked in) so a long, deep session literally glows harder. Rewards *depth of focus* with escalating
flair — **no XP coupling**, purely the visual payoff of staying in it. Applies to any aura the user has
equipped (recolored per the aura), and the same 30/60/90 ramp can drive an intensifying **flame skin** too.

### 2c · Custom Titles — `TITLE` (Common → Epic)
Tagline under your name on leaderboards.

| Item | Rarity | Lore |
|---|---|---|
| **"Kindled"** | Common | The spark caught. That's all it takes to start. |
| **"Ember Stoker"** | Common | Keeps the small fire alive on the nights no one's looking. |
| **"Night Owl"** | Common | Does the work in the hours the world forgot to guard. |
| **"Pacesetter"** | Uncommon | The one everyone else is secretly trying to catch. |
| **"Ash-Walker"** | Rare | Has burned down and rebuilt more times than they'll admit. |
| **"Iron-Forged"** | Rare | Shaped by heat and hammer. Cannot be talked out of it now. |
| **"Unbroken"** | Epic | The streak that outlived every reason to quit. |
| **"The Relentless"** | Epic | Rest is a rumour they've chosen not to believe. |

**Pop-culture leaning** (same `TITLE` type — current student / internet slang, in-voice):

| Item | Rarity | Lore |
|---|---|---|
| **"Locked In"** | Common | Phone face-down, door shut. Don't bother knocking. |
| **"Built Different"** | Uncommon | Same 24 hours as everyone else. Uses them like nobody else. |
| **"Main Character"** | Rare | The story's about them now. Everyone else is just in it. |
| **"Cracked"** | Rare | Unreasonably good at this. It's almost rude. |
| **"Villain Arc"** | Rare | Got tired of losing quietly. Now everyone's about to find out. |
| **"Final Boss"** | Epic | The name at the top of the ladder that nobody wants to fight. |
| **"The GOAT"** | Epic | Greatest of all time, and unbearably aware of it. |

**End-of-season** (earn-only — awarded for placement / milestones at season close, ties to §4b; **season-stamped**, e.g. renders as `Last Flame Standing · S1`. Never in loot boxes, never bought):

| Item | Rarity | Lore |
|---|---|---|
| **"Last Flame Standing"** | Epic | When every other fire went out, yours didn't. |
| **"Season MVP"** | Epic | Carried the whole arena on your back for ninety days. |
| **"The Undefeated"** | Epic | A whole season of challenges, and not one beat you. |
| **"Forged in Emberfall"** | Epic | You didn't survive the season. The season made you. |
| **"Ninety-Day Siege"** | Epic | Ninety days. No surrender, no dead mornings. |
| **"Ash Sovereign"** | Epic | Ruled the arena as the season burned down to ash. |

*By final placement* (which one you earn is decided by where you finish on your season leaderboard, §4b):

| Item | Placement | Rarity | Lore |
|---|---|---|---|
| **"Ascended"** | Rank 1 | Mythic | You didn't win the season — you transcended it. The arena has a new god. |
| **"Titan"** | Rank 2 | Legendary | A titan at the gates of Olympus, one single breath from godhood. |
| **"Demigod"** | Rank 3 | Legendary | Half-mortal, half-myth. The podium bows all the same. |
| **"The Untouchable"** | Top 1% | Epic | The rarest air of the season. Ninety-nine in a hundred never breathe it. |
| **"Elite Ember"** | Top 5% | Epic | The season's sharpest few — and you were one of them. |
| **"Ashborne"** | Top 10% | Epic | You closed the season in the highest tier the arena has. |
| **"Kept the Fire"** | Top 50% | Rare | Not the top, but you never let the fire go out. That counts. |

**Scope scales it (mock 66).** Two *kinds* of board (mock 42): **individual** boards where a person places, and the **collective** Vs-Unis board where whole universities place.

*Individual placement (you place):* same title name across scopes, but **rarity + treatment escalate with the pool**, and the season-stamp names the scope *and* the result:
- **Campfire** podiums cap at **Epic** (Rare–Epic) — a 6-person campfire #1 is not a god. Rank 1 = an Epic "Campfire Champion", stamp `🔥 CAMPFIRE #1`. The god-tier names (Demigod / Titan / Ascended) only start at **My Uni**.
- **My Uni** Rank 1 = **Mythic** "Ascended", stamp `🎓 [UNI] #1`.
- **Global** Rank 1 = **"Ascended · Global"** — a one-of-its-kind animated gold→red treatment, **the single rarest cosmetic in Philoi (one person per season)**, stamp `🌍 GLOBAL #1`.
- Percentile titles (Top 1% → 50%) carry the scope stamp too (`MIT · TOP 1%` vs `GLOBAL · TOP 1%`) — global percentiles read one rarity notch hotter.

*Collective (Vs-Unis — the school places, not you):* this board ranks **universities against each other** on aggregate member effort, so the reward is **campus-wide, not an individual god title**. Every contributing member of a **top-3 university** earns a shared seasonal campus title + banner, named by where the school finished:
- **#1 uni → "Prometheus' Disciples"** (Epic) — the flame-bringers; the campus that lit more than anyone.
- **#2 uni → "Keepers of the Flame"** (Epic).
- **#3 uni → "Champions of Academia"** (Epic).

The season's **top contributors** to their school's score get a **starred ★ Legendary** variant of their campus title. Nobody earns "Ascended" off this board — it's a team win.

### 2d · Campfire Banner Art — `BANNER` (Epic → Legendary)
Header art for a Campfire the user owns/edits. **Surfaced on the join preview (mock 62)** — a prospective member sees the banner *before* they join, so it does recruiting work: paired with avg rank / streak / hours-per-day / live challenges, an intense banner signals "these people are serious." A campfire's flex is a joining incentive, not just internal decoration.

| Item | Rarity | Lore |
|---|---|---|
| **Emberfall Night** | Epic | The sky over the arena, raining slow orange light. |
| **Ashfall Ridge** | Epic | A grey ridgeline under falling ash, where the serious ones train. |
| **Obsidian Colosseum** | Legendary | Black stone tiers rising into the dark. Every seat is watching. |
| **The Great Forge** | Legendary | The hall where ranks are hammered out of raw resolve. |

---

## 3 · Audio & Haptic Packs — *sensory feedback*

### 3a · Focus Audio Environments — `AUDIO` (Uncommon → Legendary)
Ambient loop under a lock-in.

| Item | Rarity | Lore |
|---|---|---|
| **Heavy Bonfire Crackle** | Uncommon | Now you can REALLY gather 'round the campfire. |
| **EDM Pulse** | Rare | For the techno lovers. |
| **Midnight Thunder** | Rare | Storms that stay on the horizon so you don't have to look up. |
| **Monastery Drone** | Epic | A single held note from people who gave their lives to focus. |
| **Lofi Lullaby** | Epic | "I heard Lofee Girl was ranked Diamond II in Philoi." |
| **Deep Space Sub-Bass** | Legendary | The sound the void makes when it's thinking. Felt more than heard. |

### 3b · Stop / Start Lock-In SFX — `SFX` (Rare → Legendary)
The sounds a session **begins** and **ends** on. One-shot stings, fired on the ignite tap and again
when you finish a lock-in — the two beats that bookend the thing this app is actually for.

Two slots, not one: **start sting** (`sfx_start`) and **end sting** (`sfx_stop`). Any SFX goes in
either, and the same one may sit in both — opening and closing on the same sound is a legitimate
choice, not a mistake.

These are **not** rank-up sounds. The rank-up moment has its own layered per-tier arrangement
(RANKUP_SPEC) and is never overridden by a cosmetic — an equipped sting replacing Immortal's
chime-and-souls would make the rarest moment in the app sound like the most ordinary one.

| Item | Rarity | Lore |
|---|---|---|
| **Heavy Anvil Slam** | Rare | One strike. It means the thing is finished and it is not coming apart. |
| **Sub-Bass Drop** | Rare | The floor falls out from under the moment. On purpose. |
| **Jet Engine Ignition** | Epic | Zero to gone. |
| **Olympian Foghorn** | Legendary | Echoes of this can be heard from Olympus. The gods are watching you. |

*Victory Anthem was removed from this set.* At 83 seconds it cannot punctuate anything, and the same
recording already serves as Hero's Champions Anthem on the band crossing — selling it as a cosmetic
made the app's rarest audio moment look like a shop item.

---

## 4 · Collection Badges & Trophies — *display showcase*
Shown off in the **Trophy Hall** on the profile (PROFILE_SPEC §D) + the personal vault. Non-equippable
prestige. **Earned only — never bought, never rolled from a box.**

### 4a · Ancient Relics — `RELIC` (Epic → Mythic) — **EARNED · SECRET**
Achievement unlocks, not box drops (decision Aug 20). **Remove from all box loot tables.**

🔒 **These are SECRET.** Unlike the discipline ladders (whose thresholds are shown), the ancient relics are
**hidden**: while locked, the Trophy Hall shows only a mysterious relic + a **cryptic hint** — never the
condition. The instant it's earned it **reveals** — *how you unlocked this* (the deed), the full lore, and what
it represents. **Discovery is the reward.** So each needs two authored things: the **lore/hint** (shown) and the
**hidden unlock** (internal — never surfaced before it's earned; telemetry may track progress silently).

*(Hestia's Hearthstone — **RETIRED**.)*

| Relic | Rarity | 🔒 Hidden unlock (internal only) | In-app hint (shown while locked) | On unlock — the deed + what it represents |
|---|---|---|---|---|
| **Athena's Aegis** | Epic | **Sequential consistency** — active (≥1 lock-in) every week for **6 consecutive weeks**, no dead week (tune) | *"Some shields are never lifted — because they are never set down."* | You came back, week after week, without a gap. **Defense of your standard** — the discipline that never drops its guard. |
| **Anvil of Hephaestus** | Legendary | **Total consistency** — **500 cumulative hours** locked in (all-time, not sequential). A brutal milestone only hardcore loyalists reach. | *"The gods' weapons were beaten out over countless hours on a single anvil. So is a person."* | 500 hours, forged. **Being forged** — the work didn't fill time, it made you the weapon. The mark of a true loyalist. |
| **Icarus' Feather** | Legendary | **Reach Hero rank** | *"Flew close to the sun and ascended past what was possible. Zeus admires his effort."* | You climbed to **Hero**. **Daring** — you flew close to the sun and ascended past what was thought possible. |
| **Prometheus' Shard** | Mythic | **Both:** (1) a **top-10% finish** logged on a season leaderboard (ever), **and** (2) **refer someone** who joins the app | *"Fire was never meant to be hoarded. The one who stole it gave it away."* | You reached the top **and** brought someone into the fire. **The pinnacle, shared** — mastery that doesn't just burn, it spreads. |
| **Zeus' Bolt** | Mythic | **Reach Primordial rank** (the summit of the whole ladder) | *"The king himself bows toward your greatness."* | You reached **Primordial** — the very top. **The pinnacle of pinnacles** — even Zeus inclines his head. |

- 🔒 **Never show the unlock condition in-app before it's earned** — only the hint. A visible checklist would
  kill the reveal moment.
- **Aegis vs Anvil are a deliberate pair:** Aegis = **sequential** loyalty (weeks in a row); Anvil = **total**
  loyalty (cumulative hours). Two ways to prove you stay.

### 4a-2 · Discipline Relics — `RELIC` (per lock-in type) — **EARNED, TIERED (4-tier ladder)**
One relic per discipline, but each is a **4-tier ladder** that upgrades through rarities as you go deeper — so
it's a running progression milestone, not a single distant unlock. Ipsative: pure effort/output, never an
outcome. Non-equippable showcase (Trophy Hall §4-relics group). **Earned only — never bought or rolled.** The
relic shows its **current tier** (rarity glow); the tap sheet shows the **next threshold**. Thresholds tunable.

**The relics (each rides one of the three ladders below):**

| Relic | Discipline | Ladder | Lore (top tier) | Symbolizes / represents for the student |
|---|---|---|---|---|
| **Hercules' Might** | Gym / Lift | Volume | Twelve labours. You're somewhere past the seventh — and it shows. | **Strength earned through labour.** Power isn't given, it's accumulated — pound by pound, set by set. |
| **Pheidippides' Sandals** | Movement (distance moved) | Distance | He crossed 414 km on foot to call for help. You've matched every step. | **Endurance.** The will to keep moving, mile after mile, for something that matters. |
| **Socrates' Scroll** | Study | Hours | The unexamined hour isn't worth logging. You examined a hundred. | **The examined hour.** Knowledge pursued, not just time passed — the mind sharpened on purpose. (Reading counts as study.) |
| **Daedalus' Blueprint** | Deep Work (building · coding · creating) | Hours | The labyrinth wasn't built in a day. Neither is whatever you're making. | **What you make.** Real things shipped through focused craft — building, coding, art, writing. The work behind the work. |
| **Oracle's Stillness** | Meditate | Hours | The Oracle spoke only in the quiet. You've kept a great deal of it. | **Inner stillness.** The rare discipline of doing nothing, well — clarity earned in silence. |

**Ladder A — Volume (Gym / Lift):**

| Tier | Total lifted | Rarity |
|---|---|---|
| I | 10,000 lb | Uncommon |
| II | 25,000 lb | Rare |
| III | 50,000 lb | Epic |
| IV | 100,000 lb | Legendary |
| V | 250,000 lb | Mythic |

**Ladder B — Distance (Movement — total distance *moved*; walking counts, NOT just running):**

| Tier | Distance | Rarity |
|---|---|---|
| I | 50 km | Rare |
| II | 100 km | Epic |
| III | 250 km | Legendary |
| IV | 414 km (Athens→Sparta round trip) | Mythic |

**Ladder C — Hours (Study · Deep Work · Meditate):** — caps at **Legendary** (hours are the
easiest metric to accumulate, so they don't mint Mythics).

| Tier | Hours | Rarity |
|---|---|---|
| I | 10 h | Uncommon |
| II | 25 h | Rare |
| III | 50 h | Epic |
| IV | 100 h | Legendary |

**Ceilings, by design (difficulty-weighted):** Gym (250k lb) and Movement (414 km) are hard → they reach
**Mythic**. Hours cap at **Legendary** (100 h is very reachable). Start points differ for the same reason —
Gym/Hours start Uncommon (10k / 10 h are trivial); Movement starts Rare (50 km is already real effort).
Lower tiers can reuse the top-tier lore or get a shorter "on your way" line each.

**Tier presentation — two independent signals on every relic tile:**
- **Rarity colour** (the tile glow/border — standard gaming palette): Uncommon **green** · Rare **blue** ·
  Epic **purple** · Legendary **orange** · Mythic **red**.
- **Greek tier letter** — a small, subtle glyph at the **bottom** of the tile marking which rung you're on:
  **α** I · **β** II · **γ** III · **δ** IV · **Ω** V (the peak). Colour = *rarity*, letter = *rung* — they're
  independent, so a maxed Hercules' Might reads **red + Ω**, a maxed Movement relic **red + δ** (its 4th rung is
  Mythic), a maxed Hours relic **orange + δ**, a first-rung anything **green + α**. Only Gym reaches **Ω**
  (it's the only 5-tier ladder — makes Ω genuinely rare).
- Standalone relics (Atlas' Burden §4a-3) show their rarity colour and, being a single peak, carry **Ω**.

**Deep Work covers all focused making** — coding, building, shipping, *and* creative work (art, music,
writing). Daedalus the master engineer stands for any of it. (Orpheus' Lyre / a separate Create discipline —
**retired**; creating folds into Deep Work.)

**Set-completion capstone:**

| Item | Earn | Rarity | Lore |
|---|---|---|---|
| **Crown of Olympus** | Reach the **top tier** of every Discipline Relic (Gym V · Movement IV · each Hours IV) | Mythic | Master of no single art, but of the discipline beneath all of them. Olympus has a seat for that. |

- **Metric per ladder** (accumulated from `check_ins` / sessions / synced data — tunable):
  - **Volume** (Gym) → total lb lifted.
  - **Distance** (Movement) → **total distance moved — walking counts**, from the fitness sync (Health/steps→km,
    Strava). Deliberately not run-only, so everyone can climb it.
  - **Hours** (Study · Deep Work · Meditate) → cumulative hours. (Reading rolls into Study; creating rolls into Deep Work.)
  (Where a synced metric isn't available, fall back to hours for that discipline.)
- **Tiering:** the relic is one showcase item that **upgrades its rarity/tier** as each threshold is crossed
  (I → IV). Award each tier once (idempotent); the tile shows the current tier's glow and the tap sheet shows
  the next threshold. Earned-only, **zero XP**, non-equippable — same firewall as every relic.
- New lock-in types added later get their own relic on the fitting ladder (keep the Greek-mythic naming + the
  "earned, never sold" rule). No obvious deity → nearest myth (e.g. a language type → **Hermes' Tongue**).

### 4a-3 · Strength-milestone relic (Mythic) — the Thousand Pound Club
A separate axis from Hercules' Might (which is *volume*): this is *max strength* — the classic powerlifting
**1000 lb club**. **Mythic**, earned-only, showcase, zero XP — same rules as every relic.

| Item | Earn | Rarity | Lore |
|---|---|---|---|
| **Atlas' Burden** | **1,000 lb total** — best bench + best squat + best deadlift (any variation) | Mythic | A thousand pounds carried across the three great lifts. Atlas nods in approval. |

**Represents for the student:** *bearing what would crush others* — the peak of raw strength. Atlas held up the
sky; you held up a thousand pounds across the three lifts that measure a body's true power.

**How it's earned (the engine):**
- Classify every logged gym exercise into one of three **families**: **bench** (flat / incline / decline /
  close-grip / dumbbell bench …), **squat** (back / front / box / goblet / hack …), **deadlift** (conventional /
  sumo / trap-bar / RDL / deficit …). Anything outside the three is ignored.
- Take the **single best (heaviest) working weight** in each family — estimated 1RM if the app tracks it,
  otherwise the top-set weight. **Max within a family, never the sum of its variations** (no double-counting an
  incline + flat bench).
- Award when **best_bench + best_squat + best_deadlift ≥ 1,000 lb**. Variation-agnostic by design: an incline DB
  press + a front squat + a trap-bar pull all count toward their families.
- Units: powerlifting convention is **lb**; if the member logs kg, convert (1000 lb ≈ 453.6 kg total).
- Data source: per-set gym logging (weight + exercise name) — the same data the gym logger already captures.
  Needs a small **exercise→family classifier** (name match on the variation list above; unknown lifts ignored).
- 🔴 Firewall: EARNED, never bought/rolled, **zero XP**, showcase-only (non-equippable), exactly like §4a / §4a-2.
- **Name: Atlas' Burden (FINAL).** Atlas holding the heavens is *the* universally recognized image of immense
  strength — the mythic match for the 1000 lb club, which is itself gym culture's canonical strength milestone.

### 4b · Seasonal Mastery Medals — `MEDAL` (Legendary)
Awarded for seasonal milestones / top campus placement. Season-stamped, never re-issued.

| Item | Rarity | Lore |
|---|---|---|
| **Emberfall Champion** | Legendary | A whole season burned down to ash around one flame that never went out. Yours. |
| **Campus Sovereign** | Legendary | There is no higher spot. You are the one they look up to, now. |
| **Unbroken Season** | Legendary | A full season without a single dead day. Almost no one earns this twice. |

---

## Notes for build / next steps
- **Graphics pass — DONE (mocks 61, 63, 64, 65):** vector art for every item, tinted by rarity aura (same construct as mocks 58–60). Mock 61 = God-Mode Flares + Relics + Halos; 63 = Flames + Particles; 64 = Card textures + Title schemas + Campfire banners; 65 = Audio + Rank-up SFX + Season medals.
- **Inventory (after art):** items grouped by type; each shows name, `RARITY · TYPE`, lore on tap, and **Equip / Unequip** (one active per equip-slot: Flame, Particle, Flare, Card, Halo, Title, Banner, Audio, SFX). Relics + Medals are showcase-only (no equip).
