# Emoji / placeholder-graphic audit (recent mocks + the code behind them)
_Every emoji-as-graphic in mocks 126–162, sorted by what it should actually become. Most are shorthand for art that already exists; only two categories are genuine new-art needs._

## ✅ Already has real art — swap the emoji for the component (no new graphic)
| Placeholder in mocks | Real art in app | Action |
|---|---|---|
| 🏛️ relic (131,132,134,160,162) | `ItemArt kind='relic'` (gem on plinth) | render `<ItemArt>`, not emoji |
| 🎁 box (132,137) | `box-art.tsx` (Ignition Crate → Promethean Vault) | render box-art |
| 🔥 flame (many) | `item-art` flame / `flame-logo` / campfire-flame | use the flame component |
| 🏆 trophy (137,139,156,157) | nav `ic-leaders` vector | use the icon |
| ⚔ challenge (132,134,156,157,160) | nav `ic-challenges` crossed swords | use the icon |
| 🎨 cosmetic, 🎒 inventory, 🛍 shop, 👤 profile, 🏕 campfire, 👥 friends, ⚙ settings, ☰ menu | full nav vector set (mock 158) | use the icon set |
| ✦ ember/spark | `ember-icon.tsx` / EmberIcon | use it |

## 🔤 UI glyphs — should be vector icons, not emoji (standard, not "custom art")
`→ ✓ ✕ ↑ ↓ ↔ ★ 🗑 👆 ↗ 💬 🔒 🎙 📍 📷 🎬` — arrows, checks, trash, tap, share, comment, lock, mic, location, camera, video. These are ordinary UI icons; use a consistent line set (many already exist in mock 158 / 162). No brand illustration required.

## 😊 Legitimately user-typed emoji — keep as emoji
`💪 😤 😭 😅 👏 🎯` when they appear **inside a user's post, comment, or a flavor caption** (Agora posts, challenge outcome mocks 144/146/150, DM 151). Real users type these; rendering them as emoji is correct. (👏 as a *cheer button* is the exception → that's the flame reaction.)

## 🎨 GENUINE new-art needs — make custom graphics
The code flags these itself:

1. **Discipline / activity icon set** — `goal-types.ts` `GOAL_TYPE_META` uses **raw emoji** (🏋️🏃📚📖📝🎯) and `GOAL_TYPE_ICON` / `CHALLENGE_TYPE_ICON` use **generic Ionicons** (barbell, walk, footsteps, bicycle, stopwatch, moon…). In-code comment: *"a raw emoji draws differently per OS and font version and cannot take a tint… sits in a themed row as a foreign object."* These appear as 📚🏋🏃📖 across mocks 130/147/149/152/153/154/162.
   → **Built as mock 163** — a unified, recolorable brand vector set. Swap-in points: `GOAL_TYPE_ICON`, `CHALLENGE_TYPE_ICON`.

2. ~~"Goal-as-fuel" flame objects (flaming dumbbell / pen / book)~~ — **RETIRED.** Old Philoi concept, didn't look good. `GOAL_TYPE_FLAME_META` should be dropped/ignored; the flame doesn't need an object burning inside it.

## Summary
Genuine custom art to produce: **the discipline icon set — done (mock 163)**. The goal-as-fuel flame illustrations are retired. Everything else is "use the component/icon that already exists" or "keep the user's emoji."
