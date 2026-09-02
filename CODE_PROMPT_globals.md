# Code Prompt — Globals: BUILD relic population, forge flow, custom-goal pathway

Three Globals items, **confirmed broken on-device by Noah** (this is not an audit — build/fix each). On `integration-wave1`, one branch, client where possible (iterates over the wave1 dev-client Metro); migrations additive on the one push path.

Confirmed state:
- Discipline relics + secret relics **don't populate** in the profile at all.
- Forge **doesn't source inventory by rarity** — you can't throw items in, run the animation, and have the backend delete the three inputs and grant one higher-rarity item.
- Custom-goal pathway **isn't built** (a named goal under a category that counts).

---

## §1 · Relics populate in the profile (discipline ladder + secret)
The surface exists (`profile.tsx` → `TrophyHallSection`; `TrophyHall` type already has a `relics: HallRelic[]` field), but nothing fills it with the current relic families.

**Prime suspect:** `get_trophy_hall` was built in `0092`, **before** `0119` recatalogued relics into discipline ladders (`relic_progress`) + secret/Greek relics. So its relic query is stale — it never reads the new tables, so `relics[]` comes back empty (or only old-shape entries), and the section renders nothing.

**Build:**
- **Migration (additive, wave1):** update `get_trophy_hall` to return, in `relics[]`, every relic the user has progress on — the **discipline-ladder relics** (Socrates' Scroll / Daedalus' Blueprint / Oracle's Stillness / Pheidippides' Sandals / Hercules' Might, from `relic_progress` with tier + progress) **and earned secret/Greek relics** (Zeus' Bolt, Atlas' Burden, Prometheus' Shard, …). Unearned secrets stay hidden (their design); in-progress ladders show at their current tier. Don't restate sibling functions — splice, prove `prosrc` removes nothing.
- **Client:** confirm `TrophyHallSection` (and the "see all" `trophy-hall.tsx`) renders the `relics[]` group with tier + progress. Wire it if the group isn't rendered.
- **Done:** an account with study hours / distance / etc. sees those discipline relics with progress in its profile hall, plus any earned secret relics.

---

## §2 · Forge works end-to-end (source → pick → animate → grant)
The backend is live (`forge_combine`, `0138`/`0139` — deletes the N inputs, grants one of the next rarity, un-owned only, season/relic/starter refused). `forge.tsx` has the skeleton (`useInventory` → `fuelByRarity`, `FORGE_LADDER`, the ErrorBoundary). But on-device the flow doesn't work: **fuel doesn't land, you can't feed items, no animation, no grant.**

**Build the full loop, debugging each stage:**
1. **Source inventory by rarity** — `fuelByRarity` must actually populate from `useInventory().owned`. Trace it: does `fetchInventory` return the account's cosmetics? is `isForgeFuel` filtering everything out (too strict on source/drop-pool)? Fix so each rarity's eligible fuel renders as pickable.
2. **Pick N and feed them in** — the user selects the required count for the chosen rung (5 Common → 1 Uncommon, 3 for the rest), with the count enforced in the UI before the forge button enables.
3. **Animation** — the hammer-strike reveal plays on forge.
4. **Backend due diligence** — call `forge_combine`; it deletes exactly the three (or five) inputs and grants one higher-rarity un-owned item. Confirm the client passes the right item ids and rarity, handles `tier_complete` (fully-owned target → greyed), and on success refetches inventory so the inputs are gone and the new item is present.
5. **Result lands** — the forged item shows in the reveal and in inventory immediately.

**Done:** on device, open `/forge`, see your owned cosmetics bucketed by rarity, feed the required count, watch the hammer reveal, and end with the three inputs gone and one higher-rarity item in your inventory. Report which stage was actually broken.

---

## §3 · Custom-goal pathway — create under a category + count toward it
Not built. `goal/create.tsx` lets you pick a `type` + optional `label`, but a named goal like **"KP231" under Study** doesn't land as a first-class member of the Study category that counts toward it.

**Build the full pathway:**
1. **Create** — a named goal ("KP231") is created **under a parent category** (Study), carrying `type='study'` (the label must NOT flip it to `custom` or strand it). Re-using the same name/category groups with the existing one rather than duplicating.
2. **Lands under the category** — it shows grouped under Study wherever goals/categories are listed (home, goal picker, profile breakdown), as a sub-item of Study.
3. **Counts toward the category** — time/XP on KP231 lock-ins feeds **Study's discipline ladder (Socrates' Scroll)** and Study's category totals, identical to an unlabelled Study lock-in. The relic feeder (`0119`) maps `goal_type → discipline family`, so the labelled goal must keep `type='study'` all the way through the check-in → ladder aggregation.
4. **Generalise** — this is the pattern for every category (a named Gym goal counts toward Gym, etc.), not a one-off for Study.

If the categorization/counting needs server work (the check-in → ladder/category aggregation treating labelled sub-goals as members of their type), that's an additive migration on wave1. Client covers the create + grouped display.

**Done:** create "KP231" under Study, it appears grouped under Study, and a lock-in on it counts toward the Study ladder + totals — and the same works for a named goal under any category.

---

## Guardrails
- One branch (`integration-wave1`), one push path; migrations additive, restate nothing, prove `prosrc`.
- Client-first (OTA via the dev-client Metro); report snapshot age before any prod push (PITR posture).
- Report, per section, what was actually broken and the fix — one line each.
