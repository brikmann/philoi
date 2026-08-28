# Build prompt — Atlas' Burden (the 1000 lb club relic)

Add the Mythic strength relic from `ITEM_CATALOG.md §4a-3`. Earned when best bench + best squat + best deadlift
(any variation) ≥ **1,000 lb**. Rides the existing earned-relic path (same as Hercules' Might, migration 0090).

## 0. Art (mock: `design-mocks/118-atlas-burden-relic.html`)
- **Atlas standing** on a rocky peak, arms raised wide, head + chest **up** — holding the heavens overhead,
  *triumphant, presenting the weight, not buckling under it* (ref: user's image 2, not the kneeling one).
- Gold statue figure holding up **the sky — a glowing celestial sphere (the vault of heaven), warm-lit with
  stars on it. NOT a galaxy / not a ring.** Mythic violet-gold aura + faint starfield behind.
- Lore: *"A thousand pounds carried across the three great lifts. Atlas nods in approval."*
- Renders as a relic tile (rarity-glowed) like §4a relics: tile → tap → lore + the lift total that earned it.
- The SVG in mock 118 is a **stylized concept** — finalize as a proper illustration (illustrator or image-gen
  from this brief + image 2), exported at the relic asset size used by the other relics.

## 1. Catalog
- Add `relic-atlas-burden` to `src/lib/economy/catalog.ts` — copy Hercules' Might's entry shape:
  `type: 'RELIC', rarity: 'mythic', acquisition: 'earned'`, name `Atlas' Burden`, the §4a-3 lore. Showcase
  (non-equippable), like every relic.

## 2. Exercise → family classifier
- New helper: `liftFamily(exerciseName): 'bench' | 'squat' | 'deadlift' | null` — case-insensitive keyword match:
  - **bench**: `bench`, `incline`, `decline`, `close-grip`, `db bench` / `dumbbell bench` / `dumbbell press`
  - **squat**: `squat`, `front squat`, `back squat`, `box squat`, `goblet`, `hack squat` (NOT `leg press`)
  - **deadlift**: `deadlift`, `sumo`, `trap bar` / `hex bar`, `rdl` / `romanian`, `deficit`, `rack pull`
  - anything else → `null` (ignored). Keep the list explicit; err toward ignoring an unknown lift over
    misclassifying it.

## 3. The check (server, forward-only migration)
- For the user, compute the **single heaviest working-set weight per family** across their gym set history
  (use estimated 1RM if the schema tracks it, else the top-set weight). Ignore `null`-family lifts.
- If `best_bench + best_squat + best_deadlift >= 1000` (convert kg→lb where logged in kg: `lb = kg * 2.20462`),
  **award `relic-atlas-burden`** through the same earned-relic grant used by 0090 — **idempotent** (award once,
  `ON CONFLICT DO NOTHING`).
- 🔴 Firewall: earned, never sold/rolled, **zero XP**. This grants a showcase relic only.

## 4. Hook
- Evaluate where the other gym-metric relics are evaluated (the gym set-log / gym lock-in completion path that
  already accrues volume for Hercules' Might). Re-run the check after a gym set is logged; award the first time
  the total clears 1,000.

## Verify
- Log bench 315 + squat 405 + deadlift 315 (= 1,035) across sessions → Atlas' Burden awarded **once**; it shows
  in the Trophy Hall relics group.
- Total 995 → not awarded. Log a heavier set to cross 1,000 → awarded, no duplicate.
- An `incline DB press` + `front squat` + `trap-bar deadlift` all count toward their families; a second bench
  variation does **not** stack (max within a family, not sum).
- `npx tsc --noEmit` clean; new migration forward-only, not pushed (list as deploy-gated).
