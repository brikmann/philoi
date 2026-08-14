# Punchlist 13 — two SFX slots: a Start sting and an End sting

Extends PUNCHLIST_12. Instead of one SFX slot, give the player **two**: a sound when a lock-in
**starts** and a sound when it **ends**. Any SFX cosmetic goes in either slot, and the same one can sit
in both ("play the same thing twice"). More variety from the same catalog.

## The one real change — decouple equipped-slot from the owned row
Today equip state lives on `cosmetics_owned` (`slot` + `equipped` bool), so an item can be "equipped"
in exactly ONE slot. That can't express the same SFX in both Start and End. Move the loadout to its own
table:

```sql
create table equipped_loadout (
  user_id      uuid not null references auth.users(id) on delete cascade,
  slot         text not null,
  cosmetic_key text not null,
  primary key (user_id, slot)
);
-- equip_cosmetic(p_key, p_slot): upsert (user, slot) -> key  (ownership still checked first)
-- unequip_cosmetic(p_slot):      delete that (user, slot) row
-- get_inventory: read the loadout from here instead of cosmetics_owned.equipped/slot
```
This makes any item equippable in any number of slots and is simpler than the current per-row toggle.
Migrate the existing `equipped`/`slot` state into it once. (Rides the next `db push` — folds in with the
already-pending 0064–0069 batch.)

## Slots + catalog
- `EquipSlot` (catalog.ts): replace `sfx` with **`sfx_start`** and **`sfx_stop`**.
- `SLOT_LABEL`: `sfx_start: 'start sting'`, `sfx_stop: 'end sting'`.
- SFX items are no longer single-slot-by-type — the user chooses the slot on equip, so drop the
  `SLOT_FOR_TYPE['SFX']` auto-assignment and let SFX equip to either slot.

## Equip UI
- SFX item detail (shop + inventory): a **Start / End / Both** control instead of one "Equip". "Both"
  writes the key to both slots; equipping a different item to one slot leaves the other alone.
- Inventory tiles: show which slot(s) an SFX is in — a small ▶ (start) / ■ (end) badge, both lit when
  in both.
- The 6 AUDIO ambient items are unaffected (single `audio` slot).

## Wiring (builds on PUNCHLIST_12)
- **Start:** on lock-in begin (the ignite tap), play the `sfx_start` cue if equipped — layered over (or
  in place of) the stock `ignite`. Honor the sound preference; no-op if empty/unshipped.
- **End:** on `stopLockInSession` (lock-in/index.tsx ~419), play the `sfx_stop` cue — this is the
  PUNCHLIST_12 stop sting, now read from the `sfx_stop` slot.
- Rename `equippedRankUpCue()` → `equippedSfxCue(slot: 'sfx_start' | 'sfx_stop')`. Rank-up audio stays
  the layered per-tier system, never overridden.

## Assets
No new audio — the 4 stop-lock-in previews (PUNCHLIST_11) serve both slots; the same sting can play at
start and end. Victory Anthem stays removed (PUNCHLIST_12).

## Ship
One migration (the loadout table) + JS → next `db push` + OTA.
