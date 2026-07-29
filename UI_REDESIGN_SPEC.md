# Philoi — UI / Visual Redesign Spec (v1)

*Direction: sharp & edgy (Strava), not soft & minimal (Forest) — but keep the campfire soul so it's determined **and** warm, not cold-elite. Target feeling: open the app and think "holy shit, these people are what I've needed" — exclusive, alive, determined, never intimidating.*

---

## The design thesis (one line)

**A dark, high-contrast athletic arena lit by firelight.** Strava's sharpness gives you *exclusive + determined*; the campfire warmth (fire accents, human copy, real faces) keeps it *helpful + not intimidating*. That tension is the whole identity — resolve every screen against it.

- *Why not Forest:* soft pastels + rounded everything undercut competition and exclusivity. It would feel like a wellness toy.
- *Why not pure Strava:* pure Strava is cold and solo-athlete. Philoi is community and warmth. So: Strava's structure, a campfire's glow.

## Naming & voice — the Campfire

- **Circles are renamed "Campfires."** A Campfire is a friend group — the place your people gather. (Internal code can keep `group`/`circle`; this is user-facing copy only, **no schema change**.)
- **Home / hub = "Camp"** (working label — or plain "Home"): the screen listing all your Campfires with the Lock-In hero on top. *(Confirm the home label.)*
- **The relaxation trap + the fix.** "Campfire" risks reading as cozy/relaxation, which fights the athletic, determined energy. Fire is a *dual* metaphor — so we run it in the **heat/intensity register** (never cozy) *and* make the flame **dynamic** (see the living-flame mechanic below), so a Campfire is something you *feed*, not somewhere you *chill*.

### Copy register — heat, not cozy
- **Use (intensity / go-getter):** "burning bright," "keep it lit," "stoke the fire," "who's fueling the fire," "your Campfire's roaring," "the fire's dying — nobody's locked in," "don't let it go out," "locked in."
- **Avoid (cozy / passive):** cozy, relax, unwind, chill, s'mores, warm & fuzzy, hang out, kick back.
- *Rule of thumb:* every Campfire line should imply **effort and heat**, not comfort.

## Why it currently reads as "AI slop" (diagnosis → fix levers)

