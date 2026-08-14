# Punchlist 11 — audio cosmetic previews

Let players HEAR an audio/SFX cosmetic before they buy or equip it. Today the 6 ambient loops and 5
SFX only play during a lock-in / as reward stings — there's no preview anywhere in the shop.

## Assets (already cut — in `assets/audio/cosmetic/preview/`)
~12s clips, faded in/out, loudness-normalized (−16 LUFS), 128 kbps. Cut from the best part of each
long track, NOT from 0:00.

| Cosmetic id | Preview |
|---|---|
| `audio-heavy-bonfire-crackle` | `preview/audio-heavy-bonfire-crackle-preview.mp3` |
| `audio-edm-pulse` | `preview/audio-edm-pulse-preview.mp3` (from the drop) |
| `audio-midnight-thunder` | `preview/audio-midnight-thunder-preview.mp3` |
| `audio-monastery-drone` | `preview/audio-monastery-drone-preview.mp3` |
| `audio-lofi-lullaby` | `preview/audio-lofi-lullaby-preview.mp3` |
| `audio-deep-space-sub-bass` | `preview/audio-deep-space-sub-bass-preview.mp3` (full 4s, tail-faded) |

These are the 6 ambient **lock-in tracks** (the AUDIO slot) — every one gets a preview.

**Stop-lock-in SFX previews** (the SFX slot — see PUNCHLIST_12 for the rescope). Short stings, so the
preview is the **full sting**, loudness-matched to the ambient previews with a tiny tail fade:

| Cosmetic id | Preview |
|---|---|
| `sfx-heavy-anvil-slam` | `preview/sfx-heavy-anvil-slam-preview.mp3` (2s) |
| `sfx-sub-bass-drop` | `preview/sfx-sub-bass-drop-preview.mp3` (7.6s) |
| `sfx-jet-engine-ignition` | `preview/sfx-jet-engine-ignition-preview.mp3` (5.6s) |
| `sfx-olympian-foghorn` | `preview/sfx-olympian-foghorn-preview.mp3` (8.3s) |

**`sfx-victory-anthem` gets NO preview** — it's Hero's rank-up anthem, not a stop-lock-in sting, and
is being removed from the SFX set (PUNCHLIST_12). ⚠️ Delete the stale
`preview/sfx-victory-anthem-preview.mp3` (read-only in the sandbox, couldn't be removed there).

(These files are new on disk — confirm they're `git add`ed with the rest of the audio batch, which is
currently untracked.)

## 1 · `src/lib/sound.ts` — a dedicated preview player
Separate from `AMBIENT_SOURCES` / the lock-in system. One shared preview player, single-shot (no
loop), torn down when a new preview starts, when the caller stops it, or on finish.

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

// Short SFX preview = their full one-shot file (reuse the cosmetic sources already in SOURCES).
// Resolution: PREVIEW_SOURCES[id] ?? the short-sfx cosmetic file ?? undefined (no-op).

export function hasPreview(itemId: string): boolean { /* PREVIEW_SOURCES or a known short sfx */ }
export function playPreview(itemId: string): void   { /* stop current, build one-shot, play, no loop */ }
export function stopPreview(): void                  { /* tear down the preview player */ }
export function previewingId(): string | null        { /* which id is currently previewing, for button state */ }
```
Notes: preview volume ~0.9; do NOT loop; auto-stop and clear state when the clip ends so the button
resets. If a lock-in is somehow running, `stopAmbientLoop()`-style isolation isn't needed (different
player), but `stopPreview()` on session start is a cheap safety.

## 2 · Wire the button — three spots (all gated to `type` AUDIO or SFX)
- **Item detail** (`src/app/shop/item/[itemId].tsx` + `src/app/inventory/[itemId].tsx`) — a play/pause
  control by the art. Tap = `playPreview(item.id)`, tap again or when another starts = stop. Reflect
  state from `previewingId()`. **Stop on blur/unmount** (navigating away kills the sound).
- **Box-open reveal** (`src/app/shop/open.tsx`) — when the pulled item is AUDIO/SFX, auto-play its
  preview once on the reveal (single, hero pull only for ×10 to avoid a pile-up), with a tap-to-replay
  affordance. Respect the user's sound preference if one exists.
- **Featured cards + inventory tiles** — a small speaker/▶ badge on AUDIO/SFX items; tap plays the
  preview inline without opening detail. Only one preview plays at a time (starting one stops another).

## Ship
All JS + 7 small preview assets → OTA. Net: any audio/SFX cosmetic is auditionable from the shop,
the reveal, and the tiles, and only one ever plays at once.
