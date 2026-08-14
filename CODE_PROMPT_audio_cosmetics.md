# Code prompt — audio cosmetics: previews + SFX rescope + two SFX slots

Implements PUNCHLIST_11, 12, and 13 together (they touch the same equip + sound code). Full detail
lives in those files; this is the build order. All JS + one migration + preview assets already cut in
`assets/audio/cosmetic/preview/`. Ships OTA except the migration, which rides the next `db push`.

## Build in this order

### 1 · Schema — decouple equipped-slot from the owned row (PL13)
The current model (`cosmetics_owned.slot` + `equipped`) can't hold one item in two slots. Add:
```sql
create table equipped_loadout (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null,
  cosmetic_key text not null,
  primary key (user_id, slot)
);
```
- `equip_cosmetic(p_key, p_slot)` → ownership check, then upsert `(user, slot) -> key`.
- `unequip_cosmetic(p_slot)` → delete that `(user, slot)` row.
- `get_inventory` → read the loadout from this table (not `cosmetics_owned.equipped/slot`).
- One-time migrate existing equipped/slot state into it.

### 2 · Slots + catalog (PL12/13)
- `EquipSlot`: replace `sfx` with `sfx_start` and `sfx_stop`.
- `SLOT_LABEL`: `sfx_start: 'start sting'`, `sfx_stop: 'end sting'`.
- Drop `SLOT_FOR_TYPE['SFX']` auto-assign — SFX equips to a slot the user picks, not one derived from
  type.
- Retitle ITEM_CATALOG.md §3b "Rank-Up & Challenge SFX" → **"Stop / Start Lock-In SFX"**; reframe as
  the sounds a session begins and ends on.

### 3 · Remove Victory Anthem from the SFX set (PL12)
An 83s anthem can't be a session sting, and it's already Hero's Champions Anthem on rank-up. Remove
`sfx-victory-anthem` from `catalog.ts` SFX[], from the `RewardCue` union + `SOURCES` in `sound.ts`, and
delete `assets/audio/cosmetic/sfx-victory-anthem.mp3` + the stale
`assets/audio/cosmetic/preview/sfx-victory-anthem-preview.mp3` (read-only in the sandbox — remove on the
real machine).

### 4 · sound.ts — rescope cues + preview player (PL11/12)
- Rename `equippedRankUpCue()` → `equippedSfxCue(slot: 'sfx_start' | 'sfx_stop')`. **Remove the rank-up
  override** — rank-up always plays the stock layered per-tier cues (RANKUP_SPEC), never a cosmetic.
- Add the preview player (single-shot, no loop, one at a time, auto-stop on finish):
```ts
const PREVIEW_SOURCES: Record<string, number> = {
  'audio-heavy-bonfire-crackle': require('../../assets/audio/cosmetic/preview/audio-heavy-bonfire-crackle-preview.mp3'),
  'audio-edm-pulse':             require('../../assets/audio/cosmetic/preview/audio-edm-pulse-preview.mp3'),
  'audio-midnight-thunder':      require('../../assets/audio/cosmetic/preview/audio-midnight-thunder-preview.mp3'),
  'audio-monastery-drone':       require('../../assets/audio/cosmetic/preview/audio-monastery-drone-preview.mp3'),
  'audio-lofi-lullaby':          require('../../assets/audio/cosmetic/preview/audio-lofi-lullaby-preview.mp3'),
  'audio-deep-space-sub-bass':   require('../../assets/audio/cosmetic/preview/audio-deep-space-sub-bass-preview.mp3'),
  'sfx-heavy-anvil-slam':        require('../../assets/audio/cosmetic/preview/sfx-heavy-anvil-slam-preview.mp3'),
  'sfx-sub-bass-drop':           require('../../assets/audio/cosmetic/preview/sfx-sub-bass-drop-preview.mp3'),
  'sfx-jet-engine-ignition':     require('../../assets/audio/cosmetic/preview/sfx-jet-engine-ignition-preview.mp3'),
  'sfx-olympian-foghorn':        require('../../assets/audio/cosmetic/preview/sfx-olympian-foghorn-preview.mp3'),
};
export function hasPreview(id: string): boolean {}
export function playPreview(id: string): void {}   // stop current, build one-shot, play, ~0.9 vol
export function stopPreview(): void {}
export function previewingId(): string | null {}
```

### 5 · Lock-in wiring (PL12/13)
- **Start:** on the ignite tap, play `equippedSfxCue('sfx_start')` if set — layered over/in place of the
  stock `ignite`. Honor the sound preference; no-op if empty/unshipped.
- **End:** at `stopLockInSession(...)` (src/app/lock-in/index.tsx ~419), stop the ambient loop first,
  then play `equippedSfxCue('sfx_stop')`.

### 6 · Equip UI (PL13)
- SFX item detail (shop + inventory): a **Start / End / Both** control in place of one "Equip". "Both"
  writes the key to both slots.
- Inventory tiles: ▶ (start) / ■ (end) badge showing which slot(s) an SFX occupies, both lit for both.

### 7 · Preview UI — three spots, gated to type AUDIO or SFX (PL11)
- **Item detail** (shop/item/[itemId].tsx + inventory/[itemId].tsx): play/pause by the art; reflect
  `previewingId()`; **stop on blur/unmount**.
- **Box-open reveal** (shop/open.tsx): auto-play the pulled item's preview once on reveal (hero pull
  only for ×10), with tap-to-replay.
- **Featured cards + inventory tiles:** small ▶/speaker badge; tap plays inline; starting one stops any
  other. Only one preview plays at a time.

## Before you finish
- `git add supabase/migrations/ supabase/functions/ assets/audio/cosmetic/preview/` — the audio batch
  and these new previews are currently untracked.
- Verify on Android + iOS: preview plays/stops in all three spots, start/end stings fire on the right
  events, rank-up audio is unchanged, and one item equipped to Both plays at both start and end.