Your theme today: `Fredoka` (rounded, friendly display), `cream` (#FFF6EC) background, 18px radii, coral accent. That specific combo *is* the generic friendly-SaaS template — soft, low-contrast, static, safe. Five levers fix it:

1. **Type** — the single biggest tell. Rounded Fredoka reads "cute template." Swap for a bold, tight, athletic face.
2. **Contrast** — go dark-first. Cream-on-white is flat; firelight only glows against dark.
3. **Density** — more data-forward (numbers, ranks, activity), less floaty whitespace. Arena, not brochure.
4. **Motion** — static screens feel cheap. Rank-ups, live timers, XP ticks = premium.
5. **A signature motif** — the hexagon rank + firelight glow, used consistently so the app is instantly "Philoi," not a template.

---

## Foundations (design system)

### Color — dark-first, firelight accent
Ship **dark as the default/hero theme**, light as the toggle.

- **Base (dark):** plum-tinted near-black so it stays warm, not clinical — e.g. `#14121A` app bg, `#1F1B2A` elevated surface, `#2A2438` cards. (Warm black, not blue-black.)
- **Accent (the fire):** keep coral→amber as the energy gradient — `#E0612C → #F2A33C`. This is your Strava-orange, already on-brand. Use for XP, primary CTA, the live Lock-In state, the flame.
- **Signature glow:** you already have a coral shadow on primary buttons — promote it to a motif. Active/important elements get a soft firelight halo. Nothing important is flat.
- **Semantic:** `green #3DA85C` streak/success, `sky #4FB0E5` info, `ember #FFD27A` highlights/sparks.
- **Light theme:** keep the cream set for the toggle, but design dark-first and port down.

### Type — swap the soul
- **Display/headers + big numerals:** replace Fredoka with a **bold, tight, athletic** face (heavy grotesk / lightly condensed — Archivo, Clash, Anton-style). This one change kills most of the slop feeling. Use oversized confident numbers for XP, rank, session time (Strava-style data hero).
- **Body:** a clean neutral sans (Inter, or keep Nunito but drop the rounded weights). Prioritize legibility.

### Shape & density
- Tighten radii: cards `18 → 10–12`, buttons `16 → 10`. Reserve the full pill only for avatars and tags.
- Increase information density — structured modules and dividing lines over floaty drop-shadow cards.

### Motion (biggest premium lever)
- Rank-ups (below), live pulsing Lock-In timer (firelight breathe), XP tick-up counters, streak-flame flicker, haptics on lock/stop. Reuse the existing RewardBurst tiers for the audio/particle layer.
- **The living flame** — each Campfire's flame is a live activity gauge, not decoration. This is *the* signature motif; full spec in the Campfire component below.

---

## Component specs

### 1. Camp (home/hub) + the Campfire (a friend group)
- **Camp (home):** header **"Hey {Name}, let's lock in today."** in the big athletic display. Hero = one action: a large, glowing, firelit **Lock In** button (one tap to start). Below it, your Campfires — each showing its **living flame** + streak — and "🔥 3 people locked in right now."
- **The Campfire (each friend group):** the gathering + competition space — real-time presence, the merged feed/chat, the leaderboard, and the **living flame** front and center.
- Sharper + richer than today: edge-lit structured modules instead of soft cards; real faces + human copy for warmth.

#### The living flame (signature mechanic)
Each Campfire's flame is a **live gauge of the group's activity**, not decoration:
- Everyone locked in / active today → flame **roars**: tall, bright, animated, firelight glow spilling into the UI.
- Activity fading → flame **dies down** to embers; dims and cools.
- Dormant → nearly out; cold, grey.

This flips the metaphor from cozy-static to **demanding-dynamic**: a fire you must *feed*. A dying flame is a built-in loss-aversion nudge ("don't let it go out") that pulls people back — go-getter energy, not relaxation. Bonus: a roaring fire looks *populated* even with 4 people, so it makes a small Campfire feel alive (serves the "make one cluster alive" strategy). Drive brightness off a simple signal — members locked in today + streak health.

### 2. The Lock-In focus block — the flaming session

The focus-block visual (Philoi's answer to Pomofocus / Forest / Habitica) is **a flaming version of the activity itself**, typed to your goal — not a generic timer.

- **Goal-typed hero icon, on fire:** Study → flaming pen. Gym → flaming dumbbell. Job apps → flaming stack of papers. Hobby → flaming [instrument/brush] or a generic flaming spark. One curated hero icon per goal type at launch + a generic flaming fallback for custom goals.
- **The fire tracks the session:** the flame builds and intensifies the longer you stay locked in (live progress during the block, the way Forest grows a tree) — previewing the effort→XP payoff. Stop early and the flame gutters out. This is the individual-session version of the living-flame system.
- **Body-double (people joining your session):** each person who joins is rendered as **another figure doing the same flaming activity**, gathered into the session — the visible "we're locked in together" image. In a mixed session, each figure shows their *own* flaming object (one person's flaming pen next to another's flaming dumbbell). This is the Focusmate/body-doubling value delivered as a picture, not a label.
- *Eng note:* keep it lightweight (Lottie or a cheap shader) — animated flames × multiple figures can get heavy in React Native; budget for perf and cap the visible figures.

**One coherent fire hierarchy** (worth designing as a system, not three separate flames): your **session flame** (individual lock-in) feeds your **Campfire's living flame** (group activity today) which feeds your **streak + XP + rank**. Same visual language at every level — session → group → identity.

### 3. Dark mode
- Dark = default, light = toggle in settings. Spec both token sets (a light/dark table of the colors above). Ensure WCAG-AA contrast in both.

### 4. Ranks — hexagon, animated (Liftoff-inspired)
- **Badge:** hexagon, metal tiers (Bronze / Silver / Gold / Diamond) with roman-numeral divisions (III → II → I). Color-coded metal + numeral so the rank is identifiable at a glance; XP bar to next division underneath.
- **Rank-up moment:** full-screen celebration on promotion (Bronze III → II, Gold I → Diamond III): the hexagon forges/flips, firelight flash + spark burst, the new rank slams in, haptic + RewardBurst sound. Make it **screenshot-worthy** — a shared rank-up is free marketing.
- Never rely on color alone — the numeral + hexagon shape carry the meaning (accessibility).

### 5. Leaderboard
- **Filter tabs underneath:** Streaks · Rank · XP per [week / all-time] · (per circle). Small feature, real utility.
- Dense, data-forward rows (Strava-feed density): avatar · name · rank hexagon · XP numeral · streak flame.
- Surface the head-to-head **"I'm better than you"** flag here.

---

## How the design delivers "exclusive, not intimidating"

- **Exclusive / determined:** dark, high-contrast, sharp type, hexagon ranks, premium motion → looks like a serious arena, not a toy.
- **Alive:** real-time "locked in now," motion, activity density → feels populated even at small scale.
- **Not intimidating:** firelight warmth, human copy, and *helpful* framing — progress bars always show the path *up*, not just where you rank; rounded avatars and real faces soften the sharp structure. Determined structure, warm humans.

## Guardrails

- **Don't let the redesign block shipping the Lock-In loop** (per V1_BUILD_SPEC) — the loop feeling good matters more than the skin. Ship the system tokens + Campfire + ranks first; polish the rest.
- Keep the flame/campfire brand equity — this sharpens it, doesn't replace it. Update `philoi_brand_kit.md` to match once locked.
- Accessibility: dark/light contrast, no color-only meaning, respect reduced-motion (rank-up should have a calm fallback).
