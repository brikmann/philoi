# Code Prompt — Forge: output ONLY un-owned items (amend the built 0138) + confirm

Small, exact amendment to the Forge you just built on `worktree-forge`. Noah's final call: the forge must produce **only items the user doesn't already own** — not "prefer un-owned," and **no dupe-salvage-to-embers fallback ever.** This changes the roll and adds one rejection path, then re-proves it.

`0138_forge_combine.sql` is committed but **not yet `db push`ed**, so amend it **in place** (no follow-up migration needed — a same-number edit is fine because nothing has deployed it). Keep everything else about the forge exactly as built.

## The change
1. **Roll from the un-owned subset only.** In `forge_combine`, the output must be drawn from `box_droppable_items` at the target rarity **minus the items the caller already owns** (`cosmetics_owned`). Remove the "prefer un-owned, else salvage the dupe to embers" logic entirely — the forge never grants embers in place of an item and never rolls a key the user holds.
2. **Add the `tier_complete` rejection.** If the caller owns **every** droppable item at the target rarity (the un-owned set is empty), there's nothing to forge toward — reject with a clear reason code (`tier_complete`) instead of salvaging. Do this **before** consuming any inputs (fail closed, consume nothing on rejection).
3. **Client (`/forge`, mock 155):** when a rung's target tier is fully owned, **grey it and explain** ("You own every Epic — nothing to forge toward"), and surface the `tier_complete` reason if the RPC is hit anyway. The on-screen promise already reads "a random Epic you don't own" — behaviour now matches it exactly.

## Leave untouched
- The season guarantee (output from `box_droppable_items`; inputs must be in it + carry a box/paid source; Emberfall/relics/starter gear rejected).
- Input validation (exact count, same rarity, ownership, mythic-never-input), the consume-and-grant **single transaction**, and the fail-closed-on-empty-allowlist posture.
- The ladder ratios and every other rung.

## Confirm (re-run the rolled-back harness, prove the harness first with a deliberate fail)
- `3 Rare → 1 Epic` grants a drop-pool epic **the caller does not already own**, and consumes exactly three.
- **New assertion:** over many `3 Legendary → 1 Mythic` runs, **every output is a key the caller did not own before the roll** (never a dupe).
- **New case:** a caller who owns **all** droppable items at the target rarity → `forge_combine` **rejects with `tier_complete`** and **consumes nothing** (inputs still present afterward).
- Unchanged rejections still hold: wrong count, duplicate ids, unowned, mythic-as-input, relic, Flame-Pass legendary — all refused, item still there.
- `tsc --noEmit` clean; no new lint in touched files.

## Done =
`forge_combine` can only ever output an item the caller doesn't own; owning the whole target tier disables that rung (`tier_complete`, nothing consumed) rather than paying embers; the client greys and explains a complete tier; the harness proves "output never already owned" and "all-owned rejects," with every prior guarantee intact. Report the harness output.

---
*(Still open separately, not in this amendment unless Noah says so: the 5×Common→1Uncommon rung — the drop pool has only four commons. Options remain add a 5th droppable common / drop the ratio to 4→1 / leave dark.)*
